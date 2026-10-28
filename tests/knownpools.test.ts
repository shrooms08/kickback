import { describe, expect, it } from 'vitest'
import { KNOWN_REWARDS, knownReward } from '../src/services/knownPools'

describe('reward addresses without a validator lookup: only a fixed, verified table', () => {
  it('Nimiq.Fun and ObsidianStake', () => {
    expect(knownReward('NQ32 1U9X 7P3X B2H5 XA00 5LC2 5KFE VBQE X3BU')).toBe('NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717')
    expect(knownReward('nq155jnsu7cerah53t02f8a9jct6qmg97tsv')).toBe('NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV')
  })
  it('anything else: unknown (never guessed from where a staker delegates)', () => {
    expect(knownReward('NQ32 V144 LJDN FJND NLCQ PKBU HTPF KD8G J664')).toBeNull()
    expect(Object.keys(KNOWN_REWARDS)).toHaveLength(2)
  })
})
