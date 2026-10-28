import { prefGet, prefSet } from './cache'

/** The invite code in a URL query (?ref=KICK-XXXX), or null. Same alphabet as the server. */
export function refFromUrl(search: string): string | null {
  const v = new URLSearchParams(search).get('ref')?.trim().toUpperCase() ?? ''
  return /^KICK-[2-9A-HJ-NP-Z]{4}$/.test(v) ? v : null
}

/**
 * On the first open only (nothing stored yet for this network), keep ?ref= for Welcome
 * ("Invited by …") and for the claim after sign-in. Later links never replace it.
 */
export function captureRef(search = typeof location !== 'undefined' ? location.search : ''): void {
  if (prefGet('opened')) return
  prefSet('opened', '1')
  const code = refFromUrl(search)
  if (code && !prefGet('ref')) prefSet('ref', code)
}

export const invitedBy = (): string | null => prefGet('ref')
