import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createEntityStore } from './store'
import type { EntityStore } from './types'
import {
  createCoalescer,
} from './composables'

/**
 * Tests for composables that don't require Pinia context.
 * The WS hooks, optimistic updates, useEntityQuery, and createEntityIndex
 * require Pinia (via useEntityStore), so they're tested in integration.spec.ts.
 * The coalescer is framework-agnostic and tested here.
 */

describe('createCoalescer', () => {
  it('batches items and flushes after delay', async () => {
    const onFlush = vi.fn()
    const coalescer = createCoalescer(onFlush, 10)

    coalescer.add('contact:1')
    coalescer.add('contact:2')
    coalescer.add('order:5')

    expect(onFlush).not.toHaveBeenCalled()

    // Wait for the delay
    await new Promise((r) => setTimeout(r, 20))

    expect(onFlush).toHaveBeenCalledOnce()
    expect(onFlush).toHaveBeenCalledWith(['contact:1', 'contact:2', 'order:5'])
  })

  it('manual flush clears timer and sends batch immediately', () => {
    const onFlush = vi.fn()
    const coalescer = createCoalescer(onFlush, 1000)

    coalescer.add('contact:1')
    coalescer.add('contact:2')

    coalescer.flush()

    expect(onFlush).toHaveBeenCalledOnce()
    expect(onFlush).toHaveBeenCalledWith(['contact:1', 'contact:2'])
  })

  it('does not flush empty batch', () => {
    const onFlush = vi.fn()
    const coalescer = createCoalescer(onFlush, 10)

    coalescer.flush()

    expect(onFlush).not.toHaveBeenCalled()
  })

  it('starts a new batch after flush', async () => {
    const onFlush = vi.fn()
    const coalescer = createCoalescer(onFlush, 10)

    coalescer.add('a')
    coalescer.flush()

    coalescer.add('b')
    coalescer.flush()

    expect(onFlush).toHaveBeenCalledTimes(2)
    expect(onFlush.mock.calls[0][0]).toEqual(['a'])
    expect(onFlush.mock.calls[1][0]).toEqual(['b'])
  })
})

// ─────────────────────────────────────────────
// Store-level tests for WS hooks pattern
// (tests the subscribe filtering that WS hooks wrap)
// ─────────────────────────────────────────────

describe('EntityStore subscribe event types', () => {
  it('distinguishes added vs updated via previousData', () => {
    const store = createEntityStore()
    const events: Array<{ type: string; previousData: unknown }> = []

    store.subscribe((event) => {
      events.push({ type: event.type, previousData: event.previousData })
    })

    // First set — entity added (no previousData)
    store.set('contact', '1', { id: '1', name: 'Alice' })
    // Second set — entity updated (has previousData)
    store.set('contact', '1', { id: '1', name: 'Alicia' })
    // Remove
    store.remove('contact', '1')

    expect(events).toHaveLength(3)
    expect(events[0].previousData).toBeUndefined() // added
    expect(events[1].previousData).toBeDefined() // updated
    expect(events[2].type).toBe('remove') // removed
  })
})

// ─────────────────────────────────────────────
// Optimistic update pattern (store-level)
// ─────────────────────────────────────────────

describe('Optimistic update pattern', () => {
  it('save-restore rollback works for existing entities', () => {
    const store = createEntityStore()
    store.set('contact', '1', { id: '1', name: 'Alice', email: 'alice@test.com' })

    // Save current state
    const previous = { ...store.get('contact', '1').value! }

    // Apply optimistic update
    store.set('contact', '1', { id: '1', name: 'Alicia' })
    expect(store.get('contact', '1').value?.name).toBe('Alicia')

    // Rollback
    store.replace('contact', '1', previous)
    expect(store.get('contact', '1').value?.name).toBe('Alice')
    expect(store.get('contact', '1').value?.email).toBe('alice@test.com')
  })

  it('save-restore rollback works for new entities', () => {
    const store = createEntityStore()

    // Entity doesn't exist
    expect(store.has('contact', '99')).toBe(false)

    // Optimistic create
    store.set('contact', '99', { id: '99', name: 'Optimistic' })
    expect(store.has('contact', '99')).toBe(true)

    // Rollback — remove the entity
    store.remove('contact', '99')
    expect(store.has('contact', '99')).toBe(false)
  })

  it('concurrent transactions on same entity handle rollback correctly', () => {
    const store = createEntityStore()
    store.set('contact', '1', { id: '1', name: 'Alice', email: 'alice@test.com' })

    // Simulate concurrent optimistic mutations:
    // Transaction A changes name
    const prevA = { ...store.get('contact', '1').value! }
    store.set('contact', '1', { id: '1', name: 'Alicia' })

    // Transaction B changes email (on top of A's change)
    store.set('contact', '1', { id: '1', email: 'alicia@new.com' })

    // Current state should have both changes
    expect(store.get('contact', '1').value?.name).toBe('Alicia')
    expect(store.get('contact', '1').value?.email).toBe('alicia@new.com')

    // If A rolls back, we need to restore server truth then replay B
    // This is what the transaction-based approach handles
    store.replace('contact', '1', prevA) // restore server truth
    // Replay B's mutation
    store.set('contact', '1', { id: '1', email: 'alicia@new.com' })

    expect(store.get('contact', '1').value?.name).toBe('Alice') // A's change reverted
    expect(store.get('contact', '1').value?.email).toBe('alicia@new.com') // B's change preserved
  })
})

// ─────────────────────────────────────────────
// BUG: Concurrent optimistic commit-then-rollback
// ─────────────────────────────────────────────

describe('Optimistic update: commit A then rollback B (server truth regression)', () => {
  it('rolling back B after A commits does NOT revert A\'s confirmed change', () => {
    const store = createEntityStore()
    store.set('contact', '1', { id: '1', name: 'Alice', email: 'alice@test.com' })

    // Inline optimistic update logic (same as useOptimisticUpdate but without Pinia)
    const serverTruth = new Map<string, { existed: boolean; data?: Record<string, unknown> }>()
    const activeTransactions: Array<{ mutations: Array<{ entityType: string; id: string; type: 'set' | 'remove'; data?: Record<string, unknown> }> }>
      = []

    function entityKey(entityType: string, id: string) { return `${entityType}:${id}` }
    function splitKey(key: string): [string, string] {
      const idx = key.indexOf(':')
      return [key.slice(0, idx), key.slice(idx + 1)]
    }

    function snapshotIfNeeded(entityType: string, id: string) {
      const key = entityKey(entityType, id)
      if (!serverTruth.has(key)) {
        const existed = store.has(entityType, id)
        serverTruth.set(key, {
          existed,
          data: existed ? { ...store.get(entityType, id).value! } : undefined,
        })
      }
    }

    function recompute(affectedKeys: Set<string>) {
      for (const key of affectedKeys) {
        const truth = serverTruth.get(key)
        if (!truth) continue
        const [eType, eId] = splitKey(key)
        const stillReferenced = activeTransactions.some(tx =>
          tx.mutations.some(m => entityKey(m.entityType, m.id) === key),
        )
        if (!stillReferenced) {
          if (truth.existed && truth.data) store.replace(eType, eId, truth.data)
          else if (!truth.existed) store.remove(eType, eId)
          serverTruth.delete(key)
        } else {
          if (truth.existed && truth.data) store.replace(eType, eId, truth.data)
          else if (!truth.existed && store.has(eType, eId)) store.remove(eType, eId)
        }
      }
      for (const tx of activeTransactions) {
        for (const m of tx.mutations) {
          if (m.type === 'set' && m.data) store.set(m.entityType, m.id, m.data)
          else if (m.type === 'remove') store.remove(m.entityType, m.id)
        }
      }
    }

    // Transaction A: change name
    const txAMutations: Array<{ entityType: string; id: string; type: 'set' | 'remove'; data?: Record<string, unknown> }> = []
    const txAEntry = { mutations: txAMutations }
    activeTransactions.push(txAEntry)
    snapshotIfNeeded('contact', '1')
    txAMutations.push({ entityType: 'contact', id: '1', type: 'set', data: { id: '1', name: 'Alicia' } })
    store.set('contact', '1', { id: '1', name: 'Alicia' })

    // Transaction B: change email
    const txBMutations: Array<{ entityType: string; id: string; type: 'set' | 'remove'; data?: Record<string, unknown> }> = []
    const txBEntry = { mutations: txBMutations }
    activeTransactions.push(txBEntry)
    snapshotIfNeeded('contact', '1') // already exists, not overwritten
    txBMutations.push({ entityType: 'contact', id: '1', type: 'set', data: { id: '1', email: 'new@test.com' } })
    store.set('contact', '1', { id: '1', email: 'new@test.com' })

    // Both changes visible
    expect(store.get('contact', '1').value?.name).toBe('Alicia')
    expect(store.get('contact', '1').value?.email).toBe('new@test.com')

    // A commits (server confirmed the name change)
    const idxA = activeTransactions.indexOf(txAEntry)
    activeTransactions.splice(idxA, 1)
    const affectedKeysA = new Set(txAMutations.map(m => entityKey(m.entityType, m.id)))
    for (const key of affectedKeysA) {
      const stillReferenced = activeTransactions.some(tx =>
        tx.mutations.some(m => entityKey(m.entityType, m.id) === key),
      )
      if (!stillReferenced) {
        serverTruth.delete(key)
      } else {
        // FIX: apply this tx's mutations on top of OLD server truth
        const truth = serverTruth.get(key)
        if (truth) {
          let newData = truth.data ? { ...truth.data } : undefined
          for (const m of txAMutations) {
            if (entityKey(m.entityType, m.id) === key) {
              if (m.type === 'set' && m.data) {
                newData = newData ? { ...newData, ...m.data } : { ...m.data }
              } else if (m.type === 'remove') {
                newData = undefined
              }
            }
          }
          serverTruth.set(key, {
            existed: newData != null,
            data: newData,
          })
        }
      }
    }

    // B rolls back (email change failed)
    const idxB = activeTransactions.indexOf(txBEntry)
    const affectedKeysB = new Set(txBMutations.map(m => entityKey(m.entityType, m.id)))
    activeTransactions.splice(idxB, 1)
    recompute(affectedKeysB)

    // A's confirmed name change should survive B's rollback
    // BUG: This FAILS — name is 'Alice' instead of 'Alicia'
    expect(store.get('contact', '1').value?.name).toBe('Alicia')
    // Email should be restored to server truth
    expect(store.get('contact', '1').value?.email).toBe('alice@test.com')
  })
})

// ─────────────────────────────────────────────
// BUG: get() phantom ref + getByType() reactivity
// ─────────────────────────────────────────────

describe('Store: phantom ref from get() before getByType()', () => {
  it('getByType includes entity set via phantom ref from prior get()', () => {
    const store = createEntityStore()

    // Step 1: getByType first — computed is cached, typeMap is empty
    const allContacts = store.getByType('contact')
    expect(allContacts.value).toEqual([])

    // Step 2: get() creates a phantom ref (subscribe-before-data pattern)
    const ref = store.get('contact', '42')
    expect(ref.value).toBeUndefined()

    // Step 3: set() populates the phantom ref
    store.set('contact', '42', { id: '42', name: 'Alice' })

    // Step 4: getByType should include Alice
    // BUG: This FAILS — version wasn't bumped, computed doesn't re-run
    expect(allContacts.value).toHaveLength(1)
    expect(allContacts.value[0].name).toBe('Alice')
  })
})

// ─────────────────────────────────────────────
// Entity index pattern (store-level)
// ─────────────────────────────────────────────

describe('Entity index pattern', () => {
  it('index-based lookup is consistent with filter', () => {
    const store = createEntityStore()
    store.set('contact', '1', { id: '1', name: 'Alice', status: 'active' })
    store.set('contact', '2', { id: '2', name: 'Bob', status: 'inactive' })
    store.set('contact', '3', { id: '3', name: 'Charlie', status: 'active' })

    // Manual filter (what createEntityIndex wraps)
    const allContacts = store.getByType('contact')
    const active = allContacts.value.filter((c) => c.status === 'active')

    expect(active).toHaveLength(2)
    expect(active.map((c) => c.name).sort()).toEqual(['Alice', 'Charlie'])
  })
})
