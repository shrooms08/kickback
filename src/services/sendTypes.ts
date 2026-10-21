/** One money action. `value` is always integer Luna. */
export type SendKind = 'payment' | 'newStaker' | 'addStake' | 'setActive' | 'updateStaker' | 'retire' | 'remove'

export interface SendRequest {
  kind: SendKind
  /**
   * payment / newStaker / addStake / remove: amount moved.
   * setActive: the new active balance. retire: amount retired. updateStaker: 0.
   */
  value: number
  recipient?: string
  delegation?: string
  newDelegation?: string
  data?: string
}
