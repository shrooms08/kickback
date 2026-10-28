<script setup lang="ts">
import { computed, ref } from 'vue'
import SheetHead from './SheetHead.vue'
import Icon from '../../components/Icon.vue'
import { useAccount } from '../../stores/account'
import { useData } from '../../stores/data'
import { useUi } from '../../stores/ui'
import { useWallet } from '../../stores/wallet'
import { buildIcs, reminderTimes } from '../../lib/ics'
import { clockOrDay, now } from '../../lib/time'

// Remind me: a calendar file with one event per kickback (from the pool's payout schedule),
// each alarming at the time the kickback lands. Opened with the system share sheet when it can
// take files, else as a download. If neither works, a toast says when the next one lands.
const a = useAccount(), data = useData(), ui = useUi(), wallet = useWallet()
const mode = ref<'next' | 'two'>('next')
const interval = computed(() => data.pool(a.pool).intervalH || 12)
const nextAt = computed(() => {
  void now.value
  if (wallet.isMock) return Date.now() + (9 * 60 + 4) * 60e3
  const t = a.nextKickbackAt
  if (!t) return null
  let x = t
  while (x < Date.now()) x += interval.value * 3600e3
  return x
})
const due = computed(() => (nextAt.value ? clockOrDay(nextAt.value) : ''))
const times = computed(() => (nextAt.value ? reminderTimes(nextAt.value, interval.value, mode.value) : []))
const opts = computed(() => [
  { k: 'next' as const, l: 'Next kickback only', d: due.value ? `One reminder, about ${due.value}` : 'One reminder' },
  { k: 'two' as const, l: 'Every kickback for 2 weeks', d: `${reminderTimes(Date.now(), interval.value, 'two').length} reminders, about every ${Math.round(interval.value)}h` },
])

async function add() {
  if (!times.value.length) { ui.closeSheet(() => ui.showToast('Your next kickback time isn\'t known yet. Try again after it lands.')); return }
  const ics = buildIcs(times.value.map(start => ({ start, title: 'Your kickback lands', desc: 'Open Kickback in Nimiq Pay to run your plan.' })), String(Date.now()))
  const file = new File([ics], 'kickback-reminders.ics', { type: 'text/calendar' })
  let ok = false
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Kickback reminders' }); ok = true }
  }
  catch (e) { if ((e as Error)?.name === 'AbortError') return }
  if (!ok) {
    try {
      const url = URL.createObjectURL(file)
      const el = document.createElement('a')
      el.href = url; el.download = 'kickback-reminders.ics'; el.rel = 'noopener'
      document.body.appendChild(el); el.click(); el.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      ok = true
    }
    catch { ok = false }
  }
  const msg = ok ? (mode.value === 'next' ? `Reminder ready for about ${due.value}` : `${times.value.length} reminders ready`) : `Couldn't open your calendar. Your next kickback lands about ${due.value}.`
  ui.closeSheet(() => ui.showToast(msg))
}
</script>

<template>
  <SheetHead title="Remind me" />
  <p class="kb-body">Get reminded when your kickback lands. Kickback adds the reminder to your calendar. Mini apps can't send notifications.</p>
  <div class="opts">
    <button v-for="o in opts" :key="o.k" class="opt kb-press-soft" :class="{ on: mode === o.k }" :data-kb-remind="o.k" @click="mode = o.k">
      <span class="radio"><span v-if="mode === o.k" class="in" /></span>
      <span class="t"><span class="l">{{ o.l }}</span><span class="d">{{ o.d }}</span></span>
    </button>
  </div>
  <div class="preview"><Icon name="calendar" :size="20" /><span><b>Your kickback lands</b><br><span class="kb-dim">{{ due ? `About ${due}` : 'Time not known yet' }} · alert at that time</span></span></div>
  <button class="kb-btn kb-btn-primary" data-kb="add-calendar" @click="add">Add to calendar</button>
</template>

<style scoped>
.opts { display: flex; flex-direction: column; gap: 8px; }
.opt { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 20px; border: 1px solid var(--kb-line); background: transparent; color: var(--kb-text); text-align: left; }
.opt.on { border-color: var(--kb-lime); }
.radio { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--kb-text-3); display: grid; place-items: center; flex: none; }
.opt.on .radio { border-color: var(--kb-lime); }
.in { width: 10px; height: 10px; border-radius: 50%; background: var(--kb-lime); }
.t { display: flex; flex-direction: column; gap: 2px; }
.l { font-size: 15px; font-weight: 700; }
.d { font-size: 13px; color: var(--kb-text-2); }
.preview { display: flex; gap: 12px; align-items: center; padding: 14px 16px; border-radius: 20px; background: var(--kb-raised); font-size: 14px; line-height: 1.4; color: var(--kb-lime); }
.preview span { color: var(--kb-text); }
</style>
