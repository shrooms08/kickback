<script setup lang="ts">
import { computed } from 'vue'
import NimAmount from '../components/NimAmount.vue'
import SegmentedBar from '../components/SegmentedBar.vue'
import KickbackRow from '../components/KickbackRow.vue'
import { useAccount } from '../stores/account'
import { CHART, CHART_GHOST, CHART_LABELS, FEED } from '../services/mock'
import { nim2 } from '../lib/format'

const a = useAccount()
const total = CHART.reduce((t, v) => t + v, 0)
// Bars grow from the bottom (scaleY), 30ms apart; today's bar is lime and settles last.
const bars = computed(() => CHART.map((v, i) => ({
  h: a.kbEmpty ? CHART_GHOST[i] : Math.round(v / 6.4 * 120),
  cls: a.kbEmpty ? 'ghost' : i === CHART.length - 1 ? 'today' : 'past',
  anim: i < CHART.length - 1 ? `kbBar 420ms var(--kb-ease) ${i * 30}ms both` : `kbBarSettle 520ms var(--kb-ease) ${13 * 30 + 80}ms both`,
})))
const groups = FEED.map(g => ({ ...g, total: nim2(g.rows.reduce((t, r) => t + r.amt, 0)) }))
</script>

<template>
  <div class="kb-scroll">
    <div class="kb-page">
      <div class="head"><span class="kb-eyebrow" style="font-size: 13px">From {{ a.poolName }}</span></div>
      <h1 class="kb-h1">Kickbacks</h1>
      <div class="chart">
        <div class="chart-top">
          <div class="col6">
            <div class="kb-eyebrow">Last 14 days</div>
            <NimAmount v-if="!a.kbEmpty" id="chart-total" :value="total" :size="32" :dim-dec="false" :unit-size="15" :gap="5" ls="-0.04em" :lh="1" />
            <div v-else class="nothing">Nothing yet</div>
          </div>
          <div class="rate">2 a day</div>
        </div>
        <div class="bars">
          <div v-for="(b, i) in bars" :key="i" class="bar" :class="b.cls" :style="{ height: b.h + 'px', animation: b.anim }" />
        </div>
        <div class="labels"><span v-for="l in CHART_LABELS" :key="l">{{ l }}</span></div>
      </div>
      <div v-if="a.kbEmpty" class="empty">
        <div class="empty-t">Your first kickback lands in about 9h</div>
        <SegmentedBar :segments="12" :value="3" size="lg" pulse />
        <div class="kb-body">Each one will show up here.</div>
      </div>
      <template v-else>
        <div v-for="g in groups" :key="g.day" class="group">
          <div class="group-h kb-eyebrow"><span>{{ g.day }}</span><span>+{{ g.total }} NIM</span></div>
          <div class="kb-row-list">
            <KickbackRow v-for="r in g.rows" :key="r.time" :amt="r.amt" :sub="`${a.poolName} · ${r.time}`" :waiting="r.waiting" />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.head { height: 52px; display: flex; align-items: center; }
.chart { border-radius: var(--kb-r-card-lg); background: var(--kb-surface); padding: 20px; display: flex; flex-direction: column; gap: 18px; }
.chart-top { display: flex; justify-content: space-between; align-items: flex-end; gap: 10px; }
.col6 { display: flex; flex-direction: column; gap: 6px; }
.nothing { font-size: 20px; font-weight: 700; line-height: 1.2; color: var(--kb-text-2); }
.rate { font-size: 13px; color: var(--kb-text-2); text-align: right; }
.bars { height: 120px; display: flex; align-items: flex-end; gap: 5px; }
.bar { flex: 1; border-radius: 6px; transform-origin: 50% 100%; }
.bar.past { background: var(--kb-chart-past); }
.bar.today { background: var(--kb-lime); }
.bar.ghost { background: var(--kb-hatch-seg) 0 0 / 48px 48px, var(--kb-raised); }
.labels { display: flex; justify-content: space-between; font-size: 12px; color: var(--kb-text-2); }
.empty { border-radius: var(--kb-r-card-lg); border: 1.5px dashed var(--kb-line); padding: 22px 20px; display: flex; flex-direction: column; gap: 14px; }
.empty-t { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; text-wrap: balance; }
.group { display: flex; flex-direction: column; gap: 8px; }
.group-h { display: flex; justify-content: space-between; padding: 0 4px; }
</style>
