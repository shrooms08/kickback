<script setup lang="ts">
import SegmentedBar from './SegmentedBar.vue'
import type { Pool } from '../services/mock'
import { bump } from '../lib/anim'

// A pool to pick on "Pick a pool": fee, payout schedule, trust score bar, last payout.
defineProps<{ pool: Pool, selected: boolean }>()
const emit = defineEmits<{ pick: [] }>()

function onPick(e: MouseEvent) {
  bump(e.currentTarget as HTMLElement)
  emit('pick')
}
</script>

<template>
  <div class="card kb-press-soft" :class="{ selected }" role="radio" :aria-checked="selected" tabindex="0" @click="onPick" @keydown.enter="emit('pick')">
    <div class="head">
      <div class="name">{{ pool.name }}</div>
      <span v-if="pool.badge" class="badge">{{ pool.badge }}</span>
    </div>
    <div class="grid">
      <div><div class="kb-eyebrow">Fee</div><div class="fee">{{ pool.fee }}</div></div>
      <div><div class="kb-eyebrow">Pays</div><div class="pays">{{ pool.pays }}</div></div>
    </div>
    <div class="trust">
      <div class="trust-row"><span class="kb-dim">Trust score</span><span class="score">{{ pool.trust }} / 10</span></div>
      <SegmentedBar :segments="10" :value="pool.trust" size="lg" />
    </div>
    <div class="paid">
      <span class="ping"><span class="ring" /><span class="core" /></span>{{ pool.lastPaid }}
    </div>
  </div>
</template>

<style scoped>
.card {
  border-radius: var(--kb-r-card-lg); background: var(--kb-surface); border: 2px solid var(--kb-line); padding: 20px;
  display: flex; flex-direction: column; gap: 18px;
  transition: transform 160ms var(--kb-ease), border-color 200ms;
}
.card.selected { border-color: var(--kb-lime); }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.name { font-size: 26px; font-weight: 800; letter-spacing: -0.03em; }
.badge { height: 28px; padding: 0 12px; border-radius: 999px; background: var(--kb-second); color: var(--kb-on-second); font-size: 12px; font-weight: 800; display: flex; align-items: center; flex: none; }
.grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.fee { font-size: 22px; font-weight: 800; margin-top: 4px; }
.pays { font-size: 15px; font-weight: 700; margin-top: 6px; line-height: 1.3; }
.trust { display: flex; flex-direction: column; gap: 8px; }
.trust-row { display: flex; justify-content: space-between; font-size: 13px; }
.score { font-weight: 800; }
.paid { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; }
.ping { position: relative; width: 8px; height: 8px; }
.ring, .core { position: absolute; inset: 0; border-radius: 50%; background: var(--kb-lime); }
.ring { animation: kbping 1.6s ease-out infinite; }
</style>
