<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { nimParts } from '../lib/format'
import { lastShown, markShown, tweenText } from '../lib/countup'

// A NIM amount: thousands separators, 2 decimals, dimmed decimals, tabular
// figures. With an `id` it counts up (700ms from 85%) the first time it is
// ever shown, and from the old value when the value changes. Remounting
// (switching tabs) shows the final value straight away. The tween writes
// only these two text nodes; Vue never re-renders per frame.
const props = withDefaults(defineProps<{
  value: number
  id?: string
  size?: number
  decSize?: number
  unitSize?: number
  gap?: number
  ls?: string
  lh?: number
  unit?: string
  dimDec?: boolean
  amtAttr?: string
}>(), { size: 64, gap: 8, ls: '-0.045em', lh: 0.9, unit: 'NIM', dimDec: true })

const COUNT_MS = 700
const intEl = ref<HTMLSpanElement>()
const decEl = ref<HTMLSpanElement>()
let current = props.value
let cancel = () => {}

function write(v: number) {
  current = v
  const [i, d] = nimParts(v)
  if (props.dimDec) {
    if (intEl.value) intEl.value.textContent = i
    if (decEl.value) decEl.value.textContent = d
  }
  else if (intEl.value) intEl.value.textContent = i + d
}

function run(from: number, to: number) {
  cancel()
  cancel = tweenText(from, to, from === to ? 0 : COUNT_MS, write)
}

onMounted(() => {
  if (!props.id) return write(props.value)
  const prev = lastShown(props.id)
  run(prev === undefined ? props.value * 0.85 : prev, props.value)
  markShown(props.id, props.value)
})

watch(() => props.value, (v) => {
  run(current, v)
  if (props.id) markShown(props.id, v)
})

onBeforeUnmount(() => cancel())
</script>

<template>
  <div class="nim-amt" :style="{ gap: gap + 'px' }">
    <span
      class="amt kb-num" :data-kb="amtAttr"
      :style="{ fontSize: size + 'px', letterSpacing: ls, lineHeight: lh }"
    ><span ref="intEl" /><span v-if="dimDec" ref="decEl" class="dec" :style="{ fontSize: (decSize ?? Math.round(size * 0.56)) + 'px' }" /></span>
    <span v-if="unit" class="unit" :style="{ fontSize: (unitSize ?? 18) + 'px' }">{{ unit }}</span>
  </div>
</template>

<style scoped>
.nim-amt { display: flex; align-items: baseline; flex-wrap: wrap; }
.amt { display: inline-block; font-weight: 800; color: var(--kb-numc); transition: color 300ms; }
.dec { color: var(--kb-text-2); }
.unit { font-weight: 700; color: var(--kb-text-2); }
</style>
