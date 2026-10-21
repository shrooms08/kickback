// Fake data for phase 1. Every number here matches the prototype
// (design/Kickback Prototype.html) so screens can be compared side by side.

export type PoolId = 'fun' | 'obs'

export interface Pool {
  id: PoolId
  name: string
  /** Validator address from the research spike (SPIKE_REPORT.md). */
  validator: string
  fee: string
  pays: string
  trust: number
  badge?: string
  lastPaid: string
}

export const POOLS: Record<PoolId, Pool> = {
  fun: {
    id: 'fun',
    name: 'Nimiq.Fun',
    validator: 'NQ32 1U9X 7P3X B2H5 XA00 5LC2 5KFE VBQE X3BU',
    fee: '2.5%',
    pays: 'About every 12h',
    trust: 9,
    badge: 'Lowest fee',
    lastPaid: 'Last paid 4h ago',
  },
  obs: {
    id: 'obs',
    name: 'ObsidianStake',
    validator: 'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV',
    fee: '5%',
    pays: '00:00 and 12:00 UTC',
    trust: 8,
    lastPaid: 'Last paid 4h ago',
  },
}

/** Fake wallet used with ?mock=1 in dev. Chip shows "NQ52 · 8F3A". */
export const MOCK_ADDRESS = 'NQ52 7HXK 3C1R 5U9S 2B4M 0Y6P TF8Q 8F3A'
export const MOCK_BALANCE_NIM = 31480.55
export const MOCK_LOW_BALANCE_NIM = 82
export const MOCK_CONNECT_MS = 1600

/** Mock NIM price in USD for "about $" lines. No price feed until a later phase. */
export const NIM_USD = 0.0013
/** Estimated yearly reward rate used for "about" projections. Estimate, not a promise. */
export const EST_APY = 0.09
/** Two kickbacks a day. */
export const KICKBACKS_PER_YEAR = 730

export const MIN_STAKE_NIM = 100
export const STAKED_NIM = 25000

export interface Contact { id: string, name: string, ini: string }

export const DEFAULT_CONTACTS: Contact[] = [
  { id: 'mom', name: 'Mom', ini: 'M' },
  { id: 'dad', name: 'Dad', ini: 'D' },
  { id: 'lea', name: 'Lea', ini: 'L' },
]

export const DEFAULT_PLAN: [number, number, number] = [50, 30, 20]
export const NO_CONTACT_PLAN: [number, number, number] = [0, 50, 50]

/** Staked account with history (cents of NIM, as the prototype keeps them). */
export const ACCOUNT_FULL = {
  readyCents: 1240,
  earnedCents: 18420,
  kbCount: 59,
  waiting: 4,
  hours: 9,
  nextIn: '3h 12m',
  lastPaid: 'Last paid 09:04',
  dueAt: 'Due about 21:04',
}

/** Just staked, no kickbacks yet. */
export const ACCOUNT_EMPTY = {
  readyCents: 0,
  earnedCents: 0,
  kbCount: 0,
  waiting: 0,
  hours: 4,
  nextIn: '8h 52m',
  lastPaid: 'Staked 3h ago',
  dueAt: 'Due about 21:04',
}

/** Last 14 kickbacks for the chart, oldest first (NIM). */
export const CHART = [6.04, 6.06, 6.05, 6.08, 6.07, 6.10, 6.09, 6.12, 6.11, 6.14, 6.15, 6.17, 6.19, 6.21]
/** Placeholder bar heights (px) for the empty chart. */
export const CHART_GHOST = [44, 58, 50, 66, 54, 70, 60, 76, 64, 80, 68, 84, 72, 88]
export const CHART_LABELS = ['Oct 8', 'Oct 14', 'Today']

export interface FeedRow { time: string, amt: number, waiting: boolean }
export interface FeedGroup { day: string, rows: FeedRow[] }

export const FEED: FeedGroup[] = [
  { day: 'Today', rows: [{ time: '12:04', amt: 3.12, waiting: true }, { time: '00:04', amt: 3.09, waiting: true }] },
  { day: 'Yesterday', rows: [{ time: '12:03', amt: 3.10, waiting: true }, { time: '00:05', amt: 3.09, waiting: true }] },
  { day: 'Mon, Oct 19', rows: [{ time: '12:04', amt: 3.08, waiting: false }, { time: '00:04', amt: 3.09, waiting: false }] },
  { day: 'Sun, Oct 18', rows: [{ time: '12:04', amt: 3.07, waiting: false }, { time: '00:03', amt: 3.08, waiting: false }] },
]

/** Home "Recent kickbacks". */
export const RECENT = [
  { amt: 3.12, when: 'Today 12:04' },
  { amt: 3.09, when: 'Today 00:04' },
  { amt: 3.10, when: 'Yesterday 12:03' },
]

/** Pool tab "Last 10 kickbacks". */
export const PAYOUTS: Array<{ when: string, amt: number }> = [
  { when: 'Today 12:04', amt: 3.12 },
  { when: 'Today 00:04', amt: 3.09 },
  { when: 'Oct 20 · 12:03', amt: 3.10 },
  { when: 'Oct 20 · 00:05', amt: 3.09 },
  { when: 'Oct 19 · 12:04', amt: 3.08 },
  { when: 'Oct 19 · 00:04', amt: 3.09 },
  { when: 'Oct 18 · 12:04', amt: 3.07 },
  { when: 'Oct 18 · 00:03', amt: 3.08 },
  { when: 'Oct 17 · 12:05', amt: 3.07 },
  { when: 'Oct 17 · 00:04', amt: 3.06 },
]

/** A new kickback for "Simulate kickback arrives" (dev). */
export const ARRIVAL_CENTS = 312

/** Mock Nimiq Pay approval answer, used by dev-only simulated flows. */
export type WalletResponse = 'approve' | 'reject' | 'fail'
export const APPROVE_DELAY_MS = 2200
