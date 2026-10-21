// Page back through a payout address's history (startAt = last hash) to measure payout cadence
import { rpc, stats } from './rpc.mjs'
import { writeFileSync } from 'node:fs'
const [name, addr, days = '4'] = process.argv.slice(2)
const norm = a => a.replace(/\s/g, '')
const cutoff = Date.now() - Number(days) * 86400e3
let all = [], startAt = null, pages = 0
while (pages < 40) {
  const txs = await rpc('getTransactionsByAddress', [addr, 500, startAt])
  pages++
  if (!txs.length) break
  all.push(...txs)
  startAt = txs.at(-1).hash
  const oldest = Math.min(...txs.map(t => t.timestamp))
  if (oldest < cutoff || txs.length < 500) break
}
const uniq = [...new Map(all.map(t => [t.hash, t])).values()]
const out = uniq.filter(t => norm(t.from) === norm(addr)).sort((a, b) => b.timestamp - a.timestamp)
const runs = []
for (const t of out) { const r = runs.at(-1); if (r && r.start - t.timestamp < 3600e3) { r.start = t.timestamp; r.n++; r.nim += t.value / 1e5 } else runs.push({ end: t.timestamp, start: t.timestamp, n: 1, nim: t.value / 1e5, sample: t }) }
const gaps = runs.slice(0, -1).map((r, i) => +((r.end - runs[i + 1].end) / 3600e3).toFixed(2))
const res = {
  name, addr, pages, txsScanned: uniq.length,
  oldestScanned: new Date(Math.min(...uniq.map(t => t.timestamp))).toISOString(),
  coinbaseIncoming: uniq.filter(t => norm(t.from) === norm('NQ81 C01N BASE 0000 0000 0000 0000 0000 0000')).length,
  outgoing: out.length,
  runs: runs.map(r => ({ at: new Date(r.end).toISOString(), txs: r.n, totalNim: +r.nim.toFixed(2), sampleHash: r.sample.hash, sampleTo: r.sample.to, sampleNim: r.sample.value / 1e5 })),
  gapsHours: gaps,
}
writeFileSync(`data/history_${name.replace(/\W+/g, '_')}.json`, JSON.stringify(res, null, 2))
console.log(JSON.stringify({ ...res, runs: res.runs.map(r => `${r.at} txs=${r.txs} total=${r.totalNim} sample=${r.sampleHash.slice(0, 12)}… ${r.sampleNim} NIM -> ${r.sampleTo}`) }, null, 1))
console.error('rpc stats', JSON.stringify({calls: stats.calls, throttled: stats.throttled, sampleLimits: stats.limits.slice(0, 6)}))
