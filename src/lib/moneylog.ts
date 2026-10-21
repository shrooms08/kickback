import { reactive } from 'vue'
import { prefGet, prefSet } from './cache'
import { net } from './net'
import { rpc } from '../services/rpc'
import type { Tx } from '../services/chain'
import type { SendKind, SendRequest } from '../services/sendTypes'

// Every real (not dry-run) money action: what was asked, the hash Nimiq Pay
// returned, when it confirmed, and the transaction as the RPC reads it back
// (account types and the first data byte). This is how the staking
// transaction types are confirmed on chain. Shown in Diagnostics, persisted
// per network, newest 30 kept.

export interface MoneyLogEntry {
  id: string
  network: string
  flow: string
  kind: SendKind
  valueLuna: number
  /** Recipient (payment) or delegation (new staker, switch). */
  to: string
  phase: string
  startedAt: number
  hash?: string
  sentAt?: number
  confirmedAt?: number
  error?: string
  /** Read back from getTransactionByHash after confirmation. */
  chain?: string
}

const CONFIG_EXPLORER = { mainnet: (h: string) => `https://nimiq.watch/#${h}`, testnet: (h: string) => `https://test.nimiq.watch/#${h}` }
const KEY = 'moneylog'
const MAX = 30

function load(): MoneyLogEntry[] {
  try { return JSON.parse(prefGet(KEY) || '[]') }
  catch { return [] }
}

export const moneylog = reactive({ entries: load() })

function save() {
  if (moneylog.entries.length > MAX) moneylog.entries.splice(0, moneylog.entries.length - MAX)
  prefSet(KEY, JSON.stringify(moneylog.entries))
}

const ACCOUNT_TYPE: Record<number, string> = { 0: 'basic', 1: 'vesting', 2: 'HTLC', 3: 'staking' }
/** Incoming staking data (recipientData[0]) and outgoing staking data (senderData[0]). */
const INCOMING: Record<string, string> = { '05': 'CreateStaker', '06': 'AddStake', '07': 'UpdateStaker', '08': 'SetActiveStake', '09': 'RetireStake' }
const OUTGOING: Record<string, string> = { '00': 'DeleteValidator', '01': 'RemoveStake' }
/** What each SDK call should produce on chain. */
export const EXPECTED: Record<SendKind, string> = {
  payment: 'basic → basic, data = memo',
  newStaker: 'basic → staking, recipientData 05 CreateStaker',
  addStake: 'basic → staking, recipientData 06 AddStake',
  updateStaker: 'basic → staking, recipientData 07 UpdateStaker',
  setActive: 'basic → staking, recipientData 08 SetActiveStake',
  retire: 'basic → staking, recipientData 09 RetireStake',
  remove: 'staking → basic, senderData 01 RemoveStake',
}

/** One line describing a transaction as the chain stores it. */
export function describeTx(t: Tx & { fromType?: number, toType?: number, senderData?: string, flags?: number }): string {
  const rd = (t.recipientData || '').slice(0, 2), sd = (t.senderData || '').slice(0, 2)
  const parts = [
    `block ${t.blockNumber}`,
    `${ACCOUNT_TYPE[t.fromType ?? -1] ?? t.fromType} → ${ACCOUNT_TYPE[t.toType ?? -1] ?? t.toType}`,
    `recipientData[0] ${rd ? `0x${rd}${t.toType === 3 && INCOMING[rd] ? ` ${INCOMING[rd]}` : ''}` : 'none'}`,
    `senderData[0] ${sd ? `0x${sd}${t.fromType === 3 && OUTGOING[sd] ? ` ${OUTGOING[sd]}` : ''}` : 'none'}`,
    `flags ${t.flags ?? 0}`,
    `value ${t.value} Luna`,
    t.executionResult === false ? 'EXECUTION FAILED' : 'executed',
  ]
  return parts.join(' · ')
}

function target(req: SendRequest): string {
  return req.recipient || req.delegation || req.newDelegation || ''
}

const reading = new Set<string>()

/** Record (or update) a real money action. Called on every phase change of a non-dry op. */
export function logMoney(op: { id: string, flow: string, req: SendRequest, phase: string, startedAt: number, hash?: string, sentAt?: number, error?: string }) {
  let e = moneylog.entries.find(x => x.id === op.id)
  if (!e) {
    e = { id: op.id, network: net.network, flow: op.flow, kind: op.req.kind, valueLuna: op.req.value, to: target(op.req), phase: op.phase, startedAt: op.startedAt }
    moneylog.entries.push(e)
  }
  e.phase = op.phase
  if (op.hash) e.hash = op.hash
  if (op.sentAt) e.sentAt = op.sentAt
  if (op.error) e.error = op.error
  if (op.phase === 'confirmed' && !e.confirmedAt) e.confirmedAt = Date.now()
  save()
  if ((op.phase === 'confirmed' || op.phase === 'failed') && e.hash && !e.chain && !reading.has(e.id)) readBack(e)
}

async function readBack(e: MoneyLogEntry) {
  reading.add(e.id)
  try {
    const r = await rpc<Tx | null>('getTransactionByHash', [e.hash], { noStore: true })
    const entry = moneylog.entries.find(x => x.id === e.id)
    if (entry) { entry.chain = r.value ? describeTx(r.value) : 'not found'; save() }
  }
  catch (error) {
    const entry = moneylog.entries.find(x => x.id === e.id)
    if (entry) { entry.chain = `read back failed: ${(error as Error).message}`; save() }
  }
  finally { reading.delete(e.id) }
}

/** Diagnostics line for one entry. */
export function moneyLine(e: MoneyLogEntry): string {
  const secs = e.confirmedAt && e.sentAt ? `${Math.round((e.confirmedAt - e.sentAt) / 100) / 10}s after send` : ''
  return [
    `${e.network} · ${e.flow}/${e.kind} · ${e.valueLuna / 1e5} NIM${e.to ? ` → ${e.to}` : ''}`,
    `${e.phase}${secs ? ` (${secs})` : ''} · started ${new Date(e.startedAt).toLocaleTimeString('en-GB')}`,
    e.hash ? `hash ${e.hash}\n${e.network === 'testnet' ? CONFIG_EXPLORER.testnet(e.hash) : CONFIG_EXPLORER.mainnet(e.hash)}` : 'no hash',
    e.error ? `error: ${e.error}` : '',
    e.chain ? `on chain: ${e.chain}` : e.hash ? 'on chain: (reading after confirmation)' : '',
    `expected: ${EXPECTED[e.kind]}`,
  ].filter(Boolean).join('\n')
}
