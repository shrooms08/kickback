<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Icon from '../../components/Icon.vue'
import { useUi } from '../../stores/ui'
import { hoursToReleaseIfStopped } from '../../money'
import { confirmStop } from '../../flows'

// Albatross only allows changing pools once no stake is active and the
// inactive stake is released, so switching is: stop earning, wait, then pick
// the new pool (one step, it moves your stake there and reactivates it).
const ui = useUi()
const hours = ref<number | null>(null)
onMounted(async () => { hours.value = await hoursToReleaseIfStopped() })
</script>

<template>
  <div class="title-row" data-sheet-drag>
    <h2 class="sheet-h">Switch pool</h2>
    <button class="kb-icon-btn" aria-label="Close" @click="ui.closeSheet()"><Icon name="close" :size="18" /></button>
  </div>
  <p class="body">To switch, stop earning with your current pool, then stake with the new one. It takes about {{ hours ?? '12–24' }}h.</p>
  <div class="list">
    <div class="item"><span class="n">1</span><span>Stop earning now. Your NIM stays in the staking contract, locked for about {{ hours ?? '12–24' }}h.</span></div>
    <div class="item"><span class="n">2</span><span>When it's released, open Switch pool again and pick the new pool. One approval moves it there.</span></div>
  </div>
  <div class="kb-safe-line"><Icon name="shieldCheck" :size="18" /><span>No kickbacks while it's switching. Your NIM stays yours.</span></div>
  <button class="kb-btn kb-btn-danger" style="height: 56px" @click="confirmStop">Stop earning</button>
  <button class="kb-btn kb-btn-primary" @click="ui.closeSheet()">Keep earning</button>
</template>

<style scoped>
.title-row { display: flex; justify-content: space-between; align-items: center; }
.sheet-h { font-size: 30px; line-height: .95; font-weight: 900; text-transform: uppercase; letter-spacing: -0.02em; }
.body { font-size: 15px; line-height: 1.45; }
.list { display: flex; flex-direction: column; gap: 12px; }
.item { display: flex; gap: 12px; font-size: 15px; line-height: 1.45; color: var(--kb-text-2); }
.n { width: 28px; height: 28px; border-radius: 50%; background: var(--kb-raised); color: var(--kb-lime); display: grid; place-items: center; font-size: 13px; font-weight: 800; flex: none; }
</style>
