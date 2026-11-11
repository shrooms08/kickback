import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { memoryStorage } from './helpers/storage'

// Nimiq Pay pays and stakes out of the wallet's HTLC remote account (SDK 0.2.5 README; seen on
// chain: the 110,000 NIM of NQ74 … R0C7 sit in HTLC NQ97 … X66F). Those transactions are the
// wallet's own: no signer block, and the on-chain search finds them.
const ME = 'NQ74 808U MR99 JHE9 CEGB JEAB DF3U 7953 R0C7', HTLC = 'NQ97 GDBS 1HMT ERNN XDVD JTEV 4RL4 2Q9R X66F'
const STRANGER = 'NQ21 C3EU F69A E1GV UFVC XSSJ HLXB SJU5 DRAF', STAKING = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'

beforeEach(() => { memoryStorage(); vi.resetModules() })

describe('walletAccounts: every account Nimiq Pay listed for the wallet', () => {
  it('remembers HTLCs across rotations, newest first, and knows nothing else', async () => {
    const { rememberAccounts, isOwn, ownContracts } = await import('../src/lib/walletAccounts')
    expect(isOwn(ME, HTLC)).toBe(false)
    rememberAccounts(ME, [ME, HTLC])
    rememberAccounts(ME, [ME, STAKING.replace('0001', '0002')])
    expect(isOwn(ME, ME.replace(/\s/g, '').toLowerCase())).toBe(true)
    expect(isOwn(ME, HTLC)).toBe(true)
    expect(isOwn(ME, STRANGER)).toBe(false)
    expect(ownContracts(ME)[1]).toBe(HTLC)
  })
})

describe('matching a sent transaction on chain', () => {
  it('a stake or payment from the wallet HTLC is the wallet\'s own; from a stranger it is not', async () => {
    const { rememberAccounts } = await import('../src/lib/walletAccounts')
    const { matches } = await import('../src/services/tx')
    rememberAccounts(ME, [ME, HTLC])
    const stake = { hash: 'h', blockNumber: 1, timestamp: 1, from: HTLC, to: STAKING, value: 500_00000, recipientData: '06' }
    expect(matches(stake, { kind: 'addStake', value: 500_00000 }, ME)).toBe(true)
    expect(matches({ ...stake, from: STRANGER }, { kind: 'addStake', value: 500_00000 }, ME)).toBe(false)
    const pay = { hash: 'p', blockNumber: 1, timestamp: 1, from: HTLC, to: STRANGER, value: 5 }
    expect(matches(pay, { kind: 'payment', value: 5, recipient: STRANGER }, ME)).toBe(true)
  })
})

describe('signer check', () => {
  async function ops() {
    setActivePinia(createPinia())
    const { useOps } = await import('../src/stores/ops')
    const { useUi } = await import('../src/stores/ui')
    vi.spyOn(useUi(), 'showToast').mockImplementation(() => {})
    const o = useOps(); o.load(ME)
    return o
  }
  const op = (kind: 'addStake' | 'remove') => ({ id: 'x', address: ME, req: { kind, value: 1 }, dry: false, meta: {} }) as never
  it('a transaction Nimiq Pay sent out of the wallet HTLC does not pause sending', async () => {
    const { rememberAccounts } = await import('../src/lib/walletAccounts')
    rememberAccounts(ME, [ME, HTLC])
    const o = await ops()
    o.checkSigner(op('addStake'), { hash: 'h', blockNumber: 1, timestamp: 1, from: HTLC, to: STAKING, value: 1 })
    expect(o.signerMismatch).toBe('')
    expect(o.signerOk).toBe(true)
  })
  it('a transaction from an unrelated account still pauses sending', async () => {
    const { rememberAccounts } = await import('../src/lib/walletAccounts')
    rememberAccounts(ME, [ME, HTLC])
    const o = await ops()
    o.checkSigner(op('addStake'), { hash: 'h', blockNumber: 1, timestamp: 1, from: STRANGER, to: STAKING, value: 1 })
    expect(o.signerMismatch).toBe(STRANGER)
  })
})

describe('the node fallback must not mask its own problems', () => {
  it('getAccountBalance throws on an answer without a balance instead of returning 0', async () => {
    vi.doMock('../src/services/rpc', async orig => ({ ...(await orig<object>()), rpc: vi.fn(async () => ({ value: null, at: 1, stale: false })) }))
    const { getAccountBalance } = await import('../src/services/chain')
    await expect(getAccountBalance(ME)).rejects.toThrow(/gave no balance/)
    vi.doUnmock('../src/services/rpc')
  })
})
