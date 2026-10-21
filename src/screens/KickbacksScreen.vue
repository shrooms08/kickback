<script setup lang="ts">
import { computed } from 'vue'
import NimAmount from '../components/NimAmount.vue'
import SegmentedBar from '../components/SegmentedBar.vue'
import KickbackRow from '../components/KickbackRow.vue'
import { useAccount } from '../stores/account'
import { useData } from '../stores/data'
import { nim2 } from '../lib/format'

const a = useAccount()
const data = useData()
const chart = computed(() => data.chart)
// Mock data scales against 6.4 like the prototype. Live data scales against
// the 90th percentile of daily totals, so one catch-up day (e.g. 18 payouts)
// doesn't flatten the rest; taller bars are clipped and marked with ↑.
function p90(values: number[]): number {
  const v = values.filter(x => x > 0).sort((x, y) => x - y)
  if (!v.length) return 0.0001
  return v[Math.min(v.length - 1, Math.ceil(v.length * 0.9) - 1)]
}
const scale = computed(() => data.isMock ? 6.4 : p90(chart.value.values))
// Bars grow from the bottom (scaleY), 30ms apart; today's bar is lime and settles last.
const bars = computed(() => chart.value.values.map((v, i) => ({
  over: !a.kbEmpty && !data.isMock && v > scale.value * 1.001,
  h: a.kbEmpty ? chart.value.ghost[i] : Math.min(120, Math.max(v > 0 ? 4 : 2, Math.round(v / scale.value * 112))),
  cls: a.kbEmpty ? 'ghost' : i === chart.value.values.length - 1 ? 'today' : v > 0 ? 'past' : 'zero',
  anim: i < 13 ? `kbBar 420ms var(--kb-ease) ${i * 30}ms both` : `kbBarSettle 520ms var(--kb-ease) ${13 * 30 + 80}ms both`,
})))
const groups = computed(() => data.feed.map(g => ({ ...g, total: nim2(g.rows.reduce((t, r) => t + r.amt, 0)) })))
const emptyTitle = computed(() => {
  if (data.isMock || a.staked) return a.notDirect ? 'Your pool restakes rewards, so there are no kickbacks to show' : `Your first kickback lands in about ${data.isMock ? 9 : (a.firstInH ?? 12)}h`
  return 'No kickbacks yet'
})
const emptyBody = computed(() => (!data.isMock && !a.staked) ? 'Stake with a pool and they show up here twice a day.' : 'Each one will show up here.')
</script>

<template>
  <div class="kb-scroll">
    <div class="kb-page">
      <div class="head"><span class="kb-eyebrow" style="font-size: 13px">{{ a.staked || data.isMock ? `From ${a.poolName}` : 'Your kickbacks' }}</span></div>
      <h1 class="kb-h1">Kickbacks</h1>
      <div class="chart">
        <div class="chart-top">
          <div class="col6">
            <div class="kb-eyebrow">Last 14 days</div>
            <NimAmount v-if="!a.kbEmpty" id="chart-total" :value="chart.total" :size="32" :dim-dec="false" :unit-size="15" :gap="5" ls="-0.04em" :lh="1" />
            <div v-else class="nothing">Nothing yet</div>
          </div>
          <div class="rate">{{ chart.perDay }}</div>
        </div>
        <div class="bars">
          <div v-for="(b, i) in bars" :key="i" class="col">
            <span v-if="b.over" class="up" aria-label="Taller than shown">↑</span>
            <div class="bar" :class="b.cls" :style="{ height: b.h + 'px', animation: b.anim }" />
          </div>
        </div>
        <div class="labels"><span v-for="l in chart.labels" :key="l">{{ l }}</span></div>
      </div>
      <div v-if="a.kbEmpty" class="empty">
        <div class="empty-t">{{ emptyTitle }}</div>
        <SegmentedBar v-if="data.isMock || (a.staked && !a.notDirect)" :segments="12" :value="data.isMock ? 3 : a.hours" size="lg" pulse />
        <div class="kb-body">{{ emptyBody }}</div>
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
.col { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; position: relative; }
.bar { border-radius: 6px; transform-origin: 50% 100%; }
.up { position: absolute; top: -2px; left: 0; right: 0; text-align: center; font-size: 11px; font-weight: 800; line-height: 1; color: var(--kb-label); }
.bar.past { background: var(--kb-chart-past); }
.bar.today { background: var(--kb-lime); }
.bar.zero { background: var(--kb-raised); }
.bar.ghost { background: var(--kb-hatch-seg) 0 0 / 48px 48px, var(--kb-raised); }
.labels { display: flex; justify-content: space-between; font-size: 12px; color: var(--kb-text-2); }
.empty { border-radius: var(--kb-r-card-lg); border: 1.5px dashed var(--kb-line); padding: 22px 20px; display: flex; flex-direction: column; gap: 14px; }
.empty-t { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; text-wrap: balance; }
.group { display: flex; flex-direction: column; gap: 8px; }
.group-h { display: flex; justify-content: space-between; padding: 0 4px; }
</style>
