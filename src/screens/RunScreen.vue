<script setup lang="ts">
import { computed } from 'vue'
import Modal from '../components/Modal.vue'
import TheStack from '../components/TheStack.vue'
import HoldButton from '../components/HoldButton.vue'
import Icon from '../components/Icon.vue'
import { useFlow } from '../stores/flow'
import type { RunStep } from '../stores/flow'
import { useAccount } from '../stores/account'
import { usePlan } from '../stores/plan'
import { useUi } from '../stores/ui'
import { useWallet } from '../stores/wallet'
import { int0, nim2, nimParts } from '../lib/format'
import { ranksOf, splitCents } from '../lib/plan'
import { shake } from '../lib/anim'
import { changePlanFromRun, closeRun, holdRunDone, process, retryFailed } from '../flows'

const flow = useFlow()
const a = useAccount()
const plan = usePlan()
const ui = useUi()
const wallet = useWallet()

const review = computed(() => flow.runPhase === 'review')
const running = computed(() => flow.runPhase === 'running')
const done = computed(() => flow.runPhase === 'done')
const partial = computed(() => done.value && flow.doneMode === 'partial')
const fullDone = computed(() => done.value && !partial.value)

const srec = computed(() => plan.contact(plan.savedRecipient))
const SLICE: Record<RunStep['type'], number> = { send: 0, restake: 1, keep: 2 }
const failed = computed<number[]>(() => flow.steps.filter(x => x.st === 'failed').map(x => SLICE[x.type]))
const split = computed(() => splitCents(a.readyCents, plan.saved))
const stack = computed(() => {
  const labels = done.value
    ? [`Sent to ${srec.value.name}`, 'Restaked', 'Kept'].map((l, i) => failed.value.includes(i) ? ['Not sent', 'Not restaked', 'Not kept'][i] : l)
    : [`Send to ${srec.value.name}`, 'Restake', 'Keep']
  return {
    pct: plan.saved,
    labels,
    amounts: split.value.map(v => nim2(v) + ' NIM'),
    ranks: ranksOf(plan.saved),
    visible: plan.hasContacts ? [0, 1, 2] : [1, 2],
    zeroed: done.value ? failed.value : [],
  }
})

const reason = computed(() => {
  if (!review.value) return ''
  if (wallet.isPreview) return 'Preview is read only'
  if (a.offline) return 'You\'re offline. Reconnect to run your plan.'
  if (a.readyCents === 0) return 'Nothing to share yet. Your first kickback lands in about 9h.'
  return ''
})

const ST: Record<RunStep['st'], [string, string]> = {
  pending: ['Next', 'var(--kb-text-2)'],
  waiting: ['Approve in Nimiq Pay…', 'var(--kb-text)'],
  approved: ['Approved', 'var(--kb-lime)'],
  cancelled: ['You cancelled', 'var(--kb-text-2)'],
  failed: ['Didn\'t go through. Still in your wallet.', 'var(--kb-text-2)'],
  skipped: ['Not sent', 'var(--kb-text-3)'],
}
const steps = computed(() => flow.steps.map((x, i) => ({
  ...x,
  n: i + 1,
  status: x.auto && x.st === 'pending' ? 'No approval needed' : x.auto && x.st === 'waiting' ? 'Keeping…' : ST[x.st][0],
  color: ST[x.st][1],
  canRetry: running.value && x.st === 'cancelled',
})))
const stuck = computed(() => running.value && flow.steps.some(x => x.st === 'cancelled') && !flow.steps.some(x => x.st === 'waiting'))

const doneText = (x: RunStep) => x.st === 'failed'
  ? `${x.label} didn't go through`
  : x.type === 'send' ? `${nim2(x.amt)} NIM sent to ${srec.value.name}` : x.type === 'restake' ? `${nim2(x.amt)} NIM restaked` : `${nim2(x.amt)} NIM kept in your wallet`

const failAmt = computed(() => flow.steps.filter(x => x.st === 'failed').reduce((t, x) => t + x.amt, 0))
const failParts = computed(() => nimParts(failAmt.value))
const okN = computed(() => flow.steps.filter(x => x.st === 'approved').length)
const keepNote = computed(() => split.value[2] > 0 ? `${nim2(split.value[2])} NIM stays in your wallet. No approval needed.` : 'Nothing is kept back this time.')
</script>

<template>
  <Modal>
    <div class="head">
      <span class="kb-eyebrow" style="font-size: 13px">Run my plan</span>
      <button class="kb-icon-btn" aria-label="Close" @click="closeRun"><Icon name="close" :size="18" /></button>
    </div>

    <h1 v-if="review" class="kb-h1">Ready to share {{ nim2(a.readyNim) }} NIM</h1>
    <h1 v-else-if="running" class="kb-h1">Approve each step</h1>
    <h1 v-else-if="partial" class="kb-h1 big52">{{ okN }} of {{ flow.steps.length }} done</h1>
    <div v-else class="done-h">
      <h1 class="kb-h1 big64">Done</h1>
      <div class="done-tick"><Icon name="check" :size="26" :stroke="2.8" /></div>
    </div>

    <TheStack v-bind="stack" size="run" :fill-key="flow.doneKey" />

    <div class="dests" :style="{ gridTemplateColumns: plan.hasContacts ? 'repeat(3,minmax(0,1fr))' : 'repeat(2,minmax(0,1fr))' }">
      <div v-if="plan.hasContacts" class="dest">
        <div class="dest-ico lime" data-kb-dest="send">{{ srec.ini }}</div>
        <div class="dest-name">{{ srec.name }}</div><div class="dest-sub">Send</div>
      </div>
      <div class="dest">
        <div class="dest-ico" data-kb-dest="restake" style="color: var(--kb-lime)"><Icon name="shield" :size="20" /></div>
        <div class="dest-name">{{ int0(a.stakedNim) }} staked</div><div class="dest-sub">Restake</div>
      </div>
      <div class="dest">
        <div class="dest-ico" data-kb-dest="keep"><Icon name="wallet" :size="20" /></div>
        <div class="dest-name">Your wallet</div><div class="dest-sub">Keep</div>
      </div>
    </div>

    <div v-if="!done" class="col10">
      <div class="kb-eyebrow">Each step is approved in Nimiq Pay</div>
      <div class="kb-row-list">
        <div v-for="s in steps" :key="s.n" class="kb-row">
          <div class="dot" :class="s.st">
            <template v-if="s.st === 'pending' || s.st === 'skipped'">{{ s.n }}</template>
            <div v-else-if="s.st === 'waiting'" class="spin" data-kb-keep="1" />
            <Icon v-else-if="s.st === 'approved'" name="check" :size="18" :stroke="2.8" />
            <Icon v-else name="close" :size="16" :stroke="2.6" />
          </div>
          <div class="step-t"><div class="step-l">{{ s.label }}</div><div class="step-s" :style="{ color: s.color }">{{ s.status }}</div></div>
          <button v-if="s.canRetry" class="retry kb-press" @click="process(s.n - 1)">Try again</button>
        </div>
      </div>
      <div class="keep-note">{{ keepNote }}</div>
    </div>

    <div v-else class="kb-row-list">
      <div v-for="(s, i) in flow.steps" :key="i" class="kb-row done-row">
        <Icon v-if="s.st !== 'failed'" name="check" :size="18" :stroke="2.6" color="var(--kb-lime)" />
        <Icon v-else name="close" :size="18" :stroke="2.6" color="var(--kb-error)" />
        <span :style="{ color: s.st === 'failed' ? 'var(--kb-text-2)' : 'var(--kb-text)' }">{{ doneText(s) }}</span>
      </div>
    </div>

    <div v-if="partial" class="col14">
      <div class="left-card">
        <div class="col6">
          <div class="kb-eyebrow">Ready to share</div>
          <div class="fail-amt"><span class="kb-num fa">{{ failParts[0] }}<span class="kb-dim fd">{{ failParts[1] }}</span></span><span class="fu">NIM</span></div>
        </div>
        <button class="retry-btn kb-press" @click="retryFailed">Retry</button>
      </div>
      <div class="kb-safe-line"><Icon name="shieldCheck" :size="18" /><span>The {{ nim2(failAmt) }} NIM that didn't go out is still in your wallet.</span></div>
      <button class="kb-link kb-link-quiet" @click="ui.openHelp('run')">Get help</button>
    </div>

    <div v-if="fullDone" class="next">
      <div class="next-t"><span class="kb-dim">What happens next:</span> your next kickback lands in 7h 40m</div>
      <button class="kb-link" style="padding: 0 12px; flex: none" @click="changePlanFromRun">Change plan</button>
    </div>

    <div class="foot">
      <div v-if="reason" class="kb-reason">{{ reason }}</div>
      <HoldButton v-if="review" label="Hold to run my plan" :disabled="!!reason" @done="holdRunDone" @blocked="shake($event.currentTarget as Element)" />
      <button v-if="stuck" class="kb-btn kb-btn-ghost" @click="closeRun">Back to home</button>
      <button v-if="done" class="kb-btn kb-btn-primary" @click="closeRun">Back to home</button>
    </div>
  </Modal>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; height: 52px; }
.big52 { font-size: 52px; line-height: .9; letter-spacing: -0.03em; }
.big64 { font-size: 64px; line-height: .9; letter-spacing: -0.03em; }
.done-h { display: flex; align-items: center; gap: 14px; }
.done-tick { width: 52px; height: 52px; border-radius: 50%; background: var(--kb-lime); color: var(--kb-bg); display: grid; place-items: center; box-shadow: 0 0 40px rgba(200, 240, 74, .45); }
.dests { display: grid; gap: 8px; }
.dest { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 6px; border-radius: 20px; background: var(--kb-surface); min-width: 0; text-align: center; }
.dest-ico { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; flex: none; background: var(--kb-raised); color: var(--kb-text); }
.dest-ico.lime { background: var(--kb-lime); color: var(--kb-bg); font-size: 17px; font-weight: 800; }
.dest-name { font-size: 13px; font-weight: 700; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dest-sub { font-size: 12px; color: var(--kb-text-2); margin-top: -4px; }
.col10 { display: flex; flex-direction: column; gap: 10px; }
.col14 { display: flex; flex-direction: column; gap: 14px; }
.col6 { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dot { width: 40px; height: 40px; border-radius: 50%; background: var(--kb-raised); color: var(--kb-text-2); border: 1px solid transparent; display: grid; place-items: center; flex: none; font-size: 14px; font-weight: 800; }
.dot.approved { background: var(--kb-lime); color: var(--kb-bg); }
.dot.failed { color: var(--kb-error); border-color: rgba(255, 107, 91, .5); }
.spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--kb-line); border-top-color: var(--kb-accent); animation: kbspin .9s linear infinite; }
.step-t { flex: 1; min-width: 0; }
.step-l { font-size: 15px; font-weight: 700; }
.step-s { font-size: 13px; }
.retry { height: 44px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--kb-lime); background: transparent; color: var(--kb-lime); font-size: 14px; font-weight: 700; flex: none; }
.keep-note { font-size: 14px; color: var(--kb-text-2); padding: 0 4px; }
.done-row { padding: 14px 0; font-size: 15px; font-weight: 600; }
.done-row :deep(svg) { flex: none; }
.left-card { border-radius: var(--kb-r-card); background: var(--kb-surface); border: 1px solid var(--kb-line); padding: 16px 16px 16px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.fail-amt { display: flex; align-items: baseline; gap: 6px; }
.fa { font-size: 28px; font-weight: 800; letter-spacing: -0.04em; line-height: 1; }
.fd { font-size: 18px; }
.fu { font-size: 14px; font-weight: 700; color: var(--kb-text-2); }
.retry-btn { height: 44px; padding: 0 20px; border-radius: 999px; border: none; background: var(--kb-lime); color: var(--kb-bg); font-size: 14px; font-weight: 800; flex: none; }
.next { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 8px 8px 16px; border-radius: 20px; background: var(--kb-surface); }
.next-t { font-size: 14px; line-height: 1.4; min-width: 0; }
.foot { margin-top: auto; }
</style>
