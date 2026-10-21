<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import StepHeader from '../components/StepHeader.vue'
import HoldButton from '../components/HoldButton.vue'
import Icon from '../components/Icon.vue'
import { useFlow } from '../stores/flow'
import { useAccount } from '../stores/account'
import { EST_APY, KICKBACKS_PER_YEAR, MIN_STAKE_NIM, NIM_USD, POOLS } from '../services/mock'
import { int0, nim2 } from '../lib/format'
import { shake } from '../lib/anim'
import { back } from '../router'
import { holdStakeDone } from '../flows'

const flow = useFlow()
const account = useAccount()
const amountEl = ref<HTMLElement>()

const bal = computed(() => account.walletNim)
const n = computed(() => parseFloat(flow.amount || '0') || 0)
const parts = computed(() => flow.amount.split('.'))
const amtInt = computed(() => parts.value[0] ? int0(Number(parts.value[0])) : '0')
const amtDec = computed(() => flow.amount.includes('.') ? '.' + (parts.value[1] || '') : '')
const amtSize = computed(() => amtInt.value.length > 7 ? 46 : amtInt.value.length > 5 ? 54 : 64)
const bad = computed(() => n.value > 0 && (n.value < MIN_STAKE_NIM || n.value > bal.value || bal.value < MIN_STAKE_NIM))

const reason = computed(() => {
  if (account.offline) return 'You\'re offline. Reconnect to stake.'
  if (bal.value < MIN_STAKE_NIM) return `You have ${nim2(bal.value)} NIM. The minimum is 100 NIM.`
  if (n.value === 0) return 'Enter how much NIM to stake.'
  if (n.value < MIN_STAKE_NIM) return 'The minimum is 100 NIM.'
  if (n.value > bal.value) return `You have ${nim2(bal.value)} NIM. Lower the amount to stake.`
  return ''
})

const projection = computed(() => {
  if (n.value <= 0) return 'Enter an amount to see about how much you could earn.'
  const perKb = n.value * EST_APY / KICKBACKS_PER_YEAR, month = n.value * EST_APY / 12
  return `About ${nim2(perKb)} NIM per kickback, about ${int0(Math.round(month))} NIM a month.`
})

const chips = computed(() => [['100', '100'], ['500', '500'], ['1,000', '1000'], ['Max', String(Math.floor(bal.value * 100) / 100)]] as const)
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del']

function errOf(a: string) {
  const v = parseFloat(a || '0') || 0, b = bal.value
  return v > 0 && (v < MIN_STAKE_NIM || b < MIN_STAKE_NIM) ? 'low' : v > b ? 'high' : ''
}

function setAmount(a: string) {
  const was = errOf(flow.amount), now = errOf(a)
  flow.amount = a
  if (now && now !== was) nextTick(() => shake(amountEl.value))
}

function press(k: string) {
  let a = flow.amount
  if (k === 'del') a = a.slice(0, -1)
  else if (k === '.') { if (a.includes('.')) return; a = (a || '0') + '.' }
  else {
    if (a.includes('.') && a.split('.')[1].length >= 2) return
    a = a === '0' ? k : a + k
    if (a.replace('.', '').length > 9) return
  }
  setAmount(a)
}
</script>

<template>
  <div class="kb-scroll">
    <div class="kb-page-push" style="gap: 14px; padding-bottom: calc(20px + var(--kb-safe-bottom))">
      <StepHeader :step="2" label="Step 2 of 2" :title="`Stake with ${POOLS[flow.poolPick].name}`" @back="back('pools')" />
      <div class="amount">
        <div ref="amountEl" class="amt-row">
          <span class="amt kb-num" :class="{ bad }" :style="{ fontSize: amtSize + 'px' }">{{ amtInt }}<span class="dec">{{ amtDec }}</span></span>
          <span class="unit">NIM</span>
        </div>
        <div class="sub">about ${{ nim2(n * NIM_USD) }}</div>
        <div class="sub">Balance {{ nim2(bal) }} NIM · Minimum 100 NIM</div>
      </div>
      <div class="chips">
        <button v-for="[l, v] in chips" :key="l" class="chip kb-press" :class="{ on: flow.amount === v }" @click="setAmount(v)">{{ l }}</button>
      </div>
      <div class="proj">
        <div class="proj-ico"><Icon name="trend" :size="18" :stroke="2.2" /></div>
        <div class="proj-t">{{ projection }}</div>
      </div>
      <div class="keys">
        <button v-for="k in KEYS" :key="k" class="key" :aria-label="k === 'del' ? 'Delete' : k" @click="press(k)">
          <Icon v-if="k === 'del'" name="backspace" :size="24" />
          <template v-else>{{ k }}</template>
        </button>
      </div>
      <div class="foot">
        <div v-if="reason" class="kb-reason">{{ reason }}</div>
        <HoldButton label="Hold to stake" :disabled="!!reason" @done="holdStakeDone" @blocked="shake(amountEl)" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.amount { display: flex; flex-direction: column; align-items: center; gap: 6px; padding-top: 6px; }
.amt-row { display: flex; align-items: baseline; gap: 8px; max-width: 100%; }
.amt { font-weight: 800; letter-spacing: -0.045em; line-height: 1; color: var(--kb-text); }
.amt.bad { color: var(--kb-error); }
.dec { font-size: .56em; color: var(--kb-text-2); }
.unit { font-size: 18px; font-weight: 700; color: var(--kb-text-2); }
.sub { font-size: 14px; color: var(--kb-text-2); }
.chips { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.chip { height: 44px; border-radius: 999px; border: 1px solid var(--kb-line); background: transparent; color: var(--kb-text); font-size: 14px; font-weight: 700; }
.chip.on { background: var(--kb-lime); color: var(--kb-bg); border-color: var(--kb-lime); }
.proj { border-radius: 20px; background: var(--kb-surface); padding: 14px 16px; display: flex; gap: 12px; align-items: center; }
.proj-ico { width: 36px; height: 36px; border-radius: 50%; background: var(--kb-raised); color: var(--kb-lime); display: grid; place-items: center; flex: none; }
.proj-t { font-size: 14px; line-height: 1.4; }
.keys { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.key {
  height: 50px; border-radius: 18px; border: none; background: var(--kb-surface); color: var(--kb-text);
  font-size: 22px; font-weight: 700; cursor: pointer; display: grid; place-items: center;
  transition: transform var(--kb-dur-press) var(--kb-ease);
}
.key:active { background: var(--kb-raised); transform: scale(var(--kb-press-scale)); }
.foot { margin-top: auto; }
</style>
