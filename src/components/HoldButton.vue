<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import Icon from './Icon.vue'
import { useUi } from '../stores/ui'
import { reducedMotion } from '../lib/anim'

// Hold to confirm. The lime fill and the knob move with WAAPI transforms,
// so holding never re-renders anything per frame. Release early and it
// springs back in 200ms. When full: arrow turns into a check, a ripple
// rings out, and `done` fires 520ms later.
const props = withDefaults(defineProps<{
  label: string
  ms?: number
  disabled?: boolean
}>(), { ms: 1200, disabled: false })

const emit = defineEmits<{ done: [], blocked: [e: PointerEvent] }>()
const ui = useUi()

const track = ref<HTMLElement>()
const clip = ref<HTMLElement>()
const inner = ref<HTMLElement>()
const knob = ref<HTMLElement>()
const pressed = ref(false)
const done = ref(false)
const ripple = ref(false)

const KNOB = 52, PAD = 5
let p = 0                        // current progress 0..1
let width = 0
let anims: Animation[] = []
let timer = 0
// live progress, computed from time so nothing needs to tick
let seg: { from: number, to: number, t0: number, ms: number, ease: (k: number) => number } | null = null

const linear = (k: number) => k
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3)

function progressNow(): number {
  if (!seg) return p
  const k = Math.max(0, Math.min(1, (performance.now() - seg.t0) / seg.ms))
  return seg.from + (seg.to - seg.from) * seg.ease(k)
}

function frames(v: number) {
  const knobX = v * (width - KNOB - 2 * PAD)
  return {
    clip: `translateX(${(v - 1) * width}px)`,
    inner: `translateX(${(1 - v) * width}px)`,
    knob: `translateX(${knobX}px)`,
  }
}

function setP(v: number) {
  p = v
  const f = frames(v)
  if (clip.value) clip.value.style.transform = f.clip
  if (inner.value) inner.value.style.transform = f.inner
  if (knob.value) knob.value.style.transform = f.knob
}

function stop() {
  anims.forEach(a => a.cancel())
  anims = []
}

function animateTo(to: number, ms: number, easing: string, ease: (k: number) => number, onEnd: () => void) {
  const from = progressNow()
  stop()
  setP(from)
  const a = frames(from), b = frames(to)
  const opts: KeyframeAnimationOptions = { duration: Math.max(1, ms), easing, fill: 'forwards' }
  anims = [
    clip.value!.animate([{ transform: a.clip }, { transform: b.clip }], opts),
    inner.value!.animate([{ transform: a.inner }, { transform: b.inner }], opts),
    knob.value!.animate([{ transform: a.knob }, { transform: b.knob }], opts),
  ]
  seg = { from, to, t0: performance.now(), ms: Math.max(1, ms), ease }
  anims[0].onfinish = () => {
    seg = null
    setP(to)
    stop()
    onEnd()
  }
}

function down(e: PointerEvent) {
  if (props.disabled) return emit('blocked', e)
  if (done.value) return
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
  catch { /* not capturable */ }
  width = track.value!.offsetWidth
  pressed.value = true
  ui.holding = true
  const from = progressNow()
  animateTo(1, (1 - from) * props.ms, 'linear', linear, complete)
}

function up() {
  if (!pressed.value) return
  pressed.value = false
  ui.holding = false
  if (done.value) return
  if (reducedMotion()) { stop(); seg = null; setP(0); return }
  animateTo(0, 200, 'cubic-bezier(.33,1,.68,1)', easeOut, () => {})
}

function complete() {
  pressed.value = false
  ui.holding = false
  done.value = true
  ripple.value = true
  timer = window.setTimeout(() => {
    done.value = false
    ripple.value = false
    setP(0)
    emit('done')
  }, reducedMotion() ? 150 : 520)
}

onBeforeUnmount(() => { stop(); clearTimeout(timer); if (pressed.value) ui.holding = false })
</script>

<template>
  <div
    v-if="disabled" class="locked" aria-disabled="true" role="button"
    @pointerdown="emit('blocked', $event)"
  >
    <Icon name="lock" :size="18" />{{ label }}
  </div>
  <div v-else class="wrap" :class="{ pressed }">
    <div
      ref="track" class="track" role="button" :aria-label="label"
      @pointerdown="down" @pointerup="up" @pointerleave="up" @pointercancel="up"
    >
      <div class="label">{{ label }}</div>
      <div ref="clip" class="clip">
        <div ref="inner" class="inner"><div class="label on">{{ label }}</div></div>
      </div>
      <div ref="knob" class="knob">
        <span class="ico" :class="{ gone: done }"><Icon name="arrow" :size="22" :stroke="2.4" /></span>
        <span class="ico chk" :class="{ shown: done }"><Icon name="check" :size="24" :stroke="2.8" /></span>
      </div>
    </div>
    <div v-if="ripple" class="ripple" />
  </div>
</template>

<style scoped>
.wrap { position: relative; transition: transform var(--kb-dur-press) var(--kb-ease); }
.wrap.pressed { transform: scale(var(--kb-hold-scale)); }
.track {
  position: relative; height: 64px; border-radius: 999px; background: var(--kb-lime-soft);
  border: 1px solid rgba(200, 240, 74, .35); overflow: hidden; cursor: pointer;
  user-select: none; -webkit-user-select: none; touch-action: none; -webkit-touch-callout: none;
}
.label {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: var(--kb-lime); font-size: 17px; font-weight: 800; padding-left: 40px;
}
.label.on { color: var(--kb-bg); }
.clip { position: absolute; inset: 0; overflow: hidden; transform: translateX(-100%); }
.inner { position: absolute; inset: 0; background: var(--kb-lime); box-shadow: inset 0 0 28px rgba(255, 255, 255, .3); transform: translateX(100%); }
.knob {
  position: absolute; top: 5px; left: 5px; width: 52px; height: 52px; border-radius: 50%;
  background: var(--kb-bg); color: var(--kb-lime); display: grid; place-items: center;
}
.ico { grid-area: 1 / 1; display: grid; transition: opacity 160ms var(--kb-ease), transform 220ms var(--kb-ease); }
.ico.gone { opacity: 0; transform: scale(.4) rotate(-45deg); }
.ico.chk { opacity: 0; transform: scale(.4); }
.ico.chk.shown { opacity: 1; transform: scale(1); }
.ripple {
  position: absolute; inset: 0; border-radius: 999px; border: 2px solid var(--kb-lime); pointer-events: none;
  animation: kbRipple 480ms var(--kb-ease) both;
}
.locked {
  height: 64px; border-radius: 999px; background: var(--kb-surface); border: 1px solid var(--kb-line);
  display: flex; align-items: center; justify-content: center; gap: 10px; color: var(--kb-text-3);
  font-size: 17px; font-weight: 800; cursor: not-allowed; user-select: none;
}
</style>
