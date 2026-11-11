<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import SheetHead from './SheetHead.vue'
import Icon from '../../components/Icon.vue'
import { useAccount } from '../../stores/account'
import { usePlan } from '../../stores/plan'
import { useSeason } from '../../stores/season'
import { useUi } from '../../stores/ui'
import { useWallet } from '../../stores/wallet'
import { useCopy } from '../../lib/copy'
import { logError } from '../../lib/logError'
import { renderShareCard } from '../../lib/shareCard'
import type { ShareInput } from '../../lib/shareCard'

// Share card: 1080x1350 PNG (NIM only, current skin, invite code and link).
const a = useAccount(), plan = usePlan(), season = useSeason(), ui = useUi()
const { copy } = useCopy()
const url = ref('')
/** drawing: the card is being made · failed: no image could be made (shown as text) */
const state = ref<'drawing' | 'ready' | 'failed'>('drawing')
/** Save image inside Nimiq Pay without share support: the card full screen, press and hold to save. */
const viewer = ref(false)
let blob: Blob | null = null

const input = computed<ShareInput>(() => {
  const rec = plan.contact(plan.savedRecipient)
  const all = [{ pct: plan.saved[0], label: rec.name || 'Send' }, { pct: plan.saved[1], label: 'Restake' }, { pct: plan.saved[2], label: 'Keep' }]
  return {
    earnedNim: a.earnedNim,
    kickbacks: a.kbCount,
    streak: season.streakN,
    code: season.data?.code ?? '',
    link: season.inviteLink,
    slices: plan.hasContacts ? all : all.slice(1),
  }
})

onMounted(async () => {
  try {
    blob = await renderShareCard(input.value, season.skin, (what, error) => logError(what, error))
    url.value = URL.createObjectURL(blob)
    state.value = 'ready'
  }
  catch (error) {
    logError('share card', error)
    url.value = ''
    state.value = 'failed'
  }
})
onBeforeUnmount(() => { if (url.value) URL.revokeObjectURL(url.value) })

const text = computed(() => `My NIM pays me: ${input.value.earnedNim.toFixed(2)} NIM in kickbacks with Kickback on Nimiq Pay.${season.data?.code ? ` Use my invite ${season.data.code}:` : ''} ${season.inviteLink}`)

async function share() {
  try {
    const file = blob ? new File([blob], 'kickback.png', { type: 'image/png' }) : null
    if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: text.value })
    else if (navigator.share) await navigator.share({ text: text.value, url: season.inviteLink })
    else { copyLink(); return }
    ui.closeSheet()
  }
  catch (e) { if ((e as Error)?.name !== 'AbortError') copyLink() }
}
/**
 * Save image. Nimiq Pay's WebView ignores download links: share the file (the share sheet has
 * "Save Image") when it can, else show the card full screen to press and hold. Elsewhere: download.
 */
async function save() {
  if (!url.value || !blob) return
  if (useWallet().env === 'nimiqpay') {
    const file = new File([blob], 'kickback.png', { type: 'image/png' })
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return }
    }
    catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      logError('Save image: share', e)
    }
    viewer.value = true
    return
  }
  const el = document.createElement('a')
  el.href = url.value; el.download = 'kickback.png'
  document.body.appendChild(el); el.click(); el.remove()
  ui.showToast('Image saved')
}
function copyLink() {
  copy('invite', season.inviteLink)
  ui.showToast('Invite link copied')
}
</script>

<template>
  <SheetHead title="Share my kickbacks" />
  <div class="card" data-kb="share-card">
    <img v-if="url" :src="url" alt="Share card: your kickbacks in NIM, your plan and your invite code" width="1080" height="1350">
    <div v-else-if="state === 'failed'" class="fail" role="alert" data-kb="share-card-failed">Couldn't draw the card</div>
    <div v-else class="kb-skel ph" />
  </div>
  <Teleport to="body">
    <div v-if="viewer" class="viewer" data-kb="share-viewer" @click.self="viewer = false">
      <img :src="url" alt="Your share card">
      <p>Press and hold to save</p>
      <button class="kb-btn kb-btn-ghost" @click="viewer = false">Done</button>
    </div>
  </Teleport>
  <button class="kb-btn kb-btn-primary" data-kb="share-btn" @click="share"><Icon name="share" :size="20" /> Share</button>
  <div class="two">
    <button class="kb-btn kb-btn-ghost" data-kb="save-img" :disabled="!url" @click="save"><Icon name="download" :size="18" /> Save image</button>
    <button class="kb-btn kb-btn-ghost" data-kb="copy-invite" @click="copyLink"><Icon name="link" :size="18" /> Copy invite link</button>
  </div>
</template>

<style scoped>
.card { border-radius: 22px; overflow: hidden; background: var(--kb-bg); border: 1px solid var(--kb-line); width: min(100%, 300px); align-self: center; aspect-ratio: 4 / 5; }
.card img { width: 100%; height: 100%; display: block; }
.ph { width: 100%; height: 100%; }
.fail { width: 100%; height: 100%; display: grid; place-items: center; padding: 24px; text-align: center; font-size: 15px; font-weight: 700; color: var(--kb-text-2); }
.viewer { position: fixed; inset: 0; z-index: 200; background: var(--kb-bg); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px; }
.viewer img { max-width: 100%; max-height: 72vh; border-radius: 18px; -webkit-touch-callout: default; user-select: auto; }
.viewer p { color: var(--kb-text); font-size: 15px; font-weight: 700; }
.two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.two .kb-btn { font-size: 14px; gap: 6px; display: flex; align-items: center; justify-content: center; }
.kb-btn-primary { display: flex; align-items: center; justify-content: center; gap: 8px; }
</style>
