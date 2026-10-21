// getStakerByAddress on sample payout recipients + inspect payouts sent to the staking contract
import { rpc } from './rpc.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
const out = {}
for (const a of ['NQ98 HGEF CD04 RHPK GYT6 YM9S U0CY PA0M CGD5', 'NQ78 G9Q9 JUCM N8GC R6FM 67MS 254L N05S YR1E']) {
  try { out[a] = await rpc('getStakerByAddress', [a]) } catch (e) { out[a] = { error: e.message } }
  try { out[a + ' (account)'] = await rpc('getAccountByAddress', [a]) } catch (e) { out[a + ' (account)'] = { error: e.message } }
}
// A Nimiq.Fun payout that went to the staking contract
const h = JSON.parse(readFileSync('data/history_Nimiq_Fun.json'))
const sc = h.runs.find(r => r.sampleTo.startsWith('NQ77 0000'))
out.stakingContractPayout = await rpc('getTransactionByHash', [sc.sampleHash])
writeFileSync('data/staker_samples.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 1))
