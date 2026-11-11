import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './design/global.css'
import './design/skins.css'
import App from './App.vue'
import { router } from './router'
import { useWallet } from './stores/wallet'
import { useAccount } from './stores/account'
import { captureRef } from './lib/ref'

const app = createApp(App)
app.use(createPinia())

// Decide the environment before the router picks the first screen:
// mock (dev ?mock=1), inside Nimiq Pay (host context present), or unknown yet.
const wallet = useWallet()
wallet.primeEnv()
// ?ref=KICK-XXXX on the first open: kept for Welcome and the claim after sign-in.
captureRef()
if (wallet.isMock) {
  // Dev convenience: reloading on an app screen keeps you there with the fake wallet.
  const path = window.location.hash.replace(/^#/, '')
  if (path && !['/', '/welcome', '/connecting', '/error'].includes(path)) {
    wallet.useMockAccount()
    useAccount().staked = !['/start', '/pools', '/stake'].includes(path)
  }
}

app.use(router)
app.mount('#app')
