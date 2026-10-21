<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import { useUi } from '../../stores/ui'
import { keepInstead } from '../../flows'

const ui = useUi()
</script>

<template>
  <div class="flag"><span class="rd" />Not enough for fees</div>
  <h2 class="sheet-h" data-sheet-drag>A little short on fees</h2>
  <p class="kb-body">Your wallet needs about 0.01 NIM for fees to run this plan.</p>
  <div class="kb-safe-line"><Icon name="shieldCheck" :size="18" /><span>Your kickback is safe and waiting.</span></div>
  <button class="kb-btn kb-btn-primary" @click="keepInstead">Keep it in wallet instead</button>
  <button class="kb-link kb-link-quiet" @click="ui.openHelp('fees')">Get help</button>
</template>

<style scoped>
.flag { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--kb-text-2); }
.rd { width: 8px; height: 8px; border-radius: 50%; background: var(--kb-error); }
.sheet-h { font-size: 30px; line-height: .95; font-weight: 900; text-transform: uppercase; letter-spacing: -0.02em; }
</style>
