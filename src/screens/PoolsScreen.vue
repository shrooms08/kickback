<script setup lang="ts">
import { computed, onMounted } from 'vue'
import StepHeader from '../components/StepHeader.vue'
import PoolCard from '../components/PoolCard.vue'
import { useFlow } from '../stores/flow'
import { useAccount } from '../stores/account'
import { useData } from '../stores/data'
import { useLive } from '../stores/live'
import { isTab, useNav } from '../stores/nav'
import { sameAddr } from '../services/chain'
import { poolsBack, poolsContinue } from '../flows'

const flow = useFlow()
const account = useAccount()
const data = useData()
const nav = useNav()
const live = useLive()

// Opened from a staked tab = switching pools; otherwise step 1 of staking.
const switchMode = computed(() => account.staked && isTab(nav.poolsFrom) && nav.poolsFrom !== 'homeEmpty')
const pickName = computed(() => data.pool(flow.poolPick).name)
const isCurrent = computed(() => flow.poolPick === account.pool || sameAddr(flow.poolPick, account.pool))
const cta = computed(() => {
  if (!switchMode.value) return `Continue with ${pickName.value}`
  return isCurrent.value ? `You're already with ${account.poolName}` : `Switch to ${pickName.value}`
})
const loading = computed(() => !data.isMock && !data.pools.length && data.poolsState !== 'error')
const empty = computed(() => !data.isMock && !data.pools.length && data.poolsState === 'error')

onMounted(() => {
  // Make sure a listed pool is selected once the list is in.
  if (data.pools.length && !data.pools.some(p => p.id === flow.poolPick)) flow.poolPick = data.pools[0].id
  if (empty.value) live.refresh()
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
      <template v-if="loading">
        <div class="kb-skel" style="height: 236px; border-radius: 28px" />
        <div class="kb-skel" style="height: 220px; border-radius: 28px" />
      </template>
      <div v-else-if="empty" class="empty">
        <div class="empty-t">Couldn't load the pools.</div>
        <div class="kb-body">Check your connection. We'll keep trying.</div>
      </div>
      <PoolCard
        v-for="p in data.pools" v-else :key="p.id" :pool="p"
        :selected="flow.poolPick === p.id" @pick="flow.poolPick = p.id"
      />
      <div class="foot">
        <button class="kb-btn kb-btn-primary" :disabled="loading || empty" @click="poolsContinue">{{ loading ? 'Checking pools…' : cta }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.intro { display: flex; flex-direction: column; gap: 10px; }
.foot { margin-top: auto; padding-top: 8px; }
.empty { border-radius: var(--kb-r-card-lg); border: 1.5px dashed var(--kb-line); padding: 20px; display: flex; flex-direction: column; gap: 6px; }
.empty-t { font-size: 17px; font-weight: 800; }
button:disabled { opacity: .5; }
</style>
