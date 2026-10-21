<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import HatchFill from './HatchFill.vue'
import Icon from './Icon.vue'
import { tweenText } from '../lib/countup'
import { reducedMotion } from '../lib/anim'

// The Stack: one card per slice of a kickback, overlapping by 12px.
// Cards are coloured by size, not by slice: biggest = lime, next = second
// (blue), smallest = raised. Hatch width = the slice's share. Only
// transforms and opacity move; percentages tween in their own text nodes.
const props = withDefaults(defineProps<{
  /** Target shares [send, restake, keep], always summing to 100. */
  pct: number[]
  labels: string[]
  amounts: string[]
  /** Which slices to show (no contacts = no send slice). */
  visible?: number[]
  /** Rank per slice, 0 = biggest. */
  ranks: number[]
  size?: 'home' | 'run' | 'plan'
  /** Slice being dragged: it follows the finger with no easing. */
  instant?: number
  /** Easing time for other changes (250 rebalance, 150 snap). */
  ms?: number
  /** Change to replay the fill from zero, staggered by rank (Run my plan "Done"). */
  fillKey?: string | number
  /** Slices that show 0 (failed steps). */
  zeroed?: number[]
  interactive?: boolean
  overlap?: number
}>(), { visible: () => [0, 1, 2], size: 'home', instant: -1, ms: 250, zeroed: () => [], interactive: false, overlap: 12 })

const emit = defineEmits<{ dragStart: [i: number], drag: [i: number, v: number], dragEnd: [i: number], step: [i: number, d: number] }>()

const H = { home: 64, run: 84, plan: 128 } as const
const h = computed(() => H[props.size])
const stackH = computed(() => props.visible.length * h.value - (props.visible.length - 1) * props.overlap)

const THEMES = [
  { cls: 't0', ink: 'dark' as const },   // lime
  { cls: 't1', ink: 'second' as const }, // second (blue)
  { cls: 't2', ink: 'light' as const },  // raised
]

// fill phases: reset (jump to 0) -> fill (grow from 0) -> live (follow changes)
const phase = ref<'reset' | 'fill' | 'live'>('reset')
const stagger = ref(false)
let liveTimer = 0

function startFill(byRank: boolean) {
  clearTimeout(liveTimer)
  if (reducedMotion()) { phase.value = 'live'; return }
  stagger.value = byRank
  phase.value = 'reset'
  requestAnimationFrame(() => requestAnimationFrame(() => {
    phase.value = 'fill'
    liveTimer = window.setTimeout(() => { phase.value = 'live' }, byRank ? 100 + 2 * 150 + 520 : 320 + 520)
  }))
}

onMounted(() => startFill(false))
watch(() => props.fillKey, (k, old) => { if (k !== old) startFill(true) })
onBeforeUnmount(() => { clearTimeout(liveTimer); cancels.forEach(c => c()) })

const cards = computed(() => {
  const vis = props.visible
  const order = vis.slice().sort((x, y) => props.ranks[x] - props.ranks[y])
  return vis.map((i, vi) => {
    const r = order.indexOf(i)
    const zero = props.zeroed.includes(i) || phase.value === 'reset'
    const target = zero ? 0 : Math.max(0, props.pct[i])
    let ms = props.ms, delay = 0
    if (phase.value === 'reset') ms = 0
    else if (phase.value === 'fill') { ms = 500; delay = stagger.value ? 100 + r * 150 : 320 }
    else if (i === props.instant) ms = 0
    return { i, vi, r, theme: THEMES[r], target, ms, delay, y: r * (h.value - props.overlap), z: r + 1 }
  })
})

// percentages: tween text nodes alongside the hatch
const pctEls: Record<number, HTMLElement | null> = {}
const shownPct: Record<number, number> = {}
const cancels: Array<() => void> = []
function setPctEl(i: number, el: unknown) { pctEls[i] = el as HTMLElement | null }

watch(cards, (list) => {
  nextTick(() => {
    for (const c of list) {
      const el = pctEls[c.i]
      if (!el) continue
      const from = shownPct[c.i] ?? 0
      if (from === c.target && el.textContent) continue
      cancels[c.i]?.()
      cancels[c.i] = tweenText(from, c.target, c.ms, (v) => {
        shownPct[c.i] = v
        el.textContent = Math.round(v) + '%'
      }, c.delay)
    }
  })
}, { immediate: true, deep: true })

// dragging across a card sets its share
let dragging: { i: number, rect: DOMRect } | null = null
function onDown(i: number, e: PointerEvent) {
  if (!props.interactive) return
  if ((e.target as HTMLElement).closest('button')) return
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
  catch { /* ignore */ }
  dragging = { i, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() }
  emit('dragStart', i)
  onMove(e)
}
function onMove(e: PointerEvent) {
  if (!dragging) return
  const { i, rect } = dragging
  emit('drag', i, Math.round(((e.clientX - rect.left) / rect.width) * 100))
}
function onUp() {
  if (!dragging) return
  const { i } = dragging
  dragging = null
  emit('dragEnd', i)
}
</script>

<template>
  <div class="stack" :class="size" :style="{ height: stackH + 'px' }">
    <div
      v-for="c in cards" :key="c.i" class="pos"
      :style="{ transform: `translateY(${c.y}px)`, zIndex: c.z }"
    >
      <div
        class="card" :class="[c.theme.cls, { shadowed: c.r > 0, interactive }]"
        :style="{ height: h + 'px', animationDelay: c.vi * 80 + 'ms' }"
        :data-kb-run-slice="size === 'run' ? c.i : undefined"
        @pointerdown="onDown(c.i, $event)" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp"
      >
        <Transition name="skin">
          <div :key="c.r" class="skin" :class="c.theme.cls">
            <HatchFill :percent="c.target" :ink="c.theme.ink" :ms="c.ms" :delay="c.delay" />
          </div>
        </Transition>
        <div class="content">
          <div class="left">
            <span :ref="el => setPctEl(c.i, el)" class="pct kb-num" />
            <span class="label small">{{ labels[c.i] }}</span>
          </div>
          <div v-if="size !== 'plan'" class="amt small kb-num">{{ amounts[c.i] }}</div>
          <div v-else class="right">
            <div class="amt small kb-num">{{ amounts[c.i] }}</div>
            <div class="btns">
              <button class="step" aria-label="Less" @pointerdown.stop @click="emit('step', c.i, -5)"><Icon name="minus" :size="18" :stroke="2.2" /></button>
              <button class="step" aria-label="More" @pointerdown.stop @click="emit('step', c.i, 5)"><Icon name="plus" :size="18" :stroke="2.2" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stack { position: relative; }
.pos { position: absolute; left: 0; right: 0; top: 0; transition: transform var(--kb-dur-stack) var(--kb-ease); }
.card {
  position: relative; border-radius: 20px; overflow: hidden;
  animation: kbCardIn 320ms var(--kb-ease) both;
}
.run .card, .plan .card { border-radius: 24px; }
.card.interactive { touch-action: pan-y; user-select: none; -webkit-user-select: none; cursor: ew-resize; }

/* themes by rank */
.skin { position: absolute; inset: 0; }
.skin.t0 { background: var(--kb-lime); box-shadow: var(--kb-sh-lime-glow); }
.skin.t1 { background: var(--kb-second); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .08); }
.skin.t2 { background: var(--kb-raised); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .05); }
.card.shadowed { box-shadow: var(--kb-sh-stack); }
.skin-leave-active { transition: opacity var(--kb-dur-stack) ease-out; z-index: 1; }
.skin-leave-to { opacity: 0; }

.card.t0 { color: var(--kb-on-lime); }
.card.t1 { color: var(--kb-on-second); }
.card.t2 { color: var(--kb-text); }
/* Readability on the blue card: the big % stays white, small text goes bg-dark and bold. */
.card.t1 .small { color: var(--kb-bg); font-weight: 800; }

.content { position: relative; z-index: 2; height: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.left { min-width: 0; display: flex; }
.pct { font-weight: 800; font-variant-numeric: tabular-nums; }
.label { font-weight: 700; letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.amt { font-weight: 700; flex: none; }

.home .content { padding: 0 18px 8px; }
.home .left { align-items: baseline; gap: 10px; }
.home .pct { font-size: 28px; letter-spacing: -0.05em; line-height: 1; }
.home .label { font-size: 11px; }
.home .amt { font-size: 13px; }

.run .content { padding: 0 20px 12px; }
.run .left { flex-direction: column; gap: 6px; }
.run .pct { font-size: 40px; letter-spacing: -0.055em; line-height: .88; }
.run .label { font-size: 12px; }
.run .amt { font-size: 15px; }

.plan .content { padding: 0 14px 12px 20px; }
.plan .left { flex-direction: column; gap: 8px; }
.plan .pct { font-size: var(--kb-fs-stack); letter-spacing: -0.055em; line-height: var(--kb-lh-stack); }
.plan .label { font-size: 12px; }
.plan .amt { font-size: 15px; }
.right { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; flex: none; }
.btns { display: flex; gap: 6px; }
.step {
  width: 44px; height: 44px; border-radius: 50%; background: transparent; color: inherit;
  border: 1px solid currentColor; border-color: color-mix(in srgb, currentColor 30%, transparent);
  display: grid; place-items: center; cursor: pointer; transition: transform var(--kb-dur-press) var(--kb-ease);
}
@supports not (border-color: color-mix(in srgb, red 30%, transparent)) {
  .step { border-color: rgba(127, 127, 127, .45); }
}
.step:active { transform: scale(var(--kb-press-scale)); }
.card.t1 .step { color: var(--kb-bg); }
</style>
