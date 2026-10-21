import { defineStore } from 'pinia'
import { DEFAULT_CONTACTS, DEFAULT_PLAN, NO_CONTACT_PLAN } from '../services/mock'
import type { Contact } from '../services/mock'
import { sameSplit } from '../lib/plan'
import type { Split } from '../lib/plan'

interface Backup { contacts: Contact[], recipient: string | null, savedRecipient: string | null, saved: Split, pct: Split }

let contactsBackup: Backup | null = null

/** Saved plan plus the plan editor's working copy. Local only in phase 1. */
export const usePlan = defineStore('plan', {
  state: () => ({
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
  },
  actions: {
    contact(id: string | null): Contact {
      return this.contacts.find(c => c.id === id) || this.contacts[0] || { id: '', name: '', ini: '' }
    },
    /** Opening the editor starts from the saved plan. */
    beginEdit() {
      this.pct = this.saved.slice() as Split
      this.recipient = this.savedRecipient
      this.dragRanks = null
    },
    save() {
      this.saved = this.pct.slice() as Split
      this.savedRecipient = this.recipient
    },
    addContact(name: string) {
      const id = 'c' + Date.now()
      this.contacts.push({ id, name, ini: name[0].toUpperCase() })
      this.recipient = id
      this.newContactId = id
      setTimeout(() => { if (this.newContactId === id) this.newContactId = null }, 700)
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
