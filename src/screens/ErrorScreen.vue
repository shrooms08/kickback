<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../components/Icon.vue'
import { useFlow } from '../stores/flow'
import { useAccount } from '../stores/account'
import { useUi } from '../stores/ui'
import type { HelpCtx } from '../stores/ui'
import { retryError } from '../flows'

// Failure pattern: 1 what happened, 2 is my NIM safe (lime + shield),
// 3 one next step, 4 Get help. Red only on the icon.
const flow = useFlow()
const account = useAccount()
const ui = useUi()

const copy = computed<string[]>(() => (({
  stake: ['Staking didn\'t go through', 'Nimiq Pay couldn\'t send the transaction.', 'Your NIM is safe. Nothing was staked.', 'Try again'],
  switch: ['The switch didn\'t go through', 'Nimiq Pay couldn\'t send the transaction.', `Your NIM is safe and still earning with ${account.poolName}.`, 'Back to pool'],
  unstake: ['That didn\'t go through', 'Nimiq Pay couldn\'t send the transaction.', 'Your NIM is safe. Nothing changed.', 'Back to pool'],
  network: ['Can\'t reach the network', 'Kickback couldn\'t load your latest data.', 'Your NIM is safe. Nothing was sent.', 'Try again'],
  notSent: ['That didn\'t go through', 'Failed. Nothing was sent.', 'Your NIM is safe and still in your wallet.', 'Back'],
  chainFailed: ['The network didn\'t accept it', 'It reached the network but failed. Nothing moved.', 'Your NIM is safe and still in your wallet.', 'Back'],
} as Record<string, string[]>)[flow.errorFrom || 'network'] ?? []))
const helpCtx = computed(() => (['stake', 'switch', 'unstake', 'network'].includes(flow.errorFrom ?? '') ? flow.errorFrom : flow.approveKind === 'stake' ? 'stake' : 'general') as HelpCtx)
</script>

<template>
  <div class="kb-scroll">
    <div class="page">
      <div class="main">
        <div class="bang">!</div>
        <h1 class="kb-h1">{{ copy[0] }}</h1>
        <p class="body">{{ copy[1] }}</p>
        <div class="kb-safe-line"><Icon name="shieldCheck" :size="18" /><span>{{ copy[2] }}</span></div>
      </div>
      <button class="kb-btn kb-btn-primary" @click="retryError"><Icon name="retry" :size="20" :stroke="2.4" />{{ copy[3] }}</button>
      <button class="kb-link kb-link-quiet" @click="ui.openHelp(helpCtx)">Get help</button>
    </div>
  </div>
</template>

<style scoped>
.page { min-height: 100%; padding: 24px 24px calc(28px + var(--kb-safe-bottom)); display: flex; flex-direction: column; }
.main { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
.bang { width: 48px; height: 48px; border-radius: 50%; border: 1.5px solid rgba(255, 107, 91, .5); color: var(--kb-error); display: grid; place-items: center; font-size: 22px; font-weight: 900; }
.body { font-size: 16px; line-height: 1.45; color: var(--kb-text-2); }
</style>
