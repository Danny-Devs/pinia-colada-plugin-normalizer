/**
 * Integration tests — full Pinia Colada round-trip.
 *
 * These test the ACTUAL plugin behavior: install the plugin, mount a component
 * with useQuery, verify that data flows through normalize → entity store →
 * denormalize → component data correctly.
 *
 * Follows the delay plugin's test pattern: mount → defineComponent → useQuery.
 */

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref, nextTick, computed } from 'vue'
import { createPinia } from 'pinia'
import { PiniaColada, useQuery, useQueryCache } from '@pinia/colada'
import type { PiniaColadaOptions } from '@pinia/colada'
import { PiniaColadaNormalizer, useEntityStore, defineEntity } from './index'
import { NORM_META_KEY } from './types'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('Plugin Integration', () => {
  enableAutoUnmount(afterEach)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Mount a component with useQuery + our normalizer plugin installed.
   */
  function factory(
    queryFn: () => Promise<unknown>,
    queryKey: unknown[],
    pluginOptions: Parameters<typeof PiniaColadaNormalizer>[0] = {},
    queryOptions: Record<string, unknown> = {},
  ) {
    const pinia = createPinia()
    const wrapper = mount(
      defineComponent({
        template: '<div></div>',
        setup() {
          const result = useQuery({
            query: queryFn,
            key: queryKey,
            normalize: true,
            ...queryOptions,
          })
          return { ...result }
        },
      }),
      {
        global: {
          plugins: [
            pinia,
            [PiniaColada, {
              plugins: [PiniaColadaNormalizer(pluginOptions)],
            } satisfies PiniaColadaOptions],
          ],
        },
      },
    )

    return { pinia, wrapper }
  }

  /**
   * Mount two components sharing the same Pinia — simulates two views
   * reading from the same entity store.
   */
  function dualFactory(
    queryFn1: () => Promise<unknown>,
    queryKey1: unknown[],
    queryFn2: () => Promise<unknown>,
    queryKey2: unknown[],
    pluginOptions: Parameters<typeof PiniaColadaNormalizer>[0] = {},
  ) {
    const pinia = createPinia()
    const coladaOptions: PiniaColadaOptions = {
      plugins: [PiniaColadaNormalizer(pluginOptions)],
    }

    const wrapper1 = mount(
      defineComponent({
        template: '<div></div>',
        setup() {
          return { ...useQuery({ query: queryFn1, key: queryKey1, normalize: true }) }
        },
      }),
      { global: { plugins: [pinia, [PiniaColada, coladaOptions]] } },
    )

    const wrapper2 = mount(
      defineComponent({
        template: '<div></div>',
        setup() {
          return { ...useQuery({ query: queryFn2, key: queryKey2, normalize: true }) }
        },
      }),
      { global: { plugins: [pinia, [PiniaColada, coladaOptions]] } },
    )

    return { pinia, wrapper1, wrapper2 }
  }

  // ─────────────────────────────────────────────
  // Basic round-trip
  // ─────────────────────────────────────────────

  describe('normalize → denormalize round-trip', () => {
    it('useQuery returns denormalized data transparently', async () => {
      const { wrapper } = factory(
        async () => [
          { contactId: '1', name: 'Alice' },
          { contactId: '2', name: 'Bob' },
        ],
        ['contacts'],
        { entities: { contact: defineEntity({ idField: 'contactId' }) } },
      )

      await flushPromises()

      const data = wrapper.vm.data as any[]
      expect(data).toHaveLength(2)
      expect(data[0].name).toBe('Alice')
      expect(data[1].name).toBe('Bob')
    })

    it('entities are stored in the entity store', async () => {
      const { pinia } = factory(
        async () => [
          { contactId: '1', name: 'Alice' },
        ],
        ['contacts'],
        { entities: { contact: defineEntity({ idField: 'contactId' }) } },
      )

      await flushPromises()

      const entityStore = useEntityStore(pinia)
      expect(entityStore.has('contact', '1')).toBe(true)
      expect(entityStore.get('contact', '1').value?.name).toBe('Alice')
    })

    it('non-entity data passes through unchanged', async () => {
      const { wrapper } = factory(
        async () => ({
          contacts: [{ contactId: '1', name: 'Alice' }],
          pagination: { page: 1, total: 10 },
        }),
        ['contacts'],
        { entities: { contact: defineEntity({ idField: 'contactId' }) } },
      )

      await flushPromises()

      const data = wrapper.vm.data as any
      expect(data.contacts[0].name).toBe('Alice')
      expect(data.pagination).toEqual({ page: 1, total: 10 })
    })
  })

  // ─────────────────────────────────────────────
  // Multi-query entity sharing
  // ─────────────────────────────────────────────

  describe('entity sharing across queries', () => {
    it('two queries see the same entity data', async () => {
      const contacts = [
        { contactId: '1', name: 'Alice' },
        { contactId: '2', name: 'Bob' },
      ]

      const { pinia, wrapper1, wrapper2 } = dualFactory(
        async () => contacts.map((c) => ({ ...c })),
        ['contacts'],
        async () => ({ ...contacts[0] }),
        ['contacts', '1'],
        { entities: { contact: defineEntity({ idField: 'contactId' }) } },
      )

      await flushPromises()

      // Both queries return Alice
      const listData = wrapper1.vm.data as any[]
      const detailData = wrapper2.vm.data as any
      expect(listData[0].name).toBe('Alice')
      expect(detailData.name).toBe('Alice')
    })

    it('entityStore.set() propagates to all queries', async () => {
      const contacts = [
        { contactId: '1', name: 'Alice' },
        { contactId: '2', name: 'Bob' },
      ]

      const { pinia, wrapper1, wrapper2 } = dualFactory(
        async () => contacts.map((c) => ({ ...c })),
        ['contacts'],
        async () => ({ ...contacts[0] }),
        ['contacts', '1'],
        { entities: { contact: defineEntity({ idField: 'contactId' }) } },
      )

      await flushPromises()

      // Update Alice via entity store (simulating WebSocket push)
      const entityStore = useEntityStore(pinia)
      entityStore.set('contact', '1', { contactId: '1', name: 'Alicia' })

      await nextTick()

      // Both queries reflect the update
      const listData = wrapper1.vm.data as any[]
      const detailData = wrapper2.vm.data as any
      expect(listData[0].name).toBe('Alicia')
      expect(detailData.name).toBe('Alicia')
    })
  })

  // ─────────────────────────────────────────────
  // Shallow merge
  // ─────────────────────────────────────────────

  describe('shallow merge on entity update', () => {
    it('preserves fields from richer queries', async () => {
      const { pinia } = factory(
        async () => ({ contactId: '1', name: 'Alice', email: 'alice@test.com', role: 'Engineer' }),
        ['contacts', '1'],
        { entities: { contact: defineEntity({ idField: 'contactId' }) } },
      )

      await flushPromises()

      // Update with partial data (no email) — email should be preserved
      const entityStore = useEntityStore(pinia)
      entityStore.set('contact', '1', { contactId: '1', name: 'Alicia' })

      expect(entityStore.get('contact', '1').value).toEqual({
        contactId: '1',
        name: 'Alicia',
        email: 'alice@test.com',
        role: 'Engineer',
      })
    })
  })

  // ─────────────────────────────────────────────
  // Opt-in behavior
  // ─────────────────────────────────────────────

  describe('opt-in normalization', () => {
    it('does not normalize queries without normalize: true', async () => {
      const pinia = createPinia()
      const wrapper = mount(
        defineComponent({
          template: '<div></div>',
          setup() {
            return {
              ...useQuery({
                query: async () => [{ contactId: '1', name: 'Alice' }],
                key: ['contacts'],
                // NO normalize: true
              }),
            }
          },
        }),
        {
          global: {
            plugins: [
              pinia,
              [PiniaColada, {
                plugins: [PiniaColadaNormalizer({
                  entities: { contact: defineEntity({ idField: 'contactId' }) },
                })],
              }],
            ],
          },
        },
      )

      await flushPromises()

      // Data should be raw (not normalized)
      const data = wrapper.vm.data as any[]
      expect(data[0].name).toBe('Alice')

      // Entity store should NOT have this entity
      const entityStore = useEntityStore(pinia)
      expect(entityStore.has('contact', '1')).toBe(false)
    })
  })

  // ─────────────────────────────────────────────
  // Edge cases
  // ─────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles query returning null', async () => {
      const { wrapper } = factory(
        async () => null,
        ['empty'],
        { entities: { contact: defineEntity({ idField: 'contactId' }) } },
      )

      await flushPromises()
      expect(wrapper.vm.data).toBeNull()
    })

    it('handles query returning primitives', async () => {
      const { wrapper } = factory(
        async () => 42,
        ['count'],
        { entities: { contact: defineEntity({ idField: 'contactId' }) } },
      )

      await flushPromises()
      expect(wrapper.vm.data).toBe(42)
    })

    it('handles empty arrays', async () => {
      const { wrapper } = factory(
        async () => [],
        ['empty-list'],
        { entities: { contact: defineEntity({ idField: 'contactId' }) } },
      )

      await flushPromises()
      expect(wrapper.vm.data).toEqual([])
    })
  })
})
