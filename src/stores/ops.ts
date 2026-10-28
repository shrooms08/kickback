import { defineStore } from 'pinia'
import { logMoney } from '../lib/moneylog'
import { prefGet, prefSet } from '../lib/cache'
import { UNKNOWN, findOnChain, send, waitIncluded } from '../services/tx'
import type { SendRequest } from '../services/sendTypes'
import { useDry } from './dry'

// Every money action is an "op", persisted per address. If the app is closed
// mid-flight, reopening resumes *checking* (chain search or inclusion polling)
// and never sends again.

export type OpFlow = 'stake' | 'unstake' | 'keep' | 'withdraw' | 'switch' | 'run'
export type OpPhase =
  | 'approving'   // waiting for the user in Nimiq Pay
  | 'checking'    // error after the request reached the wallet: searching the chain
  | 'confirming'  // sent, waiting for a block
  | 'confirmed'
  | 'failed'      // included but failed on chain
  | 'rejected'    // the user cancelled: nothing was sent
  | 'not-sent'    // refused, or the chain check found nothing

export interface Op {
  id: string
  flow: OpFlow
  req: SendRequest
  phase: OpPhase
  address: string
  dry: boolean
  startedAt: number
  hash?: string
  sentAt?: number
  /** Still confirming after 2 minutes. */
  slow?: boolean
  error?: string
  /** Seconds left in the chain check. */
  checkLeft?: number
  /** Flow details (e.g. switch: old pool, when it takes effect). */
  meta?: Record<string, string | number>
}

export const TERMINAL: OpPhase[] = ['confirmed', 'failed', 'rejected', 'not-sent']
const listeners: Array<(op: Op) => void> = []
/** Called whenever an op reaches confirmed or failed (refresh live data). */
export function onSettled(fn: (op: Op) => void) { listeners.push(fn) }

const running = new Set<string>()

export const useOps = defineStore('ops', {
  state: () => ({ address: '', ops: [] as Op[] }),
  getters: {
    byId: s => (id?: string) => s.ops.find(o => o.id === id),
    active: s => s.ops.filter(o => !TERMINAL.includes(o.phase)),
    /** The newest op of a flow, terminal or not. */
    latest: s => (flow: OpFlow) => [...s.ops].reverse().find(o => o.flow === flow),
  },
  actions: {
    key(address: string) { return 'ops:' + address.replace(/\s/g, '') },
    load(address: string) {
      this.address = address
      try { this.ops = JSON.parse(prefGet(this.key(address)) || '[]') }
      catch { this.ops = [] }
    },
    save() {
      if (!this.address) return
      const dayAgo = Date.now() - 24 * 3600e3
      const keep = this.ops.filter(o => !TERMINAL.includes(o.phase) || o.startedAt > dayAgo).slice(-40)
      prefSet(this.key(this.address), JSON.stringify(keep))
    },
    patch(id: string, p: Partial<Op>) {
      const op = this.ops.find(o => o.id === id)
      if (!op) return
      Object.assign(op, p)
      this.save()
      if (!op.dry) logMoney(op)
      if (p.phase === 'confirmed' || p.phase === 'failed') listeners.forEach(fn => fn(op))
    },

    /** Run one money action to the end. Resolves when it is terminal (or keeps going in the background if slow). */
    async execute(flow: OpFlow, req: SendRequest, address: string, meta?: Op['meta']): Promise<Op> {
      const op: Op = { id: 'op' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), flow, req, phase: 'approving', address, dry: useDry().on, startedAt: Date.now(), meta }
      this.ops.push(op)
      this.save()
      if (!op.dry) logMoney(op)
      running.add(op.id)
      try {
        const r = await send(req)
        if (r.status === 'sent') {
          this.patch(op.id, { phase: 'confirming', hash: r.hash, sentAt: Date.now() })
          await this.confirm(op.id)
        }
        else if (r.status === 'rejected') this.patch(op.id, { phase: 'rejected' })
        else if (r.status === 'not-sent') this.patch(op.id, { phase: 'not-sent', error: r.error })
        else await this.check(op.id, r.error)
      }
      finally { running.delete(op.id) }
      return this.byId(op.id)!
    },

    /** Uncertain error: search the chain before saying anything. */
    async check(id: string, error?: string): Promise<void> {
      const op = this.byId(id)
      if (!op) return
      this.patch(id, { phase: 'checking', error })
      const hash = await findOnChain(op.address, op.req, op.startedAt, left => this.patch(id, { checkLeft: Math.ceil(left / 1000) }))
      if (hash === UNKNOWN) {
        // The chain couldn't be read: it may have gone out. Stay "checking" (still in flight, no
        // re-send offered) and look again in 30 s, until a node can say for sure.
        this.patch(id, { checkLeft: 0, slow: true })
        await new Promise(r => setTimeout(r, 30_000))
        if (this.byId(id)?.phase === 'checking') return this.check(id, error)
        return
      }
      if (hash) {
        this.patch(id, { phase: 'confirming', hash, sentAt: op.sentAt ?? Date.now() })
        await this.confirm(id)
      }
      else this.patch(id, { phase: 'not-sent' })
    },

    async confirm(id: string) {
      const op = this.byId(id)
      if (!op?.hash) return
      const r = await waitIncluded(op.hash, { onSlow: () => this.patch(id, { slow: true }) })
      this.patch(id, { phase: r === 'ok' ? 'confirmed' : 'failed' })
    },

    /** After a restart: continue checking anything that was in flight. Never re-sends. */
    resume() {
      for (const op of this.ops) {
        if (running.has(op.id) || TERMINAL.includes(op.phase)) continue
        running.add(op.id)
        const done = () => running.delete(op.id)
        if (op.phase === 'confirming' && op.hash) this.confirm(op.id).finally(done)
        else this.check(op.id, op.error || 'The app closed before Nimiq Pay answered').finally(done)
      }
    },

    /** Wait for an op that is already running (or resumed) to settle. */
    waitFor(id: string): Promise<Op> {
      return new Promise((resolve) => {
        const tick = () => {
          const op = this.byId(id)
          if (!op || TERMINAL.includes(op.phase)) return resolve(op!)
          setTimeout(tick, 500)
        }
        tick()
      })
    },
  },
})
