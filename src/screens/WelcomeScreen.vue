<script setup lang="ts">
import KLogo from '../components/KLogo.vue'
import { connectWallet } from '../flows'
</script>

<template>
  <div class="kb-scroll">
    <div class="page">
      <div class="blob b1" />
      <div class="blob b2" />
      <div class="main">
        <div class="logo">
          <div class="glow" />
          <div class="pulse" />
          <KLogo :size="96" animate class="mark" />
        </div>
        <div class="copy">
          <div class="eyebrow">Kickback</div>
          <h1 class="title">Your NIM pays you</h1>
          <p class="lead">Stake once. Get your kickback twice a day.</p>
        </div>
        <div class="chips">
          <div class="chip"><span class="dot" style="background: var(--kb-lime)" />Stake once</div>
          <div class="chip"><span class="dot" style="background: var(--kb-accent)" />Paid twice a day</div>
          <div class="chip"><span class="dot" style="background: var(--kb-fourth)" />Your stake stays yours</div>
        </div>
      </div>
      <div class="cta">
        <button class="kb-btn kb-btn-primary connect" @click="connectWallet">Connect wallet</button>
        <div class="hint">You'll approve in Nimiq Pay.</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { position: relative; overflow: hidden; min-height: 100%; display: flex; flex-direction: column; padding: 24px 24px calc(28px + var(--kb-safe-bottom)); }
.blob { position: absolute; border-radius: 50%; filter: blur(3px); }
.b1 { width: 320px; height: 320px; top: 120px; right: -150px; background: var(--kb-second); opacity: .2; }
.b2 { width: 240px; height: 240px; top: 330px; left: -120px; background: var(--kb-third); opacity: .15; }
.main { position: relative; flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 28px; }
.logo { position: relative; width: 96px; height: 96px; }
.glow { position: absolute; inset: -40px; border-radius: 50%; background: radial-gradient(circle, rgba(200, 240, 74, .28), transparent 65%); animation: kbFade 500ms ease-out both; }
.pulse { position: absolute; inset: -60px; border-radius: 50%; background: radial-gradient(circle, rgba(200, 240, 74, .5), transparent 62%); animation: kbGlowPulse 800ms var(--kb-ease) 600ms both; }
.mark { position: relative; }
.copy { display: flex; flex-direction: column; gap: 14px; }
.eyebrow { font-size: 13px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--kb-label); }
.title { font-size: 52px; line-height: .9; font-weight: 900; letter-spacing: -0.025em; text-transform: uppercase; }
.lead { font-size: 17px; line-height: 1.45; color: var(--kb-text-2); max-width: 300px; text-wrap: pretty; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--kb-line); background: var(--kb-surface); display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
.dot { width: 6px; height: 6px; border-radius: 50%; }
.cta { position: relative; display: flex; flex-direction: column; gap: 14px; align-items: center; }
.connect { box-shadow: var(--kb-sh-lime-glow), 0 10px 30px rgba(200, 240, 74, .18); }
.hint { font-size: 14px; color: var(--kb-text-2); }
</style>
