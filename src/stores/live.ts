import { defineStore } from 'pinia'
import { watch } from 'vue'
import { useWallet } from './wallet'
import { useAccount } from './account'
import { useData } from './data'
import { useNav } from './nav'
import { router } from '../router'
import type { Pool } from '../services/mock'
import {
  addressHistory, findKickbacks, getAccountBalance, getStaker, getValidator, norm, poolStats, sameAddr, scheduleLabel, statsFromKickbacks, learnProbe, unstakeReadyAt,
} from '../services/chain'
import type { Kickback, PoolStats, Staker } from '../services/chain'
import { directValidators, grossStakingApy, knownValidators, status, supply } from '../services/validators'
import type { ApiValidator } from '../services/validators'
import { cacheGet, cacheSet, pruneCache } from '../lib/cache'
import { ago, clockOrDay, duration, hhmm, now, startClock } from '../lib/time'

const H = 3600e3
const STALE_AFTER = 10 * 60e3
const REFRESH_EVERY = 2 * 60e3

/** Everything needed to draw the app for one address. Cached per address for instant paint. */
interface Snapshot {
  address: string
  at: number
  staker: Staker | null
  balanceLuna: number | null
  kickbacks: Kickback[]
  userPool: Pool | null
  userStats: PoolStats | null
  /** Inactive stake timing (ms), when the staker has any. */
  unstake: { readyAt: number, startedAt: number } | null
  pools: Pool[]
  known: Record<string, Pool>
  grossApy: number | null
  poolsNote: string
}

let snap: Snapshot | null = null
let timer = 0
let generation = 0

const feePct = (f: number) => `${+(f * 100).toFixed(2)}%`

/**
 * Trust out of 10. The API has a score (score.total, 0..1, v2): use it.
 * Fallback when it has none (documented in docs/data-notes.md):
 * 5 for active+elected, up to 2 for a low fee, up to 3 for regular payouts.
 */
function trustOf(v: ApiValidator, stats: PoolStats | null): number {
  if (v.score != null && v.scoreStatus === 'current') return Math.max(0, Math.min(10, Math.round(v.score * 10)))
  const feePart = 2 * Math.max(0, 1 - v.fee / 0.1)
  let regular = 0
  if (stats && stats.batches.length >= 3 && stats.intervalH) {
    const gaps = stats.batches.slice(0, -1).map((b, i) => (b - stats.batches[i + 1]) / H)
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length)
    regular = 3 * Math.max(0, 1 - sd / stats.intervalH)
  }
  return Math.round(5 + feePart + regular)
}

function toPool(v: ApiValidator, reward: string, stats: PoolStats | null, gross: number | null): Pool {
  return {
    id: v.address,
    name: v.name,
    validator: v.address,
    reward,
    fee: feePct(v.fee),
    feeRate: v.fee,
    pays: stats ? scheduleLabel(stats.batches, stats.intervalH) : (v.payoutSchedule || ''),
    trust: trustOf(v, stats),
    lastPaid: stats?.lastPaidAt ? `Last paid ${ago(stats.lastPaidAt)}` : 'Checking payouts…',
    lastPaidAt: stats?.lastPaidAt ?? null,
    intervalH: stats?.intervalH ?? null,
    payoutType: v.payoutType,
    apyNet: gross != null ? gross * (1 - v.fee) : null,
  }
}

export const useLive = defineStore('live', {
  state: () => ({
    address: '',
    refreshing: false,
    lastOkAt: 0,
    lastError: '',
    /** Pool payout stats loaded (for Choose a pool). */
    poolsReady: false,
  }),
  getters: {
    active: () => { const w = useWallet(); return w.connected && !w.isMock },
  },
  actions: {
    /**
     * Start reading the current effective address: paint from cache at once,
     * then refresh. Resolves when there is something to show.
     */
    async start(): Promise<'cached' | 'ok' | 'failed'> {
      const wallet = useWallet(), account = useAccount()
      if (wallet.isMock) return 'ok'
      startClock()
      pruneCache()
      const address = wallet.effectiveAddress
      generation++
      this.address = address
      this.poolsReady = false
      clearInterval(timer)
      timer = window.setInterval(() => { if (document.visibilityState === 'visible') this.refresh() }, REFRESH_EVERY)
      const cached = cacheGet<Snapshot>('snap:' + norm(address))
      if (cached) {
        this.apply(cached.v, 'keep')
        this.refresh()
        return 'cached'
      }
      account.liveLoading = true
      snap = null
      const ok = await this.refresh()
      account.liveLoading = false
      return ok ? 'ok' : 'failed'
    },

    /** Re-read everything for the current address. Returns false when nothing could be loaded. */
    async refresh(): Promise<boolean> {
      const wallet = useWallet(), account = useAccount(), data = useData()
      if (wallet.isMock || !this.address || this.refreshing) return !!snap
      const gen = generation
      const address = this.address
      this.refreshing = true
      account.refreshing = true
      try {
        // API (not rate limited) and RPC reads in parallel.
        const apiP = Promise.allSettled([directValidators(), status(), supply()])
        const stakerP = getStaker(address)
        const historyP = addressHistory(address, { days: 30 })
        const balanceP = wallet.isPreview ? getAccountBalance(address) : wallet.refreshWalletBalance().then(() => null)
        const [api, stakerR, history, balanceR] = await Promise.all([apiP, stakerP, historyP, balanceP])
        if (gen !== generation) return false

        const direct = api[0].status === 'fulfilled' ? api[0].value.value : []
        const st = api[1].status === 'fulfilled' ? api[1].value.value : null
        const gross = api[2].status === 'fulfilled' ? grossStakingApy(api[2].value.value) : (snap?.grossApy ?? null)
        const elected = new Set((st?.elected || []).map(norm))

        // Candidate pools: direct payout, current score, elected this epoch, healthy on chain.
        const notes: string[] = []
        const candidates = direct.filter((v) => {
          if (v.payoutType !== 'direct') return false
          if (st && !elected.has(norm(v.address))) { notes.push(`${v.name}: not elected`); return false }
          if (v.scoreStatus !== 'current') { notes.push(`${v.name}: score ${v.scoreStatus}`); return false }
          return true
        })
        const infos = await Promise.all(candidates.map(v => getValidator(v.address).then(r => r.value).catch(() => null)))
        const healthy = candidates.map((v, i) => ({ v, info: infos[i] })).filter(({ v, info }) => {
          if (!info) { notes.push(`${v.name}: validator lookup failed`); return false }
          if (info.inactivityFlag != null || info.retired || info.jailedFrom != null) { notes.push(`${v.name}: inactive on chain`); return false }
          return true
        })

        // The user's stake and pool.
        const staker = stakerR.value
        let userPool: Pool | null = null
        let userReward = ''
        if (staker && staker.delegation) {
          const h = healthy.find(x => sameAddr(x.v.address, staker.delegation))
          if (h) userReward = h.info!.rewardAddress
          else {
            const info = await getValidator(staker.delegation).then(r => r.value).catch(() => null)
            userReward = info?.rewardAddress || ''
          }
          let v = direct.find(x => sameAddr(x.address, staker.delegation))
          if (!v) v = (await knownValidators().then(r => r.value).catch(() => [] as ApiValidator[])).find(x => sameAddr(x.address, staker.delegation))
          userPool = v ? toPool(v, userReward, null, gross) : null
        }

        // Kickbacks: incoming payouts from any healthy direct pool or the user's own pool.
        const rewards = [...healthy.map(h => h.info!.rewardAddress), ...(userReward ? [userReward] : [])]
        const kickbacks = findKickbacks(address, history.txs, rewards)

        // Payout rhythm of the user's pool: their own kickbacks when there are enough, else a probe.
        let userStats: PoolStats | null = null
        if (userPool && userPool.payoutType === 'direct' && userReward) {
          const own = kickbacks.filter(k => sameAddr(k.from, userReward))
          const fromOwn = statsFromKickbacks(own)
          if (fromOwn && fromOwn.alive && fromOwn.batches.length >= 3) { userStats = fromOwn; learnProbe(userReward, address) }
          else userStats = await poolStats(userReward).catch(() => fromOwn)
          if (userStats) userPool = toPool(direct.find(x => sameAddr(x.address, staker!.delegation))!, userReward, userStats, gross)
        }

        // Inactive stake: when it becomes withdrawable.
        let unstake: Snapshot['unstake'] = null
        if (staker && staker.inactiveBalance > 0 && staker.inactiveFrom) unstake = await unstakeReadyAt(staker.inactiveFrom).catch(() => snap?.unstake ?? null)
        else if (staker && staker.retiredBalance > 0) unstake = { readyAt: Date.now(), startedAt: Date.now() }

        const failed = stakerR.stale || history.stale || (balanceR?.stale ?? false)
        const next: Snapshot = {
          address,
          at: failed ? Math.min(stakerR.at, history.at) : Date.now(),
          staker,
          balanceLuna: balanceR ? balanceR.value : null,
          kickbacks,
          userPool,
          userStats,
          unstake,
          pools: snap?.pools ?? [],
          known: { ...(snap?.known ?? {}) },
          grossApy: gross,
          poolsNote: notes.join('; '),
        }
        if (userPool) next.known[userPool.id] = userPool
        this.apply(next, failed ? 'failed' : 'ok')
        if (!failed) { this.lastOkAt = Date.now(); this.lastError = '' }

        // Pool list for Choose a pool: payout health of every candidate (probes, cached 15 min).
        this.loadPools(healthy.map(h => ({ v: h.v, reward: h.info!.rewardAddress })), gross, gen)
        return true
      }
      catch (error) {
        this.lastError = (error as Error).message || String(error)
        if (snap) this.markStale()
        return !!snap
      }
      finally {
        this.refreshing = false
        account.refreshing = false
        data.poolsState = data.poolsState === 'idle' ? 'loading' : data.poolsState
      }
    },

    async loadPools(list: Array<{ v: ApiValidator, reward: string }>, gross: number | null, gen: number) {
      const data = useData()
      if (!list.length) { data.poolsState = snap?.pools.length ? 'ready' : 'error'; return }
      if (!data.livePools.length) data.poolsState = 'loading'
      const results = await Promise.all(list.map(x => poolStats(x.reward).catch(() => null)))
      if (gen !== generation || !snap) return
      const hidden: string[] = []
      const pools = list.map((x, i) => ({ x, s: results[i] }))
        .filter(({ x, s }) => {
          if (s && !s.alive) { hidden.push(`${x.v.name}: no payout in 72h`); return false }
          return true
        })
        // A failed check keeps the last known stats instead of blanking the card.
        .map(({ x, s }) => s ? toPool(x.v, x.reward, s, gross) : (snap!.pools.find(p => p.id === x.v.address) ?? toPool(x.v, x.reward, null, gross)))
        .map((p): Pool => ({ ...p, badge: undefined }))
        .sort((a, b) => a.feeRate - b.feeRate || b.trust - a.trust)
      const minFee = Math.min(...pools.map(p => p.feeRate))
      if (pools.filter(p => p.feeRate === minFee).length === 1) pools.find(p => p.feeRate === minFee)!.badge = 'Lowest fee'
      snap.pools = pools
      pools.forEach((p) => { snap!.known[p.id] = p })
      if (hidden.length) snap.poolsNote = [snap.poolsNote, ...hidden].filter(Boolean).join('; ')
      this.poolsReady = true
      this.apply(snap, 'keep')
      data.poolsState = pools.length ? 'ready' : 'error'
    },

    /**
     * Write a snapshot into the stores the screens read.
     * ok: fresh from the network (clears the stale banner); failed: the refresh
     * failed and this is older data; keep: don't touch the stale state.
     */
    apply(s: Snapshot, result: 'ok' | 'failed' | 'keep') {
      const wallet = useWallet(), account = useAccount(), data = useData()
      if (!sameAddr(s.address, this.address)) return
      snap = s
      if (result !== 'failed') cacheSet('snap:' + norm(s.address), s, s.at)
      data.livePools = s.pools
      data.known = s.known
      data.grossApy = s.grossApy
      data.kickbacks = s.kickbacks
      data.userReward = s.userPool?.reward || ''
      data.poolsNote = s.poolsNote
      if (s.pools.length) data.poolsState = 'ready'
      if (wallet.isPreview && s.balanceLuna != null) wallet.previewBalanceLuna = s.balanceLuna
      this.derive()
      if (result === 'failed') this.markStale()
      else if (result === 'ok') account.$patch({ stale: false, staleMin: 0 })
      this.routeHome()
    },

    /** Recompute the time-based numbers (also on every clock tick). */
    derive() {
      const account = useAccount()
      if (!snap) return
      const t = now.value
      const st = snap.staker
      const kick = snap.kickbacks
      const staked = !!st && (st.balance + st.inactiveBalance + st.retiredBalance) > 0
      const ready = kick.filter(k => t - k.at < 24 * H)
      const lunaSum = (l: Kickback[]) => l.reduce((a, k) => a + k.luna, 0)
      const stats = snap.userStats
      const own = snap.userPool?.reward ? kick.filter(k => sameAddr(k.from, snap!.userPool!.reward)) : []
      const interval = (stats?.intervalH ?? 12) * H
      const lastAt = own[0]?.at ?? stats?.lastPaidAt ?? null
      const nextAt = lastAt ? lastAt + interval : null
      const over = nextAt ? t - nextAt : 0
      const notDirect = staked && !!snap.userPool && snap.userPool.payoutType !== 'direct'
      const poolLast = stats?.lastPaidAt ?? null
      const firstIn = kick.length === 0 && poolLast ? Math.max(1, Math.ceil(((poolLast + interval - t) > 0 ? poolLast + interval - t : interval) / H)) : null
      const readyCents = Math.round(lunaSum(ready) / 1000)
      const earnedCents = Math.round(lunaSum(kick) / 1000)
      account.$patch({
        staked,
        pool: st?.delegation || '',
        stakedNim: st ? st.balance / 1e5 : 0,
        inactiveNim: st ? (st.inactiveBalance + st.retiredBalance) / 1e5 : 0,
        poolState: st && st.inactiveBalance + st.retiredBalance > 0 ? 'unstaking' : 'active',
        switchTo: null,
        notDirect,
        readyFrom: account.readyCents,
        readyCents,
        earnedFrom: account.earnedCents,
        earnedCents,
        kbCount: kick.length,
        waiting: ready.length,
        kbEmpty: kick.length === 0,
        emptyAcct: staked && kick.length === 0,
        noPayouts: false,
        hours: lastAt ? Math.max(0, Math.min(12, Math.round((t - lastAt) / interval * 12))) : 0,
        nextIn: !nextAt ? '' : over <= 0 ? duration(nextAt - t) : 'a few min',
        lastPaid: lastAt ? `Last paid ${clockOrDay(lastAt)}` : 'No kickbacks yet',
        dueAt: nextAt ? `Due about ${hhmm(nextAt)}` : '',
        late: !notDirect && !!nextAt && over > 2 * H,
        poolLastPaidAt: poolLast,
        poolDown: !notDirect && staked && !!poolLast && t - poolLast > 36 * H,
        firstInH: firstIn,
        stakePending: false,
        unstakeReadyAt: snap.unstake?.readyAt ?? null,
        unstakeProgress: snap.unstake ? Math.max(0, Math.min(1, (t - snap.unstake.startedAt) / Math.max(1, snap.unstake.readyAt - snap.unstake.startedAt))) : 0,
      })
    },

    markStale() {
      const account = useAccount()
      if (!snap) return
      const age = Date.now() - snap.at
      account.$patch({ stale: age > STALE_AFTER, staleMin: Math.round(age / 60e3) })
    },

    /** Keep Home and Home (not staked) in line with the stake. */
    routeHome() {
      const nav = useNav(), account = useAccount()
      if (nav.screen === 'home' && !account.staked) router.replace('/start')
      else if (nav.screen === 'homeEmpty' && account.staked) router.replace('/home')
    },

    stop() {
      clearInterval(timer)
      generation++
      snap = null
    },
  },
})

/** Recompute countdowns as time passes, and refresh when the app comes back to the foreground. */
export function wireLiveClock() {
  const live = useLive()
  watch(now, () => live.derive())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && live.active && Date.now() - live.lastOkAt > 60e3) live.refresh()
  })
}
