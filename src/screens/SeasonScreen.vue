<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../components/Icon.vue'
import type { IconName } from '../components/Icon.vue'
import { badgeUri, ringFill, ringUri } from '../components/badges'
import SegmentedBar from '../components/SegmentedBar.vue'
import { int0 } from '../lib/format'
import { COSMETIC_NOTE, MILESTONE_LIST, QUEST_TITLES, SKIN_LIST, XP_WAYS, useSeason } from '../stores/season'
import type { Skin, StreakDot } from '../stores/season'
import { useSession } from '../stores/session'
import { useNav } from '../stores/nav'
import { useUi } from '../stores/ui'
import { useCopy } from '../lib/copy'
import { now } from '../lib/time'
import { back } from '../router'

// Season 1 (Stage A): kickback streak, Stack skins unlocked by milestones, milestones, invites.
// Everything shown comes from the server's verified data (stores/season.ts).
const season = useSeason(), session = useSession(), nav = useNav(), ui = useUi()
const { copied, copy } = useCopy()
const d = computed(() => season.data)
const endsIn = computed(() => {
  const end = Date.parse(d.value?.season.endsAt ?? '2026-11-30T23:59:59Z')
  const ms = end - now.value
  if (ms <= 0) return 'Season 1 ended'
  const days = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5)
  return `Season ends in ${days}d ${h}h`
})
const st = computed(() => d.value?.streak ?? { current: 0, best: 0, savers: 1, pending: 0, hist: [] as StreakDot[] })
const ring = computed(() => ringUri(ringFill(st.value.current)))
const dots = computed(() => {
  const h = st.value.hist.slice(-14)
  return [...Array(14 - h.length).fill('empty'), ...h] as Array<StreakDot | 'empty'>
})
const saversLine = computed(() => st.value.savers === 1 ? '1 streak saver left this week' : 'Streak saver used this week. A new one on Monday')
const skins = computed(() => SKIN_LIST.map(s => ({ ...s, on: season.unlocked.includes(s.k), applied: season.skin === s.k })))
const milestones = computed(() => MILESTONE_LIST.map(m => ({ ...m, on: season.has(m.k) })))
const state = computed(() => {
  if (season.paused) return 'paused'
  if (!season.live) return 'live'
  if (!session.signedIn && !d.value) return 'signin'
  if (!d.value) return season.loading ? 'loading' : 'soon'
  return 'live'
})
const tier = computed(() => d.value?.tier ?? null)
const xp = computed(() => d.value?.xp ?? 0)
const ended = computed(() => !!d.value?.season.ended)
const nextIn = computed(() => {
  const t = d.value?.season.nextStartsAt ? Date.parse(d.value.season.nextStartsAt) - now.value : 0
  return t > 0 ? `${Math.ceil(t / 864e5)}d` : 'soon'
})
const tierNext = computed(() => !tier.value ? '' : tier.value.next ? `${int0(tier.value.toNext)} XP to ${tier.value.next}` : tier.value.sub < 2 ? `Top tier · ${int0(tier.value.toNext)} XP to Legend ${['II', 'III'][tier.value.sub]}` : 'Top tier reached')
const ladder = computed(() => (d.value?.tiers ?? []).map((t, i) => ({ ...t, i, cur: tier.value?.i === i, on: (tier.value?.i ?? -1) >= i, badge: badgeUri(i, (tier.value?.i ?? -1) >= i) })))
const quests = computed(() => (d.value?.quests ?? []).map(q => ({ ...q, title: QUEST_TITLES[q.key] })))
function apply(k: Skin) { void season.applySkin(k) }
function share() { ui.openSheet('share') }
const icon = (k: string) => k as IconName
</script>

<template>
  <div class="kb-scroll">
    <div class="kb-page-push" style="gap: 22px; padding-bottom: calc(40px + var(--kb-safe-bottom))">
      <div class="head">
        <button class="kb-icon-btn" aria-label="Back" @click="back(nav.seasonFrom || 'home')"><Icon name="back" :size="20" /></button>
        <div class="kb-eyebrow" style="font-size: 13px">Season 1</div>
        <div class="ends">Ends Nov 30</div>
      </div>

      <div v-if="state === 'paused'" class="notice" data-kb="season-paused">Season is paused in preview and dry run. Nothing here changes until you use your own wallet for real.</div>
      <div v-else-if="state === 'signin'" class="notice">
        <span>Sign in with your wallet to start your season. It only proves you own this wallet.</span>
        <button class="kb-btn kb-btn-primary" style="height: 52px" @click="session.signIn()">Sign in</button>
      </div>
      <div v-else-if="state === 'soon'" class="notice" data-kb="season-soon">Season 1 is starting soon. Your streak and unlocks will show here.</div>
      <div v-else-if="state === 'loading'" class="kb-skel" style="height: 180px; border-radius: var(--kb-r-card)" />

      <div v-if="ended && tier" class="hero" data-kb="season-ended">
        <div class="kb-eyebrow">Season {{ d?.season.id }} ended</div>
        <div class="big kb-num">{{ tier.name }} {{ tier.roman }}</div>
        <div class="meta">Final tier · {{ int0(xp) }} XP · Best streak {{ st.best }} in a row</div>
        <div class="meta">Season {{ (d?.season.id ?? 1) + 1 }} starts in {{ nextIn }}. Your unlocks stay: skins and badge frames carry into the next season.</div>
      </div>

      <div v-else-if="tier" class="hero" data-kb="tier-hero">
        <div class="hero-top">
          <span class="tbadge" :style="{ backgroundImage: badgeUri(tier.i, true) }" />
          <div class="col">
            <div class="kb-eyebrow">Your tier</div>
            <div class="big kb-num">{{ tier.name }} <span class="unit">{{ tier.roman }}</span></div>
          </div>
        </div>
        <SegmentedBar :segments="3" :value="tier.sub + 1" size="lg" pulse />
        <div class="row"><span class="meta"><b class="kb-num" style="color: var(--kb-text)">{{ int0(xp) }} XP</b> · {{ tierNext }}</span></div>
        <div class="meta">{{ endsIn }}</div>
        <button class="kb-btn kb-btn-ghost share" data-kb="season-share" @click="share"><Icon name="share" :size="18" /> Share my kickbacks</button>
      </div>

      <section v-if="quests.length && !ended" class="card" data-kb="quests">
        <div class="row"><div class="kb-eyebrow">This week</div><span class="meta">Resets Monday</span></div>
        <div v-for="q in quests" :key="q.key" class="quest" :class="{ done: q.done }" :data-kb-quest="q.key">
          <div class="row"><span class="qt">{{ q.title }} <span class="meta">({{ q.p }}/{{ q.n }}{{ q.key === 'keep' ? ' days' : '' }})</span></span><span class="qxp">+300 XP</span></div>
          <SegmentedBar :segments="q.n" :value="q.p" size="sm" />
        </div>
      </section>

      <div v-if="!tier" class="hero" data-kb="season-hero">
        <div class="hero-top">
          <span class="ring" :style="{ backgroundImage: ring }" />
          <div class="col">
            <div class="big kb-num">{{ st.current }} <span class="unit">in a row</span></div>
            <div class="meta">Best {{ st.best }} · {{ saversLine }}</div>
          </div>
        </div>
        <div class="meta">{{ endsIn }}</div>
        <button class="kb-btn kb-btn-ghost share" data-kb="season-share" @click="share"><Icon name="share" :size="18" /> Share my kickbacks</button>
      </div>

      <section class="card">
        <div class="row"><div class="kb-eyebrow">Kickback streak</div><span class="meta kb-num" data-kb="streak-count">{{ st.current }} in a row · best {{ st.best }}</span></div>
        <div v-if="tier" class="meta">{{ saversLine }}</div>
        <p class="kb-body">Kickbacks in a row, shared within 24h of landing. Miss one and your weekly streak saver keeps it going.</p>
        <div class="dots" data-kb="streak-dots">
          <span v-for="(k, i) in dots" :key="i" class="sdot" :class="k" :title="k" />
        </div>
        <div class="legend">
          <span><i class="sdot ok" />Shared on time</span>
          <span><i class="sdot saved" />Saved by a streak saver</span>
          <span><i class="sdot missed" />Missed</span>
          <span v-if="st.pending"><i class="sdot pending" />Waiting</span>
        </div>
      </section>

      <section v-if="ladder.length" class="card" data-kb="ladder">
        <div class="kb-eyebrow">Tiers</div>
        <div v-for="t in ladder" :key="t.name" class="tier" :class="{ cur: t.cur, on: t.on }">
          <span class="tb" :style="{ backgroundImage: t.badge }" />
          <span class="tn">{{ t.name }}</span>
          <span class="meta kb-num">{{ int0(t.at) }} XP</span>
        </div>
      </section>

      <section class="col12">
        <div class="row"><div class="kb-eyebrow">Stack skins</div><span class="meta">{{ tier ? 'One per tier' : 'Unlocked by milestones' }}</span></div>
        <div class="skins" data-kb="skins">
          <div v-for="s in skins" :key="s.k" class="skin" :class="{ on: s.on, applied: s.applied, legend: s.k === 'legend' }" :data-kb-skin-card="s.k">
            <div class="mini">
              <div class="m m0" :style="{ backgroundImage: `var(--kb-skin-${s.k}-dark)` }" />
              <div class="m m1" :style="{ backgroundImage: `var(--kb-skin-${s.k}-second)` }" />
              <div class="m m2" :style="{ backgroundImage: `var(--kb-skin-${s.k}-light)` }" />
              <div v-if="!s.on" class="lock"><Icon name="lock" :size="16" /></div>
            </div>
            <div class="sname">{{ s.name }}</div>
            <button v-if="s.applied" class="sbtn applied" disabled>Applied</button>
            <button v-else-if="s.on" class="sbtn kb-press" @click="apply(s.k)">Apply</button>
            <div v-else class="sfrom">{{ s.from }}</div>
          </div>
        </div>
      </section>

      <section class="col12">
        <div class="kb-eyebrow">Milestones</div>
        <div class="miles" data-kb="milestones">
          <div v-for="m in milestones" :key="m.k" class="mile" :class="{ on: m.on }" :data-kb-milestone="m.k">
            <span class="mico"><Icon :name="icon(m.icon)" :size="18" /></span>
            <span class="ml">{{ m.label }}</span>
          </div>
        </div>
      </section>

      <section v-if="tier" class="card" data-kb="xp-ways">
        <div class="kb-eyebrow">How XP is earned</div>
        <div v-for="[l, v] in XP_WAYS" :key="l" class="way"><span>{{ l }}</span><span class="meta">{{ v }}</span></div>
        <p class="meta">Counted on the server from your stake and transactions on chain. Nothing you tap in the app adds XP by itself.</p>
      </section>

      <section class="card" data-kb="invite">
        <div class="kb-eyebrow">Invite friends</div>
        <p class="kb-body">Share your code. It counts once their first stake is confirmed on chain.</p>
        <button class="code kb-press" :disabled="!d?.code" @click="copy('code', season.inviteLink)">
          <span class="kb-num">{{ d?.code || 'KICK-····' }}</span>
          <span class="cp">{{ copied === 'code' ? 'Copied' : 'Copy link' }}</span>
        </button>
        <div class="stats">
          <div><div class="sv kb-num">{{ d?.invites.claimed ?? 0 }}</div><div class="meta">Joined with your code</div></div>
          <div><div class="sv kb-num">{{ d?.invites.staked ?? 0 }}</div><div class="meta">Friends who staked</div></div>
        </div>
      </section>

      <p class="foot" data-kb="cosmetic">{{ COSMETIC_NOTE }}</p>
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; gap: 12px; height: 52px; }
.ends { margin-left: auto; font-size: 13px; color: var(--kb-text-2); }
.notice { border-radius: var(--kb-r-card); border: 1px dashed var(--kb-line); padding: 16px; font-size: 14px; line-height: 1.45; color: var(--kb-text-2); display: flex; flex-direction: column; gap: 12px; }
.hero { border-radius: var(--kb-r-card-lg); background: var(--kb-surface); border: 1px solid var(--kb-line); padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.hero-top { display: flex; align-items: center; gap: 16px; }
.ring { width: 66px; height: 66px; background-size: 66px 66px; flex: none; }
.big { font-size: 44px; font-weight: 900; letter-spacing: -0.04em; line-height: 1; }
.unit { font-size: 18px; font-weight: 700; color: var(--kb-text-2); letter-spacing: 0; }
.col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.col12 { display: flex; flex-direction: column; gap: 12px; }
.meta { font-size: 13px; color: var(--kb-text-2); }
.share { display: flex; align-items: center; justify-content: center; gap: 8px; height: 52px; }
.card { border-radius: var(--kb-r-card); background: var(--kb-surface); padding: 18px 16px; display: flex; flex-direction: column; gap: 12px; }
.row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.dots { display: grid; grid-template-columns: repeat(14, minmax(0, 1fr)); gap: 4px; }
.sdot { height: 14px; border-radius: 4px; background: var(--kb-raised); display: inline-block; }
.sdot.ok { background: var(--kb-lime); }
.sdot.saved { background: var(--kb-second); }
.sdot.missed { background: transparent; border: 1.5px solid rgba(255, 107, 91, .7); }
.sdot.pending { background: transparent; border: 1.5px dashed var(--kb-text-3); }
.legend { display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: 12px; color: var(--kb-text-2); }
.legend span { display: flex; align-items: center; gap: 6px; }
.legend .sdot { width: 12px; height: 12px; }
.skins { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.skin { border-radius: 18px; background: var(--kb-surface); border: 1px solid transparent; padding: 10px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.skin.applied { border-color: var(--kb-lime); }
.mini { position: relative; height: 62px; }
.m { position: absolute; left: 0; right: 0; height: 26px; border-radius: 9px; background-size: 48px 48px; }
.m0 { top: 0; background-color: var(--kb-lime); z-index: 3; }
.m1 { top: 18px; background-color: var(--kb-second); z-index: 2; }
.m2 { top: 36px; background-color: var(--kb-raised); z-index: 1; }
.skin.legend.on .m { box-shadow: var(--kb-legend-glow); }
.skin:not(.on) .m { opacity: .35; filter: saturate(.3); }
.lock { position: absolute; inset: 0; display: grid; place-items: center; z-index: 4; color: var(--kb-text); }
.sname { font-size: 14px; font-weight: 800; }
.sbtn { height: 32px; border-radius: 999px; border: 1px solid var(--kb-lime); background: transparent; color: var(--kb-lime); font-size: 12px; font-weight: 800; }
.sbtn.applied { background: var(--kb-lime); color: var(--kb-bg); }
.sfrom { font-size: 11px; line-height: 1.3; color: var(--kb-text-2); min-height: 32px; }
.miles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.mile { display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 16px; background: var(--kb-surface); background-image: var(--kb-hatch-seg); background-size: 48px 48px; color: var(--kb-text-2); font-size: 13px; font-weight: 700; line-height: 1.25; min-width: 0; }
.mile.on { background-image: none; color: var(--kb-text); }
.mico { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--kb-raised); color: var(--kb-text-3); flex: none; }
.mile.on .mico { color: var(--kb-lime); }
.code { height: 56px; border-radius: 999px; border: 1px solid var(--kb-line); background: var(--kb-raised); color: var(--kb-text); display: flex; align-items: center; justify-content: space-between; padding: 0 8px 0 20px; font-size: 18px; font-weight: 800; letter-spacing: .04em; }
.cp { height: 40px; padding: 0 16px; border-radius: 999px; background: var(--kb-lime); color: var(--kb-bg); font-size: 13px; font-weight: 800; letter-spacing: 0; display: grid; place-items: center; }
.stats { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.sv { font-size: 26px; font-weight: 900; }
.tbadge { width: 56px; height: 56px; background-size: 56px 56px; flex: none; }
.quest { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; }
.qt { font-size: 14px; font-weight: 700; }
.qxp { font-size: 13px; font-weight: 800; color: var(--kb-text-2); flex: none; }
.quest.done .qxp { color: var(--kb-lime); }
.tier { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 14px; color: var(--kb-text-2); }
.tier.on { color: var(--kb-text); }
.tier.cur { background: var(--kb-raised); }
.tb { width: 28px; height: 28px; background-size: 28px 28px; flex: none; }
.tn { flex: 1; font-size: 15px; font-weight: 800; }
.way { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; font-weight: 700; }
.way .meta { text-align: right; font-weight: 500; }
.foot { font-size: 12px; line-height: 1.45; color: var(--kb-text-3); text-align: center; padding: 0 12px; }
</style>
