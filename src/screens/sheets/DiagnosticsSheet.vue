<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Icon from '../../components/Icon.vue'
import CopySwap from '../../components/CopySwap.vue'
import { useUi } from '../../stores/ui'
import { useWallet } from '../../stores/wallet'
import { useDiag, hostInfo } from '../../stores/diag'
import { useCopy } from '../../lib/copy'
import { useLive } from '../../stores/live'
import { useData } from '../../stores/data'
import { useAccount } from '../../stores/account'
import { rpcStats } from '../../services/rpc'
import { formatAddress, isNimiqAddress } from '../../lib/format'
import { ago } from '../../lib/time'
import { shake } from '../../lib/anim'
import { openLive } from '../../flows'
import { useDry } from '../../stores/dry'
import { useOps } from '../../stores/ops'
import { navlog } from '../../lib/navlog'
import { useNav } from '../../stores/nav'
import type { DryOutcome } from '../../stores/dry'
import { parseNimInput } from '../../lib/money'
import { nim2 } from '../../lib/format'

// Hidden diagnostics: what the SDK and the RPC actually returned.
const ui = useUi()
const wallet = useWallet()
const diag = useDiag()
const { copied, copy } = useCopy()
const live = useLive()
const dry = useDry()
const ops = useOps()
const navStore = useNav()
const clock = (t: number) => new Date(t).toLocaleTimeString('en-GB') + '.' + String(t % 1000).padStart(3, '0')
const OUTCOMES: Array<[DryOutcome, string]> = [['approve', 'Approve'], ['reject', 'Reject'], ['network', 'Network error'], ['failAfterSend', 'Fail after send']]
const dryBal = ref(nim2(dry.chain.balanceLuna / 1e5))
const dryKb = ref('25')
function toggleDry() {
  dry.toggle(!dry.on)
  live.refresh({ force: true })
}
function setDryBalance() { dry.setBalance(parseNimInput(dryBal.value)); live.derive() }
function addDryKickback() { const l = parseNimInput(dryKb.value); if (l > 0) { dry.addKickback(l); dryBal.value = nim2(dry.chain.balanceLuna / 1e5) } }
function resetDry() { dry.reset(); dryBal.value = nim2(dry.chain.balanceLuna / 1e5); live.refresh({ force: true }) }
const data = useData()
const account = useAccount()
const now = ref(Date.now())

onMounted(() => {
  // RPC lines are fetched after connect; fetch them now if that never ran.
  if (wallet.effectiveAddress && !diag.stakerRaw && !diag.rpcLoading) diag.loadRpc(wallet.effectiveAddress)
})

// Preview address: read another address everywhere, read only.
const previewInput = ref(wallet.previewAddress)
const previewErr = ref('')
const inputEl = ref<HTMLInputElement>()
function applyPreview() {
  const a = previewInput.value.trim()
  if (!isNimiqAddress(a)) {
    previewErr.value = 'That doesn\'t look like a Nimiq address. It starts with NQ and has 36 characters.'
    shake(inputEl.value)
    return
  }
  previewErr.value = ''
  wallet.setPreview(a)
  previewInput.value = formatAddress(a)
  diag.stakerRaw = ''
  ui.closeSheet(() => openLive())
}
function clearPreview() {
  previewInput.value = ''
  previewErr.value = ''
  wallet.setPreview(null)
  diag.stakerRaw = ''
  ui.closeSheet(() => openLive())
}

const ms = (v: number | null) => v == null ? 'n/a' : `${v} ms`

const lines = computed(() => {
  void now.value
  const host = hostInfo()
  const accounts = diag.accounts
  const out: Array<[string, string]> = [
    ['Build', `${__APP_BUILD__} (${__APP_COMMIT__})`],
    ['SDK', `@nimiq/mini-app-sdk ${__SDK_VERSION__}`],
    ['Environment', wallet.env],
    ['window.nimiqPay', `at boot: ${diag.hostContextAtBoot ? 'yes' : 'no'} · now: ${window.nimiqPay ? 'yes' : 'no'}`],
    ['window.nimiq', `at boot: ${diag.nimiqAtBoot ? 'yes' : 'no'} · now: ${window.nimiq ? 'yes' : 'no'}`],
    ['Host network / language', `${host.network || 'n/a'} / ${host.language || 'n/a'}`],
    ['Detection', `${diag.detectMethod || 'n/a'} · ${ms(diag.detectMs)}`],
    ['init() resolved after', ms(diag.initMs)],
    ['getBalance available', window.nimiq ? (typeof (window.nimiq as unknown as Record<string, unknown>).getBalance === 'function' ? 'yes' : 'NO (update Nimiq Pay)') : 'n/a'],
    ['listAccounts count', accounts ? String(accounts.length) : 'not called'],
    ['listAccounts took', ms(diag.listAccountsMs)],
    ['Address (accounts[0])', accounts?.[0] ?? wallet.address ?? 'n/a'],
    ['Preview address', wallet.previewAddress || 'off'],
    ['Dry run', dry.on ? `ON · next answer: ${dry.outcome} · fake balance ${nim2(dry.chain.balanceLuna / 1e5)} NIM · fake staker ${dry.chain.staker ? `${nim2(dry.chain.staker.balance / 1e5)} active / ${nim2(dry.chain.staker.inactiveBalance / 1e5)} inactive / ${nim2(dry.chain.staker.retiredBalance / 1e5)} retired` : 'none'} · ${dry.txs.length} fake txs` : 'off'],
    ['Reading', wallet.effectiveAddress || 'n/a'],
  ]
  if (accounts && accounts.length > 1) accounts.slice(1).forEach((a, i) => out.push([`accounts[${i + 1}]`, a]))
  if (!diag.balanceReads.length) out.push(['getBalance', 'not called'])
  diag.balanceReads.forEach((r, i) => {
    const n = diag.balanceReads.length > 1 ? ` #${i + 1}` : ''
    out.push([`getBalance raw${n}`, `${r.raw} (${r.type}) at ${r.at}`])
    out.push([`getBalance NIM${n}`, r.nim == null ? 'n/a' : `${r.nim} NIM`])
    out.push([`getBalance took${n}`, `${r.ms} ms`])
  })
  out.push(['RPC this session', `${rpcStats.calls} calls · ${rpcStats.units} units · cache hits ${rpcStats.cacheHits} · deduped ${rpcStats.deduped} · retries ${rpcStats.retries} · 429s ${rpcStats.throttled} · queued ${Math.round(rpcStats.waitedMs / 100) / 10}s`])
  out.push(['RPC by method', Object.entries(rpcStats.byMethod).map(([m, n]) => `${m} ${n}`).join(' · ') || 'none'])
  if (rpcStats.lastError) out.push(['RPC last error', rpcStats.lastError])
  if (!wallet.isMock) {
    out.push(['Live data', `${live.lastOkAt ? `refreshed ${ago(live.lastOkAt)}` : 'not refreshed yet'}${account.stale ? ` · stale (${account.staleMin} min)` : ''}${live.lastError ? ` · error: ${live.lastError}` : ''}`])
    out.push(['Stake', account.staked ? `${account.stakedNim} NIM active · ${account.inactiveNim} inactive · pool ${account.poolName}${account.notDirect ? ' (not direct)' : ''}` : 'not a staker'])
    out.push(['Kickbacks found (30 days)', `${data.kickbacks.length} · ready ${account.readyNim} NIM · earned ${account.earnedNim} NIM`])
    out.push(['Pools shown', data.pools.map(p => `${p.name} ${p.fee} trust ${p.trust} · ${p.lastPaid} · ${p.intervalH ? p.intervalH.toFixed(2) + 'h' : '?'} · ${p.pays}`).join(' | ') || data.poolsState])
    if (data.poolsNote) out.push(['Pools hidden', data.poolsNote])
    out.push(['Est. staking reward', data.grossApy != null ? `${(data.grossApy * 100).toFixed(2)}% gross (before pool fee)` : 'n/a'])
  }
  out.push(['RPC (raw lines below)', `rpc.nimiqwatch.com · ${ms(diag.rpcMs)}`])
  out.push(['getStakerByAddress', diag.stakerRaw || (diag.rpcLoading ? 'loading…' : 'not called')])
  out.push(['getAccountByAddress', diag.accountRaw || (diag.rpcLoading ? 'loading…' : 'not called')])
  if (!diag.errors.length) out.push(['Errors', 'none'])
  diag.errors.forEach((e, i) => {
    const parts = [e.name, e.type && `type=${e.type}`, e.code !== undefined && `code=${e.code}`, `message=${e.message}`, e.data && `data=${e.data}`].filter(Boolean)
    out.push([`Error ${i + 1} · ${e.where}`, parts.join(' · ')])
  })
  // Navigation: is the transition lock held, and what did recent taps hit?
  out.push(['Nav lock', navlog.locked ? `LOCKED for ${Math.round((Date.now() - navlog.lockedAt) / 100) / 10}s (${navlog.lockReason}), auto-release in ${Math.max(0, Math.round((navlog.lockDeadline - Date.now()) / 100) / 10)}s` : 'free'])
  out.push(['Nav state', `screen ${navStore.screen ?? '-'} · route ${location.hash || '-'} · base ${navStore.base ?? '-'} · leaving ${navStore.leaving ?? '-'} · busy ${navStore.busy}`])
  const fab = document.querySelector('nav .fab')
  if (fab) {
    const r = fab.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    out.push(['Lime button', `${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.left + r.width / 2)},${Math.round(r.top + r.height / 2)} · elementFromPoint ${hit && (hit === fab || fab.contains(hit)) ? 'is the button' : 'is NOT the button: ' + (hit ? hit.tagName.toLowerCase() + '.' + String(hit.className) : 'nothing')} · viewport ${innerWidth}x${innerHeight}`])
  }
  if (!navlog.taps.length) out.push(['Taps', 'none recorded'])
  ;[...navlog.taps].reverse().forEach((t, i) => out.push([`Tap ${i + 1}`, `${clock(t.t)} ${t.type} at ${t.x},${t.y} → ${t.hit}`]))
  if (!navlog.events.length) out.push(['Nav events', 'none recorded'])
  ;[...navlog.events].reverse().forEach((e, i) => out.push([`Nav ${i + 1}`, `${clock(e.t)} ${e.what}`]))
  // Money actions: kind, value (Luna), phase, hash, error. Newest first.
  const recent = [...ops.ops].reverse().slice(0, 8)
  if (!recent.length) out.push(['Money actions', 'none'])
  recent.forEach((o, i) => out.push([`Money action ${i + 1}${o.dry ? ' (dry run)' : ''}`, `${o.flow} · ${o.req.kind} ${o.req.value} Luna${o.req.recipient ? ` to ${o.req.recipient}` : ''}${o.req.delegation ? ` to ${o.req.delegation}` : ''}${o.req.newDelegation ? ` to ${o.req.newDelegation}` : ''} · ${o.phase}${o.slow ? ' (slow)' : ''} · ${new Date(o.startedAt).toLocaleTimeString('en-GB')}${o.hash ? ` · hash ${o.hash}` : ''}${o.error ? ` · ${o.error}` : ''}`]))
  out.push(['User agent', navigator.userAgent])
  return out
})

const text = computed(() => lines.value.map(([k, v]) => `${k}: ${v}`).join('\n'))

async function again() {
  await wallet.rereadBalance()
  now.value = Date.now()
}
</script>

<template>
  <div class="title-row" data-sheet-drag>
    <h2 class="sheet-h">Diagnostics</h2>
    <button class="kb-icon-btn" aria-label="Close" @click="ui.closeSheet()"><Icon name="close" :size="18" /></button>
  </div>
  <div class="dry">
    <div class="drow">
      <div class="kb-eyebrow">Dry run</div>
      <button class="tog" :class="{ on: dry.on }" role="switch" :aria-checked="dry.on" @click="toggleDry"><span /></button>
    </div>
    <p class="dnote">Every send is simulated: no real NIM moves. Answers after 1.5 s, confirms 3 s later.</p>
    <template v-if="dry.on">
      <div class="kb-eyebrow">Nimiq Pay answers with</div>
      <div class="chips">
        <button v-for="[k, l] in OUTCOMES" :key="k" class="chip" :class="{ sel: dry.outcome === k }" @click="dry.setOutcome(k)">{{ l }}</button>
      </div>
      <div class="prow3">
        <input v-model="dryBal" class="pin" inputmode="decimal" aria-label="Fake balance in NIM">
        <button class="kb-btn pbtn" @click="setDryBalance">Set balance</button>
      </div>
      <div class="prow3">
        <input v-model="dryKb" class="pin" inputmode="decimal" aria-label="Fake kickback in NIM">
        <button class="kb-btn pbtn" @click="addDryKickback">Add kickback</button>
      </div>
      <div class="prow">
        <button class="kb-btn pbtn" @click="dry.releaseNow()">Release stake now</button>
        <button class="kb-btn pbtn" @click="resetDry">Reset dry run</button>
      </div>
    </template>
  </div>
  <div class="preview">
    <label class="kb-eyebrow" for="kb-preview">Preview address</label>
    <input
      id="kb-preview" ref="inputEl" v-model="previewInput" class="pin" :class="{ err: previewErr }"
      placeholder="NQ00 0000 0000 0000 0000 0000 0000 0000 0000" autocomplete="off" autocapitalize="characters" spellcheck="false"
      @input="previewErr = ''"
    >
    <div v-if="previewErr" class="perr">{{ previewErr }}</div>
    <div class="prow">
      <button class="kb-btn pbtn apply" @click="applyPreview">Apply</button>
      <button class="kb-btn pbtn" :disabled="!wallet.previewAddress && !previewInput" @click="clearPreview">Clear</button>
    </div>
  </div>
  <div class="lines">
    <div v-for="([k, v], i) in lines" :key="i" class="line"><span class="k">{{ k }}</span><span class="v">{{ v }}</span></div>
  </div>
  <button class="kb-btn kb-btn-primary" :disabled="diag.busy" @click="again">
    <span v-if="diag.busy" class="kb-spinner" data-kb-keep="1" style="border-top-color: var(--kb-bg)" />
    Run getBalance again
  </button>
  <button class="kb-btn ghost" @click="copy('diag', text)"><CopySwap :copied="copied === 'diag'" />Copy all</button>
</template>

<style scoped>
.title-row { display: flex; justify-content: space-between; align-items: center; }
.sheet-h { font-size: 30px; line-height: .95; font-weight: 900; text-transform: uppercase; letter-spacing: -0.02em; }
.lines { border-radius: 16px; background: var(--kb-bg); border: 1px solid var(--kb-line); padding: 6px 12px; max-height: 52vh; overflow-y: auto; }
.line { display: flex; flex-direction: column; gap: 2px; padding: 8px 0; }
.line + .line { border-top: 1px solid var(--kb-line); }
.k { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--kb-label); }
.v { font: 500 12px/1.4 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; color: var(--kb-text); word-break: break-all; white-space: pre-wrap; user-select: text; -webkit-user-select: text; }
.preview { display: flex; flex-direction: column; gap: 8px; }
.dry { display: flex; flex-direction: column; gap: 8px; border-radius: 16px; border: 1px solid var(--kb-line); padding: 12px; }
.drow { display: flex; justify-content: space-between; align-items: center; }
.dnote { font-size: 12px; line-height: 1.4; color: var(--kb-text-2); }
.tog { width: 52px; height: 30px; border-radius: 999px; border: 1px solid var(--kb-line); background: var(--kb-bg); position: relative; cursor: pointer; padding: 0; }
.tog span { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: var(--kb-text-3); transition: transform 160ms var(--kb-ease); }
.tog.on { background: var(--kb-lime); border-color: var(--kb-lime); }
.tog.on span { transform: translateX(22px); background: var(--kb-bg); }
.chips { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.chip { height: 40px; border-radius: 12px; border: 1px solid var(--kb-line); background: transparent; color: var(--kb-text); font: 700 13px var(--kb-font); cursor: pointer; }
.chip.sel { background: var(--kb-lime); color: var(--kb-bg); border-color: var(--kb-lime); }
.prow3 { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
.prow3 .pbtn { padding: 0 14px; }
.pin { height: 52px; border-radius: var(--kb-r-input); border: 1px solid var(--kb-line); background: var(--kb-bg); color: var(--kb-text); padding: 0 14px; font: 600 14px var(--kb-font); letter-spacing: .02em; outline: none; width: 100%; }
.pin.err { border-color: var(--kb-error); }
.perr { font-size: 13px; line-height: 1.4; color: var(--kb-error); }
.prow { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pbtn { height: 44px; font-size: 14px; background: transparent; border: 1px solid var(--kb-line); color: var(--kb-text); font-weight: 700; }
.pbtn.apply { background: var(--kb-lime); color: var(--kb-bg); border-color: var(--kb-lime); }
.ghost { height: 48px; background: transparent; border: 1px solid var(--kb-line); color: var(--kb-text); font-size: 15px; font-weight: 700; }
button:disabled { opacity: .6; }
</style>
