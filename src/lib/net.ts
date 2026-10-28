import { getHostNetwork } from '@nimiq/mini-app-sdk'

// Which Nimiq network Kickback talks to, decided once at startup. Nimiq Pay
// seeds its network into the page before any script runs and it never changes
// during a session (switching in Nimiq Pay reloads the app), so module-time
// constants are safe. See docs/testnet.md.

export type Network = 'mainnet' | 'testnet'

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

/**
 * Dev builds: ?net=test wins (also over a faked host, for Playwright).
 * Then the network Nimiq Pay reports. Otherwise (browser, preview, older
 * hosts without the field): mainnet. Production never reads the URL.
 */
function pick(): { network: Network, source: string } {
  if (import.meta.env.DEV && typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search).get('net')
    if (q === 'test' || q === 'testnet') return { network: 'testnet', source: '?net=test (dev only)' }
  }
  let host: string | undefined
  try { host = typeof window !== 'undefined' ? getHostNetwork() : undefined }
  catch { host = undefined }
  if (host === 'testnet' || host === 'mainnet') return { network: host, source: 'Nimiq Pay host' }
  return { network: 'mainnet', source: host ? `unknown host value "${host}", mainnet` : 'default (not in Nimiq Pay)' }
}

const picked = pick()

export const net: NetConfig & { source: string } = { network: picked.network, ...CONFIGS[picked.network], source: picked.source }
export const isTestnet = net.network === 'testnet'

/** Storage namespace: '' on mainnet (keys unchanged), 't:' on testnet, so the two never mix. */
export const NS = isTestnet ? 't:' : ''
