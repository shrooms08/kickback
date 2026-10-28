<script setup lang="ts">
import { onMounted, ref } from 'vue'
import SheetHead from './SheetHead.vue'
import { useWallet } from '../../stores/wallet'
import { useUi } from '../../stores/ui'
import { getAccountBalance } from '../../services/chain'
import { nim2 } from '../../lib/format'
import { switchWallet } from '../../flows'

// Choose wallet: only basic accounts from Nimiq Pay (contracts are never listed).
const wallet = useWallet()
const ui = useUi()
const bal = ref<Record<string, string>>({})
onMounted(() => {
  if (wallet.isMock) { bal.value = { [wallet.basicAccounts[0]]: '31,480.55 NIM', [wallet.basicAccounts[1]]: '1,204.10 NIM' }; return }
  for (const a of wallet.basicAccounts) getAccountBalance(a).then((r) => { bal.value = { ...bal.value, [a]: `${nim2(r.value / 1e5)} NIM` } }).catch(() => {})
})
const short = (a: string) => { const g = a.split(' '); return `${g[0]} ${g[1]} … ${g[g.length - 1]}` }
function pick(a: string) {
  ui.closeSheet(() => switchWallet(a))
}
</script>

<template>
  <SheetHead title="Choose wallet" />
  <div class="list">
    <button v-for="a in wallet.basicAccounts" :key="a" class="row kb-press-soft" :class="{ on: a === wallet.effectiveAddress }" data-kb="wallet-row" @click="pick(a)">
      <span class="radio"><span v-if="a === wallet.effectiveAddress" class="in" /></span>
      <span class="t">
        <span class="addr kb-num">{{ short(a) }}</span>
        <span class="sub">{{ bal[a] ?? '…' }}</span>
      </span>
      <span v-if="a === wallet.address" class="tag">Nimiq Pay</span>
      <span v-else class="tag dim">View only</span>
    </button>
  </div>
  <p class="kb-body note">Staking and payments always come from the account selected in Nimiq Pay. Your other wallets open read only. Contracts like vesting or HTLC accounts are never listed.</p>
</template>

<style scoped>
.list { display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 20px; border: 1px solid var(--kb-line); background: transparent; color: var(--kb-text); text-align: left; }
.row.on { border-color: var(--kb-lime); }
.radio { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--kb-text-3); display: grid; place-items: center; flex: none; }
.row.on .radio { border-color: var(--kb-lime); }
.in { width: 10px; height: 10px; border-radius: 50%; background: var(--kb-lime); }
.t { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.addr { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub { font-size: 13px; color: var(--kb-text-2); }
.tag.dim { color: var(--kb-text-3); }
.tag { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--kb-label); flex: none; }
.note { font-size: 13px; }
</style>
