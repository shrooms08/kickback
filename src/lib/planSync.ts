// Plan <-> server slices, and the server's validity rules, checked before sending.
// Pure functions (no stores), shared by the session store and the unit tests.
import type { Split } from './plan'

export interface ServerSlice { type: 'send' | 'restake' | 'keep', percent: number, contact_id: string | null }
export type PlanBody = { slices: ServerSlice[], plan_started_at: string | null, min_ready_luna?: number }

/**
 * Why a plan can't be stored (the server's rules, checked before sending): one slice per type,
 * whole percents 0..100 totalling 100, a send share needs one of your contacts, and a contact
 * link must point at an existing contact. '' when it is fine. Nothing is ever repaired.
 */
export function planProblem(body: PlanBody, contactIds: ReadonlySet<string>): string {
  const by = (t: ServerSlice['type']) => body.slices.filter(s => s.type === t)
  if (body.slices.length !== 3 || (['send', 'restake', 'keep'] as const).some(t => by(t).length !== 1)) return 'the plan needs one send, restake and keep slice'
  if (body.slices.some(s => !Number.isInteger(s.percent) || s.percent < 0 || s.percent > 100)) return 'percentages must be whole numbers from 0 to 100'
  if (body.slices.reduce((a, s) => a + s.percent, 0) !== 100) return 'the slices must add up to 100%'
  const send = by('send')[0]
  if (send.percent > 0 && !send.contact_id) return 'the send slice has no contact'
  if (send.contact_id && !contactIds.has(send.contact_id)) return 'the send slice points at a contact that is not saved'
  return ''
}

/** Server plan slices -> the app's [send, restake, keep] and recipient. */
export function planFromSlices(slices: ServerSlice[]): { saved: Split, recipient: string | null } {
  const by = (t: ServerSlice['type']) => slices.find(s => s.type === t)
  return { saved: [by('send')?.percent ?? 0, by('restake')?.percent ?? 0, by('keep')?.percent ?? 0] as Split, recipient: by('send')?.contact_id ?? null }
}

/** The app's plan -> server slices, exactly (no moving of shares, no dropping of links). */
export function slicesFromPlan(saved: Split, recipient: string | null): ServerSlice[] {
  return [
    { type: 'send', percent: saved[0], contact_id: recipient },
    { type: 'restake', percent: saved[1], contact_id: null },
    { type: 'keep', percent: saved[2], contact_id: null },
  ]
}
