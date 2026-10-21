<script setup lang="ts">
import KLogo from '../components/KLogo.vue'
import CopySwap from '../components/CopySwap.vue'
import { useCopy } from '../lib/copy'

// Shown when Kickback is opened outside Nimiq Pay.
const { copied, copy } = useCopy()
function copyLink() {
  const url = new URL(window.location.href)
  url.hash = ''
  copy('link', url.toString())
}
</script>

<template>
  <div class="kb-scroll">
    <div class="page">
      <div class="main">
        <KLogo :size="56" />
        <h1 class="kb-h1">Open Kickback inside Nimiq Pay</h1>
        <p class="lead">Kickback runs inside your Nimiq Pay wallet, so you approve every payment yourself.</p>
        <div class="steps">
          <div class="kb-how"><div class="kb-step-num">1</div><div>Open the Nimiq Pay app</div></div>
          <div class="kb-how"><div class="kb-step-num">2</div><div>Find Kickback in its apps list</div></div>
          <div class="kb-how"><div class="kb-step-num">3</div><div>Or paste this link there</div></div>
        </div>
      </div>
      <button class="kb-btn kb-btn-primary" @click="copyLink"><CopySwap :copied="copied === 'link'" />Copy link</button>
    </div>
  </div>
</template>

<style scoped>
.page { min-height: 100%; padding: 24px 24px calc(28px + var(--kb-safe-bottom)); display: flex; flex-direction: column; gap: 28px; }
.main { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 24px; }
.lead { font-size: 16px; line-height: 1.45; color: var(--kb-text-2); text-wrap: pretty; }
.steps { display: flex; flex-direction: column; gap: 10px; }
</style>
