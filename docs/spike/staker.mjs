// getStakerByAddress on sample payout recipients + inspect payouts sent to the staking contract
import { rpc } from './rpc.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
// Usage: node staker.mjs "<staker address>" ["<staker address>" ...]
// Pick recipients from the payout_history.mjs output. Run payout_history.mjs for Nimiq.Fun first.
const stakers = process.argv.slice(2)
if (!stakers.length) { console.error('usage: node staker.mjs "<staker address>" ...'); process.exit(1) }
const out = {}
for (const a of stakers) {
  try { out[a] = await rpc('getStakerByAddress', [a]) } catch (e) { out[a] = { error: e.message } }
  try { out[a + ' (account)'] = await rpc('getAccountByAddress', [a]) } catch (e) { out[a + ' (account)'] = { error: e.message } }
}
// A Nimiq.Fun payout that went to the staking contract
const h = JSON.parse(readFileSync('data/history_Nimiq_Fun.json'))
const sc = h.runs.find(r => r.sampleTo.startsWith('NQ77 0000'))
out.stakingContractPayout = await rpc('getTransactionByHash', [sc.sampleHash])
writeFileSync('data/staker_samples.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 1))
