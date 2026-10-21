<script setup lang="ts">
import Icon from './Icon.vue'
import SegmentedBar from './SegmentedBar.vue'

// Back button + 2-step progress + step label (+ optional title line).
defineProps<{ step: number, label: string, title?: string }>()
defineEmits<{ back: [] }>()
</script>

<template>
  <div class="head">
    <button class="kb-icon-btn" aria-label="Back" @click="$emit('back')"><Icon name="back" :size="20" /></button>
    <div class="right">
      <div class="steps">
        <div class="bar"><SegmentedBar :segments="2" :value="step" size="sm" /></div>
        <span class="kb-eyebrow nowrap">{{ label }}</span>
      </div>
      <span v-if="title" class="title">{{ title }}</span>
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; gap: 12px; height: 52px; }
.right { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.steps { display: flex; align-items: center; gap: 12px; }
.bar { width: 96px; flex: none; }
.nowrap { white-space: nowrap; }
.title { font-size: 15px; font-weight: 700; }
</style>
