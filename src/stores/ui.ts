import { defineStore } from 'pinia'

export type SheetKind = 'add' | 'stop' | 'fees' | 'help' | 'diag'
export type HelpCtx = 'stake' | 'switch' | 'unstake' | 'run' | 'fees' | 'network' | 'general'

export interface ToastData {
  id: number
  msg: string
  action: string
  fn: (() => void) | null
  undo: boolean
}

export interface ToastOptions { action?: string, fn?: () => void, undo?: boolean }

/** SheetHost registers its animated open/close here. */
interface SheetHost {
  open: (k: SheetKind) => void
  close: (after?: () => void) => void
}
let sheetHost: SheetHost | null = null
export function bindSheetHost(host: SheetHost | null) { sheetHost = host }

let toastTimer = 0
let toastOutTimer = 0
let toastSeq = 0

export const TOAST_MS = 4000
export const TOAST_UNDO_MS = 6000

export const useUi = defineStore('ui', {
  state: () => ({
    toast: null as ToastData | null,
    toastOut: false,
    /** Which sheet is mounted (stays set until its close animation ends). */
    sheet: null as SheetKind | null,
    helpCtx: 'general' as HelpCtx,
    /** prefers-reduced-motion: every transition becomes a 180ms crossfade. */
    rm: false,
    /** A hold-to-confirm button is pressed; blocks drag-to-dismiss. */
    holding: false,
  }),
  actions: {
    showToast(msg: string, opts: ToastOptions = {}) {
      clearTimeout(toastTimer); clearTimeout(toastOutTimer)
      const t: ToastData = { id: ++toastSeq, msg, action: opts.action || (opts.undo ? 'Undo' : ''), fn: opts.fn || null, undo: !!opts.undo }
      this.toast = t
      this.toastOut = false
      toastTimer = window.setTimeout(() => this.hideToast(), t.undo ? TOAST_UNDO_MS : TOAST_MS)
    },
    hideToast() {
      clearTimeout(toastTimer); clearTimeout(toastOutTimer)
      if (!this.toast) return
      this.toastOut = true
      toastOutTimer = window.setTimeout(() => { this.toast = null; this.toastOut = false }, 220)
    },
    toastAction() {
      const t = this.toast
      this.hideToast()
      t?.fn?.()
    },
    openSheet(k: SheetKind) {
      if (sheetHost) sheetHost.open(k)
    },
    closeSheet(after?: () => void) {
      if (sheetHost && this.sheet) sheetHost.close(after)
      else after?.()
    },
    openHelp(ctx: HelpCtx) {
      const open = () => { this.helpCtx = ctx; this.openSheet('help') }
      if (this.sheet) this.closeSheet(open)
      else open()
    },
    comingSoon() {
      this.showToast('Coming in phase 3')
    },
  },
})
