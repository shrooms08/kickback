<script setup lang="ts">
import { computed } from 'vue'
import KLogo from './KLogo.vue'
import CopySwap from './CopySwap.vue'
import Icon from './Icon.vue'
import StreakPill from './StreakPill.vue'
import { useWallet } from '../stores/wallet'
import { useCopy } from '../lib/copy'
import { addressChip } from '../lib/format'
import { useUi } from '../stores/ui'
import { go } from '../router'

// Home header: K tile (5 taps = Diagnostics), the Season streak chip, and the wallet address
// pill (tap to copy; the chevron switches wallets when Nimiq Pay has more than one basic account).
const wallet = useWallet()
const { copied, copy } = useCopy()
const chip = computed(() => addressChip(wallet.effectiveAddress))
const canSwitch = computed(() => wallet.basicAccounts.length > 1)

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
    <span class="logo-tap" @click="logoTap"><KLogo tile :size="34" /></span>
    <StreakPill @open="go('season')" />
    <div class="addr" data-kb="addr-pill">
      <button class="chip kb-press" aria-label="Copy wallet address" @click="copy('addr', wallet.effectiveAddress)">
        <span class="kb-dot" />{{ chip }}<CopySwap :copied="copied === 'addr'" />
      </button>
      <button v-if="canSwitch" class="chev kb-press" aria-label="Choose wallet" data-kb="wallet-switch" @click="ui.openSheet('wallets')"><Icon name="chevronDown" :size="16" :stroke="2.4" /></button>
    </div>
  </div>
</template>

<style scoped>
.header { display: flex; align-items: center; gap: 8px; height: 52px; }
.logo-tap { display: grid; touch-action: manipulation; -webkit-user-select: none; user-select: none; flex: none; }
.addr { margin-left: auto; display: flex; align-items: center; height: 44px; border-radius: 999px; border: 1px solid var(--kb-line); min-width: 0; flex: 0 1 auto; }
@media (max-width: 370px) { .chip :deep(.swap) { display: none; } .chip { padding: 0 10px; } }
.chip {
  height: 42px; padding: 0 12px; border-radius: 999px; border: none; background: transparent;
  display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--kb-text-2); white-space: nowrap; min-width: 0;
}
.chev { height: 42px; width: 36px; border: none; border-left: 1px solid var(--kb-line); background: transparent; color: var(--kb-text-2); display: grid; place-items: center; border-radius: 0 999px 999px 0; }
</style>
