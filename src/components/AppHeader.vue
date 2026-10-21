<script setup lang="ts">
import { computed } from 'vue'
import KLogo from './KLogo.vue'
import CopySwap from './CopySwap.vue'
import { useWallet } from '../stores/wallet'
import { useCopy } from '../lib/copy'
import { addressChip } from '../lib/format'

// Home header: K tile + wordmark, and the wallet address chip (tap to copy).
const wallet = useWallet()
const { copied, copy } = useCopy()
const chip = computed(() => addressChip(wallet.address))
</script>

<template>
  <div class="header">
    <div class="brand"><KLogo tile :size="34" /><span class="word">Kickback</span></div>
    <button class="chip kb-press" aria-label="Copy wallet address" @click="copy('addr', wallet.address)">
      <span class="kb-dot" />{{ chip }}<CopySwap :copied="copied === 'addr'" />
    </button>
  </div>
</template>

<style scoped>
.header { display: flex; align-items: center; justify-content: space-between; height: 52px; }
.brand { display: flex; align-items: center; gap: 10px; }
.word { font-size: 18px; font-weight: 800; }
.chip {
  height: 44px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--kb-line); background: transparent;
  display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--kb-text-2);
}
</style>
