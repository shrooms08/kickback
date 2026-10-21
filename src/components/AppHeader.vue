<script setup lang="ts">
import { computed } from 'vue'
import KLogo from './KLogo.vue'
import CopySwap from './CopySwap.vue'
import { useWallet } from '../stores/wallet'
import { useCopy } from '../lib/copy'
import { addressChip } from '../lib/format'
import { useUi } from '../stores/ui'

// Home header: K tile + wordmark, and the wallet address chip (tap to copy).
const wallet = useWallet()
const { copied, copy } = useCopy()
const chip = computed(() => addressChip(wallet.address))

// Hidden: 5 taps on the K logo within 3 seconds opens Diagnostics.
const ui = useUi()
let taps: number[] = []
function logoTap() {
  const now = Date.now()
  taps = [...taps.filter(t => now - t < 3000), now]
  if (taps.length >= 5) {
    taps = []
    ui.openSheet('diag')
  }
}
</script>

<template>
  <div class="header">
    <div class="brand"><span class="logo-tap" @click="logoTap"><KLogo tile :size="34" /></span><span class="word">Kickback</span></div>
    <button class="chip kb-press" aria-label="Copy wallet address" @click="copy('addr', wallet.address)">
      <span class="kb-dot" />{{ chip }}<CopySwap :copied="copied === 'addr'" />
    </button>
  </div>
</template>

<style scoped>
.header { display: flex; align-items: center; justify-content: space-between; height: 52px; }
.brand { display: flex; align-items: center; gap: 10px; }
.word { font-size: 18px; font-weight: 800; }
.logo-tap { display: grid; touch-action: manipulation; -webkit-user-select: none; user-select: none; }
.chip {
  height: 44px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--kb-line); background: transparent;
  display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--kb-text-2);
}
</style>
