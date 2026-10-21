<script setup lang="ts">
import { computed } from 'vue'
import ContactBubble from '../components/ContactBubble.vue'
import PlanEditor from './PlanEditor.vue'
import { usePlan } from '../stores/plan'
import { useUi } from '../stores/ui'
import { removeRecipient, resetPlan } from '../flows'

const plan = usePlan()
const ui = useUi()
const rec = computed(() => plan.contact(plan.recipient))
const hasRec = computed(() => plan.hasContacts && !!rec.value.id)
</script>

<template>
  <div class="kb-scroll">
    <div class="kb-page">
      <div class="head">
        <span class="kb-eyebrow" style="font-size: 13px">Every kickback</span>
        <button class="kb-link" style="color: var(--kb-text-2)" @click="resetPlan">Reset</button>
      </div>
      <h1 class="kb-h1" style="font-size: 44px">Your plan</h1>
      <div class="people">
        <div class="kb-eyebrow">{{ plan.hasContacts ? 'Send slice goes to' : 'No one yet' }}</div>
        <div class="bubbles">
          <ContactBubble add @pick="ui.openSheet('add')" />
          <ContactBubble
            v-for="(c, i) in plan.contacts" :key="c.id" :contact="c" :index="i"
            :selected="c.id === plan.recipient" :pop="c.id === plan.newContactId" @pick="plan.recipient = c.id"
          />
        </div>
        <div v-if="hasRec" class="sending">
          <span>Sending to {{ rec.name }}</span>
          <button class="kb-link kb-link-quiet remove" @click="removeRecipient">Remove {{ rec.name }}</button>
        </div>
      </div>
      <PlanEditor />
    </div>
  </div>
</template>

<style scoped>
.head { height: 52px; display: flex; align-items: center; justify-content: space-between; }
.people { display: flex; flex-direction: column; gap: 12px; }
.bubbles { display: flex; gap: 14px; overflow-x: auto; padding: 4px 4px 2px; margin: 0 -4px; scrollbar-width: none; }
.bubbles::-webkit-scrollbar { display: none; }
.sending { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; color: var(--kb-text-2); margin-top: -4px; }
.remove { font-size: 13px; padding: 0 2px; }
</style>
