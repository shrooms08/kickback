import { rpc } from './rpc.mjs'
import { writeFileSync } from 'node:fs'
const pools = {
  'Nimiq.Fun': 'NQ32 1U9X 7P3X B2H5 XA00 5LC2 5KFE VBQE X3BU',
  'ObsidianStake': 'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV',
  'CHIPMUNK POOL': 'NQ32 V144 LJDN FJND NLCQ PKBU HTPF KD8G J664',
}
const out = {}
for (const [name, addr] of Object.entries(pools)) {
  const v = await rpc('getValidatorByAddress', [addr])
  out[name] = v
  console.log(name, JSON.stringify(v))
}
writeFileSync('data/rpc_validators.json', JSON.stringify(out, null, 2))
