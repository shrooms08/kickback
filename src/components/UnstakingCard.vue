<script setup lang="ts">
import { computed } from 'vue'
import SegmentedBar from './SegmentedBar.vue'
import { useAccount } from '../stores/account'
import { useWallet } from '../stores/wallet'
import { nim2 } from '../lib/format'
import { now, span } from '../lib/time'
import { undoUnstake } from '../flows'

// Stake on its way back. Mock mode keeps the prototype's fixed copy; live
// mode counts down to the block after the reporting window.
const a = useAccount()
const wallet = useWallet()

const view = computed(() => {
  if (wallet.isMock || a.unstakeReadyAt == null) {
    return { left: 'About 2 days left', body: 'Available in about 2 days. Nothing else to do.', seg: 1, ready: false }
  }
  const left = a.unstakeReadyAt - now.value
  if (left <= 0) return { left: 'Ready now', body: 'Available now. It stays put until you withdraw it.', seg: 8, ready: true }
  return { left: `About ${span(left)} left`, body: `Available in about ${span(left)}. Nothing else to do.`, seg: Math.max(1, Math.round(a.unstakeProgress * 8)), ready: false }
})
</script>

<template>
  <div class="card">
    <div class="row"><div class="kb-eyebrow">Unstaking</div><span class="meta">{{ view.left }}</span></div>
    <div class="big">Your {{ nim2(a.unstakingNim) }} NIM is {{ view.ready ? 'ready to come back' : 'on its way back' }}.</div>
    <SegmentedBar :segments="8" :value="view.seg" size="lg" :pulse="!view.ready" />
    <div class="small">{{ view.body }}</div>
    <button class="kb-btn ghost48" @click="undoUnstake">Undo: keep earning</button>
  </div>
</template>

<style scoped>
.card { border-radius: var(--kb-r-card-lg); background: var(--kb-surface); border: 1px solid var(--kb-line); padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.meta { font-size: 13px; color: var(--kb-text-2); }
.big { font-size: 22px; font-weight: 800; line-height: 1.15; letter-spacing: -0.02em; }
.small { font-size: 14px; line-height: 1.45; color: var(--kb-text-2); }
.ghost48 { height: 48px; background: transparent; border: 1px solid var(--kb-line); color: var(--kb-text); font-size: 15px; font-weight: 700; }
</style>
