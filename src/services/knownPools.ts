// Reward addresses of the direct-payout pools Kickback knows, checked on chain (2026-10-28: the
// Validators API addresses, and the seed probe stakers' delegations and payout senders). Used only
// when getValidatorByAddress can't be read; never guessed from where some staker delegates.
// Same table server side in supabase/functions/pool-stats-cron/index.ts.
export const KNOWN_REWARDS: Record<string, string> = {
  // Nimiq.Fun
  NQ321U9X7P3XB2H5XA005LC25KFEVBQEX3BU: 'NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717',
  // ObsidianStake (pays from its validator address)
  NQ155JNSU7CERAH53T02F8A9JCT6QMG97TSV: 'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV',
}

export function knownReward(validator: string): string | null {
  return KNOWN_REWARDS[validator.replace(/\s+/g, '').toUpperCase()] ?? null
}
