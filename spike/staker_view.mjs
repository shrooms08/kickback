// From the staker's side: does a cheap getTransactionsByAddress(stakerAddr) show pool payouts?
import { rpc, stats } from './rpc.mjs'
import { writeFileSync } from 'node:fs'
const cases = [['NQ98 HGEF CD04 RHPK GYT6 YM9S U0CY PA0M CGD5', 'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV'], ['NQ78 G9Q9 JUCM N8GC R6FM 67MS 254L N05S YR1E', 'NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717']]
const res = {}
for (const [staker, payer] of cases) {
  const t = await rpc('getTransactionsByAddress', [staker, 50, null])
  const p = t.filter(x => x.from === payer)
  res[staker] = { fetched: t.length, fromPayoutAddress: p.length, latest: p.slice(0, 4).map(x => ({ at: new Date(x.timestamp).toISOString(), nim: x.value / 1e5, hash: x.hash })) }
}
writeFileSync('data/staker_view.json', JSON.stringify(res, null, 2))
console.log(JSON.stringify(res, null, 1), '\nrpc', stats.calls, 'calls, throttled', stats.throttled, JSON.stringify(stats.limits))
