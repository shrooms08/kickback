<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { isTestnet } from '../lib/net'
import { useRoute } from 'vue-router'
import TabBar from './TabBar.vue'
import Banner from './Banner.vue'
import Toast from './Toast.vue'
import { SCREENS, DEPTH, classify, isModal, isTab, useNav } from '../stores/nav'
import type { ScreenName, TransitionType } from '../stores/nav'
import { useUi } from '../stores/ui'
import { useAccount } from '../stores/account'
import { useFlow } from '../stores/flow'
import { SCREEN_COMPONENTS } from '../screens/registry'
import { anim, longest, release, settleWithin, track } from '../lib/anim'
import { logNav, navlog } from '../lib/navlog'
import type { Running } from '../lib/anim'
import { back } from '../router'
import { clearTimers, goPools, refreshStale, retryOnline } from '../flows'
import { useWallet } from '../stores/wallet'
import { addressShort } from '../lib/format'
import { now, span } from '../lib/time'

// The Stage moves screens. The router decides which screen is current; the
// Stage keeps the screens a transition needs mounted at once (current, the
// one under a modal, the one leaving, the one under a swipe-back) and moves
// them with WAAPI, transform + opacity only:
//   push / pop    340ms, screen below shifts -30% and dims to .35
//   modal in/out  380 / 300ms, screen behind scales to .94 (+28px radius), dims to .40
//   modal swap    220ms crossfade
//   tab           200ms crossfade + 8px
//   other         240ms fade; reduced motion: everything is a 180ms crossfade
// Taps are ignored while anything moves.
const nav = useNav()
const ui = useUi()
const account = useAccount()
const flow = useFlow()
const route = useRoute()
const wallet = useWallet()

const layerEls: Partial<Record<ScreenName, HTMLElement>> = {}
const dimEls: Partial<Record<ScreenName, HTMLElement>> = {}
let chromeEl: HTMLElement | null = null
let pending = false

// ---------- the transition lock ----------
// Held while a transition or gesture moves layers. It always has a deadline:
// a transition releases when its animations finish OR after its duration +
// 150 ms, whichever comes first; a gesture releases on pointerup/cancel, and
// if neither arrives (the host took the touch) a watchdog abandons it after
// 4 s without pointer movement. Unmounting the Stage releases it too.
let running: Running[] = []
/** Which finish() currently owns the lock; a stale one (force-released or superseded) does nothing. */
let activeToken = 0
let tokenSeq = 0
let abandonGesture: (() => void) | null = null
const GESTURE_IDLE_MS = 4000

function lock(reason: string, maxMs: number) {
  navlog.locked = true
  navlog.lockedAt = Date.now()
  navlog.lockReason = reason
  navlog.lockDeadline = Date.now() + maxMs
}
function unlock() {
  navlog.locked = false
  navlog.lockReason = ''
  navlog.lockDeadline = 0
}
const isLocked = () => navlog.locked

/** Last resort: put every layer at rest and drop the lock. */
function forceRelease(why: string) {
  logNav(`lock force-released (${navlog.lockReason || 'unknown'}): ${why}`)
  abandonGesture?.()
  abandonGesture = null
  activeToken = 0
  release(running)
  running = []
  for (const x of [...Object.values(layerEls), ...Object.values(dimEls), chromeEl]) {
    if (!x) continue
    x.getAnimations().forEach(a => a.cancel())
    x.style.transform = ''; x.style.opacity = ''; x.style.borderRadius = ''; x.style.willChange = ''
  }
  nav.$patch({ leaving: null, ltype: null, busy: false, gestureUnder: null })
  unlock()
  pending = false
  const cur = route.name as ScreenName | undefined
  if (cur && cur !== nav.screen) request(cur)
}

let watchdog = 0
onMounted(() => {
  watchdog = window.setInterval(() => {
    if (navlog.locked && navlog.lockDeadline && Date.now() > navlog.lockDeadline) forceRelease('deadline passed')
    // The busy flag must never outlive the lock (it drives the tap guard).
    else if (!navlog.locked && nav.busy) { logNav('busy flag cleared without a lock'); nav.busy = false }
  }, 250)
})
onBeforeUnmount(() => {
  clearInterval(watchdog)
  abandonGesture?.()
  release(running)
  unlock()
})
/** After a gesture the Stage is already on this screen; the router catches up asynchronously. */
let expect: ScreenName | null = null

function syncRouter(to: ScreenName) {
  expect = to
  back(to)
  // If the router never moves (already there, or navigation aborted), stop waiting.
  setTimeout(() => {
    if (expect !== to) return
    expect = null
    const cur = route.name as ScreenName | undefined
    if (cur && cur !== nav.screen) request(cur)
  }, 600)
}

function setLayer(n: ScreenName, el: unknown) { if (el) layerEls[n] = el as HTMLElement; else delete layerEls[n] }
function setDim(n: ScreenName, el: unknown) { if (el) dimEls[n] = el as HTMLElement; else delete dimEls[n] }
function setChrome(el: unknown) { chromeEl = (el as HTMLElement) || null }

// ---------- banner (pushes the layers down) ----------
const banner = computed(() => {
  const scr = nav.screen
  if (!scr) return null
  const noBanner = scr === 'welcome' || scr === 'browser' || scr === 'connecting'
  if (account.offline && !noBanner) return { kind: 'offline' as const, text: 'You\'re offline. Nothing was sent. We\'ll update when you\'re back.', label: 'Retry', act: retryOnline }
  const mins = wallet.isMock ? 14 : account.staleMin
  if (account.stale && isTab(scr)) return { kind: 'stale' as const, text: account.refreshing ? 'Refreshing…' : `Showing data from ${mins >= 120 ? `${Math.round(mins / 60)}h` : `${mins} min`} ago`, label: account.refreshing ? 'Wait' : 'Refresh', act: refreshStale }
  if (account.poolDown && (scr === 'home' || scr === 'pool')) {
    const silent = wallet.isMock || !account.poolLastPaidAt ? '2 days' : span(now.value - account.poolLastPaidAt)
    return { kind: 'pool' as const, text: `${account.poolName} hasn't paid in ${silent}`, label: 'Switch pool', act: goPools }
  }
  return null
})
// Preview (read-only view of another address): a persistent strip above everything.
// Dry run (simulated sends) uses the same strip when not previewing.
const previewOn = computed(() => (wallet.isPreview || wallet.isDry) && !!nav.screen && !['welcome', 'browser', 'connecting'].includes(nav.screen))
const previewText = computed(() => wallet.isPreview ? `Preview: ${addressShort(wallet.previewAddress)} (read only)` : 'Dry run: no real NIM moves')
// Testnet: its own strip on every screen, above the preview / dry-run strip.
const testnetOn = isTestnet
const strips = computed(() => (testnetOn ? 1 : 0) + (previewOn.value ? 1 : 0))
const stripsH = computed(() => strips.value === 2 ? 'var(--kb-preview-h) * 2' : 'var(--kb-preview-h)')
const layerTop = computed(() => {
  const parts = ['var(--kb-safe-top)']
  if (strips.value) parts.push(stripsH.value)
  if (banner.value) parts.push('var(--kb-banner-push)')
  return parts.length > 1 ? `calc(${parts.join(' + ')})` : parts[0]
})
const bannerTop = computed(() => strips.value ? `calc(var(--kb-safe-top) + ${stripsH.value} + 4px)` : 'calc(var(--kb-safe-top) + 4px)')

// ---------- layer placement ----------
function zOf(n: ScreenName): number {
  if (n === nav.screen) return isModal(n) ? 50 : 30
  if (n === nav.base || n === nav.gestureUnder) return 10
  if (n === nav.leaving) return ({ push: 10, pop: 40, tab: 20, fade: 20, modalOut: 60, modalSwap: 40, modalIn: 20 } as Record<TransitionType, number>)[nav.ltype ?? 'fade'] ?? 20
  return 0
}
function restOf(n: ScreenName) {
  if (n === nav.base && isModal(nav.screen) && !ui.rm) return { tf: 'scale(.94)', r: '28px', dim: 0.4 }
  if (n === nav.gestureUnder) return { tf: 'translateX(-30%)', r: '0px', dim: 0.35 }
  return { tf: 'none', r: '0px', dim: 0 }
}
const layers = computed(() => SCREENS.filter(n => nav.mounted.has(n)).map((n) => {
  const z = zOf(n), r = restOf(n)
  return { n, z, tf: r.tf, r: r.r, dim: r.dim, pe: n === nav.screen && !nav.busy ? 'auto' : 'none' }
}))
const chrome = computed(() => {
  const own = nav.chromeOwner
  if (!own) return null
  const r = restOf(own)
  return { z: zOf(own) + 1, tf: r.tf, r: r.r }
})
const edgeOn = computed(() => !nav.busy && !nav.gestureUnder && !ui.rm && !ui.sheet && !!(nav.screen && DEPTH[nav.screen]))
// On tab screens the toast sits above the lime button (bar 18 + 68, button pokes up 26).
const toastBottom = computed(() => `calc(${isTab(nav.screen) ? 124 : 96}px + var(--kb-safe-bottom))`)

// ---------- route -> transition ----------
watch(() => route.name as ScreenName | undefined, (to) => { if (to) request(to) }, { immediate: true })

function request(to: ScreenName) {
  if (expect) {
    if (to !== expect) { logNav(`route ${to} ignored (syncing to ${expect})`); return }
    expect = null
  }
  if (isLocked()) { pending = true; logNav(`route ${to} queued (locked: ${navlog.lockReason})`); return }
  const from = nav.screen
  if (to === from) return
  if (!from) { nav.screen = to; logNav(`start on ${to}`); return }
  if (ui.sheet) ui.closeSheet()
  const type = classify(from, to)
  let base: ScreenName | null = null
  let leaving: ScreenName | null = from
  if (type === 'modalIn') { base = from; leaving = null }
  else if (type === 'modalSwap') base = from === 'approve' && to === 'success' ? 'home' : nav.base
  if (to === 'pools' && isTab(from)) nav.poolsFrom = from
  lock(`${type} ${from}→${to}`, 1000)
  logNav(`${type} ${from}→${to}`)
  nav.$patch({ screen: to, base, leaving, ltype: type, busy: true, gestureUnder: null })
  nextTick(() => runTransition(type, from, to))
}

function finish(L: Running[], patch: Partial<{ screen: ScreenName, base: ScreenName | null, leaving: ScreenName | null, ltype: TransitionType | null, gestureUnder: ScreenName | null, busy: boolean }>, after?: () => void) {
  running = L
  abandonGesture = null
  const token = activeToken = ++tokenSeq
  // Deadline = longest animation + 150 ms (plus a margin for the watchdog).
  if (navlog.locked) navlog.lockDeadline = Date.now() + longest(L) + 600
  settleWithin(L).then((how) => {
    if (how === 'timeout') logNav(`animations did not report finished; released after ${longest(L) + 150} ms`)
    if (token !== activeToken) return // force-released or superseded
    nav.$patch({ leaving: null, ltype: null, busy: false, ...patch })
    nextTick(() => {
      release(L)
      running = []
      unlock()
      after?.()
      if (expect) { pending = false; return }
      const cur = route.name as ScreenName | undefined
      if (pending || (cur && cur !== nav.screen)) { pending = false; if (cur) request(cur) }
    })
  })
}

function runTransition(type: TransitionType, from: ScreenName, to: ScreenName) {
  const L: Running[] = []
  const el = (n: ScreenName) => layerEls[n], dm = (n: ScreenName) => dimEls[n]
  const own = nav.chromeOwner, ch = chromeEl
  const A = (e: HTMLElement | null | undefined, f: Keyframe[], ms: number, easing?: string) => anim(L, e, f, ms, easing)
  const F = (a: number, b: number) => [{ opacity: a }, { opacity: b }]
  const tabShift = isTab(to) !== isTab(from)

  if (ui.rm) {
    A(el(to), F(0, 1), 180, 'ease')
    if (type !== 'modalIn') A(el(from), F(1, 0), 180, 'ease')
    if (ch && tabShift && type !== 'modalIn' && type !== 'modalOut') A(ch, isTab(to) ? F(0, 1) : F(1, 0), 180, 'ease')
  }
  else if (type === 'push') {
    const outF = [{ transform: 'translateX(0%)' }, { transform: 'translateX(-30%)' }]
    A(el(to), [{ transform: 'translateX(100%)' }, { transform: 'translateX(0%)' }], 340)
    A(el(from), outF, 340)
    A(dm(from), [{ transform: 'translateX(0%)', opacity: 0 }, { transform: 'translateX(-30%)', opacity: 0.35 }], 340)
    if (ch && own === from) A(ch, outF, 340)
  }
  else if (type === 'pop') {
    const inF = [{ transform: 'translateX(-30%)' }, { transform: 'translateX(0%)' }]
    A(el(to), inF, 340)
    A(dm(to), [{ transform: 'translateX(-30%)', opacity: 0.35 }, { transform: 'translateX(0%)', opacity: 0 }], 340)
    A(el(from), [{ transform: 'translateX(0%)' }, { transform: 'translateX(100%)' }], 340)
    if (ch && own === to) A(ch, inF, 340)
  }
  else if (type === 'modalIn') {
    // Corner radius is set at the start (not animated): only transform/opacity move.
    const bF = [{ transform: 'scale(1)' }, { transform: 'scale(.94)' }]
    A(el(to), [{ transform: 'translateY(100%)' }, { transform: 'translateY(0%)' }], 380)
    A(el(from), bF, 380)
    A(dm(from), [{ ...bF[0], opacity: 0 }, { ...bF[1], opacity: 0.4 }], 380)
    if (ch && own === from) A(ch, bF, 380)
  }
  else if (type === 'modalOut') {
    // Corners go square as it starts, so nothing snaps when it lands full size.
    const bF = [{ transform: 'scale(.94)' }, { transform: 'scale(1)' }]
    A(el(from), [{ transform: 'translateY(0%)' }, { transform: 'translateY(100%)' }], 300)
    A(el(to), bF, 300)
    A(dm(to), [{ ...bF[0], opacity: 0.4 }, { ...bF[1], opacity: 0 }], 300)
    if (ch && own === to) A(ch, bF, 300)
  }
  else if (type === 'modalSwap') {
    A(el(to), F(0, 1), 220, 'ease')
    A(el(from), F(1, 0), 220, 'ease')
  }
  else if (type === 'tab') {
    A(el(from), [{ opacity: 1, transform: 'translateY(0px)' }, { opacity: 0, transform: 'translateY(8px)' }], 200)
    A(el(to), [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'translateY(0px)' }], 200)
  }
  else {
    A(el(to), F(0, 1), 240, 'ease')
    A(el(from), F(1, 0), 240, 'ease')
    if (ch && tabShift) A(ch, isTab(to) ? F(0, 1) : F(1, 0), 240, 'ease')
  }
  finish(L, {})
}

// ---------- left-edge swipe back (pushed screens) ----------
function edgeDown(e: PointerEvent) {
  if (nav.busy || nav.gestureUnder || isLocked() || ui.rm || !nav.screen || !DEPTH[nav.screen]) return
  const top = nav.screen
  const under: ScreenName = top === 'stake' ? 'pools' : (nav.poolsFrom || 'homeEmpty')
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
  catch { /* ignore */ }
  const x0 = e.clientX
  let last = { x: x0, t: performance.now() }, prev = last, dx = 0
  lock('edge swipe', GESTURE_IDLE_MS)
  logNav('edge swipe started')
  nav.gestureUnder = under
  const parts = () => ({ t: layerEls[top], u: layerEls[under], ud: dimEls[under], ch: nav.chromeOwner === under ? chromeEl : null })
  const W = () => layerEls[top]?.offsetWidth || 390
  const abandon = () => {
    // Its end never came and a new touch started: put everything back, no animation, no tap guard.
    ;[layerEls[top], layerEls[under], dimEls[under], chromeEl].forEach((x) => { if (x) { x.style.transform = ''; x.style.opacity = '' } })
    nav.gestureUnder = null
    abandonGesture = null
    unlock()
    logNav('edge swipe abandoned (no pointerup; a new touch started)')
  }
  const stop = track(e.pointerId, (ev) => {
    navlog.lockDeadline = Date.now() + GESTURE_IDLE_MS
    prev = last; last = { x: ev.clientX, t: performance.now() }
    dx = Math.max(0, ev.clientX - x0)
    const p = Math.min(1, dx / W()), P = parts(), ut = `translateX(${(-30 * (1 - p)).toFixed(2)}%)`
    if (P.t) P.t.style.transform = `translateX(${dx}px)`
    ;[P.u, P.ud, P.ch].forEach((x) => { if (x) x.style.transform = ut })
    if (P.ud) P.ud.style.opacity = (0.35 * (1 - p)).toFixed(3)
  }, () => {
    const p = Math.min(1, dx / W()), v = (last.x - prev.x) / Math.max(1, last.t - prev.t), P = parts(), L: Running[] = []
    const ut = `translateX(${(-30 * (1 - p)).toFixed(2)}%)`
    const done = p > 0.35 || (v > 0.5 && dx > 12)
    // Only a completed swipe navigates, so only it raises the tap guard; a snap-back never eats taps.
    if (done) nav.busy = true
    const clearInline = () => [P.t, P.u, P.ud, P.ch].forEach((x) => { if (x) { x.style.transform = ''; x.style.opacity = '' } })
    if (done) {
      const d = Math.max(140, 340 * (1 - p)), uF = [{ transform: ut }, { transform: 'translateX(0%)' }]
      anim(L, P.t, [{ transform: `translateX(${dx}px)` }, { transform: 'translateX(100%)' }], d)
      anim(L, P.u, uF, d); anim(L, P.ch, uF, d)
      anim(L, P.ud, [{ transform: ut, opacity: 0.35 * (1 - p) }, { transform: 'translateX(0%)', opacity: 0 }], d)
      finish(L, { screen: under, base: null, gestureUnder: null }, () => { clearInline(); syncRouter(under) })
    }
    else {
      const uF = [{ transform: ut }, { transform: 'translateX(-30%)' }]
      anim(L, P.t, [{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0px)' }], 250)
      anim(L, P.u, uF, 250); anim(L, P.ch, uF, 250)
      anim(L, P.ud, [{ transform: ut, opacity: 0.35 * (1 - p) }, { transform: 'translateX(-30%)', opacity: 0.35 }], 250)
      finish(L, { gestureUnder: null }, clearInline)
    }
  }, abandon)
  abandonGesture = () => { stop(); abandon() }
}

// ---------- drag a modal down from its top 80px ----------
function modalDown(e: PointerEvent) {
  const scr = nav.screen
  if (!scr || nav.busy || isLocked() || ui.rm || !isModal(scr) || ui.sheet) return
  if (scr === 'approve' || ui.holding || (scr === 'run' && flow.steps.some(x => x.st === 'waiting'))) return
  if ((e.target as HTMLElement).closest('button,input')) return
  const mEl = layerEls[scr]
  if (!mEl) return
  const rect = mEl.getBoundingClientRect()
  if (e.clientY - rect.top > 80) return
  const y0 = e.clientY, H = rect.height, base = nav.base
  let active = false, d = 0, last = { y: y0, t: performance.now() }, prev = last
  const parts = () => ({ m: mEl, b: base ? layerEls[base] : null, bd: base ? dimEls[base] : null, ch: base && nav.chromeOwner === base ? chromeEl : null })
  const abandon = () => {
    if (!active) return
    ;[mEl, base ? layerEls[base] : null, base ? dimEls[base] : null, chromeEl].forEach((x) => { if (x) { x.style.transform = ''; x.style.opacity = ''; x.style.borderRadius = '' } })
    abandonGesture = null
    unlock()
    logNav('modal drag abandoned (no pointerup; a new touch started)')
  }
  const stop = track(e.pointerId, (ev) => {
    const dy = ev.clientY - y0
    // Taps never start a drag: only a real downward move (> 6 px) takes the lock.
    if (!active) { if (dy > 6) { active = true; lock('modal drag', GESTURE_IDLE_MS); logNav('modal drag started'); abandonGesture = () => { stop(); abandon() } } else return }
    navlog.lockDeadline = Date.now() + GESTURE_IDLE_MS
    prev = last; last = { y: ev.clientY, t: performance.now() }; d = Math.max(0, dy)
    const p = d / H, P = parts(), sc = `scale(${(0.94 + 0.06 * p).toFixed(4)})`
    P.m.style.transform = `translateY(${d}px)`
    ;[P.b, P.bd, P.ch].forEach((x) => { if (x) x.style.transform = sc })
    if (P.bd) P.bd.style.opacity = (0.4 * (1 - p)).toFixed(3)
  }, () => {
    if (!active) return
    const p = d / H, v = (last.y - prev.y) / Math.max(1, last.t - prev.t), P = parts(), L: Running[] = []
    const cur = { transform: `scale(${(0.94 + 0.06 * p).toFixed(4)})` }
    nav.busy = true
    const clearInline = () => [P.m, P.b, P.bd, P.ch].forEach((x) => { if (x) { x.style.transform = ''; x.style.opacity = ''; x.style.borderRadius = '' } })
    if (p > 0.25 || v > 0.6) {
      const dur = Math.max(140, 300 * (1 - p)), bF = [cur, { transform: 'scale(1)' }]
      ;[P.b, P.bd, P.ch].forEach((x) => { if (x) x.style.borderRadius = '0px' })
      anim(L, P.m, [{ transform: `translateY(${d}px)` }, { transform: 'translateY(100%)' }], dur)
      anim(L, P.b, bF, dur); anim(L, P.ch, bF, dur)
      anim(L, P.bd, [{ ...cur, opacity: 0.4 * (1 - p) }, { ...bF[1], opacity: 0 }], dur)
      const dest = base || 'home'
      clearTimers()
      finish(L, { screen: dest, base: null }, () => { clearInline(); syncRouter(dest) })
    }
    else {
      const bF = [cur, { transform: 'scale(.94)' }]
      anim(L, P.m, [{ transform: `translateY(${d}px)` }, { transform: 'translateY(0px)' }], 250)
      anim(L, P.b, bF, 250); anim(L, P.ch, bF, 250)
      anim(L, P.bd, [{ ...cur, opacity: 0.4 * (1 - p) }, { ...bF[1], opacity: 0.4 }], 250)
      finish(L, {}, clearInline)
    }
  })
}
</script>

<template>
  <div class="stage" :style="{ '--layer-top': layerTop }">
    <div class="backdrop" />
    <template v-for="l in layers" :key="l.n">
      <div
        :ref="el => setLayer(l.n, el)" class="layer" :data-kb-layer="l.n"
        :style="{ zIndex: l.z, transform: l.tf, borderRadius: l.r, pointerEvents: l.pe as 'auto' | 'none' }"
        @pointerdown="l.n === nav.screen && isModal(l.n) ? modalDown($event) : undefined"
      >
        <component :is="SCREEN_COMPONENTS[l.n]" />
      </div>
      <div :ref="el => setDim(l.n, el)" class="dim" :style="{ zIndex: l.z + 2, transform: l.tf, borderRadius: l.r, opacity: l.dim }" />
    </template>

    <div v-if="testnetOn" class="preview testnet" role="status" data-kb="testnet-strip"><span class="pdot" />Testnet: test NIM only</div>
    <div v-if="previewOn" class="preview" :class="{ dry: !wallet.isPreview }" :style="testnetOn ? { top: 'calc(var(--kb-safe-top) + var(--kb-preview-h))' } : undefined" role="status"><span class="pdot" />{{ previewText }}</div>
    <Banner v-if="banner" :kind="banner.kind" :text="banner.text" :label="banner.label" :style="{ top: bannerTop }" @act="banner.act()" />

    <div v-if="chrome" :ref="setChrome" class="chrome" :style="{ zIndex: chrome.z, transform: chrome.tf, borderRadius: chrome.r }">
      <TabBar />
    </div>

    <div v-if="edgeOn" class="edge" @pointerdown="edgeDown" />
    <Toast :bottom="toastBottom" />
    <div class="top-cover" />
    <div v-if="nav.busy" class="guard" />
  </div>
</template>

<style scoped>
.stage { position: absolute; inset: 0; overflow: hidden; background: var(--kb-bg); }
.backdrop { position: absolute; top: var(--layer-top); left: 0; right: 0; bottom: 0; background: var(--kb-backdrop); }
.layer {
  position: absolute; top: var(--layer-top); left: 0; right: 0; bottom: 0; overflow: hidden;
  background: var(--kb-bg); transform-origin: 50% 50%; box-shadow: var(--kb-sh-layer);
}
.dim { position: absolute; top: var(--layer-top); left: 0; right: 0; bottom: 0; transform-origin: 50% 50%; background: #000; pointer-events: none; }
.chrome { position: absolute; top: var(--layer-top); left: 0; right: 0; bottom: 0; transform-origin: 50% 50%; overflow: hidden; pointer-events: none; }
.edge { position: absolute; top: var(--layer-top); left: 0; bottom: 0; width: 20px; z-index: 45; touch-action: none; }
.top-cover { position: absolute; top: 0; left: 0; right: 0; height: var(--kb-safe-top); background: var(--kb-bg); z-index: 60; }
.guard { position: absolute; inset: 0; z-index: 95; }
.preview {
  position: absolute; top: var(--kb-safe-top); left: 0; right: 0; height: var(--kb-preview-h); z-index: 61;
  display: flex; align-items: center; justify-content: center; gap: 8px; background: var(--kb-raised);
  border-bottom: 1px solid var(--kb-line); font-size: 12px; font-weight: 700; color: var(--kb-text-2); letter-spacing: .02em;
}
.pdot { width: 6px; height: 6px; border-radius: 50%; background: var(--kb-second); }
.preview.dry { color: var(--kb-lime); }
.preview.dry .pdot { background: var(--kb-lime); }
.preview.testnet { color: var(--kb-third); background: color-mix(in srgb, var(--kb-third) 14%, var(--kb-raised)); }
.preview.testnet .pdot { background: var(--kb-third); }
</style>
