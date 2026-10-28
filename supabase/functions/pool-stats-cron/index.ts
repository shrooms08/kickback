// pool-stats-cron: POST ?network=mainnet|testnet, called by pg_cron every 15 minutes with the
// X-Cron-Secret header (checked against Vault inside the database).
//
// Mainnet: every direct-payout validator from the Validators API gets its reward address and
// on-chain state from the RPC, then its payout timing from a probe staker (1 unit) or a scan of
// the reward address (5 units a page, at most 3 pages). Listed non-direct validators are stored
// without payout timing (names for the app). Testnet: every active validator (RPC
// getActiveValidators); payout timing only for direct pools (Puddle, which pays as AddStake to
// the staking contract, so a probe staker's history doesn't show it: a short scan instead).
// The RPC client stays under the public node's limit (14 of 20 units per 10 s).
import { db } from '../_shared/db.ts'
import { corsHeaders, json } from '../_shared/http.ts'
import { createRpc, fromProbe, fromScan, nextPayoutAfter } from '../_shared/payouts.ts'
import type { PayoutStats, Rpc } from '../_shared/payouts.ts'
import { serverRest, serverRpcUrls } from '../_shared/rpcEndpoints.ts'

const CONFIG = {
  mainnet: { rpc: 'https://rpc.nimiqwatch.com', api: 'https://validators-api-main.je-cf9.workers.dev' },
  testnet: { rpc: 'https://rpc.testnet.nimiqwatch.com', api: 'https://validators-api-test.je-cf9.workers.dev' },
} as const
type Net = keyof typeof CONFIG

interface ApiV { address: string, name: string, fee: number, payoutType: string, payoutSchedule?: string, isListed?: boolean, score?: { total?: number, dataStatus?: string } }
interface ChainV { address: string, rewardAddress: string, inactivityFlag: number | null, retired: boolean, jailedFrom: number | null }

const norm = (a: string) => a.replace(/\s+/g, '').toUpperCase()
const spaced = (a: string) => norm(a).replace(/(.{4})/g, '$1 ').trim()

async function api<T>(net: Net, path: string): Promise<T> {
  const res = await fetch(CONFIG[net].api + path, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`Validators API ${path}: HTTP ${res.status}`)
  return await res.json() as T
}

async function probesFor(net: Net, reward: string): Promise<string[]> {
  const { data } = await db.from('pool_probes').select('probe_address').eq('network', net).eq('reward_address', spaced(reward)).order('learned_at', { ascending: false }).limit(3)
  return (data ?? []).map((r: { probe_address: string }) => r.probe_address)
}

async function timing(rpc: Rpc, net: Net, reward: string, allowScan: boolean): Promise<PayoutStats> {
  for (const p of await probesFor(net, reward)) {
    try {
      const s = await fromProbe(rpc, reward, p)
      if (s) return s
    }
    catch { /* next probe */ }
  }
  if (!allowScan) return { lastPaidAt: null, intervalH: null, batches: [], source: 'none' }
  const s = await fromScan(rpc, reward, 3)
  if (s.learned) await db.from('pool_probes').upsert({ network: net, reward_address: spaced(reward), probe_address: spaced(s.learned), learned_at: new Date().toISOString() })
  return s
}

function row(net: Net, v: ApiV | null, address: string, extra: Record<string, unknown>) {
  return {
    network: net,
    validator_address: spaced(address),
    name: v?.name ?? null,
    fee: v ? Number(v.fee) : null,
    payout_kind: v?.payoutType === 'direct' || v?.payoutType === 'restake' ? v.payoutType : 'unknown',
    score: typeof v?.score?.total === 'number' ? v.score.total : null,
    score_status: v?.score?.dataStatus ?? null,
    listed: v ? !!v.isListed : false,
    payout_schedule: v?.payoutSchedule || null,
    updated_at: new Date().toISOString(),
    ...extra,
  }
}

function timingCols(s: PayoutStats | null) {
  return {
    last_payout_at: s?.lastPaidAt ? new Date(s.lastPaidAt).toISOString() : null,
    median_interval_s: s?.intervalH ? Math.round(s.intervalH * 3600) : null,
    next_payout_estimate_at: s ? (nextPayoutAfter(s.lastPaidAt, s.intervalH) ? new Date(nextPayoutAfter(s.lastPaidAt, s.intervalH)!).toISOString() : null) : null,
  }
}

/** Known direct pools' reward addresses (checked on chain 2026-10-28; same table in src/services/knownPools.ts). */
const KNOWN_REWARDS: Record<string, string> = {
  NQ321U9X7P3XB2H5XA005LC25KFEVBQEX3BU: 'NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717',
  NQ155JNSU7CERAH53T02F8A9JCT6QMG97TSV: 'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV',
}

/**
 * Reward addresses when getValidatorByAddress can't be read (RPC down, the REST fallback has no
 * validator route): the last stored value for the same validator, else the known-pools table.
 * Nothing is ever inferred for a validator that never had one.
 */
async function fallbackRewards(): Promise<Map<string, { reward: string, active: boolean }>> {
  const out = new Map<string, { reward: string, active: boolean }>()
  for (const [v, reward] of Object.entries(KNOWN_REWARDS)) out.set(v, { reward, active: true })
  const { data: prev } = await db.from('pool_stats').select('validator_address, reward_address, active').eq('network', 'mainnet').not('reward_address', 'is', null)
  for (const r of prev ?? []) out.set(norm(r.validator_address), { reward: r.reward_address, active: !!r.active })
  return out
}

async function runMainnet(rpc: Rpc) {
  const [direct, known, status] = await Promise.all([
    api<ApiV[]>('mainnet', '/api/v1/validators?payout-type=direct&only-known=false'),
    api<ApiV[]>('mainnet', '/api/v1/validators').catch(() => [] as ApiV[]),
    api<any>('mainnet', '/api/v1/status').catch(() => null),
  ])
  const elected = new Set<string>((status?.validators?.electedValidators ?? []).map((v: { address: string }) => norm(v.address)))
  const rows: Record<string, unknown>[] = []
  let fallback: Map<string, { reward: string, active: boolean }> | null = null
  for (const v of direct.filter(v => v.payoutType === 'direct')) {
    let chain: ChainV | null = null, lookupFailed = false
    try { chain = await rpc.call<ChainV>('getValidatorByAddress', [v.address]) }
    catch (e) { lookupFailed = !/not\s*found|no validator/i.test(String((e as Error).message)) }
    // RPC trouble is not "inactive": keep the last known reward address (or one learned from a probe).
    const known = !chain && lookupFailed ? (fallback ??= await fallbackRewards()).get(norm(v.address)) ?? null : null
    const reward = chain?.rewardAddress ?? known?.reward ?? null
    const active = chain ? chain.inactivityFlag == null && !chain.retired && chain.jailedFrom == null : !!known && elected.has(norm(v.address))
    const isElected = elected.has(norm(v.address))
    let s: PayoutStats | null = null
    if (reward && active) {
      try { s = await timing(rpc, 'mainnet', reward, true) }
      catch (e) { console.error('timing', v.name, (e as Error).message) }
    }
    rows.push(row('mainnet', v, v.address, { reward_address: reward ? spaced(reward) : null, active, elected: isElected, ...timingCols(s) }))
  }
  const seen = new Set(rows.map(r => norm(String(r.validator_address))))
  for (const v of known.filter(v => !seen.has(norm(v.address)))) rows.push(row('mainnet', v, v.address, { elected: elected.has(norm(v.address)), active: elected.has(norm(v.address)) }))
  return rows
}

async function runTestnet(rpc: Rpc) {
  const [active, known] = await Promise.all([
    rpc.call<ChainV[]>('getActiveValidators', []),
    api<ApiV[]>('testnet', '/api/v1/validators').catch(() => [] as ApiV[]),
  ])
  const rows: Record<string, unknown>[] = []
  for (const a of active ?? []) {
    const v = known.find(k => norm(k.address) === norm(a.address)) ?? null
    const ok = a.inactivityFlag == null && !a.retired && a.jailedFrom == null
    // Reward addresses here are the validators themselves (flooded with block rewards): only
    // direct pools are worth a scan.
    let s: PayoutStats | null = null
    try { s = await timing(rpc, 'testnet', a.rewardAddress, v?.payoutType === 'direct') }
    catch (e) { console.error('timing', a.address, (e as Error).message) }
    rows.push(row('testnet', v, a.address, { reward_address: spaced(a.rewardAddress), active: ok, elected: true, ...timingCols(s) }))
  }
  return rows
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req, '')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const { data: ok } = await db.rpc('cron_secret_ok', { p: req.headers.get('x-cron-secret') ?? '' })
  if (ok !== true) return json({ error: 'Forbidden' }, 403, cors)
  const net = new URL(req.url).searchParams.get('network') as Net
  if (net !== 'mainnet' && net !== 'testnet') return json({ error: 'network must be mainnet or testnet' }, 400, cors)
  const started = Date.now()
  const rpc = createRpc(serverRpcUrls(net), 14, { rest: serverRest(net) })
  try {
    const rows = net === 'mainnet' ? await runMainnet(rpc) : await runTestnet(rpc)
    if (rows.length) {
      const { error } = await db.from('pool_stats').upsert(rows, { onConflict: 'network,validator_address' })
      if (error) throw error
      // Validators that dropped out of this run are no longer active or elected.
      const keep = rows.map(r => r.validator_address as string)
      await db.from('pool_stats').update({ active: false, elected: false, updated_at: new Date().toISOString() }).eq('network', net).not('validator_address', 'in', `(${keep.map(a => `"${a}"`).join(',')})`)
    }
    const summary = { network: net, pools: rows.length, withPayouts: rows.filter(r => r.last_payout_at).length, rpc: rpc.stats(), ms: Date.now() - started }
    console.log('pool-stats-cron', JSON.stringify(summary))
    return json(summary, 200, cors)
  }
  catch (error) {
    console.error('pool-stats-cron', net, error)
    // The details stay in the function log; the caller only learns that the run failed.
    return json({ error: 'pool stats run failed', ms: Date.now() - started }, 500, cors)
  }
})
