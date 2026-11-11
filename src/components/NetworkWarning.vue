<script setup lang="ts">
import { net } from '../lib/net'
import { useWallet } from '../stores/wallet'

// Shown on Home when Nimiq Pay did not report its network and Kickback fell back to mainnet,
// so a testnet user knows why their balance or stake may look wrong.
const wallet = useWallet()
</script>

<template>
  <div v-if="!net.reported && !wallet.isMock" class="warn" role="alert" data-kb="network-warning">
    <strong>Network not reported by Nimiq Pay.</strong>
    Kickback is showing {{ net.network }}. If your Nimiq Pay is on testnet, update Nimiq Pay or reopen Kickback.
  </div>
</template>

<style scoped>
.warn {
  border-radius: 16px; padding: 12px 14px; font-size: 13px; line-height: 1.4; color: var(--kb-text);
  background: color-mix(in srgb, var(--kb-third) 16%, var(--kb-surface)); border: 1px solid color-mix(in srgb, var(--kb-third) 45%, transparent);
}
.warn strong { color: var(--kb-third); }
</style>
