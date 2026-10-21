<script setup lang="ts">
import { computed, ref } from 'vue'
import TheStack from '../components/TheStack.vue'
import Icon from '../components/Icon.vue'
import { usePlan } from '../stores/plan'
import { useAccount } from '../stores/account'
import { useUi } from '../stores/ui'
import { nim2 } from '../lib/format'
import { ranksOf, rebalance, snap5, splitCents } from '../lib/plan'
import type { Split } from '../lib/plan'
import { savePlan } from '../flows'

// The interactive part of the plan screen, split out so a drag only
// re-renders the Stack, the live line and the save button.
const plan = usePlan()
const account = useAccount()
const ui = useUi()

const instant = ref(-1)
const ms = ref(250)
let base: Split | null = null

const rec = computed(() => plan.contact(plan.recipient))
const split = computed(() => splitCents(account.readyCents, plan.pct))
const stack = computed(() => ({
  pct: plan.pct,
  labels: [`Send to ${rec.value.name}`, 'Restake', 'Keep'],
  amounts: split.value.map(v => nim2(v) + ' NIM'),
  ranks: plan.dragRanks || ranksOf(plan.pct),
  visible: plan.hasContacts ? [0, 1, 2] : [1, 2],
}))

const liveLine = computed(() => {
  const [s, r, k] = split.value, from = nim2(account.readyNim)
  return plan.hasContacts
    ? `From ${from} NIM: ${rec.value.name} ${nim2(s)}, restake ${nim2(r)}, you keep ${nim2(k)}`
    : `From ${from} NIM: restake ${nim2(r)}, you keep ${nim2(k)}`
})

function dragStart(i: number) {
  base = plan.pct.slice() as Split
  plan.dragRanks = ranksOf(plan.pct)
  instant.value = i
  ms.value = 250
}
function drag(i: number, v: number) {
  if (base) plan.pct = rebalance(i, v, base)
}
function dragEnd(i: number) {
  if (!base) return
  const next = snap5(i, plan.pct[i], base)
  base = null
  plan.dragRanks = null
  instant.value = -1
  ms.value = 150
  plan.pct = next
}
function step(i: number, d: number) {
  instant.value = -1
  ms.value = 250
  plan.pct = snap5(i, plan.pct[i] + d, plan.pct)
}
</script>

<template>
  <TheStack v-bind="stack" size="plan" interactive :instant="instant" :ms="ms" @drag-start="dragStart" @drag="drag" @drag-end="dragEnd" @step="step" />
  <div v-if="!plan.hasContacts" class="add kb-press-soft" role="button" @click="ui.openSheet('add')">
    <div class="add-ico"><Icon name="plus" :size="22" /></div>
    <div class="add-t"><div class="add-h">Add someone</div><div class="add-s">Send part of every kickback to family or friends.</div></div>
  </div>
  <div class="hint">Drag across a card, or tap − +. Always adds up to 100%.</div>
  <div class="live kb-num">{{ liveLine }}</div>
  <button v-if="plan.dirty" class="kb-btn kb-btn-primary" @click="savePlan">Save plan</button>
  <div v-else class="saved"><Icon name="check" :size="18" :stroke="2.4" color="var(--kb-lime)" />Plan saved</div>
</template>

<style scoped>
.add { min-height: 96px; border-radius: var(--kb-r-card); border: 1.5px dashed var(--kb-text-3); display: flex; align-items: center; gap: 14px; padding: 16px 20px; }
.add-ico { width: 44px; height: 44px; border-radius: 50%; background: var(--kb-raised); color: var(--kb-lime); display: grid; place-items: center; flex: none; }
.add-t { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.add-h { font-size: 17px; font-weight: 800; }
.add-s { font-size: 13px; line-height: 1.4; color: var(--kb-text-2); }
.hint { font-size: 13px; color: var(--kb-text-2); text-align: center; margin-top: -6px; }
.live { border-radius: 20px; background: var(--kb-surface); padding: 14px 16px; font-size: 15px; line-height: 1.45; }
.saved { height: 60px; border-radius: 999px; border: 1px solid var(--kb-line); color: var(--kb-text-2); font-size: 16px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; }
</style>
