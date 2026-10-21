<script setup lang="ts">
import { computed } from 'vue'
import Modal from '../components/Modal.vue'
import Icon from '../components/Icon.vue'
import { useFlow } from '../stores/flow'
import { useAccount } from '../stores/account'
import { useData } from '../stores/data'
import { nim2 } from '../lib/format'
import { cancelApprove } from '../flows'

// Waiting for the user to approve in Nimiq Pay.
const flow = useFlow()
const account = useAccount()
const data = useData()

const text = computed(() => {
  const pick = data.pool(flow.poolPick).name
  const n = parseFloat(flow.amount || '0') || 0
  const staked = nim2(account.stakedNim)
  return {
    stake: `Confirm staking ${nim2(n)} NIM with ${pick}. Nothing happens until you approve.`,
    switch: `Confirm moving your stake to ${pick}. It keeps earning while it moves.`,
    unstake: `Confirm unstaking ${staked} NIM. It comes back to your wallet after a waiting period.`,
    keep: `Confirm you want to keep earning. Your ${staked} NIM stays staked.`,
  }[flow.approveKind]
})
</script>

<template>
  <Modal centered>
    <div class="main">
      <div class="ring">
        <div class="pulse" />
        <div class="pulse late" />
        <div class="core"><Icon name="phoneCheck" :size="36" :stroke="1.8" /></div>
      </div>
      <div class="copy">
        <h1 class="kb-h1" style="font-size: 38px">Approve in Nimiq Pay</h1>
        <p class="lead">{{ text }}</p>
      </div>
    </div>
    <button class="kb-btn kb-btn-ghost" @click="cancelApprove">Cancel</button>
  </Modal>
</template>

<style scoped>
.main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 36px; text-align: center; }
.ring { position: relative; width: 140px; height: 140px; display: grid; place-items: center; }
.pulse { position: absolute; inset: 0; border-radius: 50%; border: 1.5px solid var(--kb-lime); animation: kbpulse 2.4s ease-out infinite; }
.pulse.late { animation-delay: 1.2s; }
.core { width: 96px; height: 96px; border-radius: 50%; background: var(--kb-surface); border: 1px solid var(--kb-line); display: grid; place-items: center; color: var(--kb-lime); }
.copy { position: relative; display: flex; flex-direction: column; gap: 14px; align-items: center; }
.lead { font-size: 16px; line-height: 1.45; color: var(--kb-text-2); max-width: 290px; text-wrap: pretty; }
</style>
