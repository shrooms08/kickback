// xp-cron: POST ?network=mainnet|testnet, called by pg_cron at 00:10 / 00:25 UTC with the cron
// secret. Snapshots every signed-in wallet's active stake (RPC getStakerByAddress, rate limited)
// and awards daily stake XP once per UTC day. Wallets it doesn't reach in time get theirs on
// their next season read (snapshotStake is the same code).
import { db } from '../_shared/db.ts'
import { corsHeaders, json } from '../_shared/http.ts'
import { snapshotStake } from '../_shared/xpAward.ts'
import type { Net } from '../_shared/chain.ts'

const BUDGET_MS = 120_000

Deno.serve(async (req) => {
  const cors = corsHeaders(req, '')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const { data: ok } = await db.rpc('cron_secret_ok', { p: req.headers.get('x-cron-secret') ?? '' })
  if (ok !== true) return json({ error: 'Forbidden' }, 403, cors)
  const net = new URL(req.url).searchParams.get('network') as Net
  if (net !== 'mainnet' && net !== 'testnet') return json({ error: 'network must be mainnet or testnet' }, 400, cors)
  const started = Date.now()
  const { data: users, error } = await db.from('users').select('address').eq('network', net).order('last_seen_at', { ascending: false })
  if (error) return json({ error: 'users unavailable' }, 500, cors)
  let done = 0, failed = 0
  for (const u of users ?? []) {
    if (Date.now() - started > BUDGET_MS) break
    try { (await snapshotStake(u.address, net)).ok ? done++ : failed++ }
    catch { failed++ }
  }
  return json({ network: net, users: users?.length ?? 0, done, failed, ms: Date.now() - started }, 200, cors)
})
