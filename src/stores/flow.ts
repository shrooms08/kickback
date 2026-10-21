import { defineStore } from 'pinia'
import type { PoolId, WalletResponse } from '../services/mock'
import type { ScreenName } from './nav'

export type ApproveKind = 'stake' | 'switch' | 'unstake' | 'keep'
export type ErrorFrom = 'stake' | 'switch' | 'unstake' | 'network'
export type StepState = 'pending' | 'waiting' | 'approved' | 'cancelled' | 'failed' | 'skipped'
export type StepType = 'send' | 'restake' | 'keep'

export interface RunStep {
  type: StepType
  amt: number
  label: string
  st: StepState
  /** Keep needs no approval. */
  auto?: boolean
}

/** Short-lived state of the money flows: stake amount, approvals, errors, Run my plan. */
export const useFlow = defineStore('flow', {
  state: () => ({
    amount: '7300',
    poolPick: 'fun' as PoolId,
    approveKind: 'stake' as ApproveKind,
    approveFrom: null as ScreenName | null,
    errorFrom: null as ErrorFrom | null,
    /** Error came from Connect wallet: Retry runs the connection again. */
    errorConnect: false,
    /** Dev-only: what the simulated Nimiq Pay answers next. */
    walletResp: 'approve' as WalletResponse,
    runPhase: 'review' as 'review' | 'running' | 'done',
    doneMode: 'full' as 'full' | 'partial',
    steps: [] as RunStep[],
    /** Bumped when Run my plan finishes, to replay the Stack fill. */
    doneKey: 0,
  }),
})
