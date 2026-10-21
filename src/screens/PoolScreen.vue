<script setup lang="ts">
import { computed } from 'vue'
import SegmentedBar from '../components/SegmentedBar.vue'
import NotDirectNotice from '../components/NotDirectNotice.vue'
import UnstakingCard from '../components/UnstakingCard.vue'
import { useAccount } from '../stores/account'
import { useUi } from '../stores/ui'
import { useData } from '../stores/data'
import { nim2, nimParts } from '../lib/format'
import { ago, now } from '../lib/time'
import { goPools, switchPool } from '../flows'

const a = useAccount()
const ui = useUi()
const data = useData()
const live = computed(() => !data.isMock)
const pool = computed(() => data.pool(a.pool))
const stakedParts = computed(() => nimParts(a.stakedNim))
const noPayouts = computed(() => live.value ? data.payouts.length === 0 : a.payoutsEmpty)
const status = computed(() => a.unstaking ? 'Unstaking' : a.switching ? 'Switching' : a.poolDown ? 'Not paying' : 'Active')
const dot = computed(() => a.poolDown ? 'var(--kb-error)' : a.unstaking ? 'var(--kb-text-2)' : 'var(--kb-lime)')
const line = computed(() => {
  let paid: string
  if (live.value) {
    void now.value
    paid = a.notDirect ? 'Rewards are added to your stake' : !data.payouts.length ? 'No kickbacks to you yet' : a.poolLastPaidAt ? `Last paid ${ago(a.poolLastPaidAt)}` : 'Checking payouts…'
  }
  else paid = a.poolDown ? 'Last paid 2 days ago' : a.late ? 'Last paid 14h ago' : a.payoutsEmpty ? 'No kickbacks to you yet' : 'Last paid 4h ago'
  return `${paid} · Your ${nim2(a.stakedNim)} NIM stays staked in your name.`
})
const othersLine = computed(() => {
  if (!live.value) return 'The pool paid 38 other stakers 2h ago.'
  void now.value
  return a.poolLastPaidAt ? `The pool paid its stakers ${ago(a.poolLastPaidAt)}.` : 'Kickbacks show up here after the pool pays out.'
})
</script>

<template>
  <div class="kb-scroll">
    <div class="kb-page">
      <div class="head"><span class="kb-eyebrow" style="font-size: 13px">Staking</span></div>
      <h1 class="kb-h1">Your pool</h1>
      <div v-if="live && !a.staked" class="state">
        <div class="kb-eyebrow">Not staking yet</div>
        <div class="big">Pick a pool to start earning.</div>
        <div class="small">Your NIM stays yours. The pool pays you about every 12 hours.</div>
        <button class="kb-btn kb-btn-primary" @click="goPools">Choose a pool</button>
      </div>
      <template v-else>
      <NotDirectNotice v-if="a.notDirect" />
      <div class="pool">
        <div class="row">
          <div class="name">{{ pool.name }}</div>
          <div class="status"><span class="sdot" :style="{ background: dot }" />{{ status }}</div>
        </div>
        <div class="stats">
          <div><div class="kb-eyebrow s11">Staked</div><div class="v kb-num" style="color: var(--kb-numc)">{{ stakedParts[0] }}<span class="kb-dim">{{ stakedParts[1] }}</span></div></div>
          <div><div class="kb-eyebrow s11">Fee</div><div class="v">{{ pool.fee || '—' }}</div></div>
          <div><div class="kb-eyebrow s11">Trust</div><div class="v">{{ pool.trust ? `${pool.trust} / 10` : '—' }}</div></div>
        </div>
        <SegmentedBar :segments="10" :value="pool.trust" size="lg" />
        <div class="line">{{ line }}</div>
      </div>

      <div v-if="a.switching" class="state">
        <div class="row"><div class="kb-eyebrow">Switching pool</div><span class="meta">Step 1 of 2</span></div>
        <SegmentedBar :segments="2" :value="1" size="lg" pulse />
        <div class="body15">Moving to {{ a.switchToName }}. Your NIM keeps earning with {{ a.poolName }} until the switch takes effect at the next epoch.</div>
      </div>
      <UnstakingCard v-if="a.unstaking" />

      <div class="col10">
        <div class="kb-eyebrow">Last 10 kickbacks</div>
        <div class="list">
          <div v-if="noPayouts" class="empty">
            <div class="empty-t">No kickbacks to you yet.</div>
            <div class="empty-s"><span class="kb-dot" />{{ othersLine }}</div>
          </div>
          <template v-else>
            <div v-for="p in data.payouts" :key="p.when" class="payout"><span class="kb-dim">{{ p.when }}</span><span class="amt kb-num">+{{ nim2(p.amt) }} NIM</span></div>
          </template>
        </div>
      </div>

      <div v-if="!a.unstaking" class="actions">
        <button class="kb-btn kb-btn-ghost" style="font-size: 15px" @click="switchPool">Switch pool</button>
        <button class="kb-btn kb-btn-danger" style="height: 56px; font-size: 15px" @click="ui.openSheet('stop')">Stop earning</button>
      </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.head { height: 52px; display: flex; align-items: center; }
.pool { border-radius: var(--kb-r-card-lg); background: var(--kb-raised); padding: 22px; display: flex; flex-direction: column; gap: 18px; box-shadow: inset 0 1px 0 rgba(255, 255, 255, .06); }
.row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.name { font-size: 28px; font-weight: 800; letter-spacing: -0.03em; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; flex: none; }
.sdot { width: 8px; height: 8px; border-radius: 50%; }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.s11 { font-size: 11px; }
.v { font-size: 16px; font-weight: 800; margin-top: 6px; transition: color 300ms; }
.line { font-size: 14px; line-height: 1.45; color: var(--kb-text-2); }
.state { border-radius: var(--kb-r-card-lg); background: var(--kb-surface); border: 1px solid var(--kb-line); padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.meta { font-size: 13px; color: var(--kb-text-2); }
.body15 { font-size: 15px; line-height: 1.45; }
.big { font-size: 22px; font-weight: 800; line-height: 1.15; letter-spacing: -0.02em; }
.small { font-size: 14px; line-height: 1.45; color: var(--kb-text-2); }
.ghost48 { height: 48px; background: transparent; border: 1px solid var(--kb-line); color: var(--kb-text); font-size: 15px; font-weight: 700; }
.col10 { display: flex; flex-direction: column; gap: 10px; }
.list { border-radius: var(--kb-r-card); background: var(--kb-surface); padding: 6px 16px; }
.payout { display: flex; justify-content: space-between; align-items: center; padding: 11px 0; font-size: 15px; }
.payout + .payout { border-top: 1px solid var(--kb-line); }
.amt { font-weight: 700; }
.empty { padding: 14px 0; display: flex; flex-direction: column; gap: 4px; }
.empty-t { font-size: 15px; font-weight: 700; }
.empty-s { font-size: 13px; line-height: 1.4; color: var(--kb-text-2); display: flex; align-items: center; gap: 8px; }
.actions { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
</style>
