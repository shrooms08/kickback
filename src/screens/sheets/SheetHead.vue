<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import { useUi } from '../../stores/ui'

defineProps<{ title: string }>()
const ui = useUi()
</script>

<template>
  <div class="head" data-sheet-drag>
    <h2 class="sheet-h">{{ title }}</h2>
    <button class="kb-icon-btn" aria-label="Close" @click="ui.closeSheet()"><Icon name="close" :size="18" /></button>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.sheet-h { font-size: 30px; line-height: .95; font-weight: 900; text-transform: uppercase; letter-spacing: -0.02em; }
</style>
