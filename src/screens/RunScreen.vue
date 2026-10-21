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
import SegmentedBar from '../components/SegmentedBar.vue'
import { int0, nim2, nimParts } from '../lib/format'
import { now } from '../lib/time'
import { ranksOf, splitCents } from '../lib/plan'
import { splitLuna } from '../lib/money'
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
/** Reopened with nothing ready: no "Done", no 0.00 NIM cards, just when the next kickback lands. */
const empty = computed(() => review.value && (live.value ? a.readyLuna === 0 : a.readyCents === 0))
const emptyLine = computed(() => {
  if (!live.value) return 'Your next kickback lands in about 9h'
  if (!a.staked) return 'Stake NIM to start earning kickbacks.'
  if (a.notDirect) return 'Your pool adds rewards to your stake instead of paying them out.'
  const at = a.nextKickbackAt
  if (!at) return `Your ${a.firstPending ? 'first' : 'next'} kickback lands in about 12h`
  const h = Math.max(1, Math.round((at - now.value) / 3600e3))
  return `Your ${a.firstPending ? 'first' : 'next'} kickback lands in about ${h}h`
})
const emptyBar = computed(() => !live.value || (a.staked && !a.notDirect))

const srec = computed(() => plan.contact(plan.savedRecipient))
const SLICE: Record<RunStep['type'], number> = { send: 0, restake: 1, keep: 2, retire: 1, remove: 2 }
const live = computed(() => !wallet.isMock)
const notSent = (x: RunStep) => x.st === 'failed' || (live.value && (x.st === 'skipped' || x.st === 'cancelled'))
const failed = computed<number[]>(() => flow.steps.filter(notSent).map(x => SLICE[x.type]))
// Live: the exact Luna split of what this run shares (capped by the wallet); mock: the prototype's cents.
const split = computed(() => live.value ? splitLuna(flow.runAmountLuna, plan.saved).map(v => v / 1e5) : splitCents(a.readyCents, plan.saved))
const headline = computed(() => live.value ? nim2(flow.runAmountLuna / 1e5) : nim2(a.readyNim))
const stack = computed(() => {
  const labels = done.value
    ? [`Sent to ${srec.value.name}`, 'Restaked', 'Kept'].map((l, i) => failed.value.includes(i) ? ['Not sent', 'Not restaked', 'Not kept'][i] : l)
    : [`Send to ${srec.value.name}`, 'Restake', 'Keep']
  return {
    pct: plan.saved,
    labels,
    amounts: empty.value ? ['', '', ''] : split.value.map(v => nim2(v) + ' NIM'),
    ranks: ranksOf(plan.saved),
    visible: plan.hasContacts ? [0, 1, 2] : [1, 2],
    zeroed: done.value ? failed.value : [],
  }
})

const reason = computed(() => {
  if (!review.value || empty.value) return ''
  if (wallet.isPreview) return 'Preview is read only'
  if (a.offline) return 'You\'re offline. Reconnect to run your plan.'
  if (live.value) {
    if (plan.planStartedAt == null) return 'Save your plan first. Kickbacks after that are shared with it.'
    if (a.readyLuna === 0) return 'Nothing to share yet.'
    if (flow.runAmountLuna === 0) return 'Your wallet can\'t cover this right now.'
    return ''
  }
  if (a.readyCents === 0) return 'Nothing to share yet. Your first kickback lands in about 9h.'
  return ''
})

const ST: Record<RunStep['st'], [string, string]> = {
  pending: ['Next', 'var(--kb-text-2)'],
  waiting: ['Approve in Nimiq Pay…', 'var(--kb-text)'],
  checking: ['Checking if it went through…', 'var(--kb-text)'],
  confirming: ['Approved. Confirming…', 'var(--kb-text)'],
  approved: ['Approved', 'var(--kb-lime)'],
  cancelled: ['You cancelled', 'var(--kb-text-2)'],
  failed: ['Didn\'t go through. Still in your wallet.', 'var(--kb-text-2)'],
  skipped: ['Not sent', 'var(--kb-text-3)'],
}
const steps = computed(() => flow.steps.map((x, i) => ({
  ...x,
  n: i + 1,
  status: x.auto && x.st === 'pending' ? 'No approval needed' : x.auto && x.st === 'waiting' ? 'Keeping…' : x.st === 'confirming' && x.slow ? 'Still confirming. It will update here.' : ST[x.st][0],
  color: ST[x.st][1],
  canRetry: running.value && x.st === 'cancelled',
})))
const stuck = computed(() => running.value && flow.steps.some(x => x.st === 'cancelled') && !flow.steps.some(x => x.st === 'waiting' || x.st === 'checking' || x.st === 'confirming'))

const doneText = (x: RunStep) => notSent(x)
  ? `${x.label} didn't go through`
  : x.type === 'send' ? `${nim2(x.amt)} NIM sent to ${srec.value.name}` : x.type === 'restake' ? `${nim2(x.amt)} NIM restaked` : `${nim2(x.amt)} NIM kept in your wallet`

const failAmt = computed(() => flow.steps.filter(notSent).reduce((t, x) => t + x.amt, 0))
const failParts = computed(() => nimParts(failAmt.value))
const okN = computed(() => flow.steps.filter(x => x.st === 'approved').length)
const keepNote = computed(() => {
  const keep = live.value ? (flow.steps.find(x => x.type === 'keep')?.amt ?? 0) : split.value[2]
  return keep > 0 ? `${nim2(keep)} NIM stays in your wallet. No approval needed.` : 'Nothing is kept back this time.'
})
function retryStep(n: number) { if (live.value) retryFailed(); else process(n) }
</script>

<template>
  <Modal>
    <div class="head">
      <span class="kb-eyebrow" style="font-size: 13px">Run my plan</span>
      <button class="kb-icon-btn" aria-label="Close" @click="closeRun"><Icon name="close" :size="18" /></button>
    </div>

    <template v-if="empty">
      <h1 class="kb-h1" data-kb="run-empty">Nothing to share yet</h1>
      <div class="col10">
        <p class="empty-line">{{ emptyLine }}</p>
        <SegmentedBar v-if="emptyBar" :segments="12" :value="live ? a.hours : 4" pulse size="sm" />
        <p v-if="live && plan.planStartedAt == null" class="note" style="margin-top: 0">Save your plan first. Kickbacks after that are shared with it.</p>
      </div>
    </template>
    <h1 v-else-if="review" class="kb-h1">Ready to share {{ headline }} NIM</h1>
    <h1 v-else-if="running" class="kb-h1">Approve each step</h1>
    <h1 v-else-if="partial" class="kb-h1 big52">{{ okN }} of {{ flow.steps.length }} done</h1>
    <div v-else-if="fullDone" class="done-h" data-kb="run-done">
      <h1 class="kb-h1 big64">Done</h1>
      <div class="done-tick"><Icon name="check" :size="26" :stroke="2.8" /></div>
    </div>
    <p v-if="review && !empty && live && flow.runCapped" class="note">{{ flow.runCapped }}</p>
    <p v-if="!done && !empty && live && flow.runNote" class="note">{{ flow.runNote }}</p>

    <TheStack v-bind="stack" size="run" :fill-key="flow.doneKey" />

    <div v-if="!empty" class="dests" :style="{ gridTemplateColumns: plan.hasContacts ? 'repeat(3,minmax(0,1fr))' : 'repeat(2,minmax(0,1fr))' }">
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

    <div v-if="!done && !empty" class="col10">
      <div class="kb-eyebrow">Each step is approved in Nimiq Pay</div>
      <div class="kb-row-list">
        <div v-for="s in steps" :key="s.n" class="kb-row">
          <div class="dot" :class="s.st">
            <template v-if="s.st === 'pending' || s.st === 'skipped'">{{ s.n }}</template>
            <div v-else-if="s.st === 'waiting' || s.st === 'checking' || s.st === 'confirming'" class="spin" data-kb-keep="1" />
            <Icon v-else-if="s.st === 'approved'" name="check" :size="18" :stroke="2.8" />
            <Icon v-else name="close" :size="16" :stroke="2.6" />
          </div>
          <div class="step-t"><div class="step-l">{{ s.label }}</div><div class="step-s" :style="{ color: s.color }">{{ s.status }}</div></div>
          <button v-if="s.canRetry" class="retry kb-press" @click="retryStep(s.n - 1)">Try again</button>
        </div>
      </div>
      <div class="keep-note">{{ keepNote }}</div>
    </div>

    <div v-else-if="done" class="kb-row-list">
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
      <div class="next-t"><span class="kb-dim">What happens next:</span> your next kickback lands in {{ live ? (a.nextIn || 'about 12h') : '7h 40m' }}</div>
      <button class="kb-link" style="padding: 0 12px; flex: none" @click="changePlanFromRun">Change plan</button>
    </div>

    <div class="foot">
      <div v-if="reason" class="kb-reason">{{ reason }}</div>
      <div v-if="empty" class="empty-actions">
        <button class="kb-btn kb-btn-ghost" @click="changePlanFromRun">Edit plan</button>
        <button class="kb-btn kb-btn-primary" @click="closeRun">Close</button>
      </div>
      <HoldButton v-else-if="review" label="Hold to run my plan" :disabled="!!reason" @done="holdRunDone" @blocked="shake($event.currentTarget as Element)" />
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
.empty-line { font-size: 17px; font-weight: 700; line-height: 1.35; }
.empty-actions { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.empty-actions .kb-btn { height: 56px; }
.note { font-size: 14px; line-height: 1.45; color: var(--kb-text-2); margin-top: -8px; }
</style>
