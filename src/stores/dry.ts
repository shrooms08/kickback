import { defineStore } from 'pinia'
import { prefGet, prefSet } from '../lib/cache'
import type { Staker } from '../services/chain'
import type { SendRequest } from '../services/sendTypes'

// Dry run: every send is simulated, no real NIM moves. Works in production
// (toggle in Diagnostics) so flows can be walked on a phone with 0 NIM.
// The fake chain is tiny: a wallet balance, an optional staker, fake
// kickbacks, and transactions that "land" 3 s after they are sent.

export type DryOutcome = 'approve' | 'reject' | 'network' | 'failAfterSend'

export interface DryTx {
  hash: string
  req: SendRequest
  sentAt: number
  /** Present on the fake chain (approve / failAfterSend). */
  lands: boolean
}

export interface DryKickback { at: number, luna: number }

interface DryState {
  on: boolean
  outcome: DryOutcome
  baseBalanceLuna: number
  baseStaker: Staker | null
  txs: DryTx[]
  kickbacks: DryKickback[]
  /** How long fake inactive stake stays locked (real: 12-24 h). */
  releaseMs: number
}

export const DRY_SEND_DELAY = 1500
export const DRY_CONFIRM_DELAY = 3000
const KEY = 'dryrun'

function load(): DryState {
  const fresh: DryState = { on: false, outcome: 'approve', baseBalanceLuna: 500_000_000, baseStaker: null, txs: [], kickbacks: [], releaseMs: 120_000 }
  try {
    const raw = prefGet(KEY)
    return raw ? { ...fresh, ...JSON.parse(raw) } : fresh
  }
  catch { return fresh }
}

const fakeHash = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')

export const useDry = defineStore('dry', {
  state: (): DryState & { tick: number } => ({ ...load(), tick: 0 }),
  getters: {
    /** Transactions that have landed on the fake chain by now. */
    landed(s): DryTx[] {
      void s.tick
      const t = Date.now()
      return s.txs.filter(x => x.lands && t - x.sentAt >= DRY_CONFIRM_DELAY)
    },
    /** Fake wallet balance and staker after applying every landed transaction. */
    chain(): { balanceLuna: number, staker: Staker | null, inactiveSince: number | null, stakedAt: number | null } {
      let balance = this.baseBalanceLuna + this.kickbacks.reduce((a, k) => a + k.luna, 0)
      let st: Staker | null = this.baseStaker ? { ...this.baseStaker } : null
      let inactiveSince: number | null = null
      /** When the current fake stake first confirmed (the "stake time" for first-kickback maths). */
      let stakedAt: number | null = null
      for (const tx of this.landed) {
        const r = tx.req, at = tx.sentAt + DRY_CONFIRM_DELAY
        switch (r.kind) {
          case 'payment': balance -= r.value; break
          case 'newStaker':
            balance -= r.value
            st = { address: '', balance: r.value, delegation: r.delegation!, inactiveBalance: 0, inactiveFrom: null, retiredBalance: 0 }
            stakedAt = at
            break
          case 'addStake': balance -= r.value; if (st) st.balance += r.value; break
          case 'setActive':
            if (st) {
              const total = st.balance + st.inactiveBalance
              st.balance = r.value
              st.inactiveBalance = total - r.value
              inactiveSince = st.inactiveBalance > 0 ? at : null
              st.inactiveFrom = st.inactiveBalance > 0 ? at : null
            }
            break
          case 'updateStaker':
            if (st) { st.delegation = r.newDelegation!; st.balance += st.inactiveBalance; st.inactiveBalance = 0; st.inactiveFrom = null; inactiveSince = null }
            break
          case 'retire':
            if (st) { st.inactiveBalance -= r.value; st.retiredBalance += r.value; if (!st.inactiveBalance) { st.inactiveFrom = null } }
            break
          case 'remove':
            if (st) {
              st.retiredBalance -= r.value; balance += r.value
              if (st.balance + st.inactiveBalance + st.retiredBalance === 0) { st = null; stakedAt = null }
            }
            break
        }
      }
      if (st && st.inactiveBalance === 0 && st.retiredBalance === 0) inactiveSince = null
      if (st && st.inactiveBalance > 0 && inactiveSince == null) inactiveSince = st.inactiveFrom
      return { balanceLuna: balance, staker: st, inactiveSince, stakedAt }
    },
  },
  actions: {
    save() {
      const { tick: _t, ...state } = this.$state
      prefSet(KEY, JSON.stringify(state))
    },
    toggle(on: boolean) { this.on = on; this.save() },
    setOutcome(o: DryOutcome) { this.outcome = o; this.save() },
    setBalance(luna: number) {
      // Set the *current* fake balance: adjust the base so landed txs still count.
      this.baseBalanceLuna += luna - this.chain.balanceLuna
      this.save()
    },
    /** A fake kickback, dated now. It lands in the fake wallet and counts as ready to share once a plan is saved. */
    addKickback(luna: number) {
      const last = this.kickbacks[this.kickbacks.length - 1]?.at ?? 0
      this.kickbacks.push({ at: Math.max(Date.now(), last + 1), luna })
      this.save()
    },
    /** Make fake inactive stake releasable right away. */
    releaseNow() { this.releaseMs = 0; this.save() },
    reset() {
      Object.assign(this, { baseBalanceLuna: 500_000_000, baseStaker: null, txs: [], kickbacks: [], releaseMs: 120_000 })
      this.save()
    },
    /** Simulate one send with the chosen outcome. */
    async send(req: SendRequest): Promise<{ hash: string } | { error: { type: string, code: number, message: string } }> {
      await new Promise(r => setTimeout(r, DRY_SEND_DELAY))
      const o = this.outcome
      if (o === 'reject') return { error: { type: 'PERMISSION_DENIED', code: 4001, message: 'Dry run: you rejected the request' } }
      if (o === 'network') return { error: { type: 'NETWORK_ERROR', code: -32000, message: 'Dry run: network error, nothing was sent' } }
      const tx: DryTx = { hash: fakeHash(), req, sentAt: Date.now(), lands: true }
      this.txs.push(tx)
      this.save()
      setTimeout(() => { this.tick++ }, DRY_CONFIRM_DELAY + 50)
      if (o === 'failAfterSend') return { error: { type: 'NETWORK_ERROR', code: -32000, message: 'Dry run: the connection dropped after sending' } }
      return { hash: tx.hash }
    },
    /** Fake getTransactionByHash: included once it has landed. */
    lookup(hash: string): 'included' | 'pending' | 'missing' {
      const tx = this.txs.find(x => x.hash === hash)
      if (!tx || !tx.lands) return 'missing'
      return Date.now() - tx.sentAt >= DRY_CONFIRM_DELAY ? 'included' : 'pending'
    },
    /** Fake chain search after an uncertain send. */
    findSince(req: SendRequest, since: number): string | null {
      const tx = this.txs.find(x => x.lands && x.sentAt >= since - 1000 && x.req.kind === req.kind && x.req.value === req.value && x.req.recipient === req.recipient)
      return tx ? tx.hash : null
    },
  },
})
