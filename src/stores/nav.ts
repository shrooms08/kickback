import { defineStore } from 'pinia'

export type ScreenName =
  | 'welcome' | 'connecting' | 'browser' | 'error'
  | 'home' | 'homeEmpty' | 'kickbacks' | 'plan' | 'pool'
  | 'pools' | 'stake' | 'season'
  | 'approve' | 'success' | 'run' | 'withdraw'

/** Render order. Stacking is decided by z-index, so this just keeps DOM order stable. */
export const SCREENS: ScreenName[] = ['welcome', 'home', 'homeEmpty', 'pools', 'stake', 'approve', 'success', 'kickbacks', 'plan', 'run', 'withdraw', 'pool', 'season', 'browser', 'connecting', 'error']

/** Full-screen modals slide up over the screen they came from. */
export const MODALS: ScreenName[] = ['run', 'approve', 'success', 'withdraw']
/** Tab screens crossfade and own the tab bar. */
export const TABS: ScreenName[] = ['home', 'homeEmpty', 'kickbacks', 'plan', 'pool']
/** Pushed screens slide in from the right and can be swiped back. */
export const DEPTH: Partial<Record<ScreenName, number>> = { pools: 1, stake: 2, season: 1 }

export type TransitionType = 'push' | 'pop' | 'modalIn' | 'modalOut' | 'modalSwap' | 'tab' | 'fade'

export const isModal = (n: ScreenName | null) => !!n && MODALS.includes(n)
export const isTab = (n: ScreenName | null) => !!n && TABS.includes(n)
export function depth(n: ScreenName | null): number | null {
  if (!n) return null
  if (DEPTH[n] != null) return DEPTH[n]!
  return isTab(n) ? 0 : null
}

export function classify(from: ScreenName, to: ScreenName): TransitionType {
  if (isModal(to) && !isModal(from)) return 'modalIn'
  if (isModal(from) && isModal(to)) return 'modalSwap'
  if (isModal(from)) return to === 'error' ? 'fade' : 'modalOut'
  if (isTab(from) && isTab(to)) return 'tab'
  const df = depth(from), dt = depth(to)
  if (df != null && dt != null) return dt > df ? 'push' : 'pop'
  return 'fade'
}

/**
 * Layer state for the Stage. The router holds the URL; the Stage moves the
 * layers. Several screens can be mounted at once: the current one, the one
 * under a modal (base), the one leaving, and the one under a swipe-back.
 */
export const useNav = defineStore('nav', {
  state: () => ({
    screen: null as ScreenName | null,
    base: null as ScreenName | null,
    leaving: null as ScreenName | null,
    ltype: null as TransitionType | null,
    gestureUnder: null as ScreenName | null,
    busy: false,
    /** The tab that "Choose a pool" was opened from, for back and swipe-back. */
    poolsFrom: 'homeEmpty' as ScreenName,
    /** The tab the Season screen was opened from. */
    seasonFrom: 'home' as ScreenName,
  }),
  getters: {
    mounted(s): Set<ScreenName> {
      return new Set([s.screen, s.base, s.leaving, s.gestureUnder].filter(Boolean) as ScreenName[])
    },
    /** The tab screen that currently owns the tab bar, if any. */
    chromeOwner(s): ScreenName | null {
      return [s.screen, s.base, s.leaving, s.gestureUnder].find(n => n && isTab(n)) || null
    },
  },
})
