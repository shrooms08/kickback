// Server-side Nimiq RPC endpoints per network, in failover order. RPC_MAINNET_URLS /
// RPC_TESTNET_URLS (comma-separated function secrets) add server-only endpoints in front, e.g. a
// node without CORS or a private one. The app's own list is in src/lib/net.ts.
import { REST_FALLBACK } from './restAdapter.ts'

export type Net = 'mainnet' | 'testnet'

/** The REST fallback for the methods it can answer (Nimiq.Watch, mainnet). */
export const serverRest = (net: Net) => REST_FALLBACK[net]

export const PUBLIC_RPC: Record<Net, string[]> = {
  mainnet: ['https://rpc.nimiqwatch.com'],
  testnet: ['https://rpc.testnet.nimiqwatch.com'],
}

export function serverRpcUrls(net: Net): string[] {
  // RPC_MAINNET / RPC_TESTNET (the older single-URL secret names) are read too.
  const raw = [Deno.env.get(net === 'mainnet' ? 'RPC_MAINNET_URLS' : 'RPC_TESTNET_URLS'), Deno.env.get(net === 'mainnet' ? 'RPC_MAINNET' : 'RPC_TESTNET')].filter(Boolean).join(',')
  const extra = raw.split(',').map(s => s.trim()).filter(s => /^https:\/\//.test(s))
  return [...new Set([...extra, ...PUBLIC_RPC[net]])]
}
