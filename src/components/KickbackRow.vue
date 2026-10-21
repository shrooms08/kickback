<script setup lang="ts">
import Icon from './Icon.vue'
import { nim2 } from '../lib/format'

// One kickback in a list: "+3.12 NIM", where it came from, and its tag
// (Waiting / In plan; no tag when waiting is null).
defineProps<{ amt: number, sub: string, waiting: boolean | null }>()
</script>

<template>
  <div class="kb-row">
    <div class="ico"><Icon name="kickback" :size="18" :stroke="2.2" /></div>
    <div class="txt"><div class="amt kb-num">+{{ nim2(amt) }} NIM</div><div class="sub">{{ sub }}</div></div>
    <span v-if="waiting !== null" class="tag" :class="{ plan: !waiting }">{{ waiting ? 'Waiting' : 'In plan' }}</span>
  </div>
</template>

<style scoped>
.ico { width: 40px; height: 40px; border-radius: 50%; background: var(--kb-raised); color: var(--kb-lime); display: grid; place-items: center; flex: none; }
.txt { flex: 1; min-width: 0; }
.amt { font-size: 15px; font-weight: 700; }
.sub { font-size: 13px; color: var(--kb-text-2); }
.tag { font-size: 12px; font-weight: 700; padding: 6px 10px; border-radius: 999px; border: 1px solid var(--kb-line); color: var(--kb-text-2); flex: none; }
.tag.plan { background: var(--kb-lime-soft); color: var(--kb-lime); border-color: transparent; }
</style>
