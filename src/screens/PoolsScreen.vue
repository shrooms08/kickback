<script setup lang="ts">
import { computed } from 'vue'
import StepHeader from '../components/StepHeader.vue'
import PoolCard from '../components/PoolCard.vue'
import { POOLS } from '../services/mock'
import { useFlow } from '../stores/flow'
import { useAccount } from '../stores/account'
import { isTab, useNav } from '../stores/nav'
import { poolsBack, poolsContinue } from '../flows'

const flow = useFlow()
const account = useAccount()
const nav = useNav()

// Opened from a staked tab = switching pools; otherwise step 1 of staking.
const switchMode = computed(() => account.staked && isTab(nav.poolsFrom) && nav.poolsFrom !== 'homeEmpty')
const pickName = computed(() => POOLS[flow.poolPick].name)
const cta = computed(() => {
  if (!switchMode.value) return `Continue with ${pickName.value}`
  return flow.poolPick === account.pool ? `You're already with ${account.poolName}` : `Switch to ${pickName.value}`
})
</script>

<template>
  <div class="kb-scroll">
    <div class="kb-page-push">
      <StepHeader :step="1" :label="switchMode ? 'Switch pool' : 'Step 1 of 2'" @back="poolsBack" />
      <div class="intro">
        <h1 class="kb-h1">Pick a pool</h1>
        <p class="kb-body">These pools pay rewards straight to your wallet.</p>
      </div>
      <PoolCard :pool="POOLS.fun" :selected="flow.poolPick === 'fun'" @pick="flow.poolPick = 'fun'" />
      <PoolCard :pool="POOLS.obs" :selected="flow.poolPick === 'obs'" @pick="flow.poolPick = 'obs'" />
      <div class="foot"><button class="kb-btn kb-btn-primary" @click="poolsContinue">{{ cta }}</button></div>
    </div>
  </div>
</template>

<style scoped>
.intro { display: flex; flex-direction: column; gap: 10px; }
.foot { margin-top: auto; padding-top: 8px; }
</style>
