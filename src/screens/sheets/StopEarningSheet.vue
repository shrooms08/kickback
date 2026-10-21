<script setup lang="ts">
import { useUi } from '../../stores/ui'
import { useAccount } from '../../stores/account'
import { int0 } from '../../lib/format'
import { confirmStop } from '../../flows'

const ui = useUi()
const a = useAccount()
</script>

<template>
  <h2 class="sheet-h" data-sheet-drag>Stop earning?</h2>
  <div class="list">
    <div class="item"><span class="n">1</span><span>Unstaking isn't instant. Your {{ int0(a.stakedNim) }} NIM unlocks after a waiting period.</span></div>
    <div class="item"><span class="n">2</span><span>You'll approve a few steps in Nimiq Pay: one to stop, one to move your NIM back.</span></div>
    <div class="item"><span class="n">3</span><span>Kickbacks stop once you start. We'll remind you when it's ready.</span></div>
  </div>
  <button class="kb-btn kb-btn-primary" @click="ui.closeSheet()">Keep earning</button>
  <button class="kb-btn kb-btn-danger" @click="confirmStop">Stop earning</button>
</template>

<style scoped>
.sheet-h { font-size: 32px; line-height: .95; font-weight: 900; text-transform: uppercase; letter-spacing: -0.02em; }
.list { display: flex; flex-direction: column; gap: 12px; }
.item { display: flex; gap: 12px; font-size: 15px; line-height: 1.45; }
.n { width: 28px; height: 28px; border-radius: 50%; background: var(--kb-raised); color: var(--kb-lime); display: grid; place-items: center; font-size: 13px; font-weight: 800; flex: none; }
</style>
