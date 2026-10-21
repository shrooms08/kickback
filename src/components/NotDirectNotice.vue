<script setup lang="ts">
import Icon from './Icon.vue'
import { goPools } from '../flows'

// Calm notice for stakers whose pool restakes rewards (no payout transactions to see).
</script>

<template>
  <div class="notice" role="status">
    <span class="ico"><Icon name="shield" :size="18" /></span>
    <span class="text">Your pool restakes your rewards automatically, so Kickback can't see separate kickbacks. Switch to a direct-payout pool to get them twice a day.</span>
    <button class="act kb-press" @click="goPools">Switch pool</button>
  </div>
</template>

<style scoped>
.notice {
  border-radius: 20px; background: var(--kb-raised); border: 1px solid var(--kb-line); padding: 14px 14px 14px 16px;
  display: grid; grid-template-columns: auto 1fr; gap: 10px 12px; align-items: start;
}
.ico { color: var(--kb-label); display: flex; margin-top: 1px; }
.text { font-size: 14px; line-height: 1.45; }
.act {
  grid-column: 2; justify-self: start; height: 44px; padding: 0 16px; border-radius: 14px; border: none;
  background: var(--kb-surface); color: var(--kb-lime); font-size: 14px; font-weight: 800;
}
</style>
