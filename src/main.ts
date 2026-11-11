// Entry: resolve the Nimiq network first, then load the app. Only src/lib/net.ts is imported
// statically here, so every module that reads the network at import time (RPC pool, storage
// prefix, genesis block) is evaluated after applyNetwork. See src/lib/net.ts.
import { applyNetwork, net, parseNetwork, resolveNetwork, watchLateHost } from './lib/net'
import type { Network } from './lib/net'

const LATE_KEY = 'kb-net-late'
const RELOADED_KEY = 'kb-net-reloaded'

function session(key: string, value?: string): string | null {
  try {
    if (value !== undefined) sessionStorage.setItem(key, value)
    return sessionStorage.getItem(key)
  }
  catch (error) { console.warn('[kickback] sessionStorage:', error); return null }
}

// Dev desktop modes (?mock=1, ?preview=, ?wallet=) have no host to wait for.
const noHost = import.meta.env.DEV && /[?&](mock|preview|wallet)=/.test(location.search)
// A network that arrived late in an earlier load of this session is the default now.
const hint = parseNetwork(session(LATE_KEY))

void resolveNetwork({ waitMs: noHost ? 0 : undefined, fallback: hint ?? undefined }).then((picked) => {
  applyNetwork(picked)
  if (!picked.reported && !noHost) {
    // The host may still seed its network later: if it then says another network, reload once.
    watchLateHost((n: Network) => {
      if (n === net.network) { Object.assign(net, { source: 'Nimiq Pay host (late, after start)', reported: true }); return }
      console.warn(`[kickback] network: host reported ${n} after start on ${net.network}; reloading`)
      session(LATE_KEY, n)
      // Start over from Welcome (without the #/route): after a reload on an app screen nothing
      // would connect again.
      if (session(RELOADED_KEY) !== '1') { session(RELOADED_KEY, '1'); location.replace(location.href.split('#')[0]) }
    })
  }
  return import('./boot')
})
