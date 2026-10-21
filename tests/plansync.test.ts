import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { planFromSlices, planProblem, slicesFromPlan } from '../src/lib/planSync'
import { validateSlices } from '../supabase/functions/_shared/validate'
import { usePlan } from '../src/stores/plan'
import type { Split } from '../src/lib/plan'

const CID = 'c1792614452339'

describe('plan sync round trip', () => {
  it('send (contact) 10 / restake 30 / keep 60 serializes and deserializes identically', () => {
    const slices = slicesFromPlan([10, 30, 60], CID)
    expect(slices).toEqual([
      { type: 'send', percent: 10, contact_id: CID },
      { type: 'restake', percent: 30, contact_id: null },
      { type: 'keep', percent: 60, contact_id: null },
    ])
    // Through the server's validation (what gets stored) and back, via JSON like the wire.
    const stored = validateSlices(JSON.parse(JSON.stringify(slices)), new Set([CID]))
    expect(stored).toEqual(slices)
    expect(planFromSlices(JSON.parse(JSON.stringify(stored)))).toEqual({ saved: [10, 30, 60], recipient: CID })
  })
  it('keeps a contact link at 0% too, so nothing changes on the way', () => {
    const slices = slicesFromPlan([0, 50, 50], CID)
    expect(validateSlices(slices, new Set([CID]))[0]).toEqual({ type: 'send', percent: 0, contact_id: CID })
    expect(planFromSlices(slices)).toEqual({ saved: [0, 50, 50], recipient: CID })
  })
})

describe('invalid plans are rejected, never repaired', () => {
  const ids = new Set([CID])
  it('client check', () => {
    expect(planProblem({ slices: slicesFromPlan([10, 30, 60], CID), plan_started_at: null }, ids)).toBe('')
    expect(planProblem({ slices: slicesFromPlan([10, 30, 60], null), plan_started_at: null }, ids)).toBe('the send slice has no contact')
    expect(planProblem({ slices: slicesFromPlan([10, 30, 60], 'c-missing'), plan_started_at: null }, ids)).toMatch('not saved')
    expect(planProblem({ slices: slicesFromPlan([10, 30, 61], CID), plan_started_at: null }, ids)).toMatch('100%')
    expect(planProblem({ slices: slicesFromPlan([0, 50, 50], null), plan_started_at: null }, new Set())).toBe('')
  })
  it('server check: a send slice to a missing contact is an error, not send 0% + keep', () => {
    expect(() => validateSlices(slicesFromPlan([10, 30, 60], 'c-missing'), ids)).toThrow('not saved')
    expect(() => validateSlices(slicesFromPlan([10, 30, 60], null), ids)).toThrow('needs one of your contacts')
    expect(() => validateSlices([{ type: 'send', percent: 0, contact_id: null }, { type: 'restake', percent: 30, contact_id: CID }, { type: 'keep', percent: 70, contact_id: null }], ids)).toThrow('cannot have a contact')
  })
})

describe('the plan store saves the recipient the editor shows', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('no recipient chosen yet: the first contact (shown as "Sending to …") is saved', () => {
    const plan = usePlan()
    plan.$patch({ contacts: [{ id: CID, name: 'Minos', ini: 'M', address: 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8' }], recipient: null, savedRecipient: null, pct: [10, 30, 60] as Split })
    expect(plan.contact(plan.recipient).name).toBe('Minos')
    plan.save()
    expect(plan.savedRecipient).toBe(CID)
    expect(plan.slices).toEqual([{ kind: 'send', pct: 10, contact: plan.contacts[0] }, { kind: 'restake', pct: 30 }, { kind: 'keep', pct: 60 }])
    expect(slicesFromPlan(plan.saved, plan.savedRecipient)[0]).toEqual({ type: 'send', percent: 10, contact_id: CID })
  })
})
