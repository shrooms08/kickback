// Server-side Nimiq reads for verification (public RPC, rate limited by createRpc).
// Every read returns null on "not found" and throws on network trouble, so callers can tell
// "not on chain (yet)" from "couldn't check".
import { createRpc } from './payouts.ts'
import type { Rpc } from './payouts.ts'
import type { ChainTx } from './verify.ts'

export type Net = 'mainnet' | 'testnet'
const RPC_URL: Record<Net, string> = { mainnet: 'https://rpc.nimiqwatch.com', testnet: 'https://rpc.testnet.nimiqwatch.com' }

/** One client per network per isolate: they share the per-IP budget. */
const clients: Partial<Record<Net, Rpc>> = {}
export function rpcFor(net: Net): Rpc {
  return clients[net] ??= createRpc(Deno.env.get(net === 'mainnet' ? 'RPC_MAINNET' : 'RPC_TESTNET') || RPC_URL[net], 12, { retry429: false })
}

/** The node answered "there is no such thing" (as opposed to HTTP trouble or a timeout). */
export const isNotFound = (e: unknown) => { const m = String((e as Error)?.message ?? e); return !/method not found/i.test(m) && /not\s*found|no\s+such|no staker with|no validator with|no account with|does not exist/i.test(m) }
const notFound = isNotFound

export async function getTx(rpc: Rpc, hash: string): Promise<ChainTx | null> {
  try { return await rpc.call<ChainTx>('getTransactionByHash', [hash]) ?? null }
  catch (e) { if (notFound(e)) return null; throw e }
}

export interface ServerStaker { balance: number, inactiveBalance: number, retiredBalance: number, delegation: string }
export async function getStaker(rpc: Rpc, address: string): Promise<ServerStaker | null> {
  try { return await rpc.call<ServerStaker>('getStakerByAddress', [address]) ?? null }
  catch (e) { if (notFound(e)) return null; throw e }
}

export const hasStake = (s: ServerStaker | null) => !!s && (s.balance + (s.inactiveBalance ?? 0) + (s.retiredBalance ?? 0)) > 0

export async function rewardAddressOf(rpc: Rpc, validator: string): Promise<string | null> {
  try { return (await rpc.call<{ rewardAddress: string }>('getValidatorByAddress', [validator]))?.rewardAddress ?? null }
  catch (e) { if (notFound(e)) return null; throw e }
}

export interface PageTx extends ChainTx { relatedAddresses?: string[] }
/** Newest first, 100 at a time (1 RPC unit a page). */
export async function txPage(rpc: Rpc, address: string, startAt: string | null): Promise<PageTx[]> {
  return (await rpc.call<PageTx[]>('getTransactionsByAddress', [address, 100, startAt])) ?? []
}
