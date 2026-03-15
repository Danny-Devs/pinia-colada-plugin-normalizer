/**
 * Composables and utilities for real-time patterns and DX.
 *
 * Phase 2: WebSocket hooks, optimistic updates, coalescing.
 * Phase 3: Entity queries, indexes.
 *
 * All composables build on top of the EntityStore interface —
 * they work with any backend (in-memory, IndexedDB, SQLite).
 *
 * @module pinia-colada-plugin-normalizer/composables
 */

import { computed, shallowRef } from 'vue'
import type { ComputedRef } from 'vue'
import type { Pinia } from 'pinia'
import type { EntityEvent, EntityRecord, EntityRegistry, ResolveEntity } from './types'
import { useEntityStore } from './plugin'

// ─────────────────────────────────────────────
// Phase 2: WebSocket Adapter Hooks
// ─────────────────────────────────────────────

/**
 * Subscribe to entity additions (new entities entering the store).
 * Fires when `set()` is called for an entity that didn't previously exist.
 *
 * @example
 * ```typescript
 * onEntityAdded('contact', (event) => {
 *   console.log(`New contact: ${event.id}`, event.data)
 *   toast.success(`${event.data.name} joined!`)
 * })
 * ```
 */
export function onEntityAdded<K extends string & keyof EntityRegistry>(entityType: K, callback: (event: EntityEvent<EntityRegistry[K]>) => void, pinia?: Pinia): () => void
export function onEntityAdded(entityType: string, callback: (event: EntityEvent) => void, pinia?: Pinia): () => void
export function onEntityAdded(
  entityType: string,
  callback: (event: EntityEvent) => void,
  pinia?: Pinia,
): () => void {
  const store = useEntityStore(pinia)
  return store.subscribe(
    (event) => {
      if (event.type === 'set' && event.previousData == null) {
        callback(event)
      }
    },
    { entityType },
  )
}

/**
 * Subscribe to entity updates (existing entities being modified).
 * Fires when `set()` or `replace()` is called for an entity that already exists.
 *
 * @example
 * ```typescript
 * onEntityUpdated('contact', (event) => {
 *   console.log(`Contact ${event.id} updated:`, event.previousData, '→', event.data)
 * })
 * ```
 */
export function onEntityUpdated<K extends string & keyof EntityRegistry>(entityType: K, callback: (event: EntityEvent<EntityRegistry[K]>) => void, pinia?: Pinia): () => void
export function onEntityUpdated(entityType: string, callback: (event: EntityEvent) => void, pinia?: Pinia): () => void
export function onEntityUpdated(
  entityType: string,
  callback: (event: EntityEvent) => void,
  pinia?: Pinia,
): () => void {
  const store = useEntityStore(pinia)
  return store.subscribe(
    (event) => {
      if (event.type === 'set' && event.previousData != null) {
        callback(event)
      }
    },
    { entityType },
  )
}

/**
 * Subscribe to entity removals.
 * Fires when `remove()` is called.
 *
 * @example
 * ```typescript
 * onEntityRemoved('contact', (event) => {
 *   console.log(`Contact ${event.id} removed`)
 *   toast.info(`${event.previousData?.name} left`)
 * })
 * ```
 */
export function onEntityRemoved<K extends string & keyof EntityRegistry>(entityType: K, callback: (event: EntityEvent<EntityRegistry[K]>) => void, pinia?: Pinia): () => void
export function onEntityRemoved(entityType: string, callback: (event: EntityEvent) => void, pinia?: Pinia): () => void
export function onEntityRemoved(
  entityType: string,
  callback: (event: EntityEvent) => void,
  pinia?: Pinia,
): () => void {
  const store = useEntityStore(pinia)
  return store.subscribe(
    (event) => {
      if (event.type === 'remove') {
        callback(event)
      }
    },
    { entityType },
  )
}

// ─────────────────────────────────────────────
// Phase 2: Optimistic Updates (Transaction-based)
// ─────────────────────────────────────────────

/**
 * Mutation recorded within an optimistic transaction.
 */
interface OptimisticMutation {
  entityType: string
  id: string
  type: 'set' | 'remove'
  data?: EntityRecord
}

/**
 * An optimistic transaction — a group of mutations that can be
 * committed (on success) or rolled back (on failure) atomically.
 *
 * Inspired by TanStack DB's transaction model with "clear and replay"
 * rollback. Server truth is snapshotted before the first optimistic
 * mutation touches each entity. On rollback, server truth is restored
 * and remaining active transactions are replayed on top.
 */
export interface OptimisticTransaction {
  /** Apply an optimistic entity update within this transaction. */
  set(entityType: string, id: string, data: EntityRecord): void
  /** Optimistically remove an entity within this transaction. */
  remove(entityType: string, id: string): void
  /** Commit — server data has arrived, drop optimistic state. */
  commit(): void
  /** Rollback — mutation failed, restore server truth + replay remaining transactions. */
  rollback(): void
}

/**
 * Transaction-based optimistic updates with proper rollback.
 *
 * Architecture (inspired by TanStack DB's 3-layer model):
 * - Server truth is snapshotted before optimistic mutations touch an entity
 * - Optimistic writes go directly to the entity store (Vue reactivity propagates immediately)
 * - Each transaction tracks its mutations independently
 * - On rollback: restore server truth, then replay remaining active transactions
 * - On commit: drop the transaction (server data already correct in store via normal flow)
 *
 * This handles concurrent optimistic mutations correctly:
 * - Transaction A updates contact:1 name
 * - Transaction B updates contact:1 email
 * - Transaction A fails → rollback restores server truth, replays B's email update
 *
 * @example
 * ```typescript
 * const optimistic = useOptimisticUpdate()
 *
 * // Simple single-mutation (most common):
 * const rollback = optimistic.apply('contact', '1', { name: 'Alicia' })
 * // On failure: rollback()
 *
 * // Multi-mutation transaction:
 * const tx = optimistic.transaction()
 * tx.set('contact', '1', { name: 'Alicia' })
 * tx.set('order', '5', { status: 'confirmed' })
 * // On success: tx.commit()
 * // On failure: tx.rollback()
 *
 * // With Pinia Colada useMutation:
 * const { mutate } = useMutation({
 *   mutation: (data) => api.updateContact(data),
 *   onMutate: (data) => optimistic.apply('contact', data.id, data),
 *   onError: (_err, _vars, rollback) => rollback?.(),
 * })
 * ```
 */
export function useOptimisticUpdate(pinia?: Pinia) {
  const store = useEntityStore(pinia)

  // Server truth snapshots — captured before optimistic mutations modify an entity.
  // Key: 'entityType:id', Value: { existed: boolean, data?: EntityRecord }
  const serverTruth = new Map<string, { existed: boolean; data?: EntityRecord }>()

  // Active transactions — maintained in order for deterministic replay
  const activeTransactions: Array<{ mutations: OptimisticMutation[] }> = []

  function entityKey(entityType: string, id: string): string {
    return `${entityType}:${id}`
  }

  /**
   * Snapshot server truth for an entity if not already snapshotted.
   * Only captures on first optimistic touch — subsequent mutations
   * to the same entity reuse the original snapshot.
   */
  function snapshotIfNeeded(entityType: string, id: string): void {
    const key = entityKey(entityType, id)
    if (!serverTruth.has(key)) {
      const existed = store.has(entityType, id)
      serverTruth.set(key, {
        existed,
        data: existed ? { ...store.get(entityType, id).value! } : undefined,
      })
    }
  }

  /**
   * Restore server truth for entities, then replay all active transactions.
   * This is TanStack DB's "clear and replay" approach.
   */
  function recompute(affectedKeys: Set<string>): void {
    // Step 1: Restore server truth for affected entities
    for (const key of affectedKeys) {
      const truth = serverTruth.get(key)
      if (!truth) continue

      const [entityType, id] = splitKey(key)

      // Check if any remaining active transaction references this entity
      const stillReferenced = activeTransactions.some((tx) =>
        tx.mutations.some((m) => entityKey(m.entityType, m.id) === key),
      )

      if (!stillReferenced) {
        // No active transaction references this entity — restore and clean up
        if (truth.existed && truth.data) {
          store.replace(entityType, id, truth.data)
        } else if (!truth.existed) {
          store.remove(entityType, id)
        }
        serverTruth.delete(key)
      } else {
        // Still referenced — restore server truth, then replay will re-apply
        if (truth.existed && truth.data) {
          store.replace(entityType, id, truth.data)
        } else if (!truth.existed && store.has(entityType, id)) {
          store.remove(entityType, id)
        }
      }
    }

    // Step 2: Replay all active transactions in order
    for (const tx of activeTransactions) {
      for (const mutation of tx.mutations) {
        if (mutation.type === 'set' && mutation.data) {
          store.set(mutation.entityType, mutation.id, mutation.data)
        } else if (mutation.type === 'remove') {
          store.remove(mutation.entityType, mutation.id)
        }
      }
    }
  }

  function splitKey(key: string): [string, string] {
    const idx = key.indexOf(':')
    return [key.slice(0, idx), key.slice(idx + 1)]
  }

  /**
   * Create a multi-mutation transaction.
   */
  function transaction(): OptimisticTransaction {
    const mutations: OptimisticMutation[] = []
    const txEntry = { mutations }
    activeTransactions.push(txEntry)

    return {
      set(entityType: string, id: string, data: EntityRecord) {
        snapshotIfNeeded(entityType, id)
        mutations.push({ entityType, id, type: 'set', data })
        store.set(entityType, id, data)
      },

      remove(entityType: string, id: string) {
        snapshotIfNeeded(entityType, id)
        mutations.push({ entityType, id, type: 'remove' })
        store.remove(entityType, id)
      },

      commit() {
        const idx = activeTransactions.indexOf(txEntry)
        if (idx === -1) return // already committed/rolled back

        // Collect affected keys
        const affectedKeys = new Set(
          mutations.map((m) => entityKey(m.entityType, m.id)),
        )

        // Remove this transaction
        activeTransactions.splice(idx, 1)

        // Clean up or update server truth for affected entities
        for (const key of affectedKeys) {
          const stillReferenced = activeTransactions.some((tx) =>
            tx.mutations.some((m) => entityKey(m.entityType, m.id) === key),
          )
          if (!stillReferenced) {
            serverTruth.delete(key)
          } else {
            // Update server truth by applying this transaction's mutations on top
            // of the OLD server truth. We can't use the current store value because
            // it includes other transactions' optimistic mutations.
            const truth = serverTruth.get(key)
            if (truth) {
              let newData = truth.data ? { ...truth.data } : undefined
              for (const m of mutations) {
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
      },

      rollback() {
        const idx = activeTransactions.indexOf(txEntry)
        if (idx === -1) return // already committed/rolled back

        // Collect affected keys before removing
        const affectedKeys = new Set(
          mutations.map((m) => entityKey(m.entityType, m.id)),
        )

        // Remove this transaction
        activeTransactions.splice(idx, 1)

        // Restore server truth + replay remaining transactions
        recompute(affectedKeys)
      },
    }
  }

  /**
   * Simple single-mutation convenience.
   * Creates a transaction with one `set` mutation and returns a rollback function.
   */
  function apply(
    entityType: string,
    id: string,
    data: EntityRecord,
  ): () => void {
    const tx = transaction()
    tx.set(entityType, id, data)
    return () => tx.rollback()
  }

  return { apply, transaction }
}

// ─────────────────────────────────────────────
// Phase 2: Coalescing
// ─────────────────────────────────────────────

/**
 * Batches multiple items and flushes them together after a delay.
 *
 * Use this when WebSocket events signal "entity X changed" without
 * carrying the full data. Instead of one REST call per WS event,
 * coalesce them into a single batch fetch.
 *
 * @example
 * ```typescript
 * const coalescer = createCoalescer(async (entityKeys) => {
 *   // Batch fetch all changed entities in one request
 *   const entities = await api.fetchEntitiesByIds(entityKeys)
 *   for (const entity of entities) {
 *     entityStore.set('contact', entity.id, entity)
 *   }
 * }, 100) // 100ms window
 *
 * ws.on('ENTITY_STALE', ({ key }) => coalescer.add(key))
 * ```
 */
export function createCoalescer<T = string>(
  onFlush: (items: T[]) => void | Promise<void>,
  delay = 50,
): { add: (item: T) => void; flush: () => void } {
  let pending: T[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  function add(item: T) {
    pending.push(item)
    if (!timer) {
      timer = setTimeout(flush, delay)
    }
  }

  function flush() {
    const batch = pending
    pending = []
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (batch.length > 0) {
      onFlush(batch)
    }
  }

  return { add, flush }
}

// ─────────────────────────────────────────────
// Phase 3: Entity Queries (filtered views)
// ─────────────────────────────────────────────

/**
 * Reactive filtered view of entities by type.
 * Returns a computed ref that updates when entities change.
 *
 * This is a convenience wrapper around `getByType()` + filter.
 *
 * @example
 * ```typescript
 * // All active contacts
 * const activeContacts = useEntityQuery('contact', c => c.status === 'active')
 *
 * // All high-value orders
 * const bigOrders = useEntityQuery('order', o => (o.total as number) > 1000)
 *
 * // All contacts (no filter)
 * const allContacts = useEntityQuery('contact')
 * ```
 */
export function useEntityQuery<K extends string & keyof EntityRegistry>(entityType: K, filter?: (entity: EntityRegistry[K]) => boolean, pinia?: Pinia): ComputedRef<EntityRegistry[K][]>
export function useEntityQuery(entityType: string, filter?: (entity: EntityRecord) => boolean, pinia?: Pinia): ComputedRef<EntityRecord[]>
export function useEntityQuery(
  entityType: string,
  filter?: (entity: EntityRecord) => boolean,
  pinia?: Pinia,
): ComputedRef<EntityRecord[]> {
  const store = useEntityStore(pinia)
  const allOfType = store.getByType(entityType)

  if (!filter) return allOfType

  return computed(() => allOfType.value.filter(filter))
}

// ─────────────────────────────────────────────
// Phase 3: Manual Indexes
// ─────────────────────────────────────────────

/**
 * Creates a reactive index on an entity field for O(1) lookups.
 *
 * Without an index, filtering entities by a field value requires
 * scanning all entities (O(n)). With an index, lookups by that
 * field are O(1) via a pre-maintained Map.
 *
 * The index auto-updates when entities change via the store's
 * subscribe mechanism.
 *
 * @param entityType - The entity type to index
 * @param fieldOrFn - Field name or extractor function to index by
 * @param pinia - Optional Pinia instance
 *
 * @example
 * ```typescript
 * // Index contacts by status
 * const statusIndex = createEntityIndex('contact', 'status')
 *
 * // O(1) lookup — reactive, updates automatically
 * const activeContacts = statusIndex.get('active')
 * const inactiveContacts = statusIndex.get('inactive')
 *
 * // Custom extractor
 * const roleIndex = createEntityIndex('contact', (c) => c.department as string)
 * const engineers = roleIndex.get('engineering')
 *
 * // Clean up when done
 * statusIndex.dispose()
 * ```
 */
export function createEntityIndex(
  entityType: string,
  fieldOrFn: string | ((entity: EntityRecord) => string | undefined),
  pinia?: Pinia,
): {
  get: (value: string) => ComputedRef<EntityRecord[]>
  dispose: () => void
} {
  const store = useEntityStore(pinia)
  const extractor = typeof fieldOrFn === 'string'
    ? (entity: EntityRecord) => entity[fieldOrFn] as string | undefined
    : fieldOrFn

  // Internal index: fieldValue → Set<entityId>
  const index = new Map<string, Set<string>>()
  // Reverse lookup: entityId → fieldValue (for cleanup on update)
  const entityValues = new Map<string, string>()

  // Build initial index from existing entities.
  // Uses getEntriesByType() which returns canonical store IDs alongside data,
  // avoiding the heuristic ID guessing that fails with composite keys.
  for (const { id, data } of store.getEntriesByType(entityType)) {
    const value = extractor(data)
    if (value != null) {
      addToIndex(id, value)
    }
  }

  // Version ref — bumped on index changes to trigger computed recomputation
  const version = shallowRef(0)

  // Single subscription: update index + bump version
  const unsub = store.subscribe((event) => {
    const id = event.id

    // Remove old index entry
    const oldValue = entityValues.get(id)
    if (oldValue != null) {
      removeFromIndex(id, oldValue)
    }

    // Add new index entry
    if (event.type === 'set' && event.data) {
      const newValue = extractor(event.data)
      if (newValue != null) {
        addToIndex(id, newValue)
      }
    }

    // Bump version for reactive computed recomputation
    version.value++
  }, { entityType })

  function addToIndex(id: string, value: string) {
    let set = index.get(value)
    if (!set) {
      set = new Set()
      index.set(value, set)
    }
    set.add(id)
    entityValues.set(id, value)
  }

  function removeFromIndex(id: string, value: string) {
    const set = index.get(value)
    if (set) {
      set.delete(id)
      if (set.size === 0) index.delete(value)
    }
    entityValues.delete(id)
  }

  return {
    get(value: string): ComputedRef<EntityRecord[]> {
      return computed(() => {
        // Track version for reactivity
        void version.value
        const ids = index.get(value)
        if (!ids || ids.size === 0) return []
        const result: EntityRecord[] = []
        for (const id of ids) {
          const entity = store.get(entityType, id).value
          if (entity != null) result.push(entity)
        }
        return result
      })
    },
    dispose() {
      unsub()
      index.clear()
      entityValues.clear()
    },
  }
}
