/**
 * Pinia Colada Normalizer plugin.
 *
 * Hooks into Pinia Colada's query cache via $onAction subscriptions:
 * 1. 'extend' — replace entry.state with a customRef that normalizes on write
 *    and denormalizes on read (the "customRef replacement" pattern).
 *
 * This eliminates the setEntryState after() hook entirely. Writes go through
 * the customRef setter (normalize), reads go through the getter (denormalize).
 * Transparent to all other plugins and application code.
 *
 * SSR-safe: entity store is scoped per Pinia instance via defineStore.
 *
 * Integration surface: 1 action hook (extend) + ext field.
 * Follows the delay plugin's pattern of replacing entry properties with customRef.
 * Eduardo confirmed this approach in Discussion #531.
 *
 * @module pinia-colada-plugin-normalizer
 */

import { customRef, shallowRef } from 'vue'
import type { PiniaColadaPlugin } from '@pinia/colada'
import { defineStore } from 'pinia'
import type {
  EntityRecord,
  EntityRef,
  NormalizerPluginOptions,
  NormalizationResult,
  EntityStore,
  EntityDefinition,
  NormMeta,
} from './types'
import { ENTITY_REF_MARKER, NORM_META_KEY } from './types'
import { createEntityStore } from './store'

// ─────────────────────────────────────────────
// SSR-safe entity store via defineStore
// ─────────────────────────────────────────────

const NORMALIZER_STORE_ID = '_pc_normalizer'

/**
 * Pinia store that scopes the entity store per Pinia instance.
 * This prevents SSR cross-request contamination — each app gets its own store.
 * @internal
 */
const useNormalizerStore = /* @__PURE__ */ defineStore(NORMALIZER_STORE_ID, () => {
  let store: EntityStore = createEntityStore()
  function setStore(s: EntityStore) { store = s }
  function getStore() { return store }
  return { getStore, setStore }
})

// ─────────────────────────────────────────────
// Plugin Factory
// ─────────────────────────────────────────────

/**
 * Creates the normalizer plugin for Pinia Colada.
 *
 * Architecture: customRef replacement pattern.
 * - In the `extend` hook, entry.state is replaced with a customRef.
 * - The setter normalizes incoming data (extracts entities, stores them,
 *   saves EntityRefs internally).
 * - The getter denormalizes on read (replaces EntityRefs with live store data).
 * - `setEntryState` calls `entry.state.value = state` which hits the setter.
 * - `useQuery` reads `entry.state.value` which hits the getter.
 * - All transparent to other plugins and application code.
 *
 * @example
 * ```typescript
 * import { PiniaColada } from '@pinia/colada'
 * import { PiniaColadaNormalizer, defineEntity } from 'pinia-colada-plugin-normalizer'
 *
 * app.use(PiniaColada, {
 *   plugins: [
 *     PiniaColadaNormalizer({
 *       entities: {
 *         contact: defineEntity({ idField: 'contactId' }),
 *       }
 *     })
 *   ]
 * })
 * ```
 */
export function PiniaColadaNormalizer(
  options: NormalizerPluginOptions = {},
): PiniaColadaPlugin {
  const {
    entities: entityDefs = {},
    defaultIdField = 'id',
    store: userStore,
    autoNormalize = false,
  } = options

  return ({ queryCache, pinia, scope }) => {
    // Get the per-Pinia-instance normalizer store (SSR-safe)
    const normalizerStore = useNormalizerStore(pinia)
    if (userStore) {
      normalizerStore.setStore(userStore)
    }
    const entityStoreInstance = normalizerStore.getStore()

    queryCache.$onAction(({ name, args }) => {
      // ── extend: initialize ext + customRef replacement ──
      // Called once per entry creation. Must use scope.run() for reactive refs.
      // Must define ALL ext keys here (cannot add new keys later).
      //
      // We replace entry.state with a customRef that:
      // - setter: normalizes incoming data (extract entities → store → save refs)
      // - getter: denormalizes on read (replace EntityRefs with live entity data)
      //
      // This follows the delay plugin's pattern of replacing entry.asyncStatus.
      if (name === 'extend') {
        const [entry] = args
        scope.run(() => {
          // Initialize ext metadata
          entry.ext[NORM_META_KEY] = shallowRef<NormMeta>({
            isNormalized: false,
            entityKeys: [],
          })

          // Check if this query should be normalized
          const shouldNormalize = entry.options?.normalize ?? autoNormalize
          if (!shouldNormalize) return

          // Capture the current state value — this becomes our internal storage.
          // The customRef manages this directly instead of delegating to the
          // original ShallowRef.
          let rawState = entry.state.value

          // Per-entity denormalization cache for structural sharing.
          // Maps entityKey → { entity: last ShallowRef value, result: denormalized output }.
          // When an entity's ShallowRef value hasn't changed (same object reference),
          // we return the cached denormalized subtree — same reference, no re-renders.
          const denormCache = new Map<string, { entity: EntityRecord; result: unknown }>()

          // Cached top-level state object — returned if denormalized data is the same ref.
          type State = typeof rawState
          let cachedState: State | null = null
          let cachedData: unknown = null

          // Replace entry.state with a customRef that normalizes on write
          // and denormalizes on read.
          entry.state = customRef((track, trigger) => ({
            get(): State {
              track()
              // Denormalize on read: replace EntityRefs with live store data
              if (rawState.status === 'success' && rawState.data != null) {
                const data = cachedDenormalize(rawState.data, entityStoreInstance, denormCache)
                // Structural sharing: return the same state object if data hasn't changed
                if (data === cachedData && cachedState != null) {
                  return cachedState
                }
                cachedData = data
                cachedState = { ...rawState, data } as State
                return cachedState
              }
              return rawState
            },
            set(incoming: State) {
              // Normalize on write: extract entities, replace with refs
              if (incoming.status === 'success' && incoming.data != null) {
                const result = normalize(incoming.data, entityDefs, defaultIdField)
                if (result.entities.length > 0) {
                  // Write entities to the store (batch for efficiency)
                  entityStoreInstance.setMany(result.entities)

                  // Update ext metadata via ShallowRef .value
                  entry.ext[NORM_META_KEY].value = {
                    isNormalized: true,
                    entityKeys: result.entities.map(
                      (e) => `${e.entityType}:${e.id}`,
                    ),
                  }

                  rawState = { ...incoming, data: result.normalized } as State
                } else {
                  rawState = incoming
                }
              } else {
                rawState = incoming
              }
              // Invalidate top-level cache on any setter call
              cachedState = null
              cachedData = null
              trigger()
            },
          })) as typeof entry.state
        })
      }

      // ── remove: cleanup ──────────────────────────
      // Entities persist in the store even after query entries are GC'd.
      // This is intentional for WebSocket scenarios where entities
      // outlive individual queries.
      // Future: optional reference counting for entity GC.
      if (name === 'remove') {
        // cleanup hook placeholder
      }
    })
  }
}

// ─────────────────────────────────────────────
// Entity Store Access (SSR-safe)
// ─────────────────────────────────────────────

/**
 * Returns the entity store instance used by the normalizer plugin.
 * SSR-safe: uses defineStore to scope per Pinia instance.
 * Must be called after the plugin is installed.
 *
 * In component context, Pinia is available via inject (auto-detected).
 *
 * @example
 * ```typescript
 * import { useEntityStore } from 'pinia-colada-plugin-normalizer'
 *
 * // In a component or composable:
 * const entityStore = useEntityStore()
 * const contact = entityStore.get('contact', '42')
 *
 * // Direct write from WebSocket event:
 * ws.on('CONTACT_UPDATED', (data) => {
 *   entityStore.set('contact', data.id, data)
 * })
 * ```
 */
export function useEntityStore(): EntityStore {
  // In component context, Pinia is available via inject (auto-detected by defineStore)
  const normalizerStore = useNormalizerStore()
  return normalizerStore.getStore()
}

// ─────────────────────────────────────────────
// Normalization Engine
// ─────────────────────────────────────────────

/**
 * Walks a data structure, extracts entities (objects with IDs),
 * and replaces them with EntityRef references.
 *
 * Non-entity data (no ID field, deeply nested hierarchies) is left as-is.
 * This is the "hybrid" approach — normalize selectively.
 *
 * Uses a WeakSet for circular reference detection (Issue #12 fix).
 */
export function normalize(
  data: unknown,
  entityDefs: Record<string, EntityDefinition>,
  defaultIdField: string,
): NormalizationResult {
  const extractedEntities: NormalizationResult['entities'] = []
  const visited = new WeakSet<object>()

  const normalized = walkAndNormalize(data, entityDefs, defaultIdField, extractedEntities, visited)

  return { normalized, entities: extractedEntities }
}

function walkAndNormalize(
  data: unknown,
  entityDefs: Record<string, EntityDefinition>,
  defaultIdField: string,
  extracted: NormalizationResult['entities'],
  visited: WeakSet<object>,
): unknown {
  // Null / undefined / primitives — pass through
  if (data == null || typeof data !== 'object') {
    return data
  }

  // Circular reference protection (Issue #12 fix)
  if (visited.has(data)) {
    return data // Return as-is, don't recurse
  }
  visited.add(data)

  // Arrays — walk each element
  if (Array.isArray(data)) {
    return data.map((item) =>
      walkAndNormalize(item, entityDefs, defaultIdField, extracted, visited),
    )
  }

  // Objects — check if this is an entity
  const record = data as EntityRecord
  const entityInfo = identifyEntity(record, entityDefs, defaultIdField)

  if (entityInfo) {
    const { entityType, id } = entityInfo

    // Recursively normalize nested entities within this entity
    const normalizedEntity: EntityRecord = {}
    for (const [key, value] of Object.entries(record)) {
      normalizedEntity[key] = walkAndNormalize(value, entityDefs, defaultIdField, extracted, visited)
    }

    // Extract the entity
    extracted.push({ entityType, id, data: normalizedEntity })

    // Replace with a reference (using Symbol marker, Issue #13 fix)
    const ref: EntityRef = {
      [ENTITY_REF_MARKER]: true,
      entityType,
      id,
      key: `${entityType}:${id}`,
    }
    return ref
  }

  // Not an entity — walk children but keep the structure intact
  const result: EntityRecord = {}
  for (const [key, value] of Object.entries(record)) {
    result[key] = walkAndNormalize(value, entityDefs, defaultIdField, extracted, visited)
  }
  return result
}

/**
 * Determines if an object is an entity and extracts its type and ID.
 *
 * Resolution order:
 * 1. Check explicit entityDefs (by matching field names or getId function)
 * 2. Fall back to convention (has `defaultIdField` → entity)
 *    BUT only if the entity type can be determined (via __typename or entityDefs).
 *    Generic fallback to 'entity' type is DISABLED to prevent ID collisions
 *    between unrelated objects (Issue #7, #11 fix).
 *
 * Returns null if the object is not an entity.
 */
function identifyEntity(
  record: EntityRecord,
  entityDefs: Record<string, EntityDefinition>,
  defaultIdField: string,
): { entityType: string; id: string } | null {
  // Check explicit definitions first
  for (const [entityType, def] of Object.entries(entityDefs)) {
    if (def.getId) {
      const id = def.getId(record)
      if (id != null) return { entityType, id: String(id) }
    }
    if (def.idField && record[def.idField] != null) {
      return { entityType, id: String(record[def.idField]) }
    }
  }

  // Convention-based: look for the default ID field
  if (record[defaultIdField] != null) {
    // Only auto-detect if we can determine the type.
    // __typename is the GraphQL convention.
    // Without a type, we SKIP auto-detection to prevent ID collisions
    // between unrelated objects (e.g., user id:1 vs order id:1).
    if (typeof record.__typename === 'string') {
      return { entityType: record.__typename, id: String(record[defaultIdField]) }
    }
    // No type information available — skip normalization for this object.
    // Users should use defineEntity() for REST APIs without __typename.
    return null
  }

  return null
}

// ─────────────────────────────────────────────
// Denormalization Engine (recursive)
// ─────────────────────────────────────────────

/**
 * Denormalizes data by recursively replacing EntityRef references with live
 * entity data from the store.
 *
 * This is used on the read path (customRef getter) to reconstruct the original
 * data shape with reactive entity data. Entities in the store may themselves
 * contain EntityRefs (nested entities), so denormalization must be recursive.
 *
 * Uses a WeakSet for circular reference protection.
 * Uses store.has() before store.get() to avoid creating phantom refs.
 */
export function denormalize(
  data: unknown,
  store: EntityStore,
): unknown {
  const visited = new WeakSet<object>()
  return walkAndDenormalize(data, store, visited)
}

/**
 * Cached denormalization for use inside the customRef getter.
 * Provides structural sharing: returns the same object reference for entities
 * whose ShallowRef value hasn't changed since the last denormalization.
 *
 * This prevents unnecessary re-renders when an entity store update triggers
 * the customRef getter but most entities in the query result are unchanged.
 *
 * @internal
 */
function cachedDenormalize(
  data: unknown,
  store: EntityStore,
  cache: Map<string, { entity: EntityRecord; result: unknown }>,
): unknown {
  const visited = new WeakSet<object>()
  return walkAndDenormalizeCached(data, store, visited, cache)
}

function walkAndDenormalize(
  data: unknown,
  store: EntityStore,
  visited: WeakSet<object>,
): unknown {
  if (data == null || typeof data !== 'object') {
    return data
  }

  // Circular reference protection
  if (visited.has(data as object)) {
    return data
  }
  visited.add(data as object)

  // Arrays — walk each element
  if (Array.isArray(data)) {
    return data.map((item) => walkAndDenormalize(item, store, visited))
  }

  // Check if this is an entity reference (Symbol-based, Issue #13 fix)
  const record = data as Record<string | symbol, unknown>
  if (isEntityRef(record)) {
    const entityType = record.entityType as string
    const id = record.id as string
    // Check existence first to avoid creating phantom refs
    if (!store.has(entityType, id)) return undefined
    const entity = store.get(entityType, id).value
    if (entity == null) return undefined
    // Recursively denormalize the entity's fields (they may contain refs too)
    return walkAndDenormalize(entity, store, visited)
  }

  // Walk children
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    result[key] = walkAndDenormalize(value, store, visited)
  }
  return result
}

/**
 * Cached version of walkAndDenormalize.
 * For EntityRef resolution, checks if the entity's ShallowRef value is the
 * same object as last time. If so, returns the cached denormalized subtree
 * (same reference — Vue's computed sees no change → no re-render).
 */
function walkAndDenormalizeCached(
  data: unknown,
  store: EntityStore,
  visited: WeakSet<object>,
  cache: Map<string, { entity: EntityRecord; result: unknown }>,
): unknown {
  if (data == null || typeof data !== 'object') {
    return data
  }

  if (visited.has(data as object)) {
    return data
  }
  visited.add(data as object)

  if (Array.isArray(data)) {
    let changed = false
    const result = data.map((item) => {
      const newItem = walkAndDenormalizeCached(item, store, visited, cache)
      if (newItem !== item) changed = true
      return newItem
    })
    // Structural sharing: return original array if no elements changed
    return changed ? result : data
  }

  const record = data as Record<string | symbol, unknown>
  if (isEntityRef(record)) {
    const entityType = record.entityType as string
    const id = record.id as string
    const key = `${entityType}:${id}`

    // Check existence first to avoid creating phantom refs
    if (!store.has(entityType, id)) return undefined

    // Read the ShallowRef — this is tracked by the outer computed for reactivity
    const entity = store.get(entityType, id).value
    if (entity == null) return undefined

    // Structural sharing: if entity object is the same reference, return cached result
    const cached = cache.get(key)
    if (cached && cached.entity === entity) {
      return cached.result
    }

    // Entity changed — recompute and cache
    const result = walkAndDenormalizeCached(entity, store, visited, cache)
    cache.set(key, { entity, result })
    return result
  }

  // Walk children with structural sharing
  let changed = false
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    const newValue = walkAndDenormalizeCached(value, store, visited, cache)
    result[key] = newValue
    if (newValue !== value) changed = true
  }
  return changed ? result : data
}

function isEntityRef(obj: Record<string | symbol, unknown>): boolean {
  return obj[ENTITY_REF_MARKER] === true
}
