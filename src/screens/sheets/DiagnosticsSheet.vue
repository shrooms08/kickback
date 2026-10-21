<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Icon from '../../components/Icon.vue'
import CopySwap from '../../components/CopySwap.vue'
import { useUi } from '../../stores/ui'
import { useWallet } from '../../stores/wallet'
import { useDiag, hostInfo } from '../../stores/diag'
import { useCopy } from '../../lib/copy'

// Hidden diagnostics: what the SDK and the RPC actually returned.
const ui = useUi()
const wallet = useWallet()
const diag = useDiag()
const { copied, copy } = useCopy()
const now = ref(Date.now())

onMounted(() => {
  // RPC lines are fetched after connect; fetch them now if that never ran.
  if (wallet.address && !diag.stakerRaw && !diag.rpcLoading) diag.loadRpc(wallet.address)
})

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
  ]
  if (accounts && accounts.length > 1) accounts.slice(1).forEach((a, i) => out.push([`accounts[${i + 1}]`, a]))
  if (!diag.balanceReads.length) out.push(['getBalance', 'not called'])
  diag.balanceReads.forEach((r, i) => {
    const n = diag.balanceReads.length > 1 ? ` #${i + 1}` : ''
    out.push([`getBalance raw${n}`, `${r.raw} (${r.type}) at ${r.at}`])
    out.push([`getBalance NIM${n}`, r.nim == null ? 'n/a' : `${r.nim} NIM`])
    out.push([`getBalance took${n}`, `${r.ms} ms`])
  })
  out.push(['RPC', `rpc.nimiqwatch.com · ${ms(diag.rpcMs)}`])
  out.push(['getStakerByAddress', diag.stakerRaw || (diag.rpcLoading ? 'loading…' : 'not called')])
  out.push(['getAccountByAddress', diag.accountRaw || (diag.rpcLoading ? 'loading…' : 'not called')])
  if (!diag.errors.length) out.push(['Errors', 'none'])
  diag.errors.forEach((e, i) => {
    const parts = [e.name, e.type && `type=${e.type}`, e.code !== undefined && `code=${e.code}`, `message=${e.message}`, e.data && `data=${e.data}`].filter(Boolean)
    out.push([`Error ${i + 1} · ${e.where}`, parts.join(' · ')])
  })
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
.ghost { height: 48px; background: transparent; border: 1px solid var(--kb-line); color: var(--kb-text); font-size: 15px; font-weight: 700; }
button:disabled { opacity: .6; }
</style>
