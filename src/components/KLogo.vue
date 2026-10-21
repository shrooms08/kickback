<script setup lang="ts">
import { K_PATHS } from './klogo'

withDefaults(defineProps<{
  size?: number
  /** Fill colour of the mark. */
  color?: string
  /** Play the 4-piece entrance (600ms, 70ms stagger). */
  animate?: boolean
  /** Lime rounded tile with the mark in bg colour (app icon / header). */
  tile?: boolean
}>(), { size: 96, color: 'var(--kb-lime)', animate: false, tile: false })
</script>

<template>
  <div v-if="tile" class="tile" :style="{ width: size + 'px', height: size + 'px', borderRadius: size * 0.22 + 'px' }">
    <svg :width="size * 0.53" :height="size * 0.53" viewBox="0 0 300 300" style="fill: var(--kb-bg)" aria-label="Kickback">
      <component :is="p.tag" v-for="(p, i) in K_PATHS" :key="i" v-bind="p.attrs" />
    </svg>
  </div>
  <svg v-else :width="size" :height="size" viewBox="0 0 300 300" :style="{ fill: color }" aria-label="Kickback">
    <component
      :is="p.tag" v-for="(p, i) in K_PATHS" :key="i" v-bind="p.attrs"
      :style="animate ? { transformBox: 'fill-box', animation: `${p.anim} 390ms var(--kb-ease) ${i * 70}ms both` } : undefined"
    />
  </svg>
</template>

<style scoped>
.tile {
  background: var(--kb-lime); display: grid; place-items: center; flex: none;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .5);
}
</style>
