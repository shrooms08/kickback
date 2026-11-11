import { reactive } from 'vue'
import { getHostNetwork } from '@nimiq/mini-app-sdk'

// Which Nimiq network Kickback talks to. Nimiq Pay seeds `window.nimiqPay.network`, but it can
// be missing (older hosts) or arrive after our script starts. So src/main.ts waits for it
// (resolveNetwork, up to HOST_WAIT_MS) and calls applyNetwork BEFORE the rest of the app is
// imported: every module that reads `net`, `isTestnet` or `NS` at import time (RPC pool, storage
// prefix, genesis block) gets the resolved network. If the field shows up later with another
// network, main.ts reloads once (watchLateHost). See docs/testnet.md.
//
// A host that reports no network (or one we don't recognise) gets mainnet, but never silently:
// `net.reported` is false and Home and Diagnostics show "Network not reported by Nimiq Pay".

export type Network = 'mainnet' | 'testnet'

export const DEFAULT_NETWORK: Network = 'mainnet'
/** How long to wait for Nimiq Pay to seed its network before using the default. */
export const HOST_WAIT_MS = 2000
export const HOST_POLL_MS = 50

export interface NetConfig {
  network: Network
  rpcUrl: string
  /** Ordered RPC endpoints (failover in this order; the first is rpcUrl). */
  rpcUrls: string[]
  validatorsApiUrl: string
  /** Explorer page for a transaction hash. */
  explorerTxUrl: (hash: string) => string
  /** First block of the Albatross chain: election blocks are counted from it. */
  genesisBlock: number
  /** Albatross network id as it appears in transactions. */
  networkId: number
}

const CONFIGS: Record<Network, Omit<NetConfig, 'network'>> = {
  mainnet: {
    rpcUrl: 'https://rpc.nimiqwatch.com',
    rpcUrls: ['https://rpc.nimiqwatch.com'],
    validatorsApiUrl: 'https://validators-api-main.je-cf9.workers.dev',
    explorerTxUrl: hash => `https://nimiq.watch/#${hash}`,
    genesisBlock: 3_456_000,
    networkId: 24,
  },
  testnet: {
    rpcUrl: 'https://rpc.testnet.nimiqwatch.com',
    rpcUrls: ['https://rpc.testnet.nimiqwatch.com'],
    validatorsApiUrl: 'https://validators-api-test.je-cf9.workers.dev',
    explorerTxUrl: hash => `https://test.nimiq.watch/#${hash}`,
    genesisBlock: 3_032_010,
    networkId: 5,
  },
}

/** 'testnet' / 'mainnet' (any case, also 'test' / 'main'), else null. */
export function parseNetwork(v: unknown): Network | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  if (s === 'testnet' || s === 'test') return 'testnet'
  if (s === 'mainnet' || s === 'main') return 'mainnet'
  return null
}

export interface HostRead { value: unknown, error?: string }

/** The raw host value (never throws; an exception is returned as `error`). */
export function readHost(): HostRead {
  try { return { value: typeof window !== 'undefined' ? getHostNetwork() : undefined } }
  catch (error) { return { value: undefined, error: `getHostNetwork() threw: ${(error as Error)?.message ?? String(error)}` } }
}

/** Dev builds only: ?net=test|testnet|main|mainnet wins (Playwright, desktop preview). */
function devOverride(): Network | null {
  if (!import.meta.env.DEV || typeof location === 'undefined') return null
  return parseNetwork(new URLSearchParams(location.search).get('net'))
}

export interface Picked {
  network: Network
  source: string
  /** False when the network is the default because Nimiq Pay didn't report one (show a warning). */
  reported: boolean
  error?: string
}

/** Decide from one host read: dev override, then a recognised host value, else `fallback`. */
export function pickFrom(read: HostRead, fallback: Network = DEFAULT_NETWORK, waitedMs = 0): Picked {
  const dev = devOverride()
  if (dev) return { network: dev, source: `?net=${dev} (dev only)`, reported: true }
  const host = parseNetwork(read.value)
  if (host) return { network: host, source: waitedMs > 0 ? `Nimiq Pay host (after ${waitedMs} ms)` : 'Nimiq Pay host', reported: true }
  const why = read.value === undefined ? 'host gave no network' : `unknown host value ${JSON.stringify(read.value)}`
  return { network: fallback, source: `default ${fallback} (${why}${waitedMs > 0 ? ` after ${waitedMs} ms` : ''})`, reported: false, error: read.error }
}

const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * Wait up to `waitMs` for the host to report a recognised network (polling every `intervalMs`),
 * then pick. Resolves at once when the value is already there or a dev override is set.
 */
export async function resolveNetwork(opts: { read?: () => HostRead, waitMs?: number, intervalMs?: number, fallback?: Network, sleep?: (ms: number) => Promise<void>, now?: () => number } = {}): Promise<Picked> {
  const read = opts.read ?? readHost, sleep = opts.sleep ?? realSleep, now = opts.now ?? (() => Date.now())
  const waitMs = opts.waitMs ?? HOST_WAIT_MS, intervalMs = opts.intervalMs ?? HOST_POLL_MS
  const t0 = now()
  let r = read()
  while (!devOverride() && !parseNetwork(r.value) && now() - t0 < waitMs) {
    await sleep(intervalMs)
    r = read()
  }
  return pickFrom(r, opts.fallback ?? DEFAULT_NETWORK, Math.round(now() - t0))
}

/**
 * After the app started on a default, keep looking for the host value for `forMs`. Calls
 * `onArrive(network)` once if it shows up (main.ts reloads when it differs). Returns a stop function.
 */
export function watchLateHost(onArrive: (n: Network) => void, opts: { read?: () => HostRead, forMs?: number, everyMs?: number } = {}): () => void {
  const read = opts.read ?? readHost
  const t0 = Date.now(), forMs = opts.forMs ?? 20_000
  const timer = setInterval(() => {
    const n = parseNetwork(read().value)
    if (n) { clearInterval(timer); onArrive(n) }
    else if (Date.now() - t0 >= forMs) clearInterval(timer)
  }, opts.everyMs ?? 250)
  return () => clearInterval(timer)
}

/** The current network config. One reactive object, updated in place by applyNetwork (and by main.ts when a late host value confirms it). */
export const net: NetConfig & { source: string, reported: boolean, error?: string } = reactive({ network: DEFAULT_NETWORK, ...CONFIGS[DEFAULT_NETWORK], source: '', reported: false })
export let isTestnet = false
/** Storage namespace: '' on mainnet (keys unchanged), 't:' on testnet, so the two never mix. */
export let NS = ''

export function applyNetwork(p: Picked, opts: { quiet?: boolean } = {}) {
  Object.assign(net, { network: p.network, ...CONFIGS[p.network], source: p.source, reported: p.reported, error: p.error })
  isTestnet = p.network === 'testnet'
  NS = isTestnet ? 't:' : ''
  if (opts.quiet) return
  if (p.error) console.warn('[kickback] network:', p.error)
  if (!p.reported) console.warn(`[kickback] network: not reported by Nimiq Pay, using ${p.network} (${p.source})`)
}

// Provisional value from a synchronous read (unit tests, and anything imported before main.ts
// resolves). main.ts replaces it with the awaited result before the app modules load.
applyNetwork(pickFrom(readHost()), { quiet: true })
