<script setup lang="ts">
import { computed } from 'vue'
import SegmentedBar from '../components/SegmentedBar.vue'
import { useAccount } from '../stores/account'
import { useUi } from '../stores/ui'
import { PAYOUTS, POOLS } from '../services/mock'
import { int0, nim2 } from '../lib/format'
import { switchPool, undoUnstake } from '../flows'

const a = useAccount()
const ui = useUi()
const pool = computed(() => POOLS[a.pool])
const status = computed(() => a.unstaking ? 'Unstaking' : a.switching ? 'Switching' : a.poolDown ? 'Not paying' : 'Active')
const dot = computed(() => a.poolDown ? 'var(--kb-error)' : a.unstaking ? 'var(--kb-text-2)' : 'var(--kb-lime)')
const line = computed(() => {
  const paid = a.poolDown ? 'Last paid 2 days ago' : a.late ? 'Last paid 14h ago' : a.payoutsEmpty ? 'No kickbacks to you yet' : 'Last paid 4h ago'
  return `${paid} · Your ${nim2(a.stakedNim)} NIM stays staked in your name.`
})
</script>

<template>
  <div class="kb-scroll">
    <div class="kb-page">
      <div class="head"><span class="kb-eyebrow" style="font-size: 13px">Staking</span></div>
      <h1 class="kb-h1">Your pool</h1>
      <div class="pool">
        <div class="row">
          <div class="name">{{ pool.name }}</div>
          <div class="status"><span class="sdot" :style="{ background: dot }" />{{ status }}</div>
        </div>
        <div class="stats">
          <div><div class="kb-eyebrow s11">Staked</div><div class="v kb-num" style="color: var(--kb-numc)">{{ int0(a.stakedNim) }}<span class="kb-dim">.00</span></div></div>
          <div><div class="kb-eyebrow s11">Fee</div><div class="v">{{ pool.fee }}</div></div>
          <div><div class="kb-eyebrow s11">Trust</div><div class="v">{{ pool.trust }} / 10</div></div>
        </div>
        <SegmentedBar :segments="10" :value="pool.trust" size="lg" />
        <div class="line">{{ line }}</div>
      </div>

      <div v-if="a.switching" class="state">
        <div class="row"><div class="kb-eyebrow">Switching pool</div><span class="meta">Step 1 of 2</span></div>
        <SegmentedBar :segments="2" :value="1" size="lg" pulse />
        <div class="body15">Moving to {{ a.switchToName }}. Your NIM keeps earning with {{ a.poolName }} until the switch takes effect at the next epoch.</div>
      </div>
      <div v-if="a.unstaking" class="state">
        <div class="row"><div class="kb-eyebrow">Unstaking</div><span class="meta">About 2 days left</span></div>
        <div class="big">Your {{ nim2(a.stakedNim) }} NIM is on its way back.</div>
        <SegmentedBar :segments="8" :value="1" size="lg" pulse />
        <div class="small">Available in about 2 days. Nothing else to do.</div>
        <button class="kb-btn ghost48" @click="undoUnstake">Undo: keep earning</button>
      </div>

      <div class="col10">
        <div class="kb-eyebrow">Last 10 kickbacks</div>
        <div class="list">
          <div v-if="a.payoutsEmpty" class="empty">
            <div class="empty-t">No kickbacks to you yet.</div>
            <div class="empty-s"><span class="kb-dot" />The pool paid 38 other stakers 2h ago.</div>
          </div>
          <template v-else>
            <div v-for="p in PAYOUTS" :key="p.when" class="payout"><span class="kb-dim">{{ p.when }}</span><span class="amt kb-num">+{{ nim2(p.amt) }} NIM</span></div>
          </template>
        </div>
      </div>

      <div v-if="!a.unstaking" class="actions">
        <button class="kb-btn kb-btn-ghost" style="font-size: 15px" @click="switchPool">Switch pool</button>
        <button class="kb-btn kb-btn-danger" style="height: 56px; font-size: 15px" @click="ui.openSheet('stop')">Stop earning</button>
      </div>
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
