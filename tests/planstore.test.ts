import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePlan } from '../src/stores/plan'

describe('plan store: server data arriving while you edit', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('does not wipe the editor when you have unsaved changes', () => {
    const plan = usePlan()
    plan.$patch({ saved: [0, 50, 50], pct: [10, 30, 60], contacts: [{ id: 'c1', name: 'Ada', ini: 'A' }], recipient: 'c1', savedRecipient: 'c1' })
    plan.applyServer({ saved: [0, 50, 50], savedRecipient: 'c1' })
    expect(plan.pct).toEqual([10, 30, 60])
    expect(plan.saved).toEqual([0, 50, 50])
  })
  it('follows the server when the editor has no changes', () => {
    const plan = usePlan()
    plan.$patch({ saved: [0, 50, 50], pct: [0, 50, 50], contacts: [{ id: 'c1', name: 'Ada', ini: 'A' }], recipient: 'c1', savedRecipient: 'c1' })
    plan.applyServer({ saved: [20, 30, 50], savedRecipient: 'c1' })
    expect(plan.pct).toEqual([20, 30, 50])
  })
})
