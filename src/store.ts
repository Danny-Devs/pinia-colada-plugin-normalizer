/**
 * In-memory EntityStore implementation (Level 1).
 *
 * Uses Vue's reactive primitives:
 * - reactive Map for entity storage
 * - shallowRef per entity for fine-grained reactivity
 * - computed for derived queries (brute-force, scales to ~10K entities)
 *
 * This is the default backend. No persistence, no IVM, no query planner.
 * Just Vue reactivity doing what it does best.
 */

import { computed, shallowRef } from 'vue'
import type { ComputedRef, ShallowRef } from 'vue'
import type {
  EntityEvent,
  EntityKey,
  EntityRecord,
  EntityStore,
} from './types'

type EntityListener = (event: EntityEvent) => void

/**
 * Creates an in-memory EntityStore backed by Vue reactive primitives.
 *
 * This is the default store used by the normalizer plugin.
 * Designed to be swappable — the EntityStore interface stays the same
 * whether you're using this, IndexedDB, or SQLite underneath.
 */
export function createEntityStore(): EntityStore {
  // ── Internal storage ────────────────────────
  // Two-level map: entityType → id → reactive entity ref
  const storage = new Map<string, Map<string, ShallowRef<EntityRecord>>>()

  // Trigger ref for type-level reactivity (when entities are added/removed)
  const typeVersions = new Map<string, ShallowRef<number>>()

  // Subscribers
  const listeners = new Set<{ fn: EntityListener; filter?: { entityType?: string } }>()

  // ── Helpers ─────────────────────────────────

  function getTypeMap(entityType: string): Map<string, ShallowRef<EntityRecord>> {
    let typeMap = storage.get(entityType)
    if (!typeMap) {
      typeMap = new Map()
      storage.set(entityType, typeMap)
    }
    return typeMap
  }

  function getTypeVersion(entityType: string): ShallowRef<number> {
    let version = typeVersions.get(entityType)
    if (!version) {
      version = shallowRef(0)
      typeVersions.set(entityType, version)
    }
    return version
  }

  function toEntityKey(entityType: string, id: string): EntityKey {
    return `${entityType}:${id}`
  }

  function emit(event: EntityEvent): void {
    for (const listener of listeners) {
      if (!listener.filter?.entityType || listener.filter.entityType === event.entityType) {
        listener.fn(event)
      }
    }
  }

  // ── EntityStore implementation ──────────────

  const store: EntityStore = {
    set(entityType, id, data) {
      const typeMap = getTypeMap(entityType)
      const existing = typeMap.get(id)
      const previousData = existing?.value

      if (existing && previousData) {
        // Shallow merge — incoming data is merged on top of existing data.
        // This allows a detail query (with email) to enrich an entity
        // that was first stored by a list query (without email),
        // without the list query later overwriting the email field.
        // Vue's shallowRef triggers watchers on assignment.
        existing.value = { ...previousData, ...data }
      } else if (existing) {
        existing.value = data
      } else {
        // New entity
        typeMap.set(id, shallowRef(data))
        // Bump type version so getByType() recomputes
        const version = getTypeVersion(entityType)
        version.value++
      }

      emit({
        type: 'set',
        entityType,
        id,
        key: toEntityKey(entityType, id),
        data: existing ? existing.value : data,
        previousData,
      })
    },

    replace(entityType, id, data) {
      const typeMap = getTypeMap(entityType)
      const existing = typeMap.get(id)
      const previousData = existing?.value

      if (existing) {
        // Full replacement — no merge, incoming data IS the entity
        existing.value = data
      } else {
        typeMap.set(id, shallowRef(data))
        const version = getTypeVersion(entityType)
        version.value++
      }

      emit({
        type: 'set',
        entityType,
        id,
        key: toEntityKey(entityType, id),
        data,
        previousData,
      })
    },

    setMany(entities) {
      // Batch: group by type, minimize version bumps
      const typesWithNewEntities = new Set<string>()

      for (const { entityType, id, data } of entities) {
        const typeMap = getTypeMap(entityType)
        const existing = typeMap.get(id)
        const previousData = existing?.value

        if (existing && previousData) {
          existing.value = { ...previousData, ...data }
        } else if (existing) {
          existing.value = data
        } else {
          typeMap.set(id, shallowRef(data))
          typesWithNewEntities.add(entityType)
        }

        emit({
          type: 'set',
          entityType,
          id,
          key: toEntityKey(entityType, id),
          data: existing ? existing.value : data,
          previousData,
        })
      }

      // Bump type versions once per type, not per entity
      for (const entityType of typesWithNewEntities) {
        const version = getTypeVersion(entityType)
        version.value++
      }
    },

    remove(entityType, id) {
      const typeMap = storage.get(entityType)
      if (!typeMap) return

      const existing = typeMap.get(id)
      if (!existing) return

      const previousData = existing.value
      typeMap.delete(id)

      // Bump type version so getByType() recomputes
      const version = getTypeVersion(entityType)
      version.value++

      emit({
        type: 'remove',
        entityType,
        id,
        key: toEntityKey(entityType, id),
        data: undefined,
        previousData,
      })
    },

    get(entityType, id) {
      const typeMap = getTypeMap(entityType)
      let ref = typeMap.get(id)
      if (!ref) {
        // Return a ref that will be populated if the entity arrives later.
        // This enables "subscribe before data arrives" patterns.
        ref = shallowRef(undefined as unknown as EntityRecord)
        typeMap.set(id, ref)
      }
      return ref as ShallowRef<EntityRecord | undefined>
    },

    getByType(entityType) {
      const typeMap = getTypeMap(entityType)
      const version = getTypeVersion(entityType)

      return computed(() => {
        // Track the version so this recomputes when entities are added/removed
        void version.value
        // Collect all entity values
        const result: EntityRecord[] = []
        for (const ref of typeMap.values()) {
          if (ref.value !== undefined) {
            result.push(ref.value)
          }
        }
        return result
      })
    },

    has(entityType, id) {
      const ref = storage.get(entityType)?.get(id)
      return ref != null && ref.value !== undefined
    },

    subscribe(listener, filter) {
      const entry = { fn: listener, filter }
      listeners.add(entry)
      return () => { listeners.delete(entry) }
    },

    clear() {
      for (const [entityType, typeMap] of storage) {
        typeMap.clear()
        const version = getTypeVersion(entityType)
        version.value++
      }
    },

    toJSON() {
      const snapshot: Record<EntityKey, EntityRecord> = {}
      for (const [entityType, typeMap] of storage) {
        for (const [id, ref] of typeMap) {
          if (ref.value !== undefined) {
            snapshot[toEntityKey(entityType, id)] = ref.value
          }
        }
      }
      return snapshot
    },

    hydrate(snapshot) {
      for (const [key, data] of Object.entries(snapshot)) {
        const separatorIndex = key.indexOf(':')
        if (separatorIndex === -1) continue
        const entityType = key.slice(0, separatorIndex)
        const id = key.slice(separatorIndex + 1)
        store.set(entityType, id, data)
      }
    },
  }

  return store
}
