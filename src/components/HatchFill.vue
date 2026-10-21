<script setup lang="ts">
import { computed } from 'vue'

// The hand-drawn hatch, shown over the left `percent` of its parent.
// The visible region grows with two opposing translateX transforms (the clip
// moves right, the tile moves left by the same amount), so the pattern stays
// put, never stretches, and only `transform` animates.
// The tile itself is one fixed SVG from hatch.css, never re-randomised.
const props = withDefaults(defineProps<{
  percent?: number
  ink?: 'light' | 'dark' | 'second' | 'seg'
  /** Transition time for changes, ms. 0 = jump. */
  ms?: number
  delay?: number
  /** Soft right edge, px. */
  edge?: number
}>(), { percent: 100, ink: 'light', ms: 250, delay: 0, edge: 18 })

const p = computed(() => Math.max(0, Math.min(100, props.percent)))
const transition = computed(() => props.ms > 0 ? `transform ${props.ms}ms var(--kb-ease) ${props.delay}ms` : 'none')
</script>

<template>
  <div
    class="clip"
    :style="{
      transform: `translateX(${p - 100}%)`, transition,
      WebkitMaskImage: `linear-gradient(90deg,#000 calc(100% - ${edge}px),transparent)`,
      maskImage: `linear-gradient(90deg,#000 calc(100% - ${edge}px),transparent)`,
    }"
  >
    <div class="tile" :style="{ transform: `translateX(${100 - p}%)`, transition, backgroundImage: `var(--kb-hatch-${ink})` }" />
  </div>
</template>

<style scoped>
.clip { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.tile { position: absolute; inset: 0; background-size: var(--kb-hatch-size) var(--kb-hatch-size); }
</style>
