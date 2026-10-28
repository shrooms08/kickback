import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { DEPTH, isModal, useNav } from './stores/nav'
import type { ScreenName } from './stores/nav'
import { useWallet } from './stores/wallet'
import { SCREEN_COMPONENTS } from './screens/registry'

export const PATHS: Record<ScreenName, string> = {
  welcome: '/welcome',
  connecting: '/connecting',
  browser: '/open-in-nimiq-pay',
  error: '/error',
  home: '/home',
  homeEmpty: '/start',
  kickbacks: '/kickbacks',
  plan: '/plan',
  pool: '/pool',
  pools: '/pools',
  stake: '/stake',
  approve: '/approve',
  success: '/success',
  run: '/run',
  withdraw: '/withdraw',
  season: '/season',
}

/** Screens that work before a wallet is connected. */
const OPEN: ScreenName[] = ['welcome', 'connecting', 'browser', 'error']

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: PATHS.welcome },
  ...(Object.keys(PATHS) as ScreenName[]).map(name => ({
    path: PATHS[name],
    name,
    // The Stage renders screens itself (it keeps several mounted for layered
    // transitions); the component here documents the mapping.
    component: SCREEN_COMPONENTS[name],
  })),
  { path: '/:pathMatch(.*)*', redirect: PATHS.welcome },
]

// Hash history: the mini app is a static bundle, and `?mock=1` stays in location.search.
export const router = createRouter({ history: createWebHashHistory(), routes })

router.beforeEach((to) => {
  const wallet = useWallet()
  const name = to.name as ScreenName
  if (wallet.env === 'detecting') return name === 'connecting' ? true : { name: 'connecting' }
  if (wallet.env === 'browser') return name === 'browser' ? true : { name: 'browser' }
  if (name === 'browser') return wallet.env === 'mock' ? true : { name: 'welcome' }
  if (!OPEN.includes(name) && !wallet.connected) return { name: 'welcome' }
  return true
})

/**
 * Go to a screen. Pushed screens and modals add a history entry (so the
 * system back gesture pops them); everything else replaces.
 */
export function go(to: ScreenName) {
  const nav = useNav()
  const from = nav.screen
  const deeper = DEPTH[to] != null && (from == null || (DEPTH[from] ?? 0) < DEPTH[to]!)
  const opensModal = isModal(to) && !isModal(from)
  if (deeper || opensModal) return router.push(PATHS[to])
  return router.replace(PATHS[to])
}

/** Back to a screen: pops history if that is where we came from, else replaces. */
export function back(to: ScreenName) {
  const prev = router.options.history.state.back
  if (prev === PATHS[to]) router.back()
  else router.replace(PATHS[to])
}
