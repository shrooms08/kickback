import { defineStore } from 'pinia'
import { useWallet } from './wallet'
import { useData } from './data'
import {
  ACCOUNT_EMPTY, ACCOUNT_FULL, ARRIVAL_CENTS, MOCK_LOW_BALANCE_NIM, STAKED_NIM,
} from '../services/mock'
import type { PoolId } from '../services/mock'

export type PoolState = 'active' | 'switching' | 'unstaking'

/**
 * The staking account Kickback shows. In mock mode: the prototype's numbers
 * and edge states. Live: written by the live store from mainnet data.
 */
export const useAccount = defineStore('account', {
  state: () => ({
    staked: false,
    pool: 'fun' as PoolId,
    poolState: 'active' as PoolState,
    switchTo: null as PoolId | null,
    stakedNim: STAKED_NIM,
    ...ACCOUNT_FULL,
    /** Previous values, so count-ups know where to start after an arrival. */
    readyFrom: ACCOUNT_FULL.readyCents,
    earnedFrom: ACCOUNT_FULL.earnedCents,
    // edge states
    emptyAcct: false,
    kbEmpty: false,
    noPayouts: false,
    lowBal: false,
    lowFees: false,
    stale: false,
    refreshing: false,
    late: false,
    poolDown: false,
    stakePending: false,
    offline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    // live-only details (mock mode keeps the prototype's fixed strings)
    /** Stake on its way out (deactivated), NIM. */
    inactiveNim: 0,
    /** Staking with a pool that restakes (no separate kickbacks). */
    notDirect: false,
    /** Age of the data shown when the last refresh failed, minutes. */
    staleMin: 0,
    /** Latest payout of the user's pool (to anyone), ms. */
    poolLastPaidAt: null as number | null,
    /** Hours until the first kickback, for stakers with none yet. */
    firstInH: null as number | null,
    /** Live: staked but no kickback from this pool yet; the countdown is to their first one. */
    firstPending: false,
    /** When that first kickback should land, and when the stake was made (ms). */
    firstAt: null as number | null,
    stakeAt: null as number | null,
    /** When the next kickback (or the first one) should land, ms. */
    nextKickbackAt: null as number | null,
    /** True until the first live data (cache or network) is applied. */
    liveLoading: false,
    /** When inactive stake can be withdrawn (ms), and how far along it is (0..1). */
    unstakeReadyAt: null as number | null,
    unstakeProgress: 0,
    /** Retired stake (ready to remove), NIM. */
    retiredNim: 0,
    /** Inactive (not yet retired) stake can still be reactivated. */
    canUndo: true,
    /** Ready to share in integer Luna (live), for money maths. */
    readyLuna: 0,
    /** Earned so far covers the full history (false: last 30 days only). */
    earnedComplete: true,
    /** When a pool switch takes effect (next election), ms. */
    switchEffectiveAt: null as number | null,
  }),
  getters: {
    poolName: s => useData().pool(s.pool).name,
    switchToName: s => (s.switchTo ? useData().pool(s.switchTo).name : ''),
    readyNim: s => s.readyCents / 100,
    earnedNim: s => s.earnedCents / 100,
    /** Spendable wallet balance in NIM. Real when connected inside Nimiq Pay. */
    walletNim(s): number {
      const wallet = useWallet()
      if (wallet.isMock) return s.lowBal ? MOCK_LOW_BALANCE_NIM : wallet.balanceNim
      return wallet.effectiveBalanceNim
    },
    unstaking: s => s.poolState === 'unstaking',
    /** Inactive stake is past its lock: can be withdrawn now. */
    unstakeReady: s => s.unstakeReadyAt != null && s.unstakeReadyAt <= Date.now(),
    switching: s => s.poolState === 'switching',
    payoutsEmpty: s => s.emptyAcct || s.noPayouts,
    /** Amount shown on the Unstaking card. */
    unstakingNim: s => (useWallet().isMock ? s.stakedNim : s.inactiveNim),
  },
  actions: {
    setEmptyAccount(on: boolean) {
      const v = on ? ACCOUNT_EMPTY : ACCOUNT_FULL
      this.$patch({ ...v, readyFrom: v.readyCents, earnedFrom: v.earnedCents, emptyAcct: on, kbEmpty: on })
    },
    /** A kickback lands: numbers count up from where they were. */
    arrive() {
      this.$patch({
        readyFrom: this.readyCents,
        readyCents: this.readyCents + ARRIVAL_CENTS,
        earnedFrom: this.earnedCents,
        earnedCents: this.earnedCents + ARRIVAL_CENTS,
        kbCount: this.kbCount + 1,
        waiting: this.waiting + 1,
        hours: 0,
        nextIn: '11h 59m',
        lastPaid: 'Last paid just now',
        dueAt: 'Due about 09:04',
      })
    },
    resetEdges() {
      if (this.emptyAcct) this.setEmptyAccount(false)
      this.$patch({
        lowBal: false, lowFees: false, stale: false, refreshing: false, late: false, poolDown: false,
        stakePending: false, noPayouts: false, kbEmpty: false, poolState: 'active', switchTo: null,
        offline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
      })
    },
  },
})
