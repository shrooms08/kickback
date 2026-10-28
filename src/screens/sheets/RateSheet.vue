<script setup lang="ts">
import { computed } from 'vue'
import SheetHead from './SheetHead.vue'
import { useData } from '../../stores/data'
import { useAccount } from '../../stores/account'
import { useFlow } from '../../stores/flow'
import { rateText } from '../../lib/rateText'

// Where the reward rate comes from: the Nimiq staking calculator (nimiq.com/staking), after the pool fee.
const data = useData(), a = useAccount(), flow = useFlow()
const id = computed(() => (a.staked ? a.pool : flow.poolPick))
const pool = computed(() => data.pool(id.value))
const line = computed(() => rateText(data.apyFor(id.value)))
</script>

<template>
  <SheetHead title="About the rate" />
  <p class="big kb-num">{{ line }}</p>
  <p class="kb-body">This is the rate the <b>Nimiq staking calculator</b> on nimiq.com/staking shows for today's share of NIM staked, with rewards restaked, minus {{ pool.name || 'the pool' }}'s {{ pool.fee || '' }} fee.</p>
  <p class="kb-body">It changes as more or less NIM is staked across the network. Estimate, not a promise. Your stake is never touched by Kickback.</p>
  <div class="src"><span class="kb-dot" />Source: Nimiq staking calculator</div>
</template>

<style scoped>
.big { font-size: 28px; font-weight: 900; letter-spacing: -0.02em; color: var(--kb-lime); }
.src { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--kb-text-2); }
</style>
