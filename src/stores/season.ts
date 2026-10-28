import { defineStore } from 'pinia'
import { watch } from 'vue'
import { BackendError, backendEnabled, callFn } from '../services/backend'
import { prefGet, prefSet } from '../lib/cache'
import { useWallet } from './wallet'
import { useDry } from './dry'
import { useSession } from './session'
import { useFlow } from './flow'
import { usePlan } from './plan'

// Season 1, as the server computed it from verified data (supabase/functions/season). The app
// never decides an unlock itself: it shows what the server returns, caches it per network and
// wallet for instant paint, and applies the chosen Stack skin. Preview, dry run and mock mode
// are paused: nothing is read or earned there.

export type Skin = 'spark' | 'kick' | 'bounce' | 'rally' | 'surge' | 'legend'
export type MilestoneKey = 'first_stake' | 'first_kickback' | 'first_share' | 'ten_runs' | 'hundred_shared' | 'streak_30' | 'invited_staker'
export type StreakDot = 'ok' | 'saved' | 'missed' | 'pending'

export interface TierInfo { i: number, name: string, skin: Skin, sub: 0 | 1 | 2, roman: string, next: string | null, toNext: number, floor: number }
export interface Quest { key: 'run3' | 'add' | 'keep', p: number, n: number, done: boolean }
export interface SeasonData {
  season: { id: number, name: string, endsAt: string | null, ended?: boolean, nextStartsAt?: string | null }
  /** Stage B: XP this season, tier, ladder, weekly quests. Absent from an older server. */
  xp?: number
  tier?: TierInfo
  tiers?: Array<{ name: string, at: number, skin: Skin }>
  quests?: Quest[]
  code: string
  milestones: Array<{ key: MilestoneKey, unlocked_at: string }>
  unlocked: Skin[]
  unlockedAt?: Partial<Record<Skin, string>>
  skin: Skin
  streak: { current: number, best: number, savers: number, pending: number, hist: StreakDot[] }
  facts?: { runs: number, sharedLuna: number, kickbacks: number }
  /** Verified kickbacks since the plan started (ms, Luna). Absent from an older server. */
  kickbacks?: Array<{ hash: string, at: number, luna: number }>
  invites: { claimed: number, staked: number }
  chainOk: boolean
}

/** One skin per tier (Stage B). Skins unlocked earlier through milestones stay unlocked. */
export const SKIN_LIST: Array<{ k: Skin, name: string, note: string, from: string, at: number }> = [
  { k: 'spark', name: 'Spark', note: 'Diagonal hatch', from: 'Everyone', at: 0 },
  { k: 'kick', name: 'Kick', note: 'Cross-hatch', from: 'Reach Kick · 1,000 XP', at: 1000 },
  { k: 'bounce', name: 'Bounce', note: 'Stippled dots', from: 'Reach Bounce · 3,000 XP', at: 3000 },
  { k: 'rally', name: 'Rally', note: 'Wavy lines', from: 'Reach Rally · 8,000 XP', at: 8000 },
  { k: 'surge', name: 'Surge', note: 'Zigzag', from: 'Reach Surge · 20,000 XP', at: 20000 },
  { k: 'legend', name: 'Legend', note: 'Confetti + glow', from: 'Reach Legend · 50,000 XP', at: 50000 },
]
export const QUEST_TITLES: Record<Quest['key'], string> = { run3: 'Run your plan 3 times', add: 'Add someone to your plan', keep: 'Keep your stake all week' }
export const XP_WAYS: Array<[string, string]> = [
  ['Keep NIM staked', 'up to 2,000 XP a day (50 × √ staked NIM)'],
  ['Run your plan', '+200 XP a run, 2 a day'],
  ['Share with someone', '+100 XP a run with a send, 2 a day'],
  ['Friend\'s first stake', '+500 XP'],
  ['Weekly quest', '+300 XP each'],
]

export const MILESTONE_LIST: Array<{ k: MilestoneKey, label: string, icon: string }> = [
  { k: 'first_stake', label: 'First stake', icon: 'shield' },
  { k: 'first_kickback', label: 'First kickback', icon: 'trend' },
  { k: 'first_share', label: 'First share to someone', icon: 'heart' },
  { k: 'ten_runs', label: '10 plan runs', icon: 'check' },
  { k: 'hundred_shared', label: '100 NIM shared', icon: 'coins' },
  { k: 'streak_30', label: '30-day streak', icon: 'ring' },
  { k: 'invited_staker', label: 'Invited a friend who staked', icon: 'user' },
]

export const COSMETIC_NOTE = 'Cosmetic only. Milestones and skins are not money and never become tokens. Neither is XP: it resets each season, and your unlocks stay.'
export const SEASON_END = '2026-11-30T23:59:59Z'

/** Prototype numbers for ?mock=1 (dev only). */
const MOCK: SeasonData = {
  season: { id: 1, name: 'Season 1', endsAt: SEASON_END },
  code: 'KICK-7Q2M',
  milestones: [{ key: 'first_stake', unlocked_at: '' }, { key: 'first_kickback', unlocked_at: '' }, { key: 'first_share', unlocked_at: '' }],
  unlocked: ['spark', 'kick', 'bounce', 'rally'],
  xp: 2340,
  tier: { i: 1, name: 'Kick', skin: 'kick', sub: 2, roman: 'III', next: 'Bounce', toNext: 660, floor: 1000 },
  tiers: [{ name: 'Spark', at: 0, skin: 'spark' }, { name: 'Kick', at: 1000, skin: 'kick' }, { name: 'Bounce', at: 3000, skin: 'bounce' }, { name: 'Rally', at: 8000, skin: 'rally' }, { name: 'Surge', at: 20000, skin: 'surge' }, { name: 'Legend', at: 50000, skin: 'legend' }],
  quests: [{ key: 'run3', p: 1, n: 3, done: false }, { key: 'add', p: 0, n: 1, done: false }, { key: 'keep', p: 4, n: 7, done: false }],
  skin: 'spark',
  streak: { current: 12, best: 18, savers: 1, pending: 0, hist: ['ok', 'missed', 'ok', 'ok', 'saved', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'] },
  facts: { runs: 7, sharedLuna: 4_210_000, kickbacks: 14 },
  invites: { claimed: 2, staked: 1 },
  chainOk: true,
}

const key = (addr: string, what: string) => `season-${what}:${addr.replace(/\s+/g, '').toUpperCase()}`
let wired = false
/** Bumped on every wallet change: a load for an older wallet is dropped when it returns. */
let generation = 0

export function setSkinAttr(skin: Skin) {
  if (typeof document !== 'undefined') {
    if (skin === 'spark') document.documentElement.removeAttribute('data-kb-skin')
    else document.documentElement.setAttribute('data-kb-skin', skin)
  }
}

export const useSeason = defineStore('season', {
  state: () => ({
    address: '',
    data: null as SeasonData | null,
    loading: false,
    error: '',
    /** The skin on screen (applied at once, synced to the server). */
    skin: 'spark' as Skin,
    /** A skin unlocked since the last visit: shows the "New skin unlocked" moment. */
    celebrate: null as Skin | null,
    /** Set with celebrate when it came from reaching a new tier: "You reached Kick". */
    celebrateTier: null as string | null,
    /** Bumped when a run completes: the Home streak pill ticks. */
    tick: 0,
    lastLoadAt: 0,
  }),
  getters: {
    /** Preview, dry run and mock never read or earn. */
    paused(): boolean {
      const w = useWallet()
      return w.isPreview || (w.env !== 'mock' && useDry().on)
    },
    live(): boolean { return !useWallet().isMock },
    signedIn(): boolean { return useSession().signedIn },
    streakN(s): number { return s.data?.streak.current ?? 0 },
    unlocked(s): Skin[] { return s.data?.unlocked ?? ['spark'] },
    has(s) { return (k: MilestoneKey) => !!s.data?.milestones.some(m => m.key === k) },
    inviteLink(s): string { return s.data?.code ? `https://kickback-ecru.vercel.app/?ref=${s.data.code}` : 'https://kickback-ecru.vercel.app' },
  },
  actions: {
    /** Paint from cache for this wallet, then refresh from the server. */
    start(address: string) {
      generation++
      this.address = address
      this.loading = false
      this.celebrate = null
      if (useWallet().isMock) { this.data = structuredClone(MOCK); this.useSkin(MOCK.skin); return }
      const cached = prefGet(key(address, 'data'))
      try { this.data = cached ? JSON.parse(cached) : null }
      catch { this.data = null }
      this.useSkin((prefGet(key(address, 'skin')) as Skin | null) ?? this.data?.skin ?? 'spark')
      void this.load()
    },
    async load() {
      const session = useSession()
      if (this.paused || !session.signedIn || !backendEnabled || this.loading) return
      const gen = generation, address = this.address, token = session.token
      this.loading = true
      try {
        // A skin picked on this phone that the server hasn't got yet goes first.
        const pending = prefGet(key(address, 'skin-pending')) ? (prefGet(key(address, 'skin')) as Skin | null) : null
        if (pending) {
          try { await callFn('season', { method: 'POST', token, body: { skin: pending } }); prefSet(key(address, 'skin-pending'), null) }
          catch (e) { if (e instanceof BackendError && e.status === 400) prefSet(key(address, 'skin-pending'), null) }
        }
        const d = await callFn<SeasonData>('season', { method: 'GET', token, timeoutMs: 30_000 })
        if (gen !== generation) return
        this.data = d
        this.error = ''
        // The server's verified kickbacks keep Ready to share complete on any phone.
        const plan = usePlan()
        if (d.kickbacks?.length && plan.owner.replace(/\s/g, '') === address.replace(/\s/g, '')) plan.rememberKickbacks(d.kickbacks)
        this.lastLoadAt = Date.now()
        prefSet(key(this.address, 'data'), JSON.stringify(d))
        // The server's skin wins unless this phone picked one it hasn't sent yet.
        if (!prefGet(key(this.address, 'skin-pending'))) this.useSkin(d.unlocked.includes(d.skin) ? d.skin : 'spark')
        this.noticeUnlocks(d)
      }
      catch (e) {
        if (gen !== generation) return
        // 404 = the season function isn't deployed yet: no Season data, the app works as before.
        this.error = e instanceof BackendError ? (e.status === 404 ? 'Season is not live yet.' : e.message) : String(e)
      }
      finally { if (gen === generation) this.loading = false }
    },
    /** A skin unlocked that this phone hasn't celebrated yet. The first load only records. */
    noticeUnlocks(d: SeasonData) {
      const seenRaw = prefGet(key(this.address, 'seen'))
      const seen = new Set<string>(seenRaw ? JSON.parse(seenRaw) : d.unlocked)
      const fresh = d.unlocked.filter(k => k !== 'spark' && !seen.has(k))
      prefSet(key(this.address, 'seen'), JSON.stringify(d.unlocked))
      // Tier-up: the tier index rose since this phone last saw it (the first load only records).
      const lastTier = prefGet(key(this.address, 'tier'))
      const ti = d.tier?.i ?? 0
      prefSet(key(this.address, 'tier'), String(ti))
      const tierUp = lastTier != null && ti > Number(lastTier) ? d.tier!.name : null
      if (tierUp) { this.celebrateTier = tierUp; this.celebrate = d.tier!.skin }
      else if (fresh.length) { this.celebrateTier = null; this.celebrate = fresh[fresh.length - 1] }
    },
    useSkin(k: Skin) {
      this.skin = k
      setSkinAttr(k)
    },
    /** Apply an unlocked skin: on screen at once, then saved on the server. */
    async applySkin(k: Skin) {
      if (!this.unlocked.includes(k)) return
      this.useSkin(k)
      prefSet(key(this.address, 'skin'), k)
      if (this.data) this.data.skin = k
      const session = useSession()
      if (!this.live || this.paused || !session.signedIn) return
      prefSet(key(this.address, 'skin-pending'), '1')
      try {
        await callFn('season', { method: 'POST', token: session.token, body: { skin: k } })
        prefSet(key(this.address, 'skin-pending'), null)
      }
      catch { /* kept on this phone; sent with the next load */ }
    },
    /** Invite code from ?ref= on first open: sent once after sign-in. */
    async claimRef() {
      const ref = prefGet('ref')
      const session = useSession()
      if (!ref || prefGet(key(this.address, 'ref-done')) || !session.signedIn) return
      const address = this.address
      try {
        await callFn('season', { method: 'POST', token: session.token, body: { ref } })
        prefSet(key(address, 'ref-done'), 'ok')
      }
      catch (e) {
        // Rejected for good (own code, already invited, unknown code: 400 / 409): don't ask again.
        // 404 means the season function isn't live yet, 5xx/network: try again next time.
        if (e instanceof BackendError && (e.status === 400 || e.status === 409)) prefSet(key(address, 'ref-done'), String(e.status))
      }
    },
  },
})

/** Load after sign-in and after each finished run; tick the streak pill when a run completes. */
export function wireSeason() {
  if (wired) return
  wired = true
  const season = useSeason(), session = useSession(), flow = useFlow(), wallet = useWallet()
  watch(() => [wallet.connected, wallet.effectiveAddress] as const, ([on, a]) => { if (on && a) season.start(a) }, { immediate: true })
  // After sign-in: claim the invite at once (before any stake), then read the season.
  watch(() => session.signedIn, (s) => { if (s) void season.claimRef().finally(() => season.load()) }, { immediate: true })
  watch(() => flow.doneKey, () => {
    if (flow.runPhase !== 'done') return
    season.tick++
    // Verification needs the txs in a block: read the season again shortly after.
    setTimeout(() => void season.load(), 8000)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - season.lastLoadAt > 5 * 60e3) void season.load()
  })
}
