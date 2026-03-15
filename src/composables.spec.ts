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
