<script setup lang="ts">
// Full-screen modal body (Approve, Success, Run my plan). The Stage slides it
// up over the current screen, scales that screen to .94 behind it, and lets
// the user drag it down from its top 80px to dismiss.
withDefaults(defineProps<{ centered?: boolean }>(), { centered: false })
</script>

<template>
  <div class="kb-scroll">
    <div class="body" :class="{ centered }">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.body { min-height: 100%; padding: 8px 20px calc(24px + var(--kb-safe-bottom)); display: flex; flex-direction: column; gap: 20px; }
.body.centered { padding: 24px 24px calc(28px + var(--kb-safe-bottom)); gap: 0; }
</style>
