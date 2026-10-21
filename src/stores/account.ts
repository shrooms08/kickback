import { defineStore } from 'pinia'
import { useWallet } from './wallet'
import {
  ACCOUNT_EMPTY, ACCOUNT_FULL, ARRIVAL_CENTS, MOCK_LOW_BALANCE_NIM, POOLS, STAKED_NIM,
} from '../services/mock'
import type { PoolId } from '../services/mock'

export type PoolState = 'active' | 'switching' | 'unstaking'

/**
 * The staking account Kickback shows. Phase 1: mock numbers plus every edge
 * state from the prototype. Only the wallet balance is real (inside Nimiq Pay).
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
  }),
  getters: {
    poolName: s => POOLS[s.pool].name,
    switchToName: s => (s.switchTo ? POOLS[s.switchTo].name : ''),
    readyNim: s => s.readyCents / 100,
    earnedNim: s => s.earnedCents / 100,
    /** Spendable wallet balance in NIM. Real when connected inside Nimiq Pay. */
    walletNim(s): number {
      const wallet = useWallet()
      if (wallet.isMock) return s.lowBal ? MOCK_LOW_BALANCE_NIM : wallet.balanceNim
      return wallet.balanceNim
    },
    unstaking: s => s.poolState === 'unstaking',
    switching: s => s.poolState === 'switching',
    payoutsEmpty: s => s.emptyAcct || s.noPayouts,
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
