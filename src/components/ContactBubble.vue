<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import type { Contact } from '../services/mock'

// A person in the plan. Unselected bubbles alternate accent / third tints;
// the selected one is lime with a ring. `add` renders the dashed "Add" bubble.
const props = withDefaults(defineProps<{
  contact?: Contact
  index?: number
  selected?: boolean
  pop?: boolean
  add?: boolean
}>(), { index: 0, selected: false, pop: false, add: false })
defineEmits<{ pick: [] }>()

const tint = computed(() => props.index % 2 ? 'third' : 'accent')
</script>

<template>
  <div class="bubble kb-press-soft" role="button" @click="$emit('pick')">
    <div v-if="add" class="disc add"><Icon name="plus" :size="22" /></div>
    <div v-else class="disc" :class="[tint, { on: selected, pop }]">{{ contact?.ini }}</div>
    <span class="name" :class="{ on: selected && !add, add }">{{ add ? 'Add' : contact?.name }}</span>
  </div>
</template>

<style scoped>
.bubble { display: flex; flex-direction: column; align-items: center; gap: 6px; flex: none; }
.disc { width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; font-size: 19px; font-weight: 800; color: var(--kb-text); }
.disc.accent { background: var(--kb-tint-accent); box-shadow: inset 0 0 0 1.5px var(--kb-ring-accent); }
.disc.third { background: var(--kb-tint-third); box-shadow: inset 0 0 0 1.5px var(--kb-ring-third); }
.disc.on { background: var(--kb-lime); color: var(--kb-bg); box-shadow: 0 0 0 3px var(--kb-bg), 0 0 0 5px var(--kb-lime); }
.disc.pop { animation: kbPop 420ms var(--kb-ease) both; }
.disc.add { border: 1.5px dashed var(--kb-text-3); color: var(--kb-lime); background: none; box-shadow: none; }
.name { font-size: 12px; font-weight: 600; color: var(--kb-text-2); }
.name.on { color: var(--kb-text); }
.name.add { font-weight: 400; }
</style>
