<script setup lang="ts">
import { computed } from 'vue'
import KLogo from './KLogo.vue'
import { SKIN_LIST, useSeason } from '../stores/season'

// "New skin unlocked": a K burst, the new skin sweeping across a mini Stack, Apply skin / Later.
const season = useSeason()
const s = computed(() => SKIN_LIST.find(x => x.k === season.celebrate) ?? null)
function apply() { if (s.value) void season.applySkin(s.value.k); season.celebrate = null }
function later() { season.celebrate = null }
</script>

<template>
  <div v-if="s" class="ov" role="dialog" aria-modal="true" aria-label="New skin unlocked" data-kb="unlock">
    <div class="burst">
      <div class="rays" data-kb-keep="1" />
      <div class="coin"><KLogo :size="44" color="var(--kb-bg)" animate /></div>
    </div>
    <div class="copy">
      <div class="kb-eyebrow">New skin unlocked</div>
      <h2 class="title">{{ s.name }}</h2>
      <p class="lead">{{ s.note }} for your Stack. Unlocked by: {{ s.from }}.</p>
    </div>
    <div class="stack" :class="{ legend: s.k === 'legend' }">
      <div v-for="(ink, i) in ['dark', 'second', 'light']" :key="ink" class="w" :style="{ transform: `translateY(${i * 36}px)`, zIndex: 3 - i }">
        <div class="c" :class="'c' + i" :style="{ animationDelay: 300 + i * 150 + 'ms' }">
          <div class="h" :style="{ backgroundImage: `var(--kb-skin-${s.k}-${ink})`, animationDelay: 420 + i * 150 + 'ms' }" />
        </div>
      </div>
    </div>
    <div class="acts">
      <button class="kb-btn kb-btn-primary" data-kb="apply-skin" @click="apply">Apply skin</button>
      <button class="kb-btn kb-btn-ghost" @click="later">Later</button>
    </div>
  </div>
</template>

<style scoped>
.ov { position: absolute; inset: 0; z-index: 90; background: rgba(11, 13, 28, .96); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 24px 24px calc(28px + var(--kb-safe-bottom)); animation: kbFade 220ms ease-out both; }
.burst { position: relative; width: 170px; height: 170px; display: grid; place-items: center; }
.rays { position: absolute; inset: 0; border-radius: 50%; background: repeating-conic-gradient(from 0deg, rgba(200, 240, 74, .35) 0 4deg, transparent 4deg 15deg); -webkit-mask-image: radial-gradient(circle, #000 30%, transparent 70%); mask-image: radial-gradient(circle, #000 30%, transparent 70%); animation: kbspin 40s linear infinite; }
.coin { position: relative; width: 84px; height: 84px; border-radius: 50%; background: var(--kb-lime); display: grid; place-items: center; box-shadow: 0 16px 50px rgba(200, 240, 74, .35); animation: kbPop 500ms var(--kb-ease) both; }
.copy { display: flex; flex-direction: column; gap: 8px; align-items: center; text-align: center; animation: kbRise 420ms cubic-bezier(.2, .8, .2, 1) 200ms both; }
.title { font-size: 48px; line-height: .9; font-weight: 900; text-transform: uppercase; letter-spacing: -0.025em; }
.lead { font-size: 15px; color: var(--kb-text-2); max-width: 280px; line-height: 1.45; }
.stack { position: relative; width: min(100%, 300px); height: 128px; }
.w { position: absolute; left: 0; right: 0; }
.c { height: 56px; border-radius: 18px; overflow: hidden; position: relative; animation: kbCardIn 420ms var(--kb-ease) both; }
.c0 { background: var(--kb-lime); }
.c1 { background: var(--kb-second); }
.c2 { background: var(--kb-raised); }
.stack.legend .c { box-shadow: var(--kb-legend-glow); }
.h { position: absolute; inset: 0; background-size: 48px 48px; transform-origin: left; animation: kbSweep 600ms var(--kb-ease) both; }
@keyframes kbSweep { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
.acts { width: 100%; display: flex; flex-direction: column; gap: 10px; animation: kbRise 420ms cubic-bezier(.2, .8, .2, 1) 600ms both; }
</style>
