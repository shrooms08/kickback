<script setup lang="ts">
// Every icon used by the prototype, on a 24px grid, stroke = currentColor.
export type IconName =
  | 'copy' | 'check' | 'back' | 'close' | 'plus' | 'minus' | 'arrow' | 'lock' | 'shield' | 'shieldCheck'
  | 'retry' | 'offline' | 'clock' | 'warning' | 'trend' | 'kickback' | 'backspace' | 'phoneCheck'
  | 'home' | 'bars' | 'plan' | 'run' | 'wallet'
  | 'bell' | 'share' | 'download' | 'info' | 'chevronDown' | 'heart' | 'coins' | 'ring' | 'user' | 'calendar' | 'link'

const props = withDefaults(defineProps<{ name: IconName, size?: number, stroke?: number, color?: string }>(), { size: 20, stroke: 2 })

const PATHS: Record<IconName, string> = {
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  share: '<path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  download: '<path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.5"/>',
  chevronDown: '<path d="M7 10l5 5 5-5"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  coins: '<ellipse cx="9" cy="7" rx="5" ry="2.5"/><path d="M4 7v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V7"/><path d="M10 15.6c.6 1.1 2.6 1.9 5 1.9 2.8 0 5-1.1 5-2.5v-4c0-1.2-1.6-2.2-3.9-2.4"/>',
  ring: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 8 8"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16"/><path d="M9 3.5v4M15 3.5v4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>',
  shieldCheck: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4"/>',
  retry: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4.5V11h-6.5"/>',
  offline: '<path d="M2 8.5a15 15 0 0 1 4.5-2.8M10.5 5A15 15 0 0 1 22 8.5M5 12.5a10 10 0 0 1 4-2.3M15.6 10.7A10 10 0 0 1 19 12.5M8.5 16a5 5 0 0 1 7 0M3 3l18 18"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  warning: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  trend: '<path d="M6 17c4 0 7-2 9-6l2-4"/><path d="M11 7h6v6"/>',
  kickback: '<path d="M17 7L7 17M7 9v8h8"/>',
  backspace: '<path d="M21 5H9l-6 7 6 7h12z"/><path d="M13 9.5l5 5M18 9.5l-5 5"/>',
  phoneCheck: '<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M9.5 12.5l2 2 3.5-4"/>',
  home: '<path d="M3.5 10.5L12 3.5l8.5 7V20h-5.5v-6h-6v6H3.5z"/>',
  bars: '<path d="M5 20v-8M12 20V5M19 20v-11"/>',
  plan: '<rect x="3" y="4" width="18" height="6" rx="3"/><rect x="3" y="9" width="18" height="6" rx="3"/><rect x="3" y="14" width="18" height="6" rx="3"/>',
  run: '<path d="M5.5 17.5c4.2 0 7-2 9-6l2-4"/><path d="M11 7.5h5.5V13"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M16 12.5h2"/>',
}
</script>

<template>
  <svg
    :width="props.size" :height="props.size" viewBox="0 0 24 24" fill="none"
    :stroke="props.color || 'currentColor'" :stroke-width="props.stroke" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" v-html="PATHS[props.name]"
  />
</template>
