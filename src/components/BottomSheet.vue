<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { bindSheetHost, useUi } from '../stores/ui'
import type { SheetKind } from '../stores/ui'
import { anim, release, settleWithin, track, reducedMotion } from '../lib/anim'
import type { Running } from '../lib/anim'
import AddSomeoneSheet from '../screens/sheets/AddSomeoneSheet.vue'
import StopEarningSheet from '../screens/sheets/StopEarningSheet.vue'
import FeesSheet from '../screens/sheets/FeesSheet.vue'
import HelpSheet from '../screens/sheets/HelpSheet.vue'
import DiagnosticsSheet from '../screens/sheets/DiagnosticsSheet.vue'
import SwitchSheet from '../screens/sheets/SwitchSheet.vue'

// Bottom sheets: slide up 320ms, slide down 260ms, drag the handle or title
// down past 25% of the height (or flick) to dismiss. Tap the backdrop to close.
const ui = useUi()
const sheetEl = ref<HTMLElement>()
const backdropEl = ref<HTMLElement>()
const CONTENT = { add: AddSomeoneSheet, stop: StopEarningSheet, fees: FeesSheet, help: HelpSheet, diag: DiagnosticsSheet, switch: SwitchSheet }

let closing = false
let queued: Array<() => void> = []

function open(k: SheetKind) {
  if (ui.sheet === k) return
  const wasOpen = !!ui.sheet
  ui.sheet = k
  if (wasOpen) return
  nextTick(() => {
    const L: Running[] = []
    if (reducedMotion()) {
      anim(L, sheetEl.value, [{ opacity: 0 }, { opacity: 1 }], 180, 'ease')
      anim(L, backdropEl.value, [{ opacity: 0 }, { opacity: 1 }], 180, 'ease')
    }
    else {
      anim(L, sheetEl.value, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0%)' }], 320)
      anim(L, backdropEl.value, [{ opacity: 0 }, { opacity: 1 }], 240, 'ease')
    }
    settleWithin(L).then(() => release(L))
  })
}

function close(after?: () => void) {
  if (!ui.sheet) { after?.(); return }
  if (after) queued.push(after)
  if (closing) return
  closing = true
  const sh = sheetEl.value, bd = backdropEl.value, L: Running[] = []
  const curT = (sh && sh.style.transform) || 'translateY(0px)'
  const curO = bd && bd.style.opacity !== '' ? +bd.style.opacity : 1
  ;[sh, bd].forEach(x => x?.getAnimations().forEach(a => a.cancel()))
  if (reducedMotion()) {
    anim(L, sh, [{ opacity: 1 }, { opacity: 0 }], 180, 'ease')
    anim(L, bd, [{ opacity: curO }, { opacity: 0 }], 180, 'ease')
  }
  else {
    anim(L, sh, [{ transform: curT }, { transform: 'translateY(100%)' }], 260)
    anim(L, bd, [{ opacity: curO }, { opacity: 0 }], 260, 'ease')
  }
  settleWithin(L).then(() => {
    ui.sheet = null
    closing = false
    nextTick(() => {
      const q = queued
      queued = []
      q.forEach(fn => fn())
    })
  })
}

function dragDown(e: PointerEvent) {
  if (reducedMotion() || closing) return
  const target = e.target as HTMLElement
  if (!target.closest('[data-sheet-drag]') || target.closest('button,input')) return
  const sh = sheetEl.value, bd = backdropEl.value
  if (!sh) return
  sh.getAnimations().forEach(a => a.cancel())
  bd?.getAnimations().forEach(a => a.cancel())
  const y0 = e.clientY, H = sh.offsetHeight || 400
  let d = 0, last = { y: y0, t: performance.now() }, prev = last
  const snapBack = () => { sh.style.transform = ''; if (bd) bd.style.opacity = '' }
  track(e.pointerId, (ev) => {
    prev = last; last = { y: ev.clientY, t: performance.now() }
    d = Math.max(0, ev.clientY - y0)
    sh.style.transform = `translateY(${d}px)`
    if (bd) bd.style.opacity = String(Math.max(0, 1 - d / H))
  }, () => {
    const v = (last.y - prev.y) / Math.max(1, last.t - prev.t)
    if (d / H > 0.25 || (v > 0.6 && d > 12)) return close()
    const L: Running[] = []
    anim(L, sh, [{ transform: `translateY(${d}px)` }, { transform: 'translateY(0px)' }], 250)
    anim(L, bd, [{ opacity: Math.max(0, 1 - d / H) }, { opacity: 1 }], 250)
    settleWithin(L).then(() => { snapBack(); release(L) })
  }, snapBack)
}

onMounted(() => bindSheetHost({ open, close }))
onBeforeUnmount(() => bindSheetHost(null))
</script>

<template>
  <template v-if="ui.sheet">
    <div ref="backdropEl" class="backdrop" @click="close()" />
    <div ref="sheetEl" class="sheet" role="dialog" aria-modal="true" @pointerdown="dragDown">
      <div class="handle" data-sheet-drag><div class="grip" /></div>
      <component :is="CONTENT[ui.sheet]" />
    </div>
  </template>
</template>

<style scoped>
.backdrop { position: absolute; inset: 0; z-index: 80; background: var(--kb-scrim); }
.sheet {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 81; border-radius: var(--kb-r-sheet) var(--kb-r-sheet) 0 0;
  background: var(--kb-surface); border-top: 1px solid var(--kb-line);
  padding: 12px 20px calc(28px + var(--kb-safe-bottom)); display: flex; flex-direction: column; gap: 18px;
  box-shadow: var(--kb-sh-sheet); max-height: calc(100% - 24px); overflow-y: auto;
}
.handle { align-self: stretch; height: 32px; margin: -12px -20px -14px; display: grid; place-items: center; cursor: grab; touch-action: none; }
.grip { width: 40px; height: 5px; border-radius: 999px; background: var(--kb-second); }
.sheet :deep([data-sheet-drag]) { touch-action: none; }
</style>
