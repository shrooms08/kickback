import { ref } from 'vue'

/**
 * The money action that is starting right now ('run', 'stake', …), or null. Set synchronously
 * before the action's first await (see acquire in money.ts); the hold buttons ignore presses while it is set.
 */
export const moneyLock = ref<string | null>(null)
