import { defineStore } from 'pinia'
import { watch } from 'vue'
import { BackendError, backendEnabled, callFn } from '../services/backend'
import { isUserRejection, signMessage, toMessage } from '../services/nimiq'
import { signInMessage } from '../lib/signin'
import { net } from '../lib/net'
import { prefGet, prefSet } from '../lib/cache'
import { isValidAddress } from '../lib/address'
import type { LedgerEntry } from '../lib/money'
import type { Split } from '../lib/plan'
import type { Contact } from '../services/mock'
import { useWallet } from './wallet'
import { useDry } from './dry'
import { usePlan } from './plan'
import { useFlow } from './flow'
import { onSettled } from './ops'

// Sign in with the wallet, then keep plan, contacts and processed shares in Supabase.
// localStorage stays the offline cache (the plan store), Supabase is the source of truth.
// Everything here is optional: no backend, a declined signature, preview, dry run or
// offline all leave the app working exactly as before, local only.

type Status = 'off' | 'signing' | 'signed' | 'declined' | 'error' | 'expired'
type EventKind = 'connect' | 'sign_in' | 'stake' | 'add_stake' | 'plan_saved' | 'run_done' | 'stop' | 'withdraw' | 'switch'

interface QueueItem { id: string, kind: 'plan' | 'share' | 'event', method: 'PUT' | 'POST', body: unknown, auth: boolean, tries: number }
interface ServerSlice { type: 'send' | 'restake' | 'keep', percent: number, contact_id: string | null }
interface ServerData {
  plan: { slices: ServerSlice[], plan_started_at: string | null, updated_at: string } | null
  contacts: Array<{ id: string, name: string, contact_address: string }>
  shares: Array<{ id: string, amount_luna: number, slice_type: 'send' | 'restake' | 'keep', tx_hash: string | null, status: string, created_at: string }>
}

const MAX_QUEUE = 100
const canon = (a: string) => a.replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim()
const k = (a: string) => a.replace(/\s+/g, '').toUpperCase()
let retryTimer = 0
let wired = false

function toServerContact(c: Contact) {
  return { id: c.id, name: c.name, contact_address: c.address! }
}
function fromServerContact(c: ServerData['contacts'][number]): Contact {
  return { id: c.id, name: c.name, ini: (c.name.trim()[0] || '?').toUpperCase(), address: c.contact_address }
}

export const useSession = defineStore('session', {
  state: () => ({
    address: '',
    token: null as string | null,
    expiresAt: 0,
    status: 'off' as Status,
    error: '',
    lastSyncAt: 0,
    queue: [] as QueueItem[],
    flushing: false,
  }),
  getters: {
    signedIn: s => s.status === 'signed' && !!s.token && s.expiresAt > Date.now(),
    /** Plan tab banner: the backend is there, this wallet could sign in, and hasn't. */
    offerSignIn(s): boolean {
      return backendEnabled && this.eligible && !this.signedIn && s.status !== 'signing' && !!s.address
    },
    /** Real wallet, real network data: preview, dry run and mock never sign in or write. */
    eligible(): boolean {
      const w = useWallet()
      return backendEnabled && w.env === 'nimiqpay' && w.connected && !w.isPreview && !useDry().on
    },
  },
  actions: {
    keyFor(what: string) { return `${what}:${k(this.address)}` },
    persist() {
      if (!this.address) return
      prefSet(this.keyFor('session'), this.token ? JSON.stringify({ token: this.token, expiresAt: this.expiresAt }) : null)
      prefSet(this.keyFor('syncq'), this.queue.length ? JSON.stringify(this.queue) : null)
    },

    /** After Connect wallet (and on every start): reuse the session, or ask to sign in once. */
    async start(address: string) {
      if (!backendEnabled || !address) return
      this.address = canon(address)
      try {
        const s = JSON.parse(prefGet(this.keyFor('session')) || 'null')
        this.token = s?.token ?? null
        this.expiresAt = s?.expiresAt ?? 0
      }
      catch { this.token = null }
      try { this.queue = JSON.parse(prefGet(this.keyFor('syncq')) || '[]') }
      catch { this.queue = [] }
      if (!this.eligible) { this.status = 'off'; return }
      if (this.token && this.expiresAt > Date.now() + 60_000) {
        this.status = 'signed'
        this.pushEvent('connect')
        await this.merge().catch(() => {})
        this.flush()
        return
      }
      this.token = null
      if (prefGet(this.keyFor('signin-declined'))) {
        this.status = 'declined'
        this.pushEvent('connect')
        return
      }
      await this.signIn()
    },

    /** Nonce, wallet signature, session token. A rejection leaves the app local-only. */
    async signIn() {
      if (!this.eligible || this.status === 'signing') return
      this.status = 'signing'
      this.error = ''
      try {
        const n = await callFn<{ nonce: string, issuedAt: string }>('auth-nonce', { body: { address: this.address, network: net.network } })
        const message = signInMessage({ address: this.address, network: net.network, nonce: n.nonce, issuedAt: n.issuedAt })
        const sig = await signMessage(message)
        const r = await callFn<{ token: string, expiresAt: number }>('auth-verify', { body: { address: this.address, network: net.network, nonce: n.nonce, ...sig } })
        this.token = r.token
        this.expiresAt = r.expiresAt
        this.status = 'signed'
        prefSet(this.keyFor('signin-declined'), null)
        this.persist()
        this.pushEvent('connect')
        await this.merge().catch(() => {})
        this.flush()
      }
      catch (error) {
        if (isUserRejection(error)) {
          this.status = 'declined'
          prefSet(this.keyFor('signin-declined'), '1')
        }
        else {
          this.status = 'error'
          this.error = error instanceof BackendError ? error.message : toMessage(error)
        }
        this.pushEvent('connect')
      }
    },

    signOut() {
      this.token = null
      this.expiresAt = 0
      this.status = 'declined'
      this.queue = this.queue.filter(q => !q.auth)
      prefSet(this.keyFor('signin-declined'), '1')
      this.persist()
    },

    /**
     * After sign-in: the server wins where it has data; where it has nothing, local data is
     * uploaded. Shares are facts, so both sides are kept (local ones the server lacks are sent).
     */
    async merge() {
      if (!this.signedIn) return
      const plan = usePlan()
      const server = await callFn<ServerData>('sync', { method: 'GET', token: this.token })
      const upload: { contacts?: unknown[], plan?: unknown } = {}
      const patch: Parameters<typeof plan.applyServer>[0] = {}

      const localContacts = plan.contacts.filter(c => c.address && isValidAddress(c.address))
      if (server.contacts.length) patch.contacts = server.contacts.map(fromServerContact)
      else if (localContacts.length) upload.contacts = localContacts.map(toServerContact)

      if (server.plan) {
        const by = (t: ServerSlice['type']) => server.plan!.slices.find(s => s.type === t)
        const send = by('send'), restake = by('restake'), keep = by('keep')
        patch.saved = [send?.percent ?? 0, restake?.percent ?? 0, keep?.percent ?? 0] as Split
        patch.savedRecipient = send?.contact_id ?? null
        patch.planStartedAt = server.plan.plan_started_at ? Date.parse(server.plan.plan_started_at) : null
      }
      else if (plan.planStartedAt != null || localContacts.length) upload.plan = this.planBody()

      const real = plan.ledger.filter(e => !e.dry).map(e => (e.id ? e : { ...e, id: crypto.randomUUID() }))
      const onServer = new Set(server.shares.map(s => s.id))
      const fromServer: LedgerEntry[] = server.shares.filter(s => s.status === 'confirmed').map(s => ({
        id: s.id, luna: Number(s.amount_luna), at: Date.parse(s.created_at), hash: s.tx_hash ?? undefined, sliceType: s.slice_type,
      }))
      const missing = real.filter(e => !onServer.has(e.id!))
      patch.realLedger = [...fromServer, ...missing]
      plan.applyServer(patch)

      if (upload.contacts || upload.plan) {
        try { await callFn('sync', { method: 'PUT', body: upload, token: this.token }) }
        catch (error) { if (!(error instanceof BackendError) || error.status === 0 || error.status >= 500) this.enqueue({ kind: 'plan', method: 'PUT', body: upload, auth: true }) }
      }
      for (const e of missing) this.pushShare(e)
      this.lastSyncAt = Date.now()
    },

    /** The saved plan as server slices (no contact means the send share is kept). */
    planBody() {
      const plan = usePlan()
      const c = plan.contacts.find(x => x.id === plan.savedRecipient && x.address)
      const [send, restake, keep] = plan.saved
      return {
        slices: [
          { type: 'send', percent: c ? send : 0, contact_id: c && send > 0 ? c.id : null },
          { type: 'restake', percent: restake, contact_id: null },
          { type: 'keep', percent: keep + (c ? 0 : send), contact_id: null },
        ],
        plan_started_at: plan.planStartedAt ? new Date(plan.planStartedAt).toISOString() : null,
      }
    },

    enqueue(item: Omit<QueueItem, 'id' | 'tries'>) {
      // Only the latest plan write matters.
      if (item.kind === 'plan') this.queue = this.queue.filter(q => q.kind !== 'plan')
      this.queue.push({ ...item, id: crypto.randomUUID(), tries: 0 })
      if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE)
      this.persist()
    },

    pushPlan() {
      if (!this.signedIn || !this.eligible) return
      const plan = usePlan()
      this.enqueue({ kind: 'plan', method: 'PUT', auth: true, body: { contacts: plan.contacts.filter(c => c.address && isValidAddress(c.address)).map(toServerContact), plan: this.planBody() } })
      this.flush()
    },

    pushShare(e: LedgerEntry | null | undefined, status: 'confirmed' | 'undone' = 'confirmed') {
      if (!e || e.dry || !e.id || !this.signedIn || !this.eligible) return
      this.enqueue({ kind: 'share', method: 'POST', auth: true, body: { share: { id: e.id, amount_luna: e.luna, slice_type: e.sliceType ?? (e.hash ? 'send' : 'keep'), tx_hash: e.hash ?? null, status } } })
      this.flush()
    },

    /** Fire and forget. Signed in: with the address; otherwise anonymous (address left empty). */
    pushEvent(kind: EventKind, amountLuna?: number) {
      if (!this.eligible) return
      const signed = this.signedIn
      this.enqueue({ kind: 'event', method: 'POST', auth: signed, body: { event: { kind, amount_luna: amountLuna && amountLuna > 0 ? Math.round(amountLuna) : null }, network: net.network } })
      this.flush()
    },

    /** Send queued writes in order. Network trouble: retry later (backoff). Rejected: dropped. */
    async flush() {
      if (this.flushing || !this.queue.length || !backendEnabled) return
      this.flushing = true
      clearTimeout(retryTimer)
      try {
        while (this.queue.length) {
          const item = this.queue[0]
          if (item.auth && !this.signedIn) {
            if (this.status === 'signed' || this.status === 'signing') break
            this.queue.shift(); this.persist(); continue
          }
          try {
            await callFn('sync', { method: item.method, body: item.body, token: item.auth ? this.token : null })
            this.queue.shift()
            this.lastSyncAt = Date.now()
            this.persist()
          }
          catch (error) {
            const status = error instanceof BackendError ? error.status : 0
            if (status === 401 && item.auth) {
              this.token = null; this.status = 'expired'; this.error = 'Session expired. Sign in again.'
              this.persist()
              break
            }
            if (status >= 400 && status < 500) {
              this.error = `Sync rejected a ${item.kind}: ${(error as Error).message}`
              this.queue.shift(); this.persist(); continue
            }
            item.tries++
            this.persist()
            retryTimer = window.setTimeout(() => this.flush(), Math.min(60_000, 2000 * 2 ** Math.min(item.tries, 5)))
            break
          }
        }
      }
      finally { this.flushing = false }
    },
  },
})

/** Hook plan saves, shares and money actions into sync and events. Called once from App.vue. */
export function wireSession() {
  if (wired) return
  wired = true
  const session = useSession(), plan = usePlan(), flow = useFlow()
  // Plan and contacts: any change to what the server stores (save, add or remove a contact,
  // undo) is pushed, debounced; changes that came from the server are not echoed back.
  const synced = () => JSON.stringify([plan.owner, plan.contacts.map(c => [c.id, c.name, c.address]), plan.saved, plan.savedRecipient, plan.planStartedAt])
  let last = synced(), timer = 0, applying = false
  watch(synced, (now) => {
    clearTimeout(timer)
    const owner = JSON.parse(now)[0], prevOwner = JSON.parse(last)[0]
    if (applying || owner !== prevOwner) { last = now; return }
    timer = window.setTimeout(() => { if (synced() !== last) { last = synced(); session.pushPlan() } }, 600)
  })
  plan.$onAction(({ name, args, after }) => {
    if (name === 'save') after(() => session.pushEvent('plan_saved'))
    else if (name === 'applyServer') { applying = true; after(() => { last = synced(); applying = false }) }
    else if (name === 'recordShared') after(entry => session.pushShare(entry as LedgerEntry | null))
    else if (name === 'undoShared') {
      const e = plan.ledger.find(x => x.id === args[0])
      after(() => session.pushShare(e, 'undone'))
    }
  })
  onSettled((op) => {
    if (op.dry || op.phase !== 'confirmed') return
    const r = op.req
    if (op.flow === 'stake') session.pushEvent(r.kind === 'newStaker' ? 'stake' : 'add_stake', r.value)
    else if (op.flow === 'unstake') session.pushEvent('stop')
    else if (op.flow === 'withdraw' && r.kind === 'remove') session.pushEvent('withdraw', r.value)
    else if (op.flow === 'switch') session.pushEvent('switch')
  })
  watch(() => flow.doneKey, () => {
    if (flow.runPhase !== 'done') return
    const shared = flow.steps.filter(s => s.st === 'approved').reduce((a, s) => a + (s.luna ?? 0), 0)
    session.pushEvent('run_done', shared)
  })
  window.addEventListener('online', () => session.flush())
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') session.flush() })
}
