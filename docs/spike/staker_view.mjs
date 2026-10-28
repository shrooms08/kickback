// From the staker's side: does a cheap getTransactionsByAddress(stakerAddr) show pool payouts?
import { rpc, stats } from './rpc.mjs'
import { writeFileSync } from 'node:fs'
// Usage: node staker_view.mjs "<staker address>" "<pool payout address>" [more pairs ...]
const args = process.argv.slice(2)
if (!args.length || args.length % 2) { console.error('usage: node staker_view.mjs "<staker>" "<payout address>" ...'); process.exit(1) }
const cases = []
for (let i = 0; i < args.length; i += 2) cases.push([args[i], args[i + 1]])
const res = {}
for (const [staker, payer] of cases) {
  const t = await rpc('getTransactionsByAddress', [staker, 50, null])
  const p = t.filter(x => x.from === payer)
  res[staker] = { fetched: t.length, fromPayoutAddress: p.length, latest: p.slice(0, 4).map(x => ({ at: new Date(x.timestamp).toISOString(), nim: x.value / 1e5, hash: x.hash })) }
}
writeFileSync('data/staker_view.json', JSON.stringify(res, null, 2))
console.log(JSON.stringify(res, null, 1), '\nrpc', stats.calls, 'calls, throttled', stats.throttled, JSON.stringify(stats.limits))
