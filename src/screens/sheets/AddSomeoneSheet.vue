<script setup lang="ts">
import { ref } from 'vue'
import Icon from '../../components/Icon.vue'
import { useUi } from '../../stores/ui'
import { contactAddressProblem, normalizeAddress } from '../../lib/address'
import { useWallet } from '../../stores/wallet'
import { shake } from '../../lib/anim'
import { addContact } from '../../flows'

const ui = useUi()
const wallet = useWallet()
const name = ref('')
const addr = ref('')
const nameErr = ref('')
const addrErr = ref('')
const nameEl = ref<HTMLInputElement>()
const addrEl = ref<HTMLInputElement>()

function submit() {
  const n = name.value.trim()
  nameErr.value = n ? '' : 'Add a name.'
  // Real checksum check (@nimiq/utils), and never your own address.
  const problem = contactAddressProblem(addr.value, wallet.isMock ? null : wallet.effectiveAddress)
  addrErr.value = problem === 'invalid'
    ? 'That doesn\'t look like a Nimiq address. Check it: it starts with NQ, has 36 characters, and one typo makes it invalid.'
    : problem === 'own' ? 'That\'s your own address. Add someone else.' : ''
  if (nameErr.value) shake(nameEl.value)
  if (addrErr.value) shake(addrEl.value)
  if (nameErr.value || addrErr.value) return
  addContact(n, normalizeAddress(addr.value))
}
</script>

<template>
  <div class="title-row" data-sheet-drag>
    <h2 class="sheet-h">Add someone</h2>
    <button class="kb-icon-btn" aria-label="Close" @click="ui.closeSheet()"><Icon name="close" :size="18" /></button>
  </div>
  <label class="field">
    <span class="kb-eyebrow">Name</span>
    <input ref="nameEl" v-model="name" :class="{ err: nameErr }" placeholder="Grandma" autocomplete="off" @input="nameErr = ''">
  </label>
  <div v-if="nameErr" class="error">{{ nameErr }}</div>
  <label class="field">
    <span class="kb-eyebrow">Nimiq address</span>
    <input
      ref="addrEl" v-model="addr" :class="{ err: addrErr }" class="addr" placeholder="NQ00 0000 0000 0000 0000 0000 0000 0000 0000"
      autocomplete="off" autocapitalize="characters" spellcheck="false" @input="addrErr = ''"
    >
  </label>
  <div v-if="addrErr" class="error">{{ addrErr }}</div>
  <button class="kb-btn kb-btn-primary" @click="submit">Add contact</button>
</template>

<style scoped>
.title-row { display: flex; justify-content: space-between; align-items: center; }
.sheet-h { font-size: 30px; line-height: .95; font-weight: 900; text-transform: uppercase; letter-spacing: -0.02em; }
.field { display: flex; flex-direction: column; gap: 8px; }
input {
  height: 56px; border-radius: var(--kb-r-input); border: 1px solid var(--kb-line); background: var(--kb-bg); color: var(--kb-text);
  padding: 0 16px; font: 600 16px var(--kb-font); outline: none; width: 100%;
}
input:focus { border-color: var(--kb-text-3); }
input.err { border-color: var(--kb-error); }
input.addr { font-size: 15px; letter-spacing: .02em; }
.error { font-size: 13px; line-height: 1.4; color: var(--kb-error); margin-top: -10px; animation: kbFade 200ms ease-out both; }
</style>
