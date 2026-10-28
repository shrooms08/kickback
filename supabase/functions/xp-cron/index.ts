// xp-cron: POST ?network=mainnet|testnet, called by pg_cron every hour (mainnet :10, testnet :25)
// with the cron secret. Snapshots the active stake (RPC getStakerByAddress, rate limited) of the
// wallets that can earn stake XP and have no snapshot today (a plan, or an active stake at the
// last snapshot: public.xp_cron_candidates), and awards daily stake XP once per UTC day. It walks
// them in address order from a cursor kept in cron_cursors, so each run goes on where the last
// one stopped. Wallets it doesn't reach in time get theirs on their next season read
// (snapshotStake is the same code).
import { db } from '../_shared/db.ts'
import { corsHeaders, json } from '../_shared/http.ts'
import { snapshotStake } from '../_shared/xpAward.ts'
import { utcDay } from '../_shared/xp.ts'
import type { Net } from '../_shared/chain.ts'

const BUDGET_MS = 120_000
const BATCH = 500

async function candidates(net: Net, day: string, after: string): Promise<string[]> {
  const { data, error } = await db.rpc('xp_cron_candidates', { p_network: net, p_day: day, p_after: after, p_limit: BATCH })
  if (error) throw error
  return (data ?? []).map((r: { address: string }) => r.address)
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req, '')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const { data: ok } = await db.rpc('cron_secret_ok', { p: req.headers.get('x-cron-secret') ?? '' })
  if (ok !== true) return json({ error: 'Forbidden' }, 403, cors)
  const net = new URL(req.url).searchParams.get('network') as Net
  if (net !== 'mainnet' && net !== 'testnet') return json({ error: 'network must be mainnet or testnet' }, 400, cors)
  const started = Date.now(), day = utcDay(started), name = `xp-${net}`
  let list: string[], after: string
  try {
    const { data: cur, error } = await db.from('cron_cursors').select('cursor').eq('name', name).maybeSingle()
    if (error) throw error
    after = cur?.cursor ?? ''
    list = await candidates(net, day, after)
    // Past the end: start again from the top.
    if (!list.length && after) { after = ''; list = await candidates(net, day, '') }
  }
  catch (error) {
    console.error('xp-cron', net, error)
    return json({ error: 'users unavailable' }, 500, cors)
  }
  let done = 0, failed = 0, last = after, finished = true
  for (const address of list) {
    if (Date.now() - started > BUDGET_MS) { finished = false; break }
    try { (await snapshotStake(address, net)).ok ? done++ : failed++ }
    catch { failed++ }
    last = address
  }
  // The whole list was walked: the next run starts from the top. Otherwise after the last wallet.
  const cursor = finished && list.length < BATCH ? '' : last
  const { error: cerr } = await db.from('cron_cursors').upsert({ name, cursor, updated_at: new Date().toISOString() }, { onConflict: 'name' })
  if (cerr) console.error('xp-cron cursor', cerr.message)
  return json({ network: net, candidates: list.length, done, failed, ms: Date.now() - started }, 200, cors)
})
