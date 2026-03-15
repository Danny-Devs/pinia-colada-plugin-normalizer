import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createEntityStore } from './store'
import { ENTITY_REF_MARKER } from './types'

describe('EntityStore (in-memory)', () => {
  describe('set / get', () => {
    it('stores and retrieves an entity', () => {
      const store = createEntityStore()
      store.set('contact', '42', { id: '42', name: 'Alice' })

      const ref = store.get('contact', '42')
      expect(ref.value).toEqual({ id: '42', name: 'Alice' })
    })

    it('shallow-merges on subsequent set', () => {
      const store = createEntityStore()
      store.set('contact', '42', { id: '42', name: 'Alice' })
      store.set('contact', '42', { id: '42', name: 'Alicia' })

      expect(store.get('contact', '42').value).toEqual({ id: '42', name: 'Alicia' })
    })

    it('preserves existing fields not present in incoming data', () => {
      const store = createEntityStore()
      store.set('contact', '42', { id: '42', name: 'Alice', email: 'alice@test.com' })
      store.set('contact', '42', { id: '42', name: 'Alicia' })

      // email is preserved from the first set
      expect(store.get('contact', '42').value).toEqual({ id: '42', name: 'Alicia', email: 'alice@test.com' })
    })

    it('preserves referential identity when set with identical data', () => {
      const store = createEntityStore()
      store.set('contact', '42', { id: '42', name: 'Alice' })
      const before = store.get('contact', '42').value

      store.set('contact', '42', { id: '42', name: 'Alice' })
      const after = store.get('contact', '42').value

      // Same reference — no new object created
      expect(before).toBe(after)
    })

    it('does not emit events when set with identical data', () => {
      const store = createEntityStore()
      store.set('contact', '42', { id: '42', name: 'Alice' })

      const listener = vi.fn()
      store.subscribe(listener)

      store.set('contact', '42', { id: '42', name: 'Alice' })
      expect(listener).not.toHaveBeenCalled()
    })

    it('returns undefined ref for non-existent entity', () => {
      const store = createEntityStore()
      const ref = store.get('contact', '999')
      expect(ref.value).toBeUndefined()
    })

    it('populates ref when entity arrives later', () => {
      const store = createEntityStore()
      const ref = store.get('contact', '42') // subscribe before data
      expect(ref.value).toBeUndefined()

      store.set('contact', '42', { id: '42', name: 'Alice' })
      expect(ref.value).toEqual({ id: '42', name: 'Alice' })
    })
  })

  describe('replace', () => {
    it('fully replaces entity without merging', () => {
      const store = createEntityStore()
      store.set('contact', '42', { id: '42', name: 'Alice', email: 'alice@test.com' })
      store.replace('contact', '42', { id: '42', name: 'Alicia' })

      // email should be GONE — replace doesn't merge
      expect(store.get('contact', '42').value).toEqual({ id: '42', name: 'Alicia' })
    })

    it('creates new entity if it does not exist', () => {
      const store = createEntityStore()
      store.replace('contact', '42', { id: '42', name: 'Alice' })
      expect(store.get('contact', '42').value).toEqual({ id: '42', name: 'Alice' })
    })
  })

  describe('setMany (batch)', () => {
    it('stores multiple entities at once', () => {
      const store = createEntityStore()
      store.setMany([
        { entityType: 'contact', id: '1', data: { id: '1', name: 'Alice' } },
        { entityType: 'contact', id: '2', data: { id: '2', name: 'Bob' } },
        { entityType: 'order', id: '100', data: { id: '100', total: 50 } },
      ])

      expect(store.get('contact', '1').value?.name).toBe('Alice')
      expect(store.get('contact', '2').value?.name).toBe('Bob')
      expect(store.get('order', '100').value?.total).toBe(50)
    })

    it('skips no-op updates and preserves referential identity', () => {
      const store = createEntityStore()
      store.setMany([
        { entityType: 'contact', id: '1', data: { id: '1', name: 'Alice' } },
        { entityType: 'contact', id: '2', data: { id: '2', name: 'Bob' } },
      ])
      const before1 = store.get('contact', '1').value
      const before2 = store.get('contact', '2').value

      const listener = vi.fn()
      store.subscribe(listener)

      // Re-set with identical data — should be no-ops
      store.setMany([
        { entityType: 'contact', id: '1', data: { id: '1', name: 'Alice' } },
        { entityType: 'contact', id: '2', data: { id: '2', name: 'Bob' } },
      ])

      expect(store.get('contact', '1').value).toBe(before1)
      expect(store.get('contact', '2').value).toBe(before2)
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('remove', () => {
    it('removes an entity', () => {
      const store = createEntityStore()
      store.set('contact', '42', { id: '42', name: 'Alice' })
      expect(store.has('contact', '42')).toBe(true)

      store.remove('contact', '42')
      expect(store.has('contact', '42')).toBe(false)
    })

    it('does nothing for non-existent entity', () => {
      const store = createEntityStore()
      expect(() => store.remove('contact', '999')).not.toThrow()
    })
  })

  describe('has', () => {
    it('returns true for existing entities', () => {
      const store = createEntityStore()
      store.set('contact', '42', { id: '42', name: 'Alice' })
      expect(store.has('contact', '42')).toBe(true)
    })

    it('returns false for non-existent entities', () => {
      const store = createEntityStore()
      expect(store.has('contact', '42')).toBe(false)
    })

    it('returns false for wrong entity type', () => {
      const store = createEntityStore()
      store.set('contact', '42', { id: '42', name: 'Alice' })
      expect(store.has('order', '42')).toBe(false)
    })
  })

  describe('getByType', () => {
    it('returns all entities of a type', () => {
      const store = createEntityStore()
      store.set('contact', '1', { id: '1', name: 'Alice' })
      store.set('contact', '2', { id: '2', name: 'Bob' })
      store.set('order', '100', { id: '100', total: 50 })

      const contacts = store.getByType('contact')
      expect(contacts.value).toHaveLength(2)
      expect(contacts.value.map((c: any) => c.name).sort()).toEqual(['Alice', 'Bob'])
    })

    it('returns empty array for non-existent type', () => {
      const store = createEntityStore()
      const result = store.getByType('nonexistent')
      expect(result.value).toEqual([])
    })
  })

  describe('getEntriesByType', () => {
    it('returns id+data pairs for all entities of a type', () => {
      const store = createEntityStore()
      store.set('contact', '1', { name: 'Alice' })
      store.set('contact', '2', { name: 'Bob' })
      store.set('order', '100', { total: 50 })

      const entries = store.getEntriesByType('contact')
      expect(entries).toHaveLength(2)
      expect(entries.map(e => e.id).sort()).toEqual(['1', '2'])
      expect(entries.find(e => e.id === '1')?.data.name).toBe('Alice')
    })

    it('returns canonical store IDs (not heuristic)', () => {
      const store = createEntityStore()
      // Store with a composite ID that doesn't match any field in the data
      store.set('member', 'acme-42', { orgId: 'acme', userId: '42', role: 'admin' })

      const entries = store.getEntriesByType('member')
      expect(entries).toHaveLength(1)
      expect(entries[0].id).toBe('acme-42') // canonical ID, not 'acme' or '42'
    })

    it('returns empty array for non-existent type', () => {
      const store = createEntityStore()
      expect(store.getEntriesByType('nonexistent')).toEqual([])
    })

    it('excludes phantom refs (undefined value)', () => {
      const store = createEntityStore()
      // get() creates a phantom ref
      store.get('contact', '99')
      const entries = store.getEntriesByType('contact')
      expect(entries).toEqual([])
    })
  })

  describe('subscribe', () => {
    it('emits set events', () => {
      const store = createEntityStore()
      const listener = vi.fn()
      store.subscribe(listener)

      store.set('contact', '42', { id: '42', name: 'Alice' })

      expect(listener).toHaveBeenCalledWith({
        type: 'set',
        entityType: 'contact',
        id: '42',
        key: 'contact:42',
        data: { id: '42', name: 'Alice' },
        previousData: undefined,
      })
    })

    it('emits remove events', () => {
      const store = createEntityStore()
      store.set('contact', '42', { id: '42', name: 'Alice' })

      const listener = vi.fn()
      store.subscribe(listener)
      store.remove('contact', '42')

      expect(listener).toHaveBeenCalledWith({
        type: 'remove',
        entityType: 'contact',
        id: '42',
        key: 'contact:42',
        data: undefined,
        previousData: { id: '42', name: 'Alice' },
      })
    })

    it('filters by entity type', () => {
      const store = createEntityStore()
      const listener = vi.fn()
      store.subscribe(listener, { entityType: 'order' })

      store.set('contact', '1', { id: '1' })
      store.set('order', '100', { id: '100' })

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener.mock.calls[0][0].entityType).toBe('order')
    })

    it('returns unsubscribe function', () => {
      const store = createEntityStore()
      const listener = vi.fn()
      const unsub = store.subscribe(listener)

      store.set('contact', '1', { id: '1' })
      expect(listener).toHaveBeenCalledTimes(1)

      unsub()
      store.set('contact', '2', { id: '2' })
      expect(listener).toHaveBeenCalledTimes(1) // no new calls
    })

    it('includes previousData on updates', () => {
      const store = createEntityStore()
      store.set('contact', '42', { id: '42', name: 'Alice' })

      const listener = vi.fn()
      store.subscribe(listener)
      store.set('contact', '42', { id: '42', name: 'Alicia' })

      expect(listener.mock.calls[0][0].previousData).toEqual({ id: '42', name: 'Alice' })
      expect(listener.mock.calls[0][0].data).toEqual({ id: '42', name: 'Alicia' })
    })

    it('emits merged data (not just incoming) on updates', () => {
      const store = createEntityStore()
      store.set('contact', '42', { id: '42', name: 'Alice', email: 'alice@test.com' })

      const listener = vi.fn()
      store.subscribe(listener)
      store.set('contact', '42', { id: '42', name: 'Alicia' })

      // event.data should be the merged result, not just the incoming partial
      expect(listener.mock.calls[0][0].data).toEqual({ id: '42', name: 'Alicia', email: 'alice@test.com' })
    })
  })

  describe('retain / release / gc', () => {
    it('gc removes entities with zero refcount', () => {
      const store = createEntityStore()
      store.set('contact', '1', { id: '1', name: 'Alice' })
      store.set('contact', '2', { id: '2', name: 'Bob' })

      store.retain('contact', '1')
      store.retain('contact', '2')
      store.release('contact', '2')

      const removed = store.gc()

      expect(removed).toEqual(['contact:2'])
      expect(store.has('contact', '1')).toBe(true)
      expect(store.has('contact', '2')).toBe(false)
    })

    it('gc does not touch entities that were never retained', () => {
      const store = createEntityStore()
      // Direct write (e.g., WebSocket) — never retained
      store.set('contact', '1', { id: '1', name: 'Alice' })
      // Query-extracted entity — retained then released
      store.set('contact', '2', { id: '2', name: 'Bob' })
      store.retain('contact', '2')
      store.release('contact', '2')

      const removed = store.gc()

      expect(removed).toEqual(['contact:2'])
      // Direct write entity untouched
      expect(store.has('contact', '1')).toBe(true)
    })

    it('multiple retains require matching releases', () => {
      const store = createEntityStore()
      store.set('contact', '1', { id: '1', name: 'Alice' })

      store.retain('contact', '1')
      store.retain('contact', '1') // two queries reference this
      store.release('contact', '1') // one query gone

      const removed = store.gc()
      expect(removed).toEqual([]) // still referenced by one query
      expect(store.has('contact', '1')).toBe(true)

      store.release('contact', '1') // last query gone
      const removed2 = store.gc()
      expect(removed2).toEqual(['contact:1'])
    })

    it('gc returns empty array when nothing to collect', () => {
      const store = createEntityStore()
      store.set('contact', '1', { id: '1', name: 'Alice' })
      store.retain('contact', '1')

      expect(store.gc()).toEqual([])
    })

    it('gc cleans up refcount entries for collected entities', () => {
      const store = createEntityStore()
      store.set('contact', '1', { id: '1', name: 'Alice' })
      store.retain('contact', '1')
      store.release('contact', '1')
      store.gc()

      // Re-add and retain — should start fresh, not carry stale count
      store.set('contact', '1', { id: '1', name: 'Alice' })
      store.retain('contact', '1')
      expect(store.gc()).toEqual([]) // retained, should not be collected
    })
  })

  describe('clear', () => {
    it('removes all entities', () => {
      const store = createEntityStore()
      store.set('contact', '1', { id: '1' })
      store.set('order', '100', { id: '100' })

      store.clear()
      expect(store.has('contact', '1')).toBe(false)
      expect(store.has('order', '100')).toBe(false)
    })

    it('resets refCounts so gc does not collect re-added entities', () => {
      const store = createEntityStore()
      store.set('contact', '1', { id: '1', name: 'Alice' })
      store.retain('contact', '1')
      store.release('contact', '1')

      // Clear resets everything including refCounts
      store.clear()

      // Re-add and retain fresh
      store.set('contact', '1', { id: '1', name: 'Alice' })
      store.retain('contact', '1')

      // Should not be collected — fresh retain after clear
      expect(store.gc()).toEqual([])
      expect(store.has('contact', '1')).toBe(true)
    })
  })

  describe('toJSON / hydrate', () => {
    it('serializes and restores the store', () => {
      const store1 = createEntityStore()
      store1.set('contact', '1', { id: '1', name: 'Alice' })
      store1.set('contact', '2', { id: '2', name: 'Bob' })
      store1.set('order', '100', { id: '100', total: 50 })

      const snapshot = store1.toJSON()

      const store2 = createEntityStore()
      store2.hydrate(snapshot)

      expect(store2.get('contact', '1').value?.name).toBe('Alice')
      expect(store2.get('contact', '2').value?.name).toBe('Bob')
      expect(store2.get('order', '100').value?.total).toBe(50)
    })

    it('produces correct snapshot format', () => {
      const store = createEntityStore()
      store.set('contact', '42', { id: '42', name: 'Alice' })

      const snapshot = store.toJSON()
      expect(snapshot).toEqual({
        'contact:42': { id: '42', name: 'Alice' },
      })
    })

    it('round-trips entity data containing EntityRefs (nested entities)', () => {
      const store1 = createEntityStore()

      // Simulate normalized entity data: order has a nested EntityRef for its customer
      const orderData = {
        orderId: 'order-1',
        total: 100,
        customer: {
          [ENTITY_REF_MARKER]: true,
          entityType: 'contact',
          id: '42',
          key: 'contact:42',
        },
      }
      store1.set('order', 'order-1', orderData)
      store1.set('contact', '42', { contactId: '42', name: 'Alice' })

      // Serialize to JSON (Symbols must survive the round-trip)
      const snapshot = store1.toJSON()
      const json = JSON.stringify(snapshot)
      const parsed = JSON.parse(json)

      // Hydrate into a fresh store
      const store2 = createEntityStore()
      store2.hydrate(parsed)

      // The contact should be restored normally
      expect(store2.get('contact', '42').value?.name).toBe('Alice')

      // The order's customer field should be a proper EntityRef with the Symbol marker
      const restoredOrder = store2.get('order', 'order-1').value!
      expect(restoredOrder.total).toBe(100)
      const customerRef = restoredOrder.customer as any
      expect(customerRef[ENTITY_REF_MARKER]).toBe(true)
      expect(customerRef.entityType).toBe('contact')
      expect(customerRef.id).toBe('42')
    })
  })
})
