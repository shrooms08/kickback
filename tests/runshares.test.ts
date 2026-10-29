import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { memoryStorage } from './helpers/storage'

// Audit 1: a run step that was approved before a restart must be recorded as shared exactly
// once, so its amount is never ready to share (and sendable) a second time.
const ME = 'NQ51 KVXF RMYV 9HPD CA8N 5X10 7SUY 2C29 MU2T', TO = 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8'
const tx = vi.hoisted(() => ({ send: vi.fn(), findOnChain: vi.fn(), waitIncluded: vi.fn() }))
vi.mock('../src/services/tx', async (orig) => ({ ...(await orig<object>()), ...tx }))

const flush = () => new Promise(r => setTimeout(r, 0))
async function settle(ops: { byId: (id: string) => { phase: string } | undefined }, id: string) {
  for (let i = 0; i < 50 && !['confirmed', 'failed', 'not-sent', 'rejected'].includes(ops.byId(id)?.phase ?? ''); i++) await flush()
}

beforeEach(() => {
  memoryStorage()
  tx.send.mockReset(); tx.findOnChain.mockReset(); tx.waitIncluded.mockReset()
})

async function fresh() {
  vi.resetModules() // a restart: module state (e.g. the running-ops set) starts empty
  setActivePinia(createPinia())
  const { useOps } = await import('../src/stores/ops')
  const { usePlan } = await import('../src/stores/plan')
  const { readyLuna, ledgerFor } = await import('../src/lib/money')
  const plan = usePlan(), ops = useOps()
  plan.loadFor(ME)
  ops.load(ME)
  return { plan, ops, readyLuna, ledgerFor }
}

describe('run shares survive a restart', () => {
  it('killed mid-approval, resumed and found on chain: recorded once, not ready again', async () => {
    const start = Date.now() - 3600e3
    const kick = [{ at: start + 60e3, luna: 500_000 }]
    // Session 1: the plan exists, the run's send goes to Nimiq Pay and the app is killed.
    let s = await fresh()
    s.plan.$patch({ planStartedAt: start }); s.plan.persist()
    tx.send.mockReturnValue(new Promise(() => {}))
    void s.ops.execute('run', { kind: 'payment', value: 500_000, recipient: TO, data: 'Kickback' }, ME, { step: 0, luna: 500_000, type: 'send', runId: 'r1' })
    const id = s.ops.ops[0].id
    expect(s.readyLuna(kick, start, s.ledgerFor(s.plan.ledger, false), 500_000)).toBe(0)

    // Session 2: reopen. The op resumes checking and finds the transaction.
    s = await fresh()
    tx.findOnChain.mockResolvedValue('h1')
    tx.waitIncluded.mockResolvedValue('ok')
    s.ops.resume()
    await settle(s.ops, id)
    expect(s.ops.byId(id)?.phase).toBe('confirmed')
    expect(s.plan.ledger).toHaveLength(1)
    expect(s.plan.ledger[0]).toMatchObject({ id, luna: 500_000, hash: 'h1', sliceType: 'send', runId: 'r1' })
    expect(s.readyLuna(kick, start, s.ledgerFor(s.plan.ledger, false), 0)).toBe(0)

    // Session 3: reopen again. Nothing is recorded twice.
    s = await fresh()
    s.ops.resume()
    await flush()
    expect(s.plan.ledger).toHaveLength(1)
  })

  it('an op that confirms twice (e.g. resumed while still running) is recorded once', async () => {
    const s = await fresh()
    s.plan.$patch({ planStartedAt: Date.now() - 1000 })
    tx.send.mockResolvedValue({ status: 'sent', hash: 'h2' })
    tx.waitIncluded.mockResolvedValue('ok')
    const op = await s.ops.execute('run', { kind: 'addStake', value: 200_000 }, ME, { step: 1, luna: 200_000, type: 'restake', runId: 'r2' })
    s.ops.patch(op.id, { phase: 'confirmed' })
    expect(s.plan.ledger.filter(e => e.id === op.id)).toHaveLength(1)
    expect(s.plan.ledger[0]).toMatchObject({ luna: 200_000, sliceType: 'restake', hash: 'h2' })
  })

  it('a failed or not-sent run op stays ready to share', async () => {
    const s = await fresh()
    s.plan.$patch({ planStartedAt: Date.now() - 1000 })
    tx.send.mockResolvedValue({ status: 'sent', hash: 'h3' })
    tx.waitIncluded.mockResolvedValue('failed')
    await s.ops.execute('run', { kind: 'payment', value: 100_000, recipient: TO }, ME, { step: 0, luna: 100_000, type: 'send', runId: 'r3' })
    expect(s.plan.ledger).toHaveLength(0)
  })

  it('op ids are uuids, so they can be the server share id', async () => {
    const s = await fresh()
    tx.send.mockResolvedValue({ status: 'rejected' })
    const op = await s.ops.execute('run', { kind: 'addStake', value: 1 }, ME)
    expect(op.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
