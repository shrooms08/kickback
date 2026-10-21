import { defineStore } from 'pinia'
import type { PoolId, WalletResponse } from '../services/mock'
import type { ScreenName } from './nav'

export type ApproveKind = 'stake' | 'switch' | 'unstake' | 'keep'
export type ErrorFrom = 'stake' | 'switch' | 'unstake' | 'network' | 'notSent' | 'chainFailed'
export type StepState = 'pending' | 'waiting' | 'checking' | 'confirming' | 'approved' | 'cancelled' | 'failed' | 'skipped'
export type StepType = 'send' | 'restake' | 'keep' | 'retire' | 'remove'

export interface RunStep {
  type: StepType
  amt: number
  label: string
  st: StepState
  /** Keep needs no approval. */
  auto?: boolean
  /** Exact amount in Luna (live). */
  luna?: number
  /** Send: contact address. */
  recipient?: string
  /** The op carrying this step (live), for resume after a restart. */
  opId?: string
  /** Still confirming after 2 minutes. */
  slow?: boolean
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
    /** Error came from loading live data: Retry loads it again. */
    errorLive: false,
    /** Dev-only: what the simulated Nimiq Pay answers next. */
    walletResp: 'approve' as WalletResponse,
    runPhase: 'review' as 'review' | 'running' | 'done',
    doneMode: 'full' as 'full' | 'partial',
    steps: [] as RunStep[],
    /** Bumped when Run my plan finishes, to replay the Stack fill. */
    doneKey: 0,
    /** Live: the op behind the Approve screen. */
    approveOpId: '' as string,
    /** Where to go back after a failed money action. */
    errorBack: null as ScreenName | null,
    /** Live run: why the amount is lower than Ready to share, and other notes. */
    runCapped: '' as string,
    runNote: '' as string,
    runAmountLuna: 0,
    /** Withdraw (retire then remove) steps. */
    wSteps: [] as RunStep[],
    wPhase: 'review' as 'review' | 'running' | 'done',
    /** Amount of the last stake action (Luna), for Success. */
    lastStakeLuna: 0,
    lastStakeAdd: false,
  }),
})
