<script setup lang="ts">
import Icon from './Icon.vue'

// Copy icon that turns into a lime check for a moment after copying.
defineProps<{ copied: boolean }>()
</script>

<template>
  <span class="swap">
    <span class="ico" :class="{ hide: copied }"><Icon name="copy" :size="16" /></span>
    <span class="ico" :class="{ hide: !copied }"><Icon name="check" :size="16" :stroke="2.8" color="var(--kb-lime)" /></span>
  </span>
</template>

<style scoped>
.swap { position: relative; width: 16px; height: 16px; display: grid; place-items: center; flex: none; }
.ico { grid-area: 1 / 1; display: grid; transition: opacity 160ms var(--kb-ease), transform 200ms var(--kb-ease); }
.ico.hide { opacity: 0; transform: scale(.4); }
</style>
