import { defineStore } from 'pinia'
import { DEFAULT_CONTACTS, DEFAULT_PLAN, NO_CONTACT_PLAN } from '../services/mock'
import type { Contact } from '../services/mock'
import { sameSplit } from '../lib/plan'
import type { Split } from '../lib/plan'
import type { Counted, LedgerEntry } from '../lib/money'
import { EMPTY_COUNTED, rememberKickbacks } from '../lib/money'
import { prefGet, prefSet } from '../lib/cache'
import { DEFAULT_MIN_READY, MIN_READY_CHOICES } from '../lib/minReady'
import { uuid } from '../lib/uuid'

/** One slice of a plan, in order. Send slices carry their contact. */
export type Slice =
  | { kind: 'send', pct: number, contact: Contact }
  | { kind: 'restake', pct: number }
  | { kind: 'keep', pct: number }

interface Persisted {
  contacts: Contact[]
  saved: Split
  savedRecipient: string | null
  planStartedAt: number | null
  ledger: LedgerEntry[]
  /** Run when ready reaches (Luna). */
  minReadyLuna?: number
  /** Testnet only: test kickbacks marked in Diagnostics. */
  marked?: MarkedKickback[]
  /** Real wallet kickbacks counted since the plan started (they stay ready after leaving the 30-day history). */
  counted?: Counted
}

/** A testnet test kickback: real testnet NIM already in the wallet, marked as ready to share. */
export interface MarkedKickback { at: number, luna: number }

interface Backup { contacts: Contact[], recipient: string | null, savedRecipient: string | null, saved: Split, pct: Split }

let contactsBackup: Backup | null = null

let lastWritten = ''
let subscribed = false

/**
 * Saved plan plus the plan editor's working copy. Live plans are stored in
 * localStorage per wallet address (Phase 4 moves them to Supabase); mock mode
 * keeps the prototype's contacts in memory.
 */
export const usePlan = defineStore('plan', {
  state: () => ({
    /** Address the plan belongs to ('' = mock / not loaded). */
    owner: '',
    /** First time a plan was saved: kickbacks before this are not shared. */
    planStartedAt: null as number | null,
    /** Amounts already shared (successful steps), for Ready to share. */
    ledger: [] as LedgerEntry[],
    /** Testnet only: test kickbacks marked in Diagnostics (plans are stored per network). */
    marked: [] as MarkedKickback[],
    /** Kickbacks counted since the plan started, remembered by hash. */
    counted: EMPTY_COUNTED as Counted,
    /** Run when ready reaches: 0.10 / 1 / 5 NIM (Luna). */
    minReadyLuna: DEFAULT_MIN_READY as number,
    contacts: DEFAULT_CONTACTS.slice() as Contact[],
    saved: DEFAULT_PLAN.slice() as Split,
    savedRecipient: 'mom' as string | null,
    // editor working copy
    pct: DEFAULT_PLAN.slice() as Split,
    recipient: 'mom' as string | null,
    /** Card order is frozen while dragging so cards don't jump under the finger. */
    dragRanks: null as number[] | null,
    /** Last added contact, for the pop-in animation. */
    newContactId: null as string | null,
  }),
  getters: {
    hasContacts: s => s.contacts.length > 0,
    dirty: s => !sameSplit(s.pct, s.saved) || s.recipient !== s.savedRecipient,
    /** When the plan last ran in a mode (latest ledger entry of that mode). */
    lastRunAtFor: s => (dry: boolean) => s.ledger.reduce((m, e) => !!e.dry === dry ? Math.max(m, e.at) : m, 0) || null,
    /** The saved plan as ordered slices: send (per contact), restake, keep. */
    slices(s): Slice[] {
      const out: Slice[] = []
      const c = s.contacts.find(x => x.id === s.savedRecipient) ?? (s.saved[0] > 0 ? s.contacts[0] : undefined)
      if (c && s.saved[0] > 0) out.push({ kind: 'send', pct: s.saved[0], contact: c })
      if (s.saved[1] > 0) out.push({ kind: 'restake', pct: s.saved[1] })
      // Keep is always last so it takes any rounding remainder.
      out.push({ kind: 'keep', pct: s.saved[2] + (c ? 0 : s.saved[0]) })
      return out
    },
  },
  actions: {
    contact(id: string | null): Contact {
      return this.contacts.find(c => c.id === id) || this.contacts[0] || { id: '', name: '', ini: '' }
    },
    /**
     * The recipient the screens show for an id: that contact, else the first contact (what
     * contact() displays), else none. Stored explicitly so the saved plan is what was on screen.
     */
    resolveRecipient(id: string | null): string | null {
      return this.contacts.find(c => c.id === id)?.id ?? this.contacts[0]?.id ?? null
    },
    /** Opening the editor starts from the saved plan. */
    beginEdit() {
      this.pct = this.saved.slice() as Split
      this.recipient = this.resolveRecipient(this.savedRecipient)
      this.dragRanks = null
    },
    save() {
      this.saved = this.pct.slice() as Split
      // The editor shows contact(recipient), which falls back to the first contact: save that one.
      this.savedRecipient = this.resolveRecipient(this.recipient)
      this.recipient = this.savedRecipient
      if (this.owner && this.planStartedAt == null) this.planStartedAt = Date.now()
      this.persist()
    },
    /** Load the plan for a wallet address (live). New addresses start with no contacts. */
    loadFor(address: string) {
      this.owner = address
      let p: Persisted | null = null
      try { p = JSON.parse(prefGet('plan:' + address.replace(/\s/g, '')) || 'null') }
      catch { p = null }
      const d: Persisted = p ?? { contacts: [], saved: NO_CONTACT_PLAN.slice() as Split, savedRecipient: null, planStartedAt: null, ledger: [] }
      lastWritten = ''
      this.$patch({ contacts: d.contacts, saved: d.saved, savedRecipient: d.savedRecipient, planStartedAt: d.planStartedAt, ledger: d.ledger, marked: d.marked ?? [], counted: d.counted ?? EMPTY_COUNTED, minReadyLuna: d.minReadyLuna ?? DEFAULT_MIN_READY, pct: d.saved.slice() as Split, recipient: d.savedRecipient, dragRanks: null })
      // Older plans could hold a send share with no recipient while Home and the Plan tab
      // showed the first contact: store that contact, so what is shown is what runs and syncs.
      if (this.contacts.length && !this.contacts.some(c => c.id === this.savedRecipient)) this.savedRecipient = this.resolveRecipient(this.savedRecipient)
      this.recipient = this.savedRecipient
      this.autoPersist()
    },
    persist() {
      if (!this.owner) return
      const d: Persisted = { contacts: this.contacts, saved: this.saved, savedRecipient: this.savedRecipient, planStartedAt: this.planStartedAt, ledger: this.ledger, minReadyLuna: this.minReadyLuna, ...(this.marked.length ? { marked: this.marked } : {}), ...(this.counted.items.length || this.counted.foldedLuna ? { counted: this.counted } : {}) }
      const json = JSON.stringify(d)
      if (json === lastWritten) return
      // Remembered only once stored, so a failed write (storage full) is tried again next time.
      if (prefSet('plan:' + this.owner.replace(/\s/g, ''), json)) lastWritten = json
    },
    /** Persist automatically on any change (drag moves only touch the editor copy, so they don't write). */
    autoPersist() {
      if (subscribed) return
      subscribed = true
      this.$subscribe(() => this.persist())
    },
    /**
     * A step succeeded: its amount is no longer ready to share. Dry-run shares are kept apart from real ones.
     * `id` (a run step's op id) makes it idempotent: the same id or transaction hash is never recorded twice.
     */
    recordShared(luna: number, hash?: string, dry = false, sliceType: 'send' | 'restake' | 'keep' = 'keep', runId?: string, id?: string): LedgerEntry | null {
      if (luna <= 0) return null
      if (this.ledger.some(e => (id && e.id === id) || (hash && e.hash === hash))) return null
      const entry: LedgerEntry = { id: id ?? uuid(), luna, at: Date.now(), hash, sliceType, ...(runId ? { runId } : {}), ...(dry ? { dry: true } : {}) }
      this.ledger.push(entry)
      this.persist()
      return entry
    },
    /** Undo a share (Keep instead): it is ready to share again. */
    undoShared(id: string | undefined) {
      if (!id) return
      this.ledger = this.ledger.filter(e => e.id !== id)
      this.persist()
    },
    /**
     * Server data wins (sign-in merge, sync). Real (not dry-run) ledger entries are replaced
     * by the server's shares; dry-run entries stay local.
     */
    applyServer(d: { contacts?: Contact[], saved?: Split, savedRecipient?: string | null, planStartedAt?: number | null, realLedger?: LedgerEntry[], minReadyLuna?: number }) {
      // Unsaved edits in the plan editor stay put: server data only replaces the saved plan.
      const editing = this.dirty
      if (d.contacts) this.contacts = d.contacts
      if (d.minReadyLuna && (MIN_READY_CHOICES as readonly number[]).includes(d.minReadyLuna)) this.minReadyLuna = d.minReadyLuna
      if (d.saved) { this.saved = d.saved; if (!editing) this.pct = d.saved.slice() as Split }
      if (d.savedRecipient !== undefined) this.savedRecipient = d.savedRecipient
      if (!editing || !this.contacts.some(c => c.id === this.recipient)) this.recipient = this.resolveRecipient(editing ? this.recipient : this.savedRecipient)
      if (d.planStartedAt !== undefined) this.planStartedAt = d.planStartedAt
      if (d.realLedger) this.ledger = [...this.ledger.filter(e => e.dry), ...d.realLedger].sort((a, b) => a.at - b.at)
      this.persist()
    },
    /** Remember kickbacks seen now (history, full scan, or the server's verified list). Writes only on change. */
    rememberKickbacks(seen: ReadonlyArray<{ hash: string, at: number, luna: number, restaked?: boolean, dry?: boolean, manual?: boolean }>) {
      const next = rememberKickbacks(this.counted, seen, this.planStartedAt)
      if (next !== this.counted) { this.counted = next; this.persist() }
    },
    setMinReady(luna: number) {
      if (!(MIN_READY_CHOICES as readonly number[]).includes(luna)) return
      this.minReadyLuna = luna
      this.persist()
    },
    /** Testnet: mark real NIM already in the wallet as a ready-to-share test kickback. */
    markTestKickback(luna: number) {
      const last = this.marked[this.marked.length - 1]?.at ?? 0
      this.marked.push({ at: Math.max(Date.now(), last + 1), luna })
      this.persist()
    },
    /** Reset dry run: forget what dry-run runs shared. */
    clearDryLedger() {
      this.ledger = this.ledger.filter(e => !e.dry)
      this.persist()
    },
    addContact(name: string, address?: string) {
      const id = 'c' + Date.now()
      this.contacts.push({ id, name, ini: name[0].toUpperCase(), address })
      this.recipient = id
      this.newContactId = id
      setTimeout(() => { if (this.newContactId === id) this.newContactId = null }, 700)
      this.persist()
      return id
    },
    /** Empty-state toggle (dev): no contacts means no send slice. */
    setNoContacts(on: boolean) {
      if (on) {
        if (this.contacts.length) contactsBackup = { contacts: this.contacts, recipient: this.recipient, savedRecipient: this.savedRecipient, saved: this.saved.slice() as Split, pct: this.pct.slice() as Split }
        this.$patch({ contacts: [], recipient: null, savedRecipient: null, saved: NO_CONTACT_PLAN.slice() as Split, pct: NO_CONTACT_PLAN.slice() as Split })
      }
      else {
        const b = contactsBackup || { contacts: DEFAULT_CONTACTS.slice(), recipient: 'mom', savedRecipient: 'mom', saved: DEFAULT_PLAN.slice() as Split, pct: DEFAULT_PLAN.slice() as Split }
        this.$patch({ contacts: b.contacts, recipient: b.recipient, savedRecipient: b.savedRecipient, saved: b.saved, pct: b.pct })
        contactsBackup = null
      }
    },
  },
})
