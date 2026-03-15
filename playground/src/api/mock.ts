/**
 * Mock API — simulates a real server with mutable data.
 *
 * The server data can be updated (simulating external changes from other
 * users, background processes, etc.). Both endpoints always return the
 * current server state — just like a real API would.
 */

export interface Contact {
  contactId: string
  name: string
  email: string
  role: string
  status: 'active' | 'inactive'
}

// Mutable server data — this is what the "server" currently has.
// External updates modify this, so refetches return the correct data.
const serverData = new Map<string, Contact>([
  ['1', { contactId: '1', name: 'Alice Chen', email: 'alice@acme.com', role: 'Engineer', status: 'active' }],
  ['2', { contactId: '2', name: 'Bob Park', email: 'bob@acme.com', role: 'Designer', status: 'active' }],
  ['3', { contactId: '3', name: 'Charlie Reeves', email: 'charlie@acme.com', role: 'PM', status: 'active' }],
  ['4', { contactId: '4', name: 'Diana Lopez', email: 'diana@acme.com', role: 'Engineer', status: 'inactive' }],
])

const ORIGINAL_DATA: Contact[] = [
  { contactId: '1', name: 'Alice Chen', email: 'alice@acme.com', role: 'Engineer', status: 'active' },
  { contactId: '2', name: 'Bob Park', email: 'bob@acme.com', role: 'Designer', status: 'active' },
  { contactId: '3', name: 'Charlie Reeves', email: 'charlie@acme.com', role: 'PM', status: 'active' },
  { contactId: '4', name: 'Diana Lopez', email: 'diana@acme.com', role: 'Engineer', status: 'inactive' },
]

import { ref } from 'vue'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Tracks how many API calls have been made. */
export const fetchCount = ref(0)
export function resetFetchCount() { fetchCount.value = 0 }

/** Update the server's data — simulates an external change. */
export function updateServerData(contact: Contact) {
  serverData.set(contact.contactId, { ...contact })
}

/** Reset server data to original state. */
export function resetServerData() {
  for (const c of ORIGINAL_DATA) {
    serverData.set(c.contactId, { ...c })
  }
}

/** Lightweight contact for list views — no email */
export type ContactSummary = Omit<Contact, 'email'>

/** GET /api/contacts — returns lightweight list (no email needed for list view) */
export async function fetchContacts(): Promise<ContactSummary[]> {
  fetchCount.value++
  await delay(300)
  return [...serverData.values()].map(({ email, ...rest }) => rest)
}

/** GET /api/contacts/:id — returns current server state */
export async function fetchContact(contactId: string): Promise<Contact> {
  fetchCount.value++
  await delay(200)
  const contact = serverData.get(contactId)
  if (!contact) throw new Error(`Contact ${contactId} not found`)
  return { ...contact }
}
