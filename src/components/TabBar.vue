<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import { useNav } from '../stores/nav'
import type { ScreenName } from '../stores/nav'
import { go } from '../router'
import { goPlan, goRun, tabHome } from '../flows'

// Floating tab bar: Home, Kickbacks, [Run my plan], Plan, Pool.
// The active pill glides with a transform (300ms, page easing).
const nav = useNav()
const bar = ref<HTMLElement>()
const width = ref(0)
let ro: ResizeObserver | null = null

onMounted(() => {
  if (!bar.value) return
  width.value = bar.value.offsetWidth
  ro = new ResizeObserver(() => { if (bar.value) width.value = bar.value.offsetWidth })
  ro.observe(bar.value)
})
onBeforeUnmount(() => ro?.disconnect())

const IDX: Partial<Record<ScreenName, number>> = { home: 0, homeEmpty: 0, kickbacks: 1, plan: 3, pool: 4 }
const active = computed(() => IDX[nav.screen!] ?? IDX[nav.chromeOwner!] ?? 0)
const pillX = computed(() => {
  const q = (width.value - 80) / 4
  const cx = [q / 2, 1.5 * q, 0, 2.5 * q + 80, 3.5 * q + 80][active.value]
  return cx - 28
})
</script>

<template>
  <div class="fade" />
  <nav ref="bar" class="bar" aria-label="Tabs">
    <div class="pill" :style="{ transform: `translateX(${pillX}px)`, opacity: width ? 1 : 0 }" />
    <button class="tab" :class="{ on: active === 0 }" @click="tabHome"><Icon name="home" :size="22" />Home</button>
    <button class="tab" :class="{ on: active === 1 }" @click="go('kickbacks')"><Icon name="bars" :size="22" :stroke="2.2" />Kickbacks</button>
    <div class="fab-cell">
      <button class="fab" aria-label="Run my plan" @click="goRun"><Icon name="run" :size="26" :stroke="2.6" /></button>
    </div>
    <button class="tab" :class="{ on: active === 3 }" @click="goPlan"><Icon name="plan" :size="22" />Plan</button>
    <button class="tab" :class="{ on: active === 4 }" @click="go('pool')"><Icon name="shield" :size="22" />Pool</button>
  </nav>
</template>

<style scoped>
.fade { position: absolute; left: 0; right: 0; bottom: 0; height: calc(110px + var(--kb-safe-bottom)); background: linear-gradient(to top, var(--kb-bg) 55%, rgba(11, 13, 28, 0)); pointer-events: none; }
.bar {
  position: absolute; left: 12px; right: 12px; bottom: calc(18px + var(--kb-safe-bottom)); height: 68px; border-radius: 34px;
  background: var(--kb-surface); border: 1px solid var(--kb-line); z-index: 41;
  display: grid; grid-template-columns: 1fr 1fr 80px 1fr 1fr; align-items: center;
  box-shadow: var(--kb-sh-float); pointer-events: auto;
}
.pill {
  position: absolute; top: 9px; left: 0; width: 56px; height: 32px; border-radius: 999px; background: rgba(200, 240, 74, .16);
  transition: transform 300ms var(--kb-ease-page); pointer-events: none;
}
.tab {
  position: relative; height: 60px; border: none; background: none; color: var(--kb-text-2);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  font-size: var(--kb-fs-tab); font-weight: 700; cursor: pointer; transition: transform var(--kb-dur-press) var(--kb-ease);
}
.tab.on { color: var(--kb-lime); }
.tab:active { transform: scale(var(--kb-press-scale)); }
.fab-cell { position: relative; height: 100%; }
.fab {
  position: absolute; left: 50%; top: -26px; transform: translateX(-50%); width: 70px; height: 70px; border-radius: 50%;
  border: 6px solid var(--kb-bg); background: var(--kb-lime); color: var(--kb-bg); display: grid; place-items: center; cursor: pointer;
  box-shadow: inset 0 2px 0 rgba(255, 255, 255, .55), inset 0 0 22px rgba(255, 255, 255, .35), var(--kb-sh-fab);
  transition: transform var(--kb-dur-press) var(--kb-ease);
}
.fab:active { transform: translateX(-50%) scale(var(--kb-press-scale)); }
</style>
