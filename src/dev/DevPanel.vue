<script setup lang="ts">
// DEV ONLY (?mock=1 in `npm run dev`). Jump to any screen or edge state.
// Loaded with a dynamic import behind import.meta.env.DEV, so it never ships.
import { computed, nextTick, ref } from 'vue'
import { go } from '../router'
import { useNav } from '../stores/nav'
import type { ScreenName } from '../stores/nav'
import { useAccount } from '../stores/account'
import { usePlan } from '../stores/plan'
import { useFlow } from '../stores/flow'
import type { ErrorFrom } from '../stores/flow'
import { useUi } from '../stores/ui'
import type { WalletResponse } from '../services/mock'
import { shake } from '../lib/anim'
import {
  goAddContact, goPlan, goPools, goRun, goStopSheet, goThen, showRunDone, simulateArrival, simulateRun, startApprove,
} from '../flows'

const nav = useNav(), a = useAccount(), plan = usePlan(), flow = useFlow(), ui = useUi()
const open = ref(false)

function home() { a.staked = true; go('home') }
function to(n: ScreenName) { go(n) }
function err(from: ErrorFrom) { flow.errorFrom = from; flow.errorConnect = false; go('error') }
function shakeAmount() { setTimeout(() => shake(document.querySelector('[data-kb-layer="stake"] .amt-row')), 480) }

const screens: Array<[string, () => void]> = [
  ['Welcome', () => to('welcome')],
  ['Connecting', () => to('connecting')],
  ['Open in Nimiq Pay', () => to('browser')],
  ['Home, staked', home],
  ['Home, not staked', () => { a.staked = false; go('homeEmpty') }],
  ['Choose a pool', goPools],
  ['Stake amount', () => go('stake')],
  ['Approve (stake)', () => startApprove('stake')],
  ['Success', () => { a.staked = true; go('success') }],
  ['Kickbacks', () => { a.kbEmpty = false; go('kickbacks') }],
  ['Kickbacks, empty', () => { a.kbEmpty = true; go('kickbacks') }],
  ['Plan editor', goPlan],
  ['Add someone sheet', goAddContact],
  ['Run my plan', goRun],
  ['Run: simulate steps', simulateRun],
  ['Run: done', () => showRunDone(false)],
  ['Run: partly done', () => showRunDone(true)],
  ['Pool', () => go('pool')],
  ['Stop earning sheet', goStopSheet],
  ['Error: network', () => err('network')],
  ['Error: stake', () => err('stake')],
  ['Error: switch', () => err('switch')],
]

const approvals: Array<[string, () => void]> = [
  ['Approve: switch pool', () => goThen('pool', () => startApprove('switch'))],
  ['Approve: unstake', () => goThen('pool', () => startApprove('unstake'))],
  ['Approve: keep earning', () => goThen('pool', () => startApprove('keep'))],
  ['Kickback arrives', simulateArrival],
]

const toggle = (k: 'stale' | 'late' | 'poolDown' | 'stakePending' | 'noPayouts', dest: ScreenName) => () => {
  a[k] = !a[k]
  if (a[k]) { if (dest === 'home') home(); else go(dest) }
}

const edges = computed<Array<[string, boolean, () => void]>>(() => [
  ['Not enough NIM', a.lowBal, () => { a.lowBal = !a.lowBal; flow.amount = a.lowBal ? '100' : '7300'; if (a.lowBal) { go('stake'); shakeAmount() } }],
  ['Not enough for fees', a.lowFees, () => { a.lowFees = !a.lowFees; if (a.lowFees) { goRun(); goThen('run', () => ui.openSheet('fees')) } }],
  ['Approval rejected', false, () => { flow.walletResp = 'reject'; goThen('stake', () => setTimeout(() => startApprove('stake'), 200)) }],
  ['Offline', a.offline, () => { a.offline = !a.offline }],
  ['Data out of date', a.stale, toggle('stale', 'home')],
  ['Kickback late', a.late, toggle('late', 'home')],
  ['Pool stopped paying', a.poolDown, toggle('poolDown', 'home')],
  ['Stake pending', a.stakePending, toggle('stakePending', 'home')],
  ['Switching pool', a.switching, () => { const on = !a.switching; a.$patch({ poolState: on ? 'switching' : 'active', switchTo: on ? (a.pool === 'fun' ? 'obs' : 'fun') : null }); if (on) go('pool') }],
  ['Unstaking', a.unstaking, () => { const on = !a.unstaking; a.poolState = on ? 'unstaking' : 'active'; if (on) go('pool') }],
  ['No contacts', !plan.hasContacts, () => { plan.setNoContacts(plan.hasContacts); if (nav.screen !== 'plan') goPlan() }],
  ['Pool, no payouts', a.noPayouts, toggle('noPayouts', 'pool')],
  ['Empty account', a.emptyAcct, () => { const on = !a.emptyAcct; a.setEmptyAccount(on); plan.setNoContacts(on); if (on) home() }],
])

function resetAll() {
  a.resetEdges()
  if (!plan.hasContacts) plan.setNoContacts(false)
  flow.$patch({ amount: '7300', walletResp: 'approve' })
  home()
}

function setResp(r: WalletResponse) { flow.walletResp = r }
function toggleRm() { ui.rm = !ui.rm }
function run(fn: () => void) { open.value = false; nextTick(fn) }
</script>

<template>
  <button class="fab" :class="{ on: open }" aria-label="Dev panel" @click="open = !open">DEV</button>
  <aside class="panel" :class="{ open }">
    <div class="h">Kickback · dev</div>
    <p class="note">Mock wallet. Only in <code>npm run dev</code> with <code>?mock=1</code>.</p>

    <div class="sec">Screens</div>
    <div class="grid">
      <button v-for="[l, fn] in screens" :key="l" @click="run(fn)">{{ l }}</button>
    </div>

    <div class="sec">Simulated flows</div>
    <div class="grid">
      <button v-for="[l, fn] in approvals" :key="l" @click="run(fn)">{{ l }}</button>
    </div>

    <div class="sec">Nimiq Pay answers next approval with</div>
    <div class="row3">
      <button v-for="r in (['approve', 'reject', 'fail'] as const)" :key="r" :class="{ sel: flow.walletResp === r, fail: r === 'fail' }" @click="setResp(r)">{{ r }}</button>
    </div>

    <div class="sec">Edge states</div>
    <div class="grid">
      <button v-for="[l, on, fn] in edges" :key="l" :class="{ sel: on }" @click="run(fn)">{{ l }}</button>
    </div>
    <div class="row2">
      <button :class="{ sel: ui.rm }" @click="toggleRm">Reduced motion</button>
      <button @click="run(resetAll)">Reset all</button>
    </div>
  </aside>
</template>

<style scoped>
.fab {
  position: fixed; right: 8px; top: 50%; z-index: 200; height: 28px; padding: 0 8px; border-radius: 999px;
  border: 1px solid var(--kb-line); background: rgba(31, 36, 64, .85); color: var(--kb-text-2);
  font: 800 10px var(--kb-font); letter-spacing: .1em; cursor: pointer;
}
.fab.on { color: var(--kb-bg); background: var(--kb-lime); }
.panel {
  position: fixed; right: 0; top: 0; bottom: 0; width: min(340px, 92vw); z-index: 199; overflow-y: auto;
  background: var(--kb-panel); border-left: 1px solid var(--kb-line); padding: 20px 16px 40px;
  transform: translateX(100%); transition: transform 260ms var(--kb-ease-page); color: var(--kb-text);
}
.panel.open { transform: none; }
@media (min-width: 1000px) {
  .fab { display: none; }
  .panel { position: relative; transform: none; height: 100%; flex: none; border: 1px solid var(--kb-line); border-radius: 0; }
}
.h { font-weight: 900; text-transform: uppercase; letter-spacing: -0.01em; font-size: 18px; }
.note { font-size: 12px; color: var(--kb-text-2); margin: 6px 0 14px; line-height: 1.4; }
code { color: var(--kb-lime); }
.sec { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--kb-label); margin: 16px 0 8px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 12px; }
button:not(.fab) {
  min-height: 34px; padding: 6px 8px; border-radius: 10px; border: 1px solid var(--kb-line); background: transparent;
  color: var(--kb-text); font: 600 12px var(--kb-font); text-align: left; cursor: pointer; line-height: 1.2;
}
button.sel { background: var(--kb-lime); color: var(--kb-bg); border-color: var(--kb-lime); }
button.sel.fail { background: var(--kb-error); border-color: var(--kb-error); }
</style>
