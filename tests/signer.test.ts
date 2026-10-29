import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { memoryStorage } from './helpers/storage'

// Audit 7: every send re-checks the recipient (checksum, not your own address), and once a sent
// transaction shows Nimiq Pay signed from another account, Kickback stops sending.
const ME = 'NQ51 KVXF RMYV 9HPD CA8N 5X10 7SUY 2C29 MU2T', TO = 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8', OTHER = 'NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717'
const tx = vi.hoisted(() => ({ send: vi.fn(), findOnChain: vi.fn(), waitIncluded: vi.fn(), validUntilOf: vi.fn(async () => null) }))
vi.mock('../src/services/tx', async orig => ({ ...(await orig<object>()), ...tx }))

async function fresh() {
  vi.resetModules()
  setActivePinia(createPinia())
  const { useOps } = await import('../src/stores/ops')
  const { useUi } = await import('../src/stores/ui')
  const toasts: string[] = []
  vi.spyOn(useUi(), 'showToast').mockImplementation((m: string) => { toasts.push(m) })
  const ops = useOps(); ops.load(ME)
  return { ops, toasts }
}

beforeEach(() => {
  memoryStorage()
  tx.send.mockReset(); tx.waitIncluded.mockReset()
  tx.send.mockResolvedValue({ status: 'sent', hash: 'h1' })
})

describe('recipient checks at send time', () => {
  it('never pays your own address', async () => {
    const { ops } = await fresh()
    const op = await ops.execute('run', { kind: 'payment', value: 1, recipient: ME.toLowerCase().replace(/ /g, '') }, ME)
    expect(op.phase).toBe('not-sent')
    expect(tx.send).not.toHaveBeenCalled()
  })
  it('never pays an address with a bad checksum', async () => {
    const { ops } = await fresh()
    const op = await ops.execute('run', { kind: 'payment', value: 1, recipient: TO.replace('VCR8', 'VCR9') }, ME)
    expect(op.phase).toBe('not-sent')
    expect(tx.send).not.toHaveBeenCalled()
  })
  it('never delegates to an invalid validator address', async () => {
    const { ops } = await fresh()
    const op = await ops.execute('stake', { kind: 'newStaker', value: 1, delegation: 'NQ00 0000' }, ME)
    expect(op.phase).toBe('not-sent')
    expect(tx.send).not.toHaveBeenCalled()
  })
})

describe('the signing account', () => {
  it('a sent transaction from another account blocks further sends, also after a restart', async () => {
    let s = await fresh()
    tx.waitIncluded.mockImplementation(async (_h: string, o: { onTx?: (t: unknown) => void }) => { o.onTx?.({ hash: 'h1', from: OTHER, to: TO, value: 1 }); return 'ok' })
    await s.ops.execute('run', { kind: 'payment', value: 1, recipient: TO }, ME)
    expect(s.ops.signerMismatch).toBeTruthy()
    expect(s.toasts.join(' ')).toMatch(/different account/i)
    s = await fresh()
    const op = await s.ops.execute('run', { kind: 'payment', value: 1, recipient: TO }, ME)
    expect(op.phase).toBe('not-sent')
    expect(tx.send).toHaveBeenCalledTimes(1)
  })
  it('a transaction from the connected account is fine', async () => {
    const s = await fresh()
    tx.waitIncluded.mockImplementation(async (_h: string, o: { onTx?: (t: unknown) => void }) => { o.onTx?.({ hash: 'h1', from: ME, to: TO, value: 1 }); return 'ok' })
    await s.ops.execute('run', { kind: 'payment', value: 1, recipient: TO }, ME)
    expect(s.ops.signerMismatch).toBeFalsy()
    const op = await s.ops.execute('run', { kind: 'payment', value: 1, recipient: TO }, ME)
    expect(op.phase).toBe('confirmed')
  })
  it('remove stake is paid from the staking contract to you: checked by recipient', async () => {
    const s = await fresh()
    tx.waitIncluded.mockImplementation(async (_h: string, o: { onTx?: (t: unknown) => void }) => { o.onTx?.({ hash: 'h1', from: 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001', to: ME, value: 1 }); return 'ok' })
    await s.ops.execute('withdraw', { kind: 'remove', value: 1 }, ME)
    expect(s.ops.signerMismatch).toBeFalsy()
  })
})

describe('reset signer check (final fix 2)', () => {
  async function blocked() {
    const s = await fresh()
    tx.waitIncluded.mockImplementation(async (_h: string, o: { onTx?: (t: unknown) => void }) => { o.onTx?.({ hash: 'h1', from: OTHER, to: TO, value: 1 }); return 'ok' })
    await s.ops.execute('run', { kind: 'payment', value: 1, recipient: TO }, ME)
    expect(s.ops.signerMismatch).toBeTruthy()
    return s
  }
  it('clears the block when Nimiq Pay lists this account again, and the next send is verified again', async () => {
    const s = await blocked()
    expect(s.ops.resetSigner([ME.toLowerCase(), OTHER])).toEqual({ cleared: true })
    expect(s.ops.signerMismatch).toBe('')
    expect(s.ops.signerOk).toBe(false)
    expect(localStorage.getItem('kb:ops:' + ME.replace(/\s/g, '') + ':signer')).toBeNull()
  })
  it('keeps the block when Nimiq Pay is still on another account, and says which', async () => {
    const s = await blocked()
    expect(s.ops.resetSigner([OTHER])).toEqual({ cleared: false, account: OTHER })
    expect(s.ops.signerMismatch).toBeTruthy()
  })
  it('explains the block in plain words', async () => {
    const { signerBlockText } = await import('../src/stores/ops')
    const t = signerBlockText(OTHER)
    expect(t).toMatch(/NQ16 … P717/)
    expect(t).toMatch(/Reset signer check/)
  })
})
