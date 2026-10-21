<script setup lang="ts">
import { computed } from 'vue'
import SegmentedBar from './SegmentedBar.vue'
import { useAccount } from '../stores/account'
import { useWallet } from '../stores/wallet'
import { int0, nim2 } from '../lib/format'
import { now, span } from '../lib/time'
import { goPools, undoUnstake, withdraw } from '../flows'

// Stake on its way back. Mock mode keeps the prototype's fixed copy. Live:
// counts down to release (next election + one epoch), then offers Withdraw.
// Undo (reactivate) works while the stake is inactive, not once it's retired.
const a = useAccount()
const wallet = useWallet()

const view = computed(() => {
  if (wallet.isMock || a.unstakeReadyAt == null) {
    return { left: 'About 2 days left', body: 'Available in about 2 days. Nothing else to do.', seg: 1, ready: false }
  }
  // The shared clock ticks every 30 s; read the real time so a release shows at once.
  void now.value
  const left = a.unstakeReadyAt - Date.now()
  if (left <= 0) return { left: 'Ready now', body: 'Released. Withdraw it to your wallet, or keep earning instead.', seg: 8, ready: true }
  const t = left < 120_000 ? 'a minute' : span(left)
  return { left: `About ${t} left`, body: `Available in about ${t}. Nothing else to do.`, seg: Math.max(1, Math.round(a.unstakeProgress * 8)), ready: false }
})
const canUndo = computed(() => wallet.isMock || a.canUndo)
</script>

<template>
  <div class="card">
    <div class="row"><div class="kb-eyebrow">Unstaking</div><span class="meta">{{ view.left }}</span></div>
    <div v-if="view.ready" class="big">{{ int0(Math.floor(a.unstakingNim)) }} NIM ready to withdraw</div>
    <div v-else class="big">Your {{ nim2(a.unstakingNim) }} NIM is on its way back.</div>
    <SegmentedBar :segments="8" :value="view.seg" size="lg" :pulse="!view.ready" />
    <div class="small">{{ view.body }}</div>
    <button v-if="view.ready" class="kb-btn kb-btn-primary" @click="withdraw">Withdraw</button>
    <button v-if="canUndo" class="kb-btn ghost48" @click="undoUnstake">{{ view.ready ? 'Keep earning instead' : 'Undo: keep earning' }}</button>
    <!-- Released and nothing active: one update moves it to a new pool and reactivates it. -->
    <button v-if="view.ready && canUndo && !wallet.isMock && a.stakedNim === 0" class="kb-btn ghost48" @click="goPools">Move to another pool</button>
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
