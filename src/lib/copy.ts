import { ref } from 'vue'

/** Copy text and flash a check for 1.4s. One shared flag per key. */
const copied = ref<string | null>(null)
let timer = 0

export function useCopy() {
  function copy(key: string, text: string) {
    try { navigator.clipboard?.writeText(text).catch(() => {}) }
    catch { /* clipboard unavailable in some WebViews */ }
    clearTimeout(timer)
    copied.value = key
    timer = window.setTimeout(() => { copied.value = null }, 1400)
  }
  return { copied, copy }
}
