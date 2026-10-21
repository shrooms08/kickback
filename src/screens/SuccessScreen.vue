<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Modal from '../components/Modal.vue'
import KLogo from '../components/KLogo.vue'
import Icon from '../components/Icon.vue'
import SegmentedBar from '../components/SegmentedBar.vue'
import { useFlow } from '../stores/flow'
import { useData } from '../stores/data'
import { useWallet } from '../stores/wallet'
import { useOps } from '../stores/ops'
import { useLive } from '../stores/live'
import { int0, nim2 } from '../lib/format'
import { epochClock, firstKickbackAt } from '../services/chain'
import { successHome } from '../flows'

const flow = useFlow()
const data = useData()
const wallet = useWallet()
const ops = useOps()
const live = useLive()
const amount = computed(() => wallet.isMock ? `${int0(Math.floor(parseFloat(flow.amount || '0') || 0))}.00` : nim2(flow.lastStakeLuna / 1e5))
const op = computed(() => (wallet.isMock ? undefined : ops.byId(flow.approveOpId)))
const confirmed = computed(() => wallet.isMock || op.value?.phase === 'confirmed')
const failed = computed(() => op.value?.phase === 'failed')

// New stake counts from the next election block, earns for one epoch, then the
// pool pays at its next payout. Adding to an existing stake follows the same rule.
const firstH = ref<number | null>(null)
onMounted(async () => {
  if (wallet.isMock) return
  const clock = live.clock ?? await epochClock().catch(() => null)
  if (!clock) return
  const p = data.pool(flow.poolPick)
  // Stake time: when the stake was sent (dry run: the fake send), else now.
  const at = firstKickbackAt(clock, op.value?.sentAt ?? Date.now(), p.lastPaidAt && p.intervalH ? { alive: true, lastPaidAt: p.lastPaidAt, batches: [], intervalH: p.intervalH, source: 'probe', checkedAt: Date.now() } : null)
  firstH.value = Math.max(1, Math.round((at - Date.now()) / 3600e3))
})
const firstLine = computed(() => {
  if (wallet.isMock) return 'First kickback lands in about 12h'
  const h = firstH.value
  if (flow.lastStakeAdd) return h ? `The added NIM earns from the next epoch. More per kickback in about ${h}h` : 'The added NIM earns from the next epoch'
  return h ? `First kickback lands in about ${h}h` : 'First kickback lands in about 12 to 24h'
})
</script>

<template>
  <Modal centered>
    <div class="main">
      <div class="burst">
        <div class="rays" data-kb-keep="1" />
        <div class="halo" />
        <div class="pulse" />
        <div class="coin"><KLogo :size="58" color="var(--kb-bg)" animate /></div>
      </div>
      <div class="copy">
        <h1 class="title">{{ flow.lastStakeAdd && !wallet.isMock ? 'Stake added' : 'You\'re earning' }}</h1>
        <p class="lead">{{ amount }} NIM is staked with {{ data.pool(flow.poolPick).name }}. It stays yours.</p>
      </div>
    </div>
    <div class="next">
      <div class="row"><div class="kb-eyebrow">What happens next</div><span class="count">1 of 3</span></div>
      <SegmentedBar :segments="3" :value="1" size="sm" pulse />
      <div class="steps">
        <div v-if="confirmed" class="step"><div class="dot done"><Icon name="check" :size="14" :stroke="3" /></div><span class="strong">Stake confirmed</span></div>
        <div v-else-if="failed" class="step"><div class="dot todo">!</div><span class="strong">The network didn't accept it. Nothing moved.</span></div>
        <div v-else class="step"><div class="dot live"><span class="breath" /></div><span class="strong">{{ op?.slow ? 'Still confirming your stake' : 'Confirming your stake…' }}</span></div>
        <div class="step"><div class="dot" :class="confirmed ? 'live' : 'todo'"><span v-if="confirmed" class="breath" /><template v-else>2</template></div><span :class="confirmed ? 'strong' : 'kb-dim'">{{ firstLine }}</span></div>
        <div class="step"><div class="dot todo">3</div><span class="kb-dim">Split it with your plan</span></div>
      </div>
    </div>
    <button class="kb-btn kb-btn-primary" @click="successHome">Set up my plan</button>
  </Modal>
</template>

<style scoped>
.main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; text-align: center; }
.burst { position: relative; width: 280px; height: 280px; display: grid; place-items: center; }
.rays {
  position: absolute; inset: 0; border-radius: 50%;
  background: repeating-conic-gradient(from 0deg, rgba(200, 240, 74, .35) 0 4deg, transparent 4deg 15deg);
  -webkit-mask-image: radial-gradient(circle, #000 30%, transparent 70%); mask-image: radial-gradient(circle, #000 30%, transparent 70%);
  animation: kbspin 40s linear infinite;
}
.halo { position: absolute; inset: 60px; border-radius: 50%; background: radial-gradient(circle, rgba(200, 240, 74, .4), transparent 70%); }
.pulse { position: absolute; left: 20px; top: 20px; width: 240px; height: 240px; border-radius: 50%; background: radial-gradient(circle, rgba(200, 240, 74, .55), transparent 60%); animation: kbGlowPulse 800ms var(--kb-ease) 600ms both; }
.coin {
  position: relative; width: 128px; height: 128px; border-radius: 50%; background: var(--kb-lime); display: grid; place-items: center;
  box-shadow: inset 0 2px 0 rgba(255, 255, 255, .6), inset 0 0 30px rgba(255, 255, 255, .35), 0 20px 60px rgba(200, 240, 74, .35);
}
.copy { position: relative; display: flex; flex-direction: column; gap: 14px; align-items: center; }
.title { font-size: 52px; line-height: .9; font-weight: 900; letter-spacing: -0.025em; text-transform: uppercase; }
.lead { font-size: 16px; line-height: 1.45; color: var(--kb-text-2); max-width: 290px; }
.next { border-radius: var(--kb-r-card); background: var(--kb-surface); padding: 16px; display: flex; flex-direction: column; gap: 14px; margin: 8px 0 20px; }
.row { display: flex; justify-content: space-between; align-items: center; }
.count { font-size: 12px; color: var(--kb-text-2); }
.steps { display: flex; flex-direction: column; gap: 12px; }
.step { display: flex; align-items: center; gap: 12px; font-size: 15px; }
.strong { font-weight: 700; }
.dot { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; flex: none; }
.dot.done { background: var(--kb-lime); color: var(--kb-bg); }
.dot.live { border: 1.5px solid var(--kb-lime); }
.breath { width: 8px; height: 8px; border-radius: 50%; background: var(--kb-lime); animation: kbBreathe 2s ease-in-out infinite; }
.dot.todo { border: 1px solid var(--kb-line); color: var(--kb-text-2); font-size: 13px; font-weight: 800; }
</style>
