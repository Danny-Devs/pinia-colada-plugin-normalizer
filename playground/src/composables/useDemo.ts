/**
 * Shared demo state — normalization toggle, update logic.
 *
 * Two REAL modes with REAL behavior:
 * - ON:  entityStore.set() → all normalized queries update (0 refetches)
 * - OFF: queryCache.setQueryData() on ONE raw query → other raw query is stale
 *
 * No faking. Both modes use real Pinia Colada queries.
 */

import { ref, reactive } from 'vue'
import { useQueryCache } from '@pinia/colada'
import { useEntityStore } from 'pinia-colada-plugin-normalizer'
import { updateServerData, resetServerData } from '../api/mock'
import type { Contact } from '../api/mock'

export interface LogEntry {
  time: string
  message: string
  type: 'update' | 'info' | 'warning'
}

export function useDemo() {
  const normalized = ref(true)
  const entityWrites = ref(0)
  const rawUpdates = ref(0)
  const log = reactive<LogEntry[]>([])

  const entityStore = useEntityStore()

  function logEvent(message: string, type: LogEntry['type'] = 'update') {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false })
    log.unshift({ time, message, type })
    if (log.length > 8) log.pop()
  }

  /**
   * Apply an entity update — the core demo interaction.
   *
   * ON mode:  entityStore.set() → all normalized queries see the change
   * OFF mode: setQueryData() on the DETAIL query only → list query is stale
   *
   * Both are REAL Pinia Colada behavior. No simulation.
   */
  function applyUpdate(contact: Contact, description: string) {
    // The server now has the new data (simulating an external change).
    // In a real app, this is the event that triggered the update.
    updateServerData(contact)

    if (normalized.value) {
      // NORMALIZED: write to entity store → all views update automatically.
      // No API calls. No invalidation. One write, all views see it.
      entityStore.set('contact', contact.contactId, { ...contact })
      entityWrites.value++
      logEvent(`${description} — 1 store write, all views updated, 0 refetches`)
    } else {
      // NOT NORMALIZED: update only the detail query's cache blob.
      // The list query has its OWN independent copy — it goes stale.
      // To fix the list, you'd need to invalidate it (triggering a refetch).
      const queryCache = useQueryCache()
      queryCache.setQueryData(
        ['raw', 'contacts', contact.contactId],
        () => ({ ...contact }),
      )
      rawUpdates.value++
      logEvent(`${description} — only detail updated, list is STALE`, 'warning')
    }
  }

  function resetDemo() {
    resetServerData()
    entityWrites.value = 0
    rawUpdates.value = 0
    log.length = 0
    logEvent('Switched mode — queries will re-fetch fresh data', 'info')
  }

  return {
    normalized,
    entityWrites,
    rawUpdates,
    log,
    applyUpdate,
    resetDemo,
    logEvent,
  }
}
