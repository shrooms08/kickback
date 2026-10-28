/**
 * Server-side checks for everything the app writes (pure, no Deno APIs, so vitest covers it).
 * Each validator returns a cleaned value or throws a ValidationError with a short reason.
 */
import { isValidAddress, normalizeAddress } from './nimiqSignature.ts'

export class ValidationError extends Error {}
const fail = (msg: string): never => { throw new ValidationError(msg) }

export const SLICE_TYPES = ['send', 'restake', 'keep'] as const
export type SliceType = typeof SLICE_TYPES[number]
export interface Slice { type: SliceType, percent: number, contact_id: string | null }
export interface ContactIn { id: string, name: string, contact_address: string }

export const EVENT_KINDS = ['connect', 'sign_in', 'stake', 'add_stake', 'plan_saved', 'run_done', 'stop', 'withdraw', 'switch'] as const
export type EventKind = typeof EVENT_KINDS[number]

/** Luna amounts: positive safe integers (bigint in the database). */
export function positiveLuna(v: unknown, what = 'amount'): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) fail(`${what} must be a positive whole number of Luna`)
  return v as number
}

/**
 * A plan: exactly one slice per type, whole percents 0..100 that total 100. A send slice above
 * 0% must name one of the owner's contacts; a contact link (at any percent) must point at one
 * of them. Stored exactly as sent: nothing is moved between slices or dropped.
 */
export function validateSlices(v: unknown, contactIds: ReadonlySet<string>): Slice[] {
  if (!Array.isArray(v) || v.length !== 3) fail('slices must list send, restake and keep')
  const out: Slice[] = []
  for (const type of SLICE_TYPES) {
    const s = (v as any[]).find(x => x && x.type === type)
    if (!s) fail(`missing ${type} slice`)
    if (!Number.isInteger(s.percent) || s.percent < 0 || s.percent > 100) fail(`${type} percent must be a whole number 0..100`)
    let contact: string | null = null
    if (type === 'send') {
      if (s.contact_id != null && (typeof s.contact_id !== 'string' || !contactIds.has(s.contact_id))) fail('send slice points at a contact you have not saved')
      if (s.percent > 0 && s.contact_id == null) fail('send slice needs one of your contacts')
      contact = s.contact_id ?? null
    }
    else if (s.contact_id != null) fail(`${type} slice cannot have a contact`)
    out.push({ type, percent: s.percent, contact_id: contact })
  }
  if (out.reduce((a, s) => a + s.percent, 0) !== 100) fail('slices must total 100')
  return out
}

/** A contact: short id, 1..40 character name, a checksummed Nimiq address that isn't the owner's. */
export function validateContact(v: unknown, owner: string): ContactIn {
  const c = v as Record<string, unknown> | null
  if (!c || typeof c !== 'object') fail('contact must be an object')
  const id = c!.id, name = typeof c!.name === 'string' ? c!.name.trim() : ''
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) fail('contact id is invalid')
  if (!name || name.length > 40) fail('contact name must be 1 to 40 characters')
  if (typeof c!.contact_address !== 'string' || !isValidAddress(c!.contact_address)) fail('contact address is not a valid Nimiq address')
  if (normalizeAddress(c!.contact_address as string) === normalizeAddress(owner)) fail('a contact cannot be your own address')
  if (normalizeAddress(c!.contact_address as string) === 'NQ7700000000000000000000000000000001') fail('a contact cannot be the staking contract')
  const a = normalizeAddress(c!.contact_address as string)
  return { id: id as string, name, contact_address: a.replace(/(.{4})/g, '$1 ').trim() }
}

export interface ShareIn { id: string, amount_luna: number, slice_type: SliceType, tx_hash: string | null, status: 'confirmed' | 'undone', run_id: string | null }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A processed share: uuid id (idempotent upsert), positive Luna, slice type, hash for send/restake. */
export function validateShare(v: unknown): ShareIn {
  const s = v as Record<string, unknown> | null
  if (!s || typeof s !== 'object') fail('share must be an object')
  if (typeof s!.id !== 'string' || !UUID.test(s!.id)) fail('share id must be a uuid')
  if (s!.run_id != null && (typeof s!.run_id !== 'string' || !UUID.test(s!.run_id))) fail('run_id must be a uuid')
  const amount = positiveLuna(s!.amount_luna)
  if (!SLICE_TYPES.includes(s!.slice_type as SliceType)) fail('slice_type must be send, restake or keep')
  const hash = s!.tx_hash == null ? null : s!.tx_hash
  if (hash !== null && (typeof hash !== 'string' || !/^[0-9a-f]{64}$/i.test(hash))) fail('tx_hash must be 64 hex characters')
  if (s!.slice_type !== 'keep' && !hash) fail('send and restake shares need a tx_hash')
  const status = s!.status ?? 'confirmed'
  if (status !== 'confirmed' && status !== 'undone') fail('status must be confirmed or undone')
  return { id: (s!.id as string).toLowerCase(), amount_luna: amount, slice_type: s!.slice_type as SliceType, tx_hash: hash ? (hash as string).toLowerCase() : null, status: status as 'confirmed' | 'undone', run_id: s!.run_id ? (s!.run_id as string).toLowerCase() : null }
}

/** Stake events may carry the stake's tx hash (verified on chain before it counts). */
export function validateEvent(v: unknown): { kind: EventKind, amount_luna: number | null, tx_hash: string | null } {
  const e = v as Record<string, unknown> | null
  if (!e || typeof e !== 'object') fail('event must be an object')
  if (!EVENT_KINDS.includes(e!.kind as EventKind)) fail('unknown event kind')
  const amount = e!.amount_luna == null ? null : positiveLuna(e!.amount_luna)
  let hash: string | null = null
  if (e!.tx_hash != null) {
    if (e!.kind !== 'stake' && e!.kind !== 'add_stake') fail('only stake events carry a tx_hash')
    if (typeof e!.tx_hash !== 'string' || !/^[0-9a-f]{64}$/i.test(e!.tx_hash)) fail('tx_hash must be 64 hex characters')
    hash = (e!.tx_hash as string).toLowerCase()
  }
  return { kind: e!.kind as EventKind, amount_luna: amount, tx_hash: hash }
}

export function validateNetwork(v: unknown): 'mainnet' | 'testnet' {
  if (v !== 'mainnet' && v !== 'testnet') fail('network must be mainnet or testnet')
  return v as 'mainnet' | 'testnet'
}
