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

import { computed, shallowRef } from "vue";
import type { ComputedRef, ShallowRef } from "vue";
import type { EntityEvent, EntityKey, EntityRecord, EntityRef, EntityStore } from "./types";
import { ENTITY_REF_MARKER } from "./types";

/**
 * Sentinel key used in JSON serialization to represent EntityRefs.
 * EntityRefs use a Symbol marker (ENTITY_REF_MARKER) which doesn't survive
 * JSON.stringify. This string key is used as the wire format in toJSON/hydrate.
 * @internal
 */
const ENTITY_REF_JSON_KEY = "__pcn_ref";

/**
 * Walk data and replace EntityRef objects (Symbol-marked) with a JSON-safe
 * wire format. Used by toJSON() to produce serializable snapshots.
 * @internal
 */
function encodeEntityRefs(data: unknown): unknown {
  if (data == null || typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map(encodeEntityRefs);
  }

  const record = data as Record<string | symbol, unknown>;
  if (record[ENTITY_REF_MARKER] === true) {
    // Replace Symbol-marked EntityRef with string-keyed wire format
    return {
      [ENTITY_REF_JSON_KEY]: true,
      entityType: record.entityType,
      id: record.id,
      key: record.key,
    };
  }

  // Walk children
  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const encoded = encodeEntityRefs(value);
    result[key] = encoded;
    if (encoded !== value) changed = true;
  }
  return changed ? result : data;
}

/**
 * Walk data and replace wire-format EntityRefs with Symbol-marked EntityRef
 * objects. Used by hydrate() to restore the in-memory representation.
 * @internal
 */
function decodeEntityRefs(data: unknown): unknown {
  if (data == null || typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map(decodeEntityRefs);
  }

  const record = data as Record<string, unknown>;
  if (record[ENTITY_REF_JSON_KEY] === true && "entityType" in record && "key" in record) {
    // Restore Symbol-marked EntityRef from wire format
    const ref: EntityRef = {
      [ENTITY_REF_MARKER]: true,
      entityType: record.entityType as string,
      id: record.id as string,
      key: record.key as EntityKey,
    };
    return ref;
  }

  // Walk children
  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const decoded = decodeEntityRefs(value);
    result[key] = decoded;
    if (decoded !== value) changed = true;
  }
  return changed ? result : data;
}

type EntityListener = (event: EntityEvent) => void;

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
  const storage = new Map<string, Map<string, ShallowRef<EntityRecord>>>();

  // Trigger ref for type-level reactivity (when entities are added/removed)
  const typeVersions = new Map<string, ShallowRef<number>>();

  // Subscribers
  const listeners = new Set<{ fn: EntityListener; filter?: { entityType?: string } }>();

  // Reference counts for GC — only tracked for entities that have been retain()ed.
  // Entities created via direct set() (e.g., WebSocket) have no entry here
  // and are immune to gc().
  const refCounts = new Map<EntityKey, number>();

  // Memoized computed refs from getByType() — one per entity type.
  const getByTypeCache = new Map<string, ComputedRef<EntityRecord[]>>();

  // ── Helpers ─────────────────────────────────

  /**
   * Checks if incoming data would actually change the existing entity.
   * Returns true if any incoming field differs from the existing value.
   * Used to skip no-op merges and preserve referential identity.
   */
  function hasChangedFields(existing: EntityRecord, incoming: EntityRecord): boolean {
    for (const key of Object.keys(incoming)) {
      if (incoming[key] !== existing[key]) return true;
    }
    return false;
  }

  function getTypeMap(entityType: string): Map<string, ShallowRef<EntityRecord>> {
    let typeMap = storage.get(entityType);
    if (!typeMap) {
      typeMap = new Map();
      storage.set(entityType, typeMap);
    }
    return typeMap;
  }

  function getTypeVersion(entityType: string): ShallowRef<number> {
    let version = typeVersions.get(entityType);
    if (!version) {
      version = shallowRef(0);
      typeVersions.set(entityType, version);
    }
    return version;
  }

  function toEntityKey(entityType: string, id: string): EntityKey {
    return `${entityType}:${id}`;
  }

  function emit(event: EntityEvent): void {
    for (const listener of listeners) {
      if (!listener.filter?.entityType || listener.filter.entityType === event.entityType) {
        listener.fn(event);
      }
    }
  }

  // ── EntityStore implementation ──────────────

  const store: EntityStore = {
    set(entityType: string, id: string, data: EntityRecord) {
      const typeMap = getTypeMap(entityType);
      const existing = typeMap.get(id);
      const previousData = existing?.value;

      if (existing && previousData) {
        // Skip merge if incoming fields are identical — preserves referential
        // identity and prevents unnecessary reactivity triggers downstream.
        if (!hasChangedFields(previousData, data)) return;
        // Shallow merge — incoming data is merged on top of existing data.
        // This allows a detail query (with email) to enrich an entity
        // that was first stored by a list query (without email),
        // without the list query later overwriting the email field.
        // Vue's shallowRef triggers watchers on assignment.
        existing.value = { ...previousData, ...data };
      } else if (existing) {
        existing.value = data;
        // Bump type version — this is a phantom ref being populated (functionally a new entity)
        const version = getTypeVersion(entityType);
        version.value++;
      } else {
        // New entity
        typeMap.set(id, shallowRef(data));
        // Bump type version so getByType() recomputes
        const version = getTypeVersion(entityType);
        version.value++;
      }

      emit({
        type: "set",
        entityType,
        id,
        key: toEntityKey(entityType, id),
        data: existing ? existing.value : data,
        previousData,
      });
    },

    replace(entityType: string, id: string, data: EntityRecord) {
      const typeMap = getTypeMap(entityType);
      const existing = typeMap.get(id);
      const previousData = existing?.value;

      if (existing) {
        // Full replacement — no merge, incoming data IS the entity
        existing.value = data;
      } else {
        typeMap.set(id, shallowRef(data));
        const version = getTypeVersion(entityType);
        version.value++;
      }

      emit({
        type: "set",
        entityType,
        id,
        key: toEntityKey(entityType, id),
        data,
        previousData,
      });
    },

    setMany(entities) {
      // Batch: group by type, minimize version bumps
      const typesWithNewEntities = new Set<string>();

      for (const { entityType, id, data } of entities) {
        const typeMap = getTypeMap(entityType);
        const existing = typeMap.get(id);
        const previousData = existing?.value;

        if (existing && previousData) {
          // Skip no-op merges to preserve referential identity
          if (!hasChangedFields(previousData, data)) continue;
          existing.value = { ...previousData, ...data };
        } else if (existing) {
          existing.value = data;
          typesWithNewEntities.add(entityType);
        } else {
          typeMap.set(id, shallowRef(data));
          typesWithNewEntities.add(entityType);
        }

        emit({
          type: "set",
          entityType,
          id,
          key: toEntityKey(entityType, id),
          data: existing ? existing.value : data,
          previousData,
        });
      }

      // Bump type versions once per type, not per entity
      for (const entityType of typesWithNewEntities) {
        const version = getTypeVersion(entityType);
        version.value++;
      }
    },

    remove(entityType, id) {
      const typeMap = storage.get(entityType);
      if (!typeMap) return;

      const existing = typeMap.get(id);
      if (!existing) return;

      const previousData = existing.value;
      typeMap.delete(id);

      // Bump type version so getByType() recomputes
      const version = getTypeVersion(entityType);
      version.value++;

      emit({
        type: "remove",
        entityType,
        id,
        key: toEntityKey(entityType, id),
        data: undefined,
        previousData,
      });
    },

    get(entityType: string, id: string) {
      const typeMap = getTypeMap(entityType);
      let ref = typeMap.get(id);
      if (!ref) {
        // Return a ref that will be populated if the entity arrives later.
        // This enables "subscribe before data arrives" patterns.
        ref = shallowRef(undefined as unknown as EntityRecord);
        typeMap.set(id, ref);
      }
      return ref as ShallowRef<EntityRecord | undefined>;
    },

    getByType(entityType: string) {
      let cached = getByTypeCache.get(entityType);
      if (cached) return cached;

      const typeMap = getTypeMap(entityType);
      const version = getTypeVersion(entityType);

      cached = computed(() => {
        // Track the version so this recomputes when entities are added/removed
        void version.value;
        // Collect all entity values
        const result: EntityRecord[] = [];
        for (const ref of typeMap.values()) {
          if (ref.value !== undefined) {
            result.push(ref.value);
          }
        }
        return result;
      });
      getByTypeCache.set(entityType, cached);
      return cached;
    },

    getEntriesByType(entityType) {
      const typeMap = storage.get(entityType);
      if (!typeMap) return [];
      const result: Array<{ id: string; data: EntityRecord }> = [];
      for (const [id, ref] of typeMap.entries()) {
        if (ref.value !== undefined) {
          result.push({ id, data: ref.value });
        }
      }
      return result;
    },

    has(entityType, id) {
      const ref = storage.get(entityType)?.get(id);
      return ref != null && ref.value !== undefined;
    },

    subscribe(listener: (event: EntityEvent) => void, filter?: { entityType?: string }) {
      const entry = { fn: listener, filter };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },

    retain(entityType, id) {
      const key = toEntityKey(entityType, id);
      refCounts.set(key, (refCounts.get(key) ?? 0) + 1);
    },

    release(entityType, id) {
      const key = toEntityKey(entityType, id);
      const current = refCounts.get(key);
      if (current != null && current > 0) {
        refCounts.set(key, current - 1);
      }
    },

    gc() {
      // Collect keys to remove first, then process — avoids mutating
      // refCounts during iteration (subscribers could call retain/release).
      const toCollect: Array<{ key: EntityKey; entityType: string; id: string }> = [];
      for (const [key, count] of refCounts) {
        if (count <= 0) {
          const separatorIndex = key.indexOf(":");
          toCollect.push({
            key,
            entityType: key.slice(0, separatorIndex),
            id: key.slice(separatorIndex + 1),
          });
        }
      }

      const removed: string[] = [];
      for (const { key, entityType, id } of toCollect) {
        refCounts.delete(key);
        if (store.has(entityType, id)) {
          store.remove(entityType, id);
          removed.push(key);
        }
      }
      return removed;
    },

    clear() {
      for (const [entityType, typeMap] of storage) {
        typeMap.clear();
        const version = getTypeVersion(entityType);
        version.value++;
      }
      refCounts.clear();
      getByTypeCache.clear();
    },

    toJSON() {
      const snapshot: Record<EntityKey, EntityRecord> = {};
      for (const [entityType, typeMap] of storage) {
        for (const [id, ref] of typeMap) {
          if (ref.value !== undefined) {
            snapshot[toEntityKey(entityType, id)] = encodeEntityRefs(ref.value) as EntityRecord;
          }
        }
      }
      return snapshot;
    },

    hydrate(snapshot) {
      for (const [key, data] of Object.entries(snapshot)) {
        const separatorIndex = key.indexOf(":");
        if (separatorIndex === -1) continue;
        const entityType = key.slice(0, separatorIndex);
        const id = key.slice(separatorIndex + 1);
        store.set(entityType, id, decodeEntityRefs(data) as EntityRecord);
      }
    },
  };

  return store;
}
