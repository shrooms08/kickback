<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { badgeUri, ringFill, ringUri } from './badges'
import { useSeason } from '../stores/season'
import { useUi } from '../stores/ui'
import { int0 } from '../lib/format'

// Home header chip: the tier badge, season XP and the 7-segment streak ring (Stage B); before the
// server sends XP it shows the streak ring and count (Stage A). Opens Season. Ticks
// (1 -> 1.18 -> .95 -> 1, 700ms) when a run completes.
defineEmits<{ open: [] }>()
const season = useSeason()
const ui = useUi()
const n = computed(() => season.streakN)
const ring = computed(() => ringUri(ringFill(n.value)))
const tier = computed(() => season.data?.tier ?? null)
const badge = computed(() => (tier.value ? badgeUri(tier.value.i, true) : ''))
const xp = computed(() => int0(season.data?.xp ?? 0))
const ticking = ref(false)
watch(() => season.tick, () => {
  if (ui.rm) return
  ticking.value = false
  requestAnimationFrame(() => { ticking.value = true; setTimeout(() => { ticking.value = false }, 900) })
})
</script>

<template>
  <button
    class="pill kb-press" :class="{ tick: ticking }" data-kb="streak-pill"
    :aria-label="tier ? `Season. ${tier.name} ${tier.roman}, ${xp} XP, streak ${n} in a row` : `Season. Kickback streak ${n} in a row`"
    @click="$emit('open')"
  >
    <template v-if="tier">
      <span class="badge" data-kb="season-chip" :style="{ backgroundImage: badge }" />
      <span class="n kb-num">{{ xp }}</span><span class="t">XP</span>
      <span class="ring" :style="{ backgroundImage: ring }" />
    </template>
    <template v-else>
      <span class="ring" :style="{ backgroundImage: ring }" />
      <span class="n kb-num">{{ n }}</span><span class="t">in a row</span>
    </template>
  </button>
</template>

<style scoped>
.pill { height: 36px; padding: 0 8px; border-radius: 999px; border: 1px solid var(--kb-line); background: var(--kb-surface); color: var(--kb-text); display: flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 700; flex: none; white-space: nowrap; }
.pill.tick { animation: kbTick 700ms cubic-bezier(.2, .8, .2, 1) both; }
.ring { width: 22px; height: 22px; background-size: 22px 22px; flex: none; }
.badge { width: 22px; height: 22px; background-size: 22px 22px; flex: none; }
.n { font-weight: 800; }
.t { color: var(--kb-text-2); font-weight: 600; margin-right: 2px; }
</style>
