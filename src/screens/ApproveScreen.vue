<script setup lang="ts">
import { computed } from 'vue'
import Modal from '../components/Modal.vue'
import Icon from '../components/Icon.vue'
import { useFlow } from '../stores/flow'
import { useAccount } from '../stores/account'
import { useData } from '../stores/data'
import { useOps } from '../stores/ops'
import { useWallet } from '../stores/wallet'
import { nim2 } from '../lib/format'
import { cancelApprove } from '../flows'
import { back } from '../router'

// Waiting for the user to approve in Nimiq Pay, then (live) checking and
// confirming on the network.
const flow = useFlow()
const account = useAccount()
const data = useData()
const ops = useOps()
const wallet = useWallet()

const op = computed(() => (wallet.isMock ? undefined : ops.byId(flow.approveOpId)))
const phase = computed(() => op.value?.phase ?? 'approving')

const text = computed(() => {
  const pick = data.pool(flow.poolPick).name
  const n = wallet.isMock ? parseFloat(flow.amount || '0') || 0 : flow.lastStakeLuna / 1e5
  const staked = nim2(account.stakedNim)
  const all = nim2(account.stakedNim + account.inactiveNim)
  return {
    stake: flow.lastStakeAdd && !wallet.isMock ? `Confirm adding ${nim2(n)} NIM to your stake with ${account.poolName}. Nothing happens until you approve.` : `Confirm staking ${nim2(n)} NIM with ${pick}. Nothing happens until you approve.`,
    switch: wallet.isMock ? `Confirm moving your stake to ${pick}. It keeps earning while it moves.` : `Confirm moving your stake to ${pick}. It starts earning there at the next epoch.`,
    unstake: `Confirm unstaking ${staked} NIM. It comes back to your wallet after a waiting period.`,
    keep: `Confirm you want to keep earning. Your ${wallet.isMock ? staked : all} NIM stays staked.`,
  }[flow.approveKind]
})

const view = computed(() => {
  const o = op.value
  if (phase.value === 'checking') return { title: 'Checking', body: `Nimiq Pay lost the connection. Checking the network to see if it went through${o?.checkLeft ? ` (${o.checkLeft}s)` : ''}. Don't send it again.`, icon: 'retry' as const }
  if (phase.value === 'confirming' && o?.slow) return { title: 'Still confirming', body: 'It\'s taking longer than usual. You can leave this screen. It updates when the network includes it.', icon: 'clock' as const }
  if (phase.value === 'confirming') return { title: 'Confirming', body: 'Sent. Waiting for the network to include it. Usually a few seconds.', icon: 'check' as const }
  return { title: 'Approve in Nimiq Pay', body: text.value, icon: 'phoneCheck' as const }
})
</script>

<template>
  <Modal centered>
    <div class="main">
      <div class="ring">
        <div class="pulse" />
        <div class="pulse late" />
        <div class="core"><Icon :name="view.icon" :size="36" :stroke="1.8" /></div>
      </div>
      <div class="copy">
        <h1 class="kb-h1" style="font-size: 38px">{{ view.title }}</h1>
        <p class="lead">{{ view.body }}</p>
        <p v-if="wallet.isDry && phase === 'approving'" class="dry">Dry run: no real NIM moves.</p>
      </div>
    </div>
    <button v-if="wallet.isMock" class="kb-btn kb-btn-ghost" @click="cancelApprove">Cancel</button>
    <button v-else-if="op?.slow" class="kb-btn kb-btn-ghost" @click="back(account.staked ? 'home' : 'homeEmpty')">Back to home</button>
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
.dry { font-size: 13px; font-weight: 700; color: var(--kb-label); }
</style>
