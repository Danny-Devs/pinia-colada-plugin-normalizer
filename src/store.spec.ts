import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createEntityStore } from './store'

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

  describe('query', () => {
    it('runs a derived query', () => {
      const store = createEntityStore()
      store.set('contact', '1', { id: '1', name: 'Alice', status: 'active' })
      store.set('contact', '2', { id: '2', name: 'Bob', status: 'inactive' })
      store.set('contact', '3', { id: '3', name: 'Charlie', status: 'active' })

      const activeContacts = store.query((entities) =>
        entities.getByType('contact').filter((c: any) => c.status === 'active'),
      )

      expect(activeContacts.value).toHaveLength(2)
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

  describe('clear', () => {
    it('removes all entities', () => {
      const store = createEntityStore()
      store.set('contact', '1', { id: '1' })
      store.set('order', '100', { id: '100' })

      store.clear()
      expect(store.has('contact', '1')).toBe(false)
      expect(store.has('order', '100')).toBe(false)
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
  })
})
