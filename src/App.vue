<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Stage from './components/Stage.vue'
import BottomSheet from './components/BottomSheet.vue'
import { useUi } from './stores/ui'
import { useAccount } from './stores/account'
import { useWallet } from './stores/wallet'
import { router } from './router'
import { bindFxLayer } from './lib/fx'

// Dev panel: only in dev builds with ?mock=1. Never part of a production bundle.
const DevPanel = import.meta.env.DEV ? defineAsyncComponent(() => import('./dev/DevPanel.vue')) : null

const ui = useUi()
const account = useAccount()
const wallet = useWallet()
const fx = ref<HTMLElement>()

// prefers-reduced-motion: every transition becomes a 180ms crossfade
const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
const applyRm = () => { ui.rm = !!mq?.matches }
watch(() => ui.rm, rm => document.documentElement.setAttribute('data-kb-rm', rm ? '1' : '0'), { immediate: true })

// numbers dim when data is stale
watch(() => account.stale, s => document.documentElement.style.setProperty('--kb-numc', s ? 'var(--kb-text-2)' : 'currentColor'), { immediate: true })

const onOnline = () => { account.offline = false }
const onOffline = () => { account.offline = true }

onMounted(async () => {
  applyRm()
  mq?.addEventListener?.('change', applyRm)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  bindFxLayer(fx.value || null)
  // Not sure yet if we're inside Nimiq Pay: wait for the provider (3s max).
  if (wallet.env === 'detecting') {
    const env = await wallet.detect()
    router.replace(env === 'nimiqpay' ? '/welcome' : '/open-in-nimiq-pay')
  }
})

onBeforeUnmount(() => {
  mq?.removeEventListener?.('change', applyRm)
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  bindFxLayer(null)
})
</script>

<template>
  <div class="shell">
    <main class="app">
      <Stage />
      <div ref="fx" class="fx" />
      <BottomSheet />
    </main>
    <component :is="DevPanel" v-if="DevPanel && wallet.isMock" />
  </div>
</template>

<style scoped>
.shell { position: fixed; inset: 0; display: flex; justify-content: center; align-items: stretch; gap: 32px; background: var(--kb-page); }
.app { position: relative; width: 100%; max-width: var(--kb-app-max); height: 100%; overflow: hidden; background: var(--kb-bg); isolation: isolate; }
.fx { position: absolute; inset: 0; pointer-events: none; z-index: 75; overflow: hidden; }
</style>
