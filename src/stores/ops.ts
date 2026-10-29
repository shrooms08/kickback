import { defineStore } from 'pinia'
import { logMoney } from '../lib/moneylog'
import { prefGet, prefSet } from '../lib/cache'
import { DRY_CHECK_WINDOW_MS, UNCERTAIN_HOLD_MS, UNKNOWN, VALIDITY_MS, findOnChain, searchWide, send, waitIncluded } from '../services/tx'
import type { SendRequest } from '../services/sendTypes'
import { useDry } from './dry'
import { usePlan } from './plan'
import { useUi } from './ui'
import { isValidAddress } from '../lib/address'
import { STAKING_CONTRACT, sameAddr } from '../services/chain'
import type { Tx } from '../services/chain'
import { isUuid, uuid } from '../lib/uuid'

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
  /** When an uncertain error happened (it may have gone out): nothing is re-sent for 10 minutes after. */
  uncertainAt?: number
  /** Declined with a cancel name the SDK doesn't define: a retry checks the chain first. */
  softCancel?: boolean
  /**
   * Flow details. Switch: old pool, when it takes effect. Run: step index, `luna`, `type`
   * (send / restake) and `runId`, so the share is recorded when it settles, even after a restart.
   */
  meta?: Record<string, string | number>
}

export const TERMINAL: OpPhase[] = ['confirmed', 'failed', 'rejected', 'not-sent']

/**
 * A run step in a block is shared: record it in the plan ledger right here, whoever is watching
 * (the run walking its steps, or a resume after a restart). The op id is the ledger id, so it is
 * written exactly once.
 */
/** Why a request must not go out, checked right before every send ('' = fine). */
export function requestProblem(req: SendRequest, address: string): string {
  if (req.kind === 'payment') {
    if (!req.recipient || !isValidAddress(req.recipient)) return 'The recipient address isn\'t a valid Nimiq address. Nothing was sent.'
    if (sameAddr(req.recipient, address)) return 'That\'s your own address. Nothing was sent.'
  }
  if (req.kind === 'newStaker' && (!req.delegation || !isValidAddress(req.delegation))) return 'That pool address isn\'t valid. Nothing was sent.'
  if (req.kind === 'updateStaker' && (!req.newDelegation || !isValidAddress(req.newDelegation))) return 'That pool address isn\'t valid. Nothing was sent.'
  return ''
}

const MISMATCH = 'Nimiq Pay sent from a different account than the one Kickback shows, so Kickback stopped sending. Open Kickback again from the account you use in Nimiq Pay.'

/** Hashes already shared: never mistaken for a new send of the same amount. */
export function ledgerHashes(): Set<string> {
  return new Set(usePlan().ledger.map(e => e.hash).filter((h): h is string => !!h))
}

/**
 * An uncertain "not sent" run op: held until a final search after its validity window has
 * released it (or a retry replaced it), so a late transaction is never shared twice.
 */
export function isHeld(o: Op): boolean {
  return o.flow === 'run' && o.phase === 'not-sent' && o.uncertainAt != null && !o.meta?.superseded && !o.meta?.released
}

/** Luna kept out of Ready to share: run ops in flight, and uncertain ones that may still land. */
export function heldLuna(ops: readonly Op[], dry: boolean): number {
  return ops.filter(o => o.dry === dry && o.flow === 'run' && (!TERMINAL.includes(o.phase) || isHeld(o))).reduce((a, o) => a + o.req.value, 0)
}

function recordRunShare(op: Op) {
  const m = op.meta
  // A payment signed from another account is not this wallet's share.
  if (op.flow !== 'run' || op.phase !== 'confirmed' || !m || typeof m.luna !== 'number' || m.foreign) return
  const id = isUuid(op.id) ? op.id : String(m.shareId)
  usePlan().recordShared(m.luna, op.hash, op.dry, m.type === 'restake' ? 'restake' : 'send', typeof m.runId === 'string' ? m.runId : undefined, id)
}
const listeners: Array<(op: Op) => void> = []
/** Called whenever an op reaches confirmed or failed (refresh live data). */
export function onSettled(fn: (op: Op) => void) { listeners.push(fn) }

const running = new Set<string>()

export const useOps = defineStore('ops', {
  state: () => ({
    address: '', ops: [] as Op[],
    /** A sent transaction came from another account than `address` (the signer it was from): no more sends. */
    signerMismatch: '' as string,
    /** A sent transaction proved Nimiq Pay signs from `address`: later steps needn't wait for it. */
    signerOk: false,
  }),
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
      this.signerMismatch = prefGet(this.key(address) + ':signer') || ''
      this.signerOk = prefGet(this.key(address) + ':signerok') === '1'
    },
    save() {
      if (!this.address) return
      // Every op still in flight or held is kept; finished ones for a day, at most 40.
      const now = Date.now(), dayAgo = now - 24 * 3600e3
      const done = new Set(this.ops.filter(o => TERMINAL.includes(o.phase) && !isHeld(o) && o.startedAt > dayAgo).slice(-40))
      const keep = this.ops.filter(o => (!TERMINAL.includes(o.phase) || isHeld(o)) || done.has(o))
      prefSet(this.key(this.address), JSON.stringify(keep))
    },
    patch(id: string, p: Partial<Op>) {
      const op = this.ops.find(o => o.id === id)
      if (!op) return
      // Ops saved before ids were uuids get a stable share id once.
      if (op.flow === 'run' && op.meta && !isUuid(op.id) && !op.meta.shareId) op.meta.shareId = uuid()
      Object.assign(op, p)
      if (p.phase === 'confirmed') recordRunShare(op)
      this.save()
      if (!op.dry) logMoney(op)
      if (p.phase === 'confirmed' || p.phase === 'failed') listeners.forEach(fn => fn(op))
    },

    /** Run one money action to the end. Resolves when it is terminal (or keeps going in the background if slow). */
    async execute(flow: OpFlow, req: SendRequest, address: string, meta?: Op['meta']): Promise<Op> {
      const op: Op = { id: uuid(), flow, req, phase: 'approving', address, dry: useDry().on, startedAt: Date.now(), meta }
      this.ops.push(op)
      this.save()
      if (!op.dry) logMoney(op)
      const problem = this.signerMismatch && !op.dry ? MISMATCH : requestProblem(req, address)
      if (problem) {
        this.patch(op.id, { phase: 'not-sent', error: problem })
        useUi().showToast(problem)
        return this.byId(op.id)!
      }
      running.add(op.id)
      try {
        const r = await send(req)
        if (r.status === 'sent') {
          this.patch(op.id, { phase: 'confirming', hash: r.hash, sentAt: Date.now() })
          await this.confirm(op.id)
        }
        else if (r.status === 'rejected') this.patch(op.id, { phase: 'rejected', ...(r.soft ? { softCancel: true } : {}) })
        else if (r.status === 'not-sent') this.patch(op.id, { phase: 'not-sent', error: r.error })
        else await this.check(op.id, r.error)
      }
      finally { running.delete(op.id) }
      return this.byId(op.id)!
    },

    /**
     * Uncertain error: search the chain before saying anything. It stays "checking" for 10 minutes
     * (a transaction can show up late), then a deeper search (history and mempool) decides.
     */
    async check(id: string, error?: string): Promise<void> {
      const op = this.byId(id)
      if (!op) return
      this.patch(id, { phase: 'checking', error, uncertainAt: op.uncertainAt ?? Date.now() })
      const windowMs = op.dry ? DRY_CHECK_WINDOW_MS : Math.max(0, op.uncertainAt! + UNCERTAIN_HOLD_MS - Date.now())
      let hash = await findOnChain(op.address, op.req, op.startedAt, left => this.patch(id, { checkLeft: Math.ceil(left / 1000) }), { windowMs, skip: this.knownHashes(id) })
      if (hash === null && !op.dry) hash = await searchWide(op.address, op.req, op.startedAt, this.knownHashes(id))
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
      const r = await waitIncluded(op.hash, { onSlow: () => this.patch(id, { slow: true }), onTx: tx => this.checkSigner(op, tx) })
      this.patch(id, { phase: r === 'ok' ? 'confirmed' : 'failed' })
    },

    /**
     * Retry found an earlier send of this step (in a block or the mempool): follow it to the end
     * instead of sending again. A pruned op comes back under its old id.
     */
    adopt(flow: OpFlow, req: SendRequest, address: string, hash: string, meta: Op['meta'], id?: string): string {
      const old = id ? this.byId(id) : undefined
      if (old) this.patch(old.id, { phase: 'confirming', hash, sentAt: old.sentAt ?? Date.now(), slow: false })
      else this.ops.push({ id: id && isUuid(id) ? id : uuid(), flow, req, phase: 'confirming', address, dry: useDry().on, startedAt: Date.now(), hash, sentAt: Date.now(), meta })
      const opId = old?.id ?? this.ops[this.ops.length - 1].id
      this.save()
      running.add(opId)
      void this.confirm(opId).finally(() => running.delete(opId))
      return opId
    },

    /**
     * Nimiq Pay signs from its own account. If a transaction we sent came from another one
     * (remove stake: was paid to another one), stop sending and say so. Kept until the app is
     * opened for the right account.
     */
    checkSigner(op: Op, tx: Tx) {
      if (op.dry || !this.address) return
      const ours = op.req.kind === 'remove' ? sameAddr(tx.from, STAKING_CONTRACT) && sameAddr(tx.to, op.address) : sameAddr(tx.from, op.address)
      if (ours) {
        if (!this.signerOk) { this.signerOk = true; prefSet(this.key(this.address) + ':signerok', '1') }
        return
      }
      op.meta = { ...op.meta, foreign: 1 }
      if (this.signerMismatch) return
      this.signerMismatch = op.req.kind === 'remove' ? tx.to : tx.from
      prefSet(this.key(this.address) + ':signer', this.signerMismatch)
      useUi().showToast(MISMATCH)
    },

    /** Hashes that belong to something else (shared, or another op): never this op's transaction. */
    knownHashes(id: string): Set<string> {
      const s = ledgerHashes()
      for (const o of this.ops) if (o.id !== id && o.hash) s.add(o.hash)
      return s
    },

    /**
     * An uncertain amount is held until its transaction can no longer be included. Then one last
     * deep search: found means it went out late (followed and recorded), otherwise it is released.
     */
    async sweepUncertain() {
      const now = Date.now()
      for (const op of this.ops) {
        if (op.flow !== 'run' || op.phase !== 'not-sent' || op.uncertainAt == null || op.meta?.superseded || op.meta?.released) continue
        if (now - op.uncertainAt < VALIDITY_MS || running.has(op.id)) continue
        running.add(op.id)
        try {
          const hash = await searchWide(op.address, op.req, op.startedAt, this.knownHashes(op.id))
          if (hash === UNKNOWN) continue
          if (hash) { running.delete(op.id); this.adopt(op.flow, op.req, op.address, hash, op.meta, op.id); continue }
          this.patch(op.id, { meta: { ...op.meta, released: 1 } })
        }
        finally { if (this.byId(op.id)?.phase !== 'confirming') running.delete(op.id) }
      }
    },

    /** After a restart: continue checking anything that was in flight. Never re-sends. */
    resume() {
      void this.sweepUncertain()
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
