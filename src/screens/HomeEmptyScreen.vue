<script setup lang="ts">
import { rateText } from '../lib/rateText'
import { usd } from '../lib/usd'
import { useUi } from '../stores/ui'
import Icon from '../components/Icon.vue'
import { computed } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import NimAmount from '../components/NimAmount.vue'
import HatchFill from '../components/HatchFill.vue'
import { useAccount } from '../stores/account'
import { useWallet } from '../stores/wallet'
import { NIM_USD } from '../services/mock'
import { useData } from '../stores/data'
import { int0 } from '../lib/format'
import { goPools } from '../flows'

// Home before staking: the real wallet balance (inside Nimiq Pay) and the pitch.
const account = useAccount()
const wallet = useWallet()
const data = useData()
const bal = computed(() => account.walletNim)
// Estimate: network staking reward after the best pool's fee. "about", never a promise.
const rateLine = computed(() => rateText(data.bestRate))
const ui = useUi()
const monthly = computed(() => Math.round(bal.value * data.bestApy / 12))
</script>

<template>
  <div class="kb-scroll">
    <div class="kb-page" style="gap: 28px">
      <AppHeader />
      <div class="block">
        <div class="kb-eyebrow">Wallet balance</div>
        <NimAmount v-if="wallet.balanceKnown" id="wallet-balance" :value="bal" :size="58" :dec-size="32" />
        <div v-else-if="wallet.balanceError" class="sub">Couldn't read your balance. It shows here once Nimiq Pay is ready.</div>
        <div v-else class="kb-skel" style="width: 62%; height: 52px; border-radius: 12px" aria-label="Loading balance" />
        <!-- No price feed yet: the fiat estimate only shows with mock data. -->
        <div v-if="wallet.isMock && usd(bal, NIM_USD)" class="sub">about {{ usd(bal, NIM_USD) }}</div>
      </div>
      <div class="pitch">
        <HatchFill class="pitch-hatch" ink="dark" :percent="100" :ms="0" :edge="20" />
        <div class="pitch-body">
          <h2 class="pitch-title">Your NIM could be paying you</h2>
          <p class="pitch-text">At today's rate, {{ int0(Math.floor(bal)) }} NIM could earn about {{ int0(monthly) }} NIM a month. Estimate, not a promise.</p>
          <button v-if="rateLine" class="rate" data-kb="rate-info" @click="ui.openSheet('rate')">{{ rateLine }} · Nimiq staking calculator <Icon name="info" :size="14" /></button>
          <button class="kb-btn start" @click="goPools">Start earning</button>
        </div>
      </div>
      <div class="how">
        <div class="kb-eyebrow">How it works</div>
        <div class="kb-how"><div class="kb-step-num">1</div><div>Stake once with a trusted pool.</div></div>
        <div class="kb-how"><div class="kb-step-num">2</div><div>The pool pays you about every 12 hours.</div></div>
        <div class="kb-how"><div class="kb-step-num">3</div><div>Split each kickback your way.</div></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.block { display: flex; flex-direction: column; gap: 8px; }
.sub { font-size: 14px; color: var(--kb-text-2); }
.pitch {
  position: relative; border-radius: var(--kb-r-card-lg); background: var(--kb-lime); color: var(--kb-bg);
  padding: 26px 22px 22px; overflow: hidden; box-shadow: inset 0 1px 0 rgba(255, 255, 255, .55), inset 0 0 32px rgba(255, 255, 255, .3);
}
.rate { align-self: flex-start; border: none; background: none; padding: 0; color: var(--kb-bg); opacity: .75; font: inherit; font-size: 13px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; }
.pitch-hatch { right: 38%; }
.pitch-body { position: relative; display: flex; flex-direction: column; gap: 18px; }
.pitch-title { font-size: 36px; line-height: .92; font-weight: 900; letter-spacing: -0.02em; text-transform: uppercase; text-wrap: balance; }
.pitch-text { font-size: 15px; line-height: 1.45; font-weight: 500; }
.start { height: 56px; background: var(--kb-bg); color: var(--kb-lime); font-size: 16px; }
.how { display: flex; flex-direction: column; gap: 10px; }
</style>
