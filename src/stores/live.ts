import { defineStore } from 'pinia'
import { watch } from 'vue'
import { useWallet } from './wallet'
import { useAccount } from './account'
import { useData } from './data'
import { useNav } from './nav'
import { usePlan } from './plan'
import { useOps, onSettled } from './ops'
import { useDry } from './dry'
import { router } from '../router'
import type { Pool } from '../services/mock'
import { rpc } from '../services/rpc'
import {
  addressHistory, findKickbacks, firstKickbackAt, getAccountBalance, getStaker, getValidator, headBlock, learnProbe, norm, poolStats,
  sameAddr, scheduleLabel, statsFromKickbacks, unstakeReadyAt,
} from '../services/chain'
import type { History, Kickback, PoolStats, Staker, Tx } from '../services/chain'
import { directValidators, grossStakingApy, knownValidators, status, supply } from '../services/validators'
import type { ApiValidator } from '../services/validators'
import { cacheGet, cacheSet, pruneCache } from '../lib/cache'
import { readyLuna } from '../lib/money'
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
  /** Kickbacks from the last 30 days. */
  kickbacks: Kickback[]
  userPool: Pool | null
  userStats: PoolStats | null
  /** Real inactive-stake timing (ms). */
  unstake: { readyAt: number, startedAt: number } | null
  /** Head block reading, for epoch timing. */
  head: { block: number, at: number } | null
  pools: Pool[]
  known: Record<string, Pool>
  /** Reward addresses of every direct pool we know (for kickback detection). */
  rewards: string[]
  grossApy: number | null
  poolsNote: string
}

/** Every incoming transaction of an address, compact, for the full-history Earned total. */
interface Incoming { h: string, t: number, f: string, v: number, r: boolean }
interface FullScan { items: Incoming[], newest: string | null, oldest: string | null, complete: boolean, at: number }

let snap: Snapshot | null = null
let lastHistory: History | null = null
let timer = 0
let generation = 0
let scanning = false

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

/** A pool we only know by address so far (before the Validators API answers). */
function placeholderPool(validator: string, reward: string, prev?: Pool): Pool {
  return prev ?? { id: validator, name: 'Your pool', validator, reward, fee: '', feeRate: 0, pays: '', trust: 0, lastPaid: '', payoutType: 'unknown' }
}

function incomingOf(address: string, txs: Tx[]): Incoming[] {
  const me = norm(address)
  const out: Incoming[] = []
  for (const t of txs) {
    if (t.executionResult === false || !(t.value > 0) || norm(t.from) === me) continue
    const toMe = norm(t.to) === me
    if (!toMe && !(t.relatedAddresses || []).some(a => norm(a) === me)) continue
    out.push({ h: t.hash, t: t.timestamp, f: t.from, v: t.value, r: !toMe })
  }
  return out
}

export const useLive = defineStore('live', {
  state: () => ({
    address: '',
    refreshing: false,
    lastOkAt: 0,
    lastError: '',
    /** Pool payout stats loaded (for Choose a pool). */
    poolsReady: false,
    /** Full-history scan for "Earned so far". */
    fullScan: { pages: 0, complete: false, running: false },
  }),
  getters: {
    active: () => { const w = useWallet(); return w.connected && !w.isMock },
    head: () => snap?.head ?? null,
    userStats: () => snap?.userStats ?? null,
  },
  actions: {
    /**
     * Start reading the current effective address: paint from cache at once,
     * then refresh. Resolves as soon as Home can be drawn (the user's own stake
     * and kickbacks); pools and the full history load in the background.
     */
    async start(): Promise<'cached' | 'ok' | 'failed'> {
      const wallet = useWallet(), account = useAccount(), plan = usePlan(), ops = useOps()
      if (wallet.isMock) return 'ok'
      startClock()
      pruneCache()
      const address = wallet.effectiveAddress
      generation++
      this.address = address
      this.poolsReady = false
      this.fullScan = { pages: 0, complete: false, running: false }
      plan.loadFor(address)
      ops.load(address)
      ops.resume()
      clearInterval(timer)
      timer = window.setInterval(() => { if (document.visibilityState === 'visible') this.refresh() }, REFRESH_EVERY)
      const cached = cacheGet<Snapshot>('snap:' + norm(address))
      if (cached && cached.v.rewards) {
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

    /**
     * Phase A (awaited): the user's stake, history and balance, so Home can render.
     * Phase B (background): Validators API, pool list, names, full history.
     */
    async refresh(opts: { force?: boolean } = {}): Promise<boolean> {
      const wallet = useWallet(), account = useAccount(), dry = useDry()
      if (wallet.isMock || !this.address) return !!snap
      if (this.refreshing && !opts.force) return !!snap
      const gen = generation
      const address = this.address
      const ttl = opts.force ? 0 : 60e3
      this.refreshing = true
      account.refreshing = true
      try {
        const stakerP = getStaker(address, ttl)
        const historyP = addressHistory(address, { days: 30, ttl })
        const balanceP = wallet.isPreview ? getAccountBalance(address, ttl) : Promise.resolve(null)
        if (!wallet.isPreview && !dry.on) wallet.refreshWalletBalance()
        const [stakerR, history, balanceR] = await Promise.all([stakerP, historyP, balanceP])
        if (gen !== generation) return false
        lastHistory = history

        const staker = dry.on && !wallet.isPreview ? dry.chain.staker : stakerR.value
        const prevKnown = snap?.known ?? {}
        let userReward = ''
        let userPool: Pool | null = null
        if (staker?.delegation) {
          const prev = prevKnown[staker.delegation] ?? Object.values(prevKnown).find(p => sameAddr(p.validator, staker.delegation))
          userReward = prev?.reward || (await getValidator(staker.delegation).then(r => r.value.rewardAddress).catch(() => ''))
          userPool = placeholderPool(staker.delegation, userReward, prev)
        }
        const rewards = [...new Set([...(snap?.rewards ?? []), ...(userReward ? [userReward] : [])])]
        const kickbacks = findKickbacks(address, history.txs, rewards)

        // Payout rhythm: own kickbacks when there are enough, else a probe of a known direct pool.
        let userStats: PoolStats | null = snap?.userStats ?? null
        if (userPool && userReward) {
          const own = kickbacks.filter(k => sameAddr(k.from, userReward))
          const fromOwn = statsFromKickbacks(own)
          if (fromOwn && fromOwn.alive && fromOwn.batches.length >= 3) { userStats = fromOwn; learnProbe(userReward, address) }
          else if (userPool.payoutType === 'direct') userStats = await poolStats(userReward).catch(() => fromOwn)
          else userStats = fromOwn
        }
        else userStats = null

        // Epoch timing (only when needed: inactive stake, new stakers).
        let unstake: Snapshot['unstake'] = null
        let head = snap?.head ?? null
        const needsHead = !!staker && (staker.inactiveBalance > 0 || kickbacks.length === 0)
        if (needsHead) head = await headBlock().catch(() => head)
        if (staker && !(dry.on && !wallet.isPreview)) {
          if (staker.inactiveBalance > 0 && staker.inactiveFrom) unstake = await unstakeReadyAt(staker.inactiveFrom).catch(() => snap?.unstake ?? null)
          else if (staker.retiredBalance > 0) unstake = { readyAt: Date.now(), startedAt: Date.now() }
        }

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
          head,
          pools: snap?.pools ?? [],
          known: { ...prevKnown, ...(userPool ? { [userPool.id]: userPool } : {}) },
          rewards,
          grossApy: snap?.grossApy ?? null,
          poolsNote: snap?.poolsNote ?? '',
        }
        this.apply(next, failed ? 'failed' : 'ok')
        if (!failed) { this.lastOkAt = Date.now(); this.lastError = '' }

        this.phaseB(gen, history)
        this.scanFull(gen)
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
      }
    },

    /** Validators API, pool list, the user's pool name and fee, all in the background. */
    async phaseB(gen: number, history: History) {
      const data = useData()
      if (!data.livePools.length) data.poolsState = 'loading'
      const api = await Promise.allSettled([directValidators(), status(), supply()])
      if (gen !== generation || !snap) return
      const direct = api[0].status === 'fulfilled' ? api[0].value.value : []
      const st = api[1].status === 'fulfilled' ? api[1].value.value : null
      const gross = api[2].status === 'fulfilled' ? grossStakingApy(api[2].value.value) : snap.grossApy
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
      if (gen !== generation || !snap) return
      const healthy = candidates.map((v, i) => ({ v, info: infos[i] })).filter(({ v, info }) => {
        if (!info) { notes.push(`${v.name}: validator lookup failed`); return false }
        if (info.inactivityFlag != null || info.retired || info.jailedFrom != null) { notes.push(`${v.name}: inactive on chain`); return false }
        return true
      })

      const s = snap
      const staker = s.staker
      const rewards = [...new Set([...healthy.map(h => h.info!.rewardAddress), ...s.rewards])]
      let userPool = s.userPool
      let userStats = s.userStats
      if (staker?.delegation) {
        let v = direct.find(x => sameAddr(x.address, staker.delegation))
        if (!v) v = (await knownValidators().then(r => r.value).catch(() => [] as ApiValidator[])).find(x => sameAddr(x.address, staker.delegation))
        const reward = userPool?.reward || healthy.find(h => sameAddr(h.v.address, staker.delegation))?.info?.rewardAddress || ''
        if (v) {
          if (v.payoutType === 'direct' && reward && !userStats) userStats = await poolStats(reward).catch(() => null)
          userPool = toPool(v, reward, v.payoutType === 'direct' ? userStats : null, gross)
        }
      }
      const kickbacks = findKickbacks(s.address, history.txs, rewards)
      const next: Snapshot = { ...s, kickbacks, userPool, userStats, rewards, grossApy: gross, poolsNote: notes.join('; '), known: { ...s.known, ...(userPool ? { [userPool.id]: userPool } : {}) } }
      this.apply(next, 'keep')
      this.loadPools(healthy.map(h => ({ v: h.v, reward: h.info!.rewardAddress })), gross, gen)
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
      pools.forEach((p) => { snap!.known[p.id] = { ...p, reward: p.reward } })
      if (hidden.length) snap.poolsNote = [snap.poolsNote, ...hidden].filter(Boolean).join('; ')
      this.poolsReady = true
      this.apply(snap, 'keep')
      data.poolsState = pools.length ? 'ready' : 'error'
    },

    /**
     * Earned so far over the full history: page back once (rate limited, in
     * the background), then only fetch what is new. Cached per address.
     */
    async scanFull(gen: number) {
      if (scanning || !this.address) return
      scanning = true
      const address = this.address
      const key = 'kbfull:' + norm(address)
      const c = cacheGet<FullScan>(key)?.v ?? { items: [], newest: null, oldest: null, complete: false, at: 0 }
      const seen = new Set(c.items.map(i => i.h))
      this.fullScan = { pages: 0, complete: c.complete, running: true }
      try {
        // 1. New transactions since the last scan (newest first, stop at the last one we have).
        let startAt: string | null = null, newest = c.newest
        for (let page = 0; page < 50; page++) {
          const r: { value: Tx[] } = await rpc<Tx[]>('getTransactionsByAddress', [address, 100, startAt], { ttl: page ? 7 * 24 * H : 60e3 })
          if (gen !== generation) return
          const list = r.value || []
          if (page === 0 && list[0]) newest = list[0].hash
          const stopAt = c.newest ? list.findIndex(t => t.hash === c.newest) : -1
          const fresh = stopAt >= 0 ? list.slice(0, stopAt) : list
          for (const i of incomingOf(address, fresh)) if (!seen.has(i.h)) { seen.add(i.h); c.items.push(i) }
          if (!c.oldest && list.length) c.oldest = list[list.length - 1].hash
          this.fullScan.pages++
          if (stopAt >= 0 || list.length < 100) { if (!c.newest && list.length < 100) c.complete = true; break }
          startAt = list[list.length - 1].hash
          if (!c.newest) c.oldest = startAt
        }
        c.newest = newest
        // 2. Older history, once.
        let older = c.oldest
        for (let page = 0; !c.complete && older && page < 300; page++) {
          const r: { value: Tx[] } = await rpc<Tx[]>('getTransactionsByAddress', [address, 100, older], { ttl: 30 * 24 * H })
          if (gen !== generation) return
          const list = r.value || []
          for (const i of incomingOf(address, list)) if (!seen.has(i.h)) { seen.add(i.h); c.items.push(i) }
          this.fullScan.pages++
          if (list.length < 100) { c.complete = true; break }
          older = list[list.length - 1].hash
          c.oldest = older
          if (page % 5 === 4) cacheSet(key, { ...c, at: Date.now() })
        }
        cacheSet(key, { ...c, at: Date.now() })
        this.fullScan.complete = c.complete
        this.derive()
      }
      catch { /* try again on the next refresh */ }
      finally {
        scanning = false
        this.fullScan.running = false
      }
    },

    /** Write a snapshot into the stores the screens read. */
    apply(s: Snapshot, result: 'ok' | 'failed' | 'keep') {
      const wallet = useWallet(), account = useAccount(), data = useData()
      if (!sameAddr(s.address, this.address)) return
      snap = s
      if (result !== 'failed') cacheSet('snap:' + norm(s.address), s, s.at)
      data.livePools = s.pools
      data.known = s.known
      data.grossApy = s.grossApy
      data.userReward = s.userPool?.reward || ''
      data.poolsNote = s.poolsNote
      if (s.pools.length) data.poolsState = 'ready'
      if (wallet.isPreview && s.balanceLuna != null) wallet.previewBalanceLuna = s.balanceLuna
      this.derive()
      if (result === 'failed') this.markStale()
      else if (result === 'ok') account.$patch({ stale: false, staleMin: 0 })
      this.routeHome()
    },

    /** All kickbacks we know: last 30 days, full history, and dry-run fakes. */
    allKickbacks(): { list: Kickback[], earnedLuna: number, complete: boolean } {
      if (!snap) return { list: [], earnedLuna: 0, complete: false }
      const dry = useDry(), wallet = useWallet()
      const rewards = new Set(snap.rewards.map(norm))
      const full = cacheGet<FullScan>('kbfull:' + norm(snap.address))?.v
      const byHash = new Map<string, Kickback>()
      for (const k of snap.kickbacks) byHash.set(k.hash, k)
      if (full) for (const i of full.items) if (rewards.has(norm(i.f)) && !byHash.has(i.h)) byHash.set(i.h, { hash: i.h, at: i.t, luna: i.v, from: i.f, restaked: i.r })
      if (dry.on && !wallet.isPreview) for (const k of dry.kickbacks) byHash.set('dry' + k.at, { hash: 'dry' + k.at, at: k.at, luna: k.luna, from: snap.userPool?.reward || 'Dry run', restaked: false })
      const list = [...byHash.values()].sort((a, b) => b.at - a.at)
      const complete = !!full?.complete
      const earnedLuna = (complete ? list : list.filter(k => k.at >= Date.now() - 30 * 24 * H)).reduce((a, k) => a + k.luna, 0)
      return { list, earnedLuna, complete }
    },

    /** Recompute everything derived (also on every clock tick and plan/op change). */
    derive() {
      const account = useAccount(), data = useData(), plan = usePlan(), ops = useOps(), dry = useDry(), wallet = useWallet()
      if (!snap) return
      const t = now.value
      const isDry = dry.on && !wallet.isPreview
      const chain = isDry ? dry.chain : null
      const st = isDry ? chain!.staker : snap.staker
      const { list: kick, earnedLuna, complete } = this.allKickbacks()
      const recent = kick.filter(k => k.at >= t - 30 * 24 * H)
      data.kickbacks = recent
      const staked = !!st && (st.balance + st.inactiveBalance + st.retiredBalance) > 0

      // Ready to share: wallet kickbacks since the plan started, minus what's shared or in flight.
      const inFlight = ops.active.filter(o => o.flow === 'run').reduce((a, o) => a + o.req.value, 0)
      const ready = readyLuna(kick, plan.planStartedAt, plan.ledger, inFlight)
      const since = Math.max(plan.planStartedAt ?? Infinity, plan.lastRunAt ?? 0)
      const waiting = plan.planStartedAt == null ? 0 : kick.filter(k => !k.restaked && k.at >= since).length

      const stats = snap.userStats
      const own = snap.userPool?.reward ? kick.filter(k => sameAddr(k.from, snap!.userPool!.reward)) : []
      const interval = (stats?.intervalH ?? 12) * H
      const lastAt = own[0]?.at ?? stats?.lastPaidAt ?? null
      const nextAt = lastAt ? lastAt + interval : null
      const over = nextAt ? t - nextAt : 0
      const notDirect = staked && !!snap.userPool && snap.userPool.payoutType !== 'direct' && snap.userPool.payoutType !== 'unknown'
      const poolLast = stats?.lastPaidAt ?? null
      let firstIn: number | null = null
      if (staked && own.length === 0) {
        const at = snap.head ? firstKickbackAt(snap.head, stats) : (poolLast ? poolLast + interval : null)
        if (at) firstIn = Math.max(1, Math.ceil((at - t) / H))
      }

      // Inactive stake: real timing, or the fake chain's.
      let unstake = snap.unstake
      if (isDry && st && (st.inactiveBalance > 0 || st.retiredBalance > 0)) {
        const startedAt = chain!.inactiveSince ?? t
        unstake = { startedAt, readyAt: st.inactiveBalance > 0 ? startedAt + dry.releaseMs : t }
      }
      const inactive = st ? st.inactiveBalance + st.retiredBalance : 0

      // Switching (update staker after release): shows "Moving to…" until it takes effect.
      const sw = ops.latest('switch')
      // Only while the stake is still with the new pool and nothing has been deactivated since.
      const switching = !!sw && !!st && st.inactiveBalance === 0 && st.retiredBalance === 0 && sameAddr(st.delegation, sw.req.newDelegation)
        && (sw.phase === 'confirming' || (sw.phase === 'confirmed' && Number(sw.meta?.effectiveAt ?? 0) > t))

      account.$patch({
        staked,
        pool: st?.delegation || '',
        stakedNim: st ? st.balance / 1e5 : 0,
        inactiveNim: inactive / 1e5,
        retiredNim: st ? st.retiredBalance / 1e5 : 0,
        poolState: switching ? 'switching' : st && inactive > 0 ? 'unstaking' : 'active',
        switchTo: switching ? (sw!.req.newDelegation ?? null) : null,
        switchEffectiveAt: switching ? Number(sw!.meta?.effectiveAt ?? 0) || null : null,
        notDirect,
        readyFrom: account.readyCents,
        readyCents: Math.round(ready / 1000),
        readyLuna: ready,
        earnedFrom: account.earnedCents,
        earnedCents: Math.round(earnedLuna / 1000),
        earnedComplete: complete,
        kbCount: complete ? kick.length : recent.length,
        waiting,
        kbEmpty: recent.length === 0,
        emptyAcct: staked && recent.length === 0,
        noPayouts: false,
        hours: lastAt ? Math.max(0, Math.min(12, Math.round((t - lastAt) / interval * 12))) : 0,
        nextIn: !nextAt ? '' : over <= 0 ? duration(nextAt - t) : 'a few min',
        lastPaid: lastAt ? `Last paid ${clockOrDay(lastAt)}` : 'No kickbacks yet',
        dueAt: nextAt ? `Due about ${hhmm(nextAt)}` : '',
        late: !notDirect && !!nextAt && over > 2 * H,
        poolLastPaidAt: poolLast,
        poolDown: !notDirect && staked && !!poolLast && t - poolLast > 36 * H,
        firstInH: firstIn,
        stakePending: ops.active.some(o => o.flow === 'stake'),
        unstakeReadyAt: unstake?.readyAt ?? null,
        unstakeProgress: unstake ? Math.max(0, Math.min(1, (t - unstake.startedAt) / Math.max(1, unstake.readyAt - unstake.startedAt))) : 0,
        canUndo: !!st && st.inactiveBalance > 0,
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
      lastHistory = null
    },
  },
})

/** Recompute countdowns as time passes, refresh on foreground, and after every settled transaction. */
export function wireLiveClock() {
  const live = useLive(), plan = usePlan(), dry = useDry(), ops = useOps()
  watch(now, () => live.derive())
  watch(() => [plan.ledger.length, plan.planStartedAt, ops.active.length, dry.tick, dry.on, dry.kickbacks.length, dry.releaseMs], () => live.derive())
  onSettled(() => { if (live.active) setTimeout(() => live.refresh({ force: true }), 1500) })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && live.active && Date.now() - live.lastOkAt > 60e3) live.refresh()
  })
}

/** The staker as the app sees it now, in Luna: the fake chain in dry run, else the last read. */
export function currentStaker(): Staker | null {
  const dry = useDry(), wallet = useWallet()
  if (dry.on && !wallet.isPreview) return dry.chain.staker
  return snap?.staker ?? null
}

/** Last fetched 30-day history (for flows that need raw transactions). */
export function currentHistory(): History | null { return lastHistory }
