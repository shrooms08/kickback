<script setup lang="ts">
import { computed } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import NimAmount from '../components/NimAmount.vue'
import SegmentedBar from '../components/SegmentedBar.vue'
import TheStack from '../components/TheStack.vue'
import ContactBubble from '../components/ContactBubble.vue'
import KickbackRow from '../components/KickbackRow.vue'
import Icon from '../components/Icon.vue'
import NotDirectNotice from '../components/NotDirectNotice.vue'
import UnstakingCard from '../components/UnstakingCard.vue'
import { useAccount } from '../stores/account'
import { usePlan } from '../stores/plan'
import { NIM_USD } from '../services/mock'
import { useData } from '../stores/data'
import { useWallet } from '../stores/wallet'
import { ago, span, now } from '../lib/time'
import { nim2, nimParts } from '../lib/format'
import { ranksOf, splitCents } from '../lib/plan'
import { goAddContact, goPlan, goPoolTab, shareNow } from '../flows'
import { go } from '../router'

const a = useAccount()
const plan = usePlan()
const data = useData()
const wallet = useWallet()
const live = computed(() => !wallet.isMock)
const stakedParts = computed(() => nimParts(a.stakedNim))
// Wallet: the fake balance in dry run, RPC getAccountByAddress in preview, getBalance otherwise.
const walletParts = computed(() => nimParts(a.walletNim))
const walletKnown = computed(() => wallet.balanceKnown)
const walletSub = computed(() => wallet.isPreview ? 'Preview address' : wallet.isDry ? 'Dry run balance' : 'Free to spend')
// Live new staker: the big countdown is to their own first kickback.
const firstPending = computed(() => live.value && a.firstPending)

// Live: someone still earning on active stake keeps the countdown and sees the
// Unstaking card below it; the card only replaces the countdown when nothing is active.
const unstakingOnly = computed(() => a.unstaking && (wallet.isMock || a.stakedNim === 0))
const mode = computed(() => {
  if (unstakingOnly.value) return 'unstaking'
  if (a.notDirect) return 'restake'
  if (a.stakePending) return 'pending'
  if (a.late || a.poolDown) return 'late'
  return 'normal'
})
const earnedShow = computed(() => !a.stakePending && a.earnedCents > 0)
const earnedLabel = computed(() => live.value && !a.earnedComplete && !firstPending.value ? 'Earned (last 30 days)' : 'Earned so far')
const firstLine = computed(() => `Your first kickback lands in about ${live.value ? (a.firstInH ?? 12) : 9}h.`)
const earnedNote = computed(() => {
  if (a.stakePending) return 'Starts with your first kickback, about 12h after your stake confirms.'
  if (a.notDirect) return 'Your pool adds rewards to your stake instead of paying them out.'
  if (firstPending.value) return '0.00 NIM, first one on the way'
  return firstLine.value
})
const lateLine = computed(() => {
  if (!live.value) return `${a.poolName} usually pays every 12h. Last paid ${a.poolDown ? '2 days' : '14h'} ago.`
  void now.value
  const every = Math.round(data.pool(a.pool).intervalH || 12)
  return `${a.poolName} usually pays every ${every}h. Last paid ${a.poolLastPaidAt ? span(Date.now() - a.poolLastPaidAt) : 'a while'} ago.`
})
const headline = computed(() => {
  if (firstPending.value) return `First kickback in ${a.nextIn}`
  return a.nextIn ? `Next kickback in ${a.nextIn}` : 'Waiting for your first kickback'
})
const earnedSub = computed(() => live.value ? `from ${a.kbCount} kickback${a.kbCount === 1 ? '' : 's'}` : `about $${nim2(a.earnedNim * NIM_USD)} · from ${a.kbCount} kickbacks`)
const readySub = computed(() => {
  if (live.value && plan.planStartedAt == null) return 'Save your plan to start sharing'
  if (!a.readyCents) return 'Nothing to share yet'
  return live.value ? `${a.waiting} kickback${a.waiting === 1 ? '' : 's'} waiting` : `about $${nim2(a.readyNim * NIM_USD)} · ${a.waiting} kickbacks waiting`
})

const srec = computed(() => plan.contact(plan.savedRecipient))
const split = computed(() => splitCents(a.readyCents, plan.saved))
const stack = computed(() => ({
  pct: plan.saved,
  labels: [srec.value.name, 'Restake', 'Keep'],
  amounts: split.value.map(v => nim2(v) + ' NIM'),
  ranks: ranksOf(plan.saved),
  visible: plan.hasContacts ? [0, 1, 2] : [1, 2],
}))

const poolPaid = computed(() => {
  if (live.value) {
    void now.value
    if (a.notDirect) return 'Restakes rewards'
    if (!a.poolLastPaidAt) return 'Checking payouts…'
    return a.poolDown ? `Last paid ${ago(a.poolLastPaidAt)}` : a.emptyAcct ? `Paid others ${ago(a.poolLastPaidAt)}` : `Paid ${ago(a.poolLastPaidAt)}`
  }
  return a.poolDown ? 'Last paid 2 days ago' : a.late ? 'Paid 14h ago' : a.emptyAcct ? 'Paid others 2h ago' : 'Paid 4h ago'
})
</script>

<template>
  <div class="kb-scroll">
    <div class="kb-page" style="gap: 22px">
      <AppHeader />

      <div v-if="mode === 'normal'" class="block14">
        <h1 class="kb-h1">{{ headline }}</h1>
        <SegmentedBar :segments="12" :value="a.hours" pulse size="lg" />
        <div class="meta between"><span>{{ a.lastPaid }}</span><span>{{ a.dueAt }}</span></div>
      </div>
      <div v-else-if="mode === 'late'" class="block14">
        <h1 class="kb-h1">Running late</h1>
        <SegmentedBar :segments="14" :value="12" :overdue="2" size="lg" />
        <div class="late"><span class="lime"><Icon name="shieldCheck" :size="18" /></span><span>{{ lateLine }} <span class="safe">Your stake is safe.</span></span></div>
        <button class="kb-link" style="align-self: flex-start; padding: 0 2px" @click="goPoolTab">Check pool</button>
      </div>
      <NotDirectNotice v-else-if="mode === 'restake'" />
      <div v-else-if="mode === 'pending'" class="block14" aria-busy="true">
        <h1 class="kb-h1">Confirming your stake</h1>
        <div class="pending-bar"><div class="sweep" /></div>
        <div class="meta">Usually under a minute. You can close Kickback, it keeps going.</div>
      </div>
      <UnstakingCard v-else />

      <UnstakingCard v-if="a.unstaking && !unstakingOnly" />

      <div class="block8">
        <div class="kb-eyebrow">{{ earnedLabel }}</div>
        <template v-if="earnedShow">
          <NimAmount id="earned" :value="a.earnedNim" :size="64" :dec-size="36" />
          <div class="sub">{{ earnedSub }}</div>
        </template>
        <div v-else class="note" data-kb="earned-note">{{ earnedNote }}</div>
      </div>

      <div class="ready" data-kb="ready-card">
        <div class="ready-head">
          <div class="ready-l">
            <div class="kb-eyebrow">Ready to share</div>
            <NimAmount id="ready" :value="a.readyNim" :size="32" :dec-size="20" :unit-size="14" :gap="6" ls="-0.04em" :lh="1" amt-attr="ready-amt" />
            <div class="meta">{{ readySub }}</div>
          </div>
          <button class="share kb-press" :class="{ off: !a.readyCents }" @click="shareNow">Share now</button>
        </div>
        <TheStack v-bind="stack" size="home" />
      </div>

      <div class="grid2">
        <div class="mini" data-kb="wallet-stat">
          <div class="kb-eyebrow">Wallet</div>
          <div v-if="walletKnown" class="mini-v kb-num" style="color: var(--kb-numc)" data-kb="wallet-amt">{{ walletParts[0] }}<span class="kb-dim">{{ walletParts[1] }}</span> NIM</div>
          <div v-else class="mini-v kb-dim">…</div>
          <div class="meta">{{ walletSub }}</div>
        </div>
        <div class="mini kb-press-soft" @click="goPoolTab">
          <div class="kb-eyebrow">Staked</div>
          <div class="mini-v kb-num" style="color: var(--kb-numc)">{{ stakedParts[0] }}<span class="kb-dim">{{ stakedParts[1] }}</span> NIM</div>
          <div class="meta">Never touched</div>
        </div>
        <div class="mini wide kb-press-soft" @click="goPoolTab">
          <div class="kb-eyebrow">Pool</div>
          <div class="mini-v ell">{{ a.poolName }}</div>
          <div class="meta paid"><span class="kb-dot" :style="{ background: a.poolDown ? 'var(--kb-error)' : 'var(--kb-lime)' }" />{{ poolPaid }}</div>
        </div>
      </div>

      <div class="block12">
        <div class="kb-eyebrow">{{ plan.hasContacts ? 'Your plan sends to' : 'Send part of every kickback to family or friends' }}</div>
        <div class="bubbles">
          <ContactBubble add @pick="goAddContact" />
          <ContactBubble v-for="(c, i) in plan.contacts" :key="c.id" :contact="c" :index="i" :selected="c.id === plan.savedRecipient" @pick="goPlan" />
        </div>
      </div>

      <div class="block10">
        <div class="row"><div class="kb-eyebrow">Recent kickbacks</div><button class="kb-link" @click="go('kickbacks')">See all</button></div>
        <div v-if="!a.kbEmpty" class="kb-row-list">
          <KickbackRow v-for="r in data.recent" :key="r.when" :amt="r.amt" :sub="`${a.poolName} · ${r.when}`" :waiting="r.waiting" />
        </div>
        <div v-else class="empty">
          <div class="empty-t">{{ a.notDirect ? 'Kickbacks show up here with a direct-payout pool.' : firstPending ? 'No kickbacks yet' : firstLine }}</div>
          <div class="meta">Each one will show up here.</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.block14 { display: flex; flex-direction: column; gap: 14px; }
.block8 { display: flex; flex-direction: column; gap: 8px; }
.block10 { display: flex; flex-direction: column; gap: 10px; }
.block12 { display: flex; flex-direction: column; gap: 12px; }
.meta { font-size: 13px; color: var(--kb-text-2); }
.between { display: flex; justify-content: space-between; }
.sub { font-size: 14px; color: var(--kb-text-2); }
.note { font-size: 20px; font-weight: 700; line-height: 1.3; letter-spacing: -0.01em; max-width: 300px; }
.late { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; line-height: 1.45; color: var(--kb-text-2); }
.lime { color: var(--kb-lime); display: flex; margin-top: 1px; }
.safe { color: var(--kb-lime); font-weight: 600; }
.pending-bar { position: relative; overflow: hidden; height: 10px; border-radius: 999px; background-color: var(--kb-surface); background-image: var(--kb-hatch-seg); background-size: 48px 48px; }
.sweep { position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(200, 240, 74, .5), transparent); animation: kbShimmer 1.4s var(--kb-ease-fx) infinite; }
.row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.ready { position: relative; border-radius: var(--kb-r-card-lg); background: var(--kb-surface); border: 1px solid var(--kb-line); padding: 18px 14px 14px; display: flex; flex-direction: column; gap: 16px; }
.ready-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 0 6px; }
.ready-l { display: flex; flex-direction: column; gap: 6px; }
.share { height: 44px; padding: 0 18px; border-radius: 999px; border: none; background: var(--kb-lime); color: var(--kb-bg); font-size: 14px; font-weight: 800; flex: none; }
.share.off { background: var(--kb-raised); color: var(--kb-text-2); }
.grid2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.mini { border-radius: var(--kb-r-card); background: var(--kb-surface); padding: 16px; display: flex; flex-direction: column; gap: 6px; }
.mini.wide { grid-column: 1 / -1; }
.mini-v { font-size: 22px; font-weight: 800; letter-spacing: -0.03em; transition: color 300ms; }
.ell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.paid { display: flex; align-items: center; gap: 6px; }
.bubbles { display: flex; gap: 14px; overflow-x: auto; padding: 4px 4px 2px; margin: 0 -4px; scrollbar-width: none; }
.bubbles::-webkit-scrollbar { display: none; }
.empty { border-radius: var(--kb-r-card); border: 1.5px dashed var(--kb-line); padding: 18px 16px; display: flex; flex-direction: column; gap: 4px; }
.empty-t { font-size: 15px; font-weight: 700; }
</style>
