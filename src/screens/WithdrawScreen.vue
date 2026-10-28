<script setup lang="ts">
import { computed } from 'vue'
import Modal from '../components/Modal.vue'
import Icon from '../components/Icon.vue'
import HoldButton from '../components/HoldButton.vue'
import StepList from '../components/StepList.vue'
import { useFlow } from '../stores/flow'
import { useAccount } from '../stores/account'
import { useWallet } from '../stores/wallet'
import { nim2 } from '../lib/format'
import { back } from '../router'
import { clearFinished, runWithdraw } from '../money'

// Withdraw released stake: unlock (retire) then move to the wallet (remove).
const flow = useFlow()
const a = useAccount()
const wallet = useWallet()
const total = computed(() => flow.wSteps.reduce((m, s) => Math.max(m, s.luna ?? 0), 0))
const done = computed(() => flow.wPhase === 'done' && flow.wSteps.every(s => s.st === 'approved'))
const reason = computed(() => wallet.isPreview ? 'Preview is read only' : '')

function close() {
  clearFinished()
  back(a.staked ? 'pool' : 'homeEmpty')
}
</script>

<template>
  <Modal>
    <div class="head">
      <span class="kb-eyebrow" style="font-size: 13px">Withdraw</span>
      <button class="kb-icon-btn" aria-label="Close" @click="close"><Icon name="close" :size="18" /></button>
    </div>
    <div v-if="done" class="done-h">
      <h1 class="kb-h1 big">Done</h1>
      <div class="tick"><Icon name="check" :size="26" :stroke="2.8" /></div>
    </div>
    <h1 v-else class="kb-h1">{{ flow.wPhase === 'running' ? 'Approve each step' : `Withdraw ${nim2(total / 1e5)} NIM` }}</h1>
    <p v-if="done" class="lead">{{ nim2(total / 1e5) }} NIM is back in your wallet.</p>
    <p v-else class="lead">{{ flow.wSteps.length > 1 ? 'Two steps, each approved in Nimiq Pay: unlock your stake, then move it to your wallet.' : 'One step, approved in Nimiq Pay.' }}</p>
    <StepList :steps="flow.wSteps" />
    <div v-if="!done" class="kb-safe-line"><Icon name="shieldCheck" :size="18" /><span>Your NIM only ever moves to your own wallet.</span></div>
    <div class="kb-actionbar" data-kb="action-bar">
      <div v-if="reason" class="kb-reason">{{ reason }}</div>
      <button v-if="done" class="kb-btn kb-btn-primary" @click="close">Back to pool</button>
      <HoldButton v-else-if="flow.wPhase !== 'running'" label="Hold to withdraw" :disabled="!!reason || !flow.wSteps.length" @done="runWithdraw" />
    </div>
  </Modal>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; height: 52px; }
.done-h { display: flex; align-items: center; gap: 14px; }
.big { font-size: 64px; line-height: .9; letter-spacing: -0.03em; }
.tick { width: 52px; height: 52px; border-radius: 50%; background: var(--kb-lime); color: var(--kb-bg); display: grid; place-items: center; box-shadow: 0 0 40px rgba(200, 240, 74, .45); }
.lead { font-size: 15px; line-height: 1.45; color: var(--kb-text-2); }
</style>
