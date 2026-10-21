<script setup lang="ts">
import Icon from './Icon.vue'

// Problem banner for persistent issues: icon + one line + one action.
// It pushes the content down (the Stage moves layers below it), never covers it.
defineProps<{
  kind: 'offline' | 'stale' | 'pool' | 'sync'
  text: string
  label: string
}>()
defineEmits<{ act: [] }>()
</script>

<template>
  <div role="status" class="banner">
    <Icon v-if="kind === 'offline'" name="offline" :size="18" color="var(--kb-error)" />
    <Icon v-else-if="kind === 'stale'" name="clock" :size="18" color="var(--kb-text-2)" />
    <Icon v-else name="warning" :size="18" color="var(--kb-error)" />
    <span class="text">{{ text }}</span>
    <button class="act" @click="$emit('act')">{{ label }}</button>
  </div>
</template>

<style scoped>
.banner {
  position: absolute; top: calc(var(--kb-safe-top) + 4px); left: 12px; right: 12px; z-index: 55;
  height: var(--kb-banner-h); padding: 6px 6px 6px 14px; border-radius: 20px; background: var(--kb-raised);
  border: 1px solid var(--kb-line); display: flex; align-items: center; gap: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, .35); animation: kbToastIn 260ms var(--kb-ease) both;
}
.banner :deep(svg) { flex: none; }
.text { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; line-height: 1.3; }
.act {
  height: 48px; padding: 0 14px; border-radius: 14px; border: none; background: var(--kb-surface); color: var(--kb-lime);
  font-size: 13px; font-weight: 800; cursor: pointer; flex: none; transition: transform var(--kb-dur-press) var(--kb-ease);
}
.act:active { transform: scale(var(--kb-press-scale)); }
</style>
