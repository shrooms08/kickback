import { defineStore } from 'pinia'
import { useWallet } from './wallet'
import { CHART, CHART_GHOST, CHART_LABELS, FEED, PAYOUTS, POOLS, RECENT } from '../services/mock'
import type { FeedGroup, Pool } from '../services/mock'
import type { Kickback } from '../services/chain'
import { sameAddr } from '../services/chain'
import { dayLabel, hhmm, monthDay, now, startOfDay, whenLabel } from '../lib/time'

const DAY = 24 * 3600e3

/**
 * What the screens show about pools and kickbacks. In mock mode (?mock=1 in
 * dev) every getter returns the prototype's mock data unchanged; otherwise it
 * is built from live mainnet data written by the live store.
 */
export const useData = defineStore('data', {
  state: () => ({
    /** Live pools that passed the filters, cheapest first. */
    livePools: [] as Pool[],
    /** Every pool we know by id, including the user's pool when it is hidden or not direct. */
    known: {} as Record<string, Pool>,
    poolsState: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
    /** Why pools were hidden, for Diagnostics. */
    poolsNote: '',
    /** Gross network staking reward estimate, 0..1. */
    grossApy: null as number | null,
    kickbacks: [] as Kickback[],
    /** Reward address of the user's pool (live). */
    userReward: '' as string,
  }),
  getters: {
    isMock: () => useWallet().isMock,
    pools(): Pool[] {
      return this.isMock ? [POOLS.fun, POOLS.obs] : this.livePools
    },
    /** A pool by id, falling back to a placeholder so screens never crash. */
    pool() {
      return (id: string | null | undefined): Pool => {
        if (!id) return placeholder('')
        if (this.isMock) return POOLS[id] || POOLS.fun
        return this.known[id] || this.livePools.find(p => sameAddr(p.validator, id)) || placeholder(id)
      }
    },
    /** Estimated reward rate for a pool, after its fee. */
    apyFor() {
      return (id: string | null | undefined): number => {
        const p = this.pool(id)
        if (p.apyNet != null) return p.apyNet
        if (this.grossApy != null) return this.grossApy * (1 - (p.feeRate || 0.025))
        return 0.08
      }
    },
    /** The Nimiq staking calculator rate after the pool's fee, or null when it isn't known yet (no label then). */
    rateFor() {
      return (id: string | null | undefined): number | null => {
        if (this.isMock) return this.apyFor(id)
        const p = this.pool(id)
        if (p.apyNet != null) return p.apyNet
        return this.grossApy != null && p.feeRate != null ? this.grossApy * (1 - p.feeRate) : null
      }
    },
    /** Best calculator rate across the pools on offer, or null. */
    bestRate(): number | null {
      if (this.isMock) return this.bestApy
      const rates = this.livePools.map(p => p.apyNet).filter((r): r is number => r != null)
      return rates.length ? Math.max(...rates) : null
    },
    /** Best estimate across the pools on offer (Home before staking). */
    bestApy(): number {
      if (this.isMock) return 0.09
      const rates = this.livePools.map(p => p.apyNet).filter((r): r is number => r != null)
      if (rates.length) return Math.max(...rates)
      return this.grossApy != null ? this.grossApy * 0.975 : 0.08
    },
    recent(): Array<{ amt: number, when: string, waiting: boolean | null }> {
      if (this.isMock) return RECENT.map(r => ({ ...r, waiting: true }))
      const t = now.value
      return this.kickbacks.slice(0, 3).map(k => ({ amt: k.luna / 1e5, when: whenLabel(k.at, t), waiting: t - k.at < DAY ? true : null }))
    },
    /** Day-grouped list for the Kickbacks feed. Kickbacks from the last 24h are "Waiting" (ready to share). */
    feed(): FeedGroup[] {
      if (this.isMock) return FEED
      const t = now.value
      const groups: FeedGroup[] = []
      for (const k of this.kickbacks) {
        const day = dayLabel(k.at, t)
        let g = groups[groups.length - 1]
        if (!g || g.day !== day) { g = { day, rows: [] }; groups.push(g) }
        g.rows.push({ time: hhmm(k.at), amt: k.luna / 1e5, waiting: t - k.at < DAY ? true : null })
      }
      return groups
    },
    /** Pool tab "Last 10 kickbacks". */
    payouts(): Array<{ when: string, amt: number }> {
      if (this.isMock) return PAYOUTS
      void now.value
      const own = this.userReward ? this.kickbacks.filter(k => sameAddr(k.from, this.userReward)) : this.kickbacks
      return own.slice(0, 10).map(k => ({ when: whenLabel(k.at), amt: k.luna / 1e5 }))
    },
    /** 14 daily totals, oldest first; the last bar is today. */
    chart(): { values: number[], ghost: number[], labels: string[], total: number, perDay: string } {
      if (this.isMock) return { values: CHART, ghost: CHART_GHOST, labels: CHART_LABELS, total: CHART.reduce((a, b) => a + b, 0), perDay: '2 a day' }
      const today = startOfDay(now.value)
      const days = Array.from({ length: 14 }, (_, i) => today - (13 - i) * DAY)
      const values = days.map(() => 0)
      let count = 0
      for (const k of this.kickbacks) {
        const i = days.indexOf(startOfDay(k.at))
        if (i >= 0) { values[i] += k.luna / 1e5; count++ }
      }
      const total = values.reduce((a, b) => a + b, 0)
      const per = count / 14
      return {
        values,
        ghost: CHART_GHOST,
        labels: [monthDay(days[0]), monthDay(days[6]), 'Today'],
        total,
        perDay: per >= 0.5 ? `${Math.round(per)} a day` : count ? `${count} in 14 days` : 'None yet',
      }
    },
  },
})

function placeholder(id: string): Pool {
  const g = id.trim().split(/\s+/)
  return {
    id,
    name: g.length > 1 ? `${g[0]} … ${g[g.length - 1]}` : (id || 'Pool'),
    validator: id,
    fee: '',
    feeRate: 0,
    pays: '',
    trust: 0,
    lastPaid: '',
    payoutType: 'unknown',
  }
}
