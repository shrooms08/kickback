<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../../components/Icon.vue'
import CopySwap from '../../components/CopySwap.vue'
import { useUi } from '../../stores/ui'
import { useFlow } from '../../stores/flow'
import { useWallet } from '../../stores/wallet'
import { useData } from '../../stores/data'
import { addressShort, nim2 } from '../../lib/format'
import { useCopy } from '../../lib/copy'

// Pre-written support message for Telegram.
const ui = useUi()
const flow = useFlow()
const wallet = useWallet()
const data = useData()
const { copied, copy } = useCopy()

const msg = computed(() => {
  const pick = data.pool(flow.poolPick).name
  const n = parseFloat(flow.amount || '0') || 0
  const failAmt = flow.steps.filter(x => x.st === 'failed').reduce((t, x) => t + x.amt, 0)
  const lines: Record<string, string> = {
    stake: `My stake didn't go through. Amount: ${nim2(n)} NIM, pool: ${pick}.`,
    switch: `My switch to ${pick} didn't go through.`,
    unstake: 'Stopping my stake didn\'t go through.',
    run: `Part of my plan didn't go out: ${nim2(failAmt)} NIM.`,
    fees: 'I don\'t have enough NIM for fees to run my plan.',
    network: 'Kickback can\'t reach the network.',
    general: 'I have a question about Kickback.',
  }
  const time = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  const who = wallet.effectiveAddress ? `\nWallet: ${addressShort(wallet.effectiveAddress)}${wallet.isPreview ? ' (preview)' : ''}` : ''
  return `Hi Kickback team,\n${lines[ui.helpCtx] || lines.general}${who}\nTime: ${time}`
})

function openTelegram() {
  ui.closeSheet(() => ui.showToast('Opening Kickback on Telegram. Your message is ready.'))
}
</script>

<template>
  <div class="title-row" data-sheet-drag>
    <h2 class="sheet-h">Get help</h2>
    <button class="kb-icon-btn" aria-label="Close" @click="ui.closeSheet()"><Icon name="close" :size="18" /></button>
  </div>
  <p class="kb-body">Message the Kickback team on Telegram. We wrote it for you.</p>
  <div class="msg">{{ msg }}</div>
  <button class="kb-btn kb-btn-primary" @click="openTelegram">Open Telegram</button>
  <button class="kb-btn ghost" @click="copy('msg', msg)"><CopySwap :copied="copied === 'msg'" />Copy message</button>
</template>

<style scoped>
.title-row { display: flex; justify-content: space-between; align-items: center; }
.sheet-h { font-size: 30px; line-height: .95; font-weight: 900; text-transform: uppercase; letter-spacing: -0.02em; }
.msg { border-radius: 16px; background: var(--kb-bg); border: 1px solid var(--kb-line); padding: 14px 16px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
.ghost { height: 48px; background: transparent; border: 1px solid var(--kb-line); color: var(--kb-text); font-size: 15px; font-weight: 700; }
</style>
