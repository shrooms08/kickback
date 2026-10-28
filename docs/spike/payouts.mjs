// Fetch recent txs for each pool's payout address and summarize outgoing payout batches
import { rpc } from './rpc.mjs'
import { writeFileSync } from 'node:fs'
const LUNA = 1e5
const pools = {
  'Nimiq.Fun': 'NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717',
  'ObsidianStake': 'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV',
  'CHIPMUNK POOL': 'NQ32 V144 LJDN FJND NLCQ PKBU HTPF KD8G J664',
}
const MAX = Number(process.env.MAX || 500)
const summary = {}
for (const [name, addr] of Object.entries(pools)) {
  const txs = await rpc('getTransactionsByAddress', [addr, MAX, null])
  writeFileSync(`data/txs_${name.replace(/\W+/g, '_')}.json`, JSON.stringify(txs, null, 2))
  const norm = a => a.replace(/\s/g, '')
  const out = txs.filter(t => norm(t.from) === norm(addr))
  const inc = txs.filter(t => norm(t.to) === norm(addr))
  // Group outgoing txs into payout "runs": txs within 1h of each other
  const times = out.map(t => t.timestamp).sort((a, b) => b - a)
  const runs = []
  for (const ts of times) { const r = runs.at(-1); if (r && r.start - ts < 3600e3) { r.start = ts; r.n++ } else runs.push({ end: ts, start: ts, n: 1 }) }
  const gaps = runs.slice(0, -1).map((r, i) => (r.start - runs[i + 1].end) / 3600e3)
  const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null }
  const latest = out.sort((a, b) => b.timestamp - a.timestamp)[0]
  summary[name] = {
    payoutAddress: addr,
    fetched: txs.length,
    oldestFetched: txs.length ? new Date(Math.min(...txs.map(t => t.timestamp))).toISOString() : null,
    outgoing: out.length, incoming: inc.length,
    incomingSenders: [...new Set(inc.map(t => t.from))].slice(0, 5),
    latestPayout: latest && { iso: new Date(latest.timestamp).toISOString(), hash: latest.hash, to: latest.to, nim: latest.value / LUNA, fee: latest.fee, block: latest.blockNumber, data: latest.recipientData, senderData: latest.senderData },
    payoutRuns: runs.length,
    runSizes: runs.slice(0, 10).map(r => r.n),
    runTimes: runs.slice(0, 10).map(r => new Date(r.end).toISOString()),
    medianGapHours: med(gaps), gapsHours: gaps.slice(0, 12).map(g => +g.toFixed(2)),
    distinctRecipients: new Set(out.map(t => t.to)).size,
    amountsNim: out.slice(0, 8).map(t => t.value / LUNA),
  }
  console.log(name, JSON.stringify(summary[name], null, 1))
  if (txs[0]) console.log('tx keys:', Object.keys(txs[0]).join(','))
}
writeFileSync('data/payout_summary.json', JSON.stringify(summary, null, 2))
