<script setup lang="ts">
import { computed } from 'vue'
import AppHeader from '../components/AppHeader.vue'
import NimAmount from '../components/NimAmount.vue'
import HatchFill from '../components/HatchFill.vue'
import { useAccount } from '../stores/account'
import { useWallet } from '../stores/wallet'
import { EST_APY, NIM_USD } from '../services/mock'
import { aboutUsd, int0 } from '../lib/format'
import { goPools } from '../flows'

// Home before staking: the real wallet balance (inside Nimiq Pay) and the pitch.
const account = useAccount()
const wallet = useWallet()
const bal = computed(() => account.walletNim)
const monthly = computed(() => Math.round(bal.value * EST_APY / 12))
</script>

<template>
  <div class="kb-scroll">
    <div class="kb-page" style="gap: 28px">
      <AppHeader />
      <div class="block">
        <div class="kb-eyebrow">Wallet balance</div>
        <NimAmount id="wallet-balance" :value="bal" :size="58" :dec-size="32" />
        <!-- No price feed yet: the fiat estimate only shows with mock data. -->
        <div v-if="wallet.isMock" class="sub">{{ aboutUsd(bal * NIM_USD) }}</div>
      </div>
      <div class="pitch">
        <HatchFill class="pitch-hatch" ink="dark" :percent="100" :ms="0" :edge="20" />
        <div class="pitch-body">
          <h2 class="pitch-title">Your NIM could be paying you</h2>
          <p class="pitch-text">At today's rate, {{ int0(Math.floor(bal)) }} NIM could earn about {{ int0(monthly) }} NIM a month. Estimate, not a promise.</p>
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
.pitch-hatch { right: 38%; }
.pitch-body { position: relative; display: flex; flex-direction: column; gap: 18px; }
.pitch-title { font-size: 36px; line-height: .92; font-weight: 900; letter-spacing: -0.02em; text-transform: uppercase; text-wrap: balance; }
.pitch-text { font-size: 15px; line-height: 1.45; font-weight: 500; }
.start { height: 56px; background: var(--kb-bg); color: var(--kb-lime); font-size: 16px; }
.how { display: flex; flex-direction: column; gap: 10px; }
</style>
