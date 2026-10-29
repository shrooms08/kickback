<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import type { RunStep } from '../stores/flow'

// Numbered steps, each approved in Nimiq Pay: waiting, checking, confirming,
// approved, cancelled, failed, skipped. Same look as Run my plan.
const props = defineProps<{ steps: RunStep[] }>()

const ST: Record<RunStep['st'], [string, string]> = {
  pending: ['Next', 'var(--kb-text-2)'],
  waiting: ['Approve in Nimiq Pay…', 'var(--kb-text)'],
  checking: ['Checking if it went through…', 'var(--kb-text)'],
  confirming: ['Approved. Confirming…', 'var(--kb-text)'],
  approved: ['Done', 'var(--kb-lime)'],
  cancelled: ['You cancelled', 'var(--kb-text-2)'],
  failed: ['Didn\'t go through. Nothing was sent.', 'var(--kb-text-2)'],
  skipped: ['Not sent', 'var(--kb-text-3)'],
  unknown: ['Not sure it went through. It is checked before anything is sent again.', 'var(--kb-text-2)'],
}
const rows = computed(() => props.steps.map((s, i) => ({
  ...s,
  n: i + 1,
  status: s.st === 'confirming' && s.slow ? 'Still confirming. It will update here.' : ST[s.st][0],
  color: ST[s.st][1],
})))
</script>

<template>
  <div class="kb-row-list">
    <div v-for="s in rows" :key="s.n" class="kb-row">
      <div class="dot" :class="s.st">
        <template v-if="s.st === 'pending' || s.st === 'skipped'">{{ s.n }}</template>
        <div v-else-if="s.st === 'waiting' || s.st === 'checking' || s.st === 'confirming'" class="spin" data-kb-keep="1" />
        <Icon v-else-if="s.st === 'approved'" name="check" :size="18" :stroke="2.8" />
        <Icon v-else name="close" :size="16" :stroke="2.6" />
      </div>
      <div class="txt"><div class="label">{{ s.label }}</div><div class="status" :style="{ color: s.color }">{{ s.status }}</div></div>
    </div>
  </div>
</template>

<style scoped>
.dot { width: 40px; height: 40px; border-radius: 50%; background: var(--kb-raised); color: var(--kb-text-2); border: 1px solid transparent; display: grid; place-items: center; flex: none; font-size: 14px; font-weight: 800; }
.dot.approved { background: var(--kb-lime); color: var(--kb-bg); }
.dot.failed { color: var(--kb-error); border-color: rgba(255, 107, 91, .5); }
.spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--kb-line); border-top-color: var(--kb-accent); animation: kbspin .9s linear infinite; }
.txt { flex: 1; min-width: 0; }
.label { font-size: 15px; font-weight: 700; }
.status { font-size: 13px; }
</style>
