// Server-side Nimiq RPC endpoints per network, in failover order. RPC_MAINNET_URLS /
// RPC_TESTNET_URLS (comma-separated function secrets) add server-only endpoints in front, e.g. a
// node without CORS or a private one. The app's own list is in src/lib/net.ts.
export type Net = 'mainnet' | 'testnet'

export const PUBLIC_RPC: Record<Net, string[]> = {
  mainnet: ['https://rpc.nimiqwatch.com'],
  testnet: ['https://rpc.testnet.nimiqwatch.com'],
}

export function serverRpcUrls(net: Net): string[] {
  const extra = (Deno.env.get(net === 'mainnet' ? 'RPC_MAINNET_URLS' : 'RPC_TESTNET_URLS') ?? '').split(',').map(s => s.trim()).filter(s => /^https:\/\//.test(s))
  return [...new Set([...extra, ...PUBLIC_RPC[net]])]
}
