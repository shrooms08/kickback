<script setup lang="ts">
import Icon from './Icon.vue'
import { useUi, TOAST_UNDO_MS } from '../stores/ui'

// Confirmation toast: lime check, one line, optional action.
// 4s, or 6s with Undo plus a shrinking lime time line.
defineProps<{ bottom: string }>()
const ui = useUi()
</script>

<template>
  <div
    v-if="ui.toast" :key="ui.toast.id" role="status" class="toast"
    :class="{ out: ui.toastOut }" :style="{ bottom }"
  >
    <div class="check"><Icon name="check" :size="14" :stroke="3" /></div>
    <span class="msg">{{ ui.toast.msg }}</span>
    <button v-if="ui.toast.action" class="act" @click="ui.toastAction()">{{ ui.toast.action }}</button>
    <div v-if="ui.toast.undo" class="line" :style="{ animationDuration: TOAST_UNDO_MS + 'ms' }" />
  </div>
</template>

<style scoped>
.toast {
  position: absolute; left: 12px; right: 12px; z-index: 70; min-height: 60px; padding: 8px 8px 8px 12px;
  border-radius: 20px; background: var(--kb-raised); border: 1px solid var(--kb-line); color: var(--kb-text);
  display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: 700; line-height: 1.3;
  box-shadow: var(--kb-sh-float); overflow: hidden;
  animation: kbToastIn 260ms var(--kb-ease) both;
}
.toast.out { animation: kbToastOut 200ms var(--kb-ease-out-in) both; pointer-events: none; }
.check { width: 28px; height: 28px; border-radius: 50%; background: var(--kb-lime); color: var(--kb-bg); display: grid; place-items: center; flex: none; }
.msg { flex: 1; min-width: 0; padding: 6px 0; }
.act {
  height: 44px; padding: 0 14px; border-radius: 14px; border: none; background: transparent; color: var(--kb-lime);
  font-size: 14px; font-weight: 800; cursor: pointer; flex: none; transition: transform var(--kb-dur-press) var(--kb-ease);
}
.act:active { transform: scale(var(--kb-press-scale)); }
.line {
  position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--kb-lime);
  transform-origin: 0 50%; animation: kbShrink linear both;
}
</style>
