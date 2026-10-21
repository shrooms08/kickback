<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

// Filled segments fade in left to right (60ms stagger, 180ms fade). Empty
// segments are surface + hatch. With `pulse`, the next segment breathes lime.
// `overdue` segments show in the accent colour after the filled ones.
const props = withDefaults(defineProps<{
  segments?: number
  value?: number
  size?: 'sm' | 'lg'
  pulse?: boolean
  overdue?: number
}>(), { segments: 10, value: 0, size: 'lg', pulse: false, overdue: 0 })

const on = ref(false)
let t = 0
onMounted(() => { t = window.setTimeout(() => { on.value = true }, 60) })
onBeforeUnmount(() => clearTimeout(t))

const segs = computed(() => {
  const n = Math.max(1, props.segments)
  const v = Math.max(0, Math.min(n, props.value))
  const od = Math.max(0, props.overdue)
  const shown = on.value ? v + od : 0
  const breathe = props.pulse && !od
  return Array.from({ length: n }, (_, i) => ({
    over: i >= v,
    op: i < shown ? 1 : 0,
    delay: i * 60 + 'ms',
    breathe: breathe && on.value && i === v && v < n,
  }))
})
</script>

<template>
  <div class="segbar" :class="size" role="presentation">
    <div v-for="(s, i) in segs" :key="i" class="seg">
      <div v-if="s.breathe" class="breathe" />
      <div class="fill" :class="{ over: s.over }" :style="{ opacity: s.op, transitionDelay: s.delay }" />
    </div>
  </div>
</template>

<style scoped>
.segbar { display: flex; gap: var(--kb-seg-gap); width: 100%; }
.seg {
  position: relative; flex: 1; min-width: 0; height: var(--kb-seg-h-lg); border-radius: 999px; overflow: hidden;
  background-color: var(--kb-seg-off); background-image: var(--kb-hatch-seg); background-size: 48px 48px;
}
.sm .seg { height: var(--kb-seg-h-sm); }
.breathe { position: absolute; inset: 0; border-radius: 999px; background: var(--kb-lime); animation: kbBreathe var(--kb-breathe) ease-in-out infinite; }
.fill { position: absolute; inset: 0; border-radius: 999px; background: var(--kb-seg-on); transition: opacity 180ms var(--kb-ease); }
.fill.over { background: var(--kb-accent); }
</style>
