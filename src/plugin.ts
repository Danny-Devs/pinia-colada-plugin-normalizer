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
import { defineStore, type Pinia } from 'pinia'
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

/**
 * Split an entity key like 'contact:42' into ['contact', '42'].
 * @internal
 */
function splitEntityKey(key: string): [string, string] {
  const idx = key.indexOf(':')
  return [key.slice(0, idx), key.slice(idx + 1)]
}

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
  let qCache: any = null
  let eDefs: Record<string, EntityDefinition> = {}
  let defIdField = 'id'
  function setStore(s: EntityStore) { store = s }
  function getStore() { return store }
  function setQueryCache(qc: any) { qCache = qc }
  function getQueryCache() { return qCache }
  function setEntityDefs(defs: Record<string, EntityDefinition>, defaultId: string) {
    eDefs = defs
    defIdField = defaultId
  }
  function getEntityDefs() { return { entityDefs: eDefs, defaultIdField: defIdField } }
  return { getStore, setStore, getQueryCache, setQueryCache, setEntityDefs, getEntityDefs }
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
    normalizerStore.setQueryCache(queryCache)
    normalizerStore.setEntityDefs(entityDefs, defaultIdField)
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

          // Invalidate denorm cache only when a REFERENCED entity changes.
          // denormCache keys are entity keys (e.g., 'contact:42') populated
          // during denormalization — they track all entities this query reads,
          // including transitive deps from nested entity refs.
          // When the cache is cold (empty), no invalidation needed — the next
          // read rebuilds fresh from the store.
          const unsubDenormWatcher = entityStoreInstance.subscribe((event) => {
            if (denormCache.has(event.key)) {
              denormCache.clear()
              cachedState = null
              cachedData = null
            }
          })

          // Store the unsubscribe function on the entry for cleanup on removal.
          // Using a non-enumerable property to avoid polluting the entry.
          Object.defineProperty(entry, '_normUnsub', {
            value: unsubDenormWatcher,
            configurable: true,
          })

          // Replace entry.state with a customRef that normalizes on write
          // and denormalizes on read.
          entry.state = customRef((track, trigger) => ({
            get(): State {
              track()
              // Denormalize on read: replace EntityRefs with live store data
              if (rawState.status === 'success' && rawState.data != null) {
                const data = denormalize(rawState.data, entityStoreInstance, denormCache)
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
              // Short-circuit: skip normalization if same reference
              if (incoming === rawState) return

              // Normalize on write: extract entities, replace with refs
              if (incoming.status === 'success' && incoming.data != null) {
                const result = normalize(incoming.data, entityDefs, defaultIdField)
                if (result.entities.length > 0) {
                  // Write entities to the store, respecting custom merge policies.
                  // Entities with a custom merge function are processed individually;
                  // the rest are batched for efficiency.
                  const customMergeEntities = result.entities.filter(e => entityDefs[e.entityType]?.merge)
                  const regularEntities = result.entities.filter(e => !entityDefs[e.entityType]?.merge)

                  if (regularEntities.length > 0) {
                    entityStoreInstance.setMany(regularEntities)
                  }
                  for (const entity of customMergeEntities) {
                    const mergeFn = entityDefs[entity.entityType].merge!
                    if (entityStoreInstance.has(entity.entityType, entity.id)) {
                      const existing = entityStoreInstance.get(entity.entityType, entity.id).value!
                      entityStoreInstance.replace(entity.entityType, entity.id, mergeFn(existing, entity.data))
                    } else {
                      entityStoreInstance.set(entity.entityType, entity.id, entity.data)
                    }
                  }

                  // GC lifecycle: retain new keys FIRST, then release old ones.
                  // This order prevents a transient zero-refcount window for
                  // entities present in both old and new sets.
                  const newEntityKeys = result.entities.map(
                    (e) => `${e.entityType}:${e.id}`,
                  )
                  for (const key of newEntityKeys) {
                    const [type, id] = splitEntityKey(key)
                    entityStoreInstance.retain(type, id)
                  }
                  const oldMeta = entry.ext[NORM_META_KEY].value
                  if (oldMeta.isNormalized) {
                    for (const key of oldMeta.entityKeys) {
                      const [type, id] = splitEntityKey(key)
                      entityStoreInstance.release(type, id)
                    }
                  }

                  // Update ext metadata via ShallowRef .value
                  entry.ext[NORM_META_KEY].value = {
                    isNormalized: true,
                    entityKeys: newEntityKeys,
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

      // ── remove: release entity refs for GC + cleanup subscription ──
      // When a query entry is removed (GC or manual), release its entity keys
      // so gc() can collect unreferenced entities, and unsubscribe the
      // denorm cache watcher to prevent memory leaks.
      if (name === 'remove') {
        const [entry] = args
        const meta = (entry as any).ext?.[NORM_META_KEY]?.value as NormMeta | undefined
        if (meta?.isNormalized) {
          for (const key of meta.entityKeys) {
            const [type, id] = splitEntityKey(key)
            entityStoreInstance.release(type, id)
          }
        }
        // Unsubscribe the denorm cache watcher
        const unsub = (entry as any)._normUnsub as (() => void) | undefined
        if (unsub) unsub()
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
 * In component setup or composables, Pinia is auto-detected via inject.
 * Outside component context (e.g., standalone services), pass the Pinia
 * instance explicitly — same pattern as `useMutationCache(pinia)`.
 *
 * @param pinia - Optional Pinia instance. Required outside component setup.
 *
 * @example
 * ```typescript
 * import { useEntityStore } from 'pinia-colada-plugin-normalizer'
 *
 * // In a component or composable (auto-detected):
 * const entityStore = useEntityStore()
 *
 * // Outside component context (e.g., WebSocket service):
 * const entityStore = useEntityStore(pinia)
 *
 * ws.on('CONTACT_UPDATED', (data) => {
 *   entityStore.set('contact', data.contactId, data)
 * })
 * ```
 */
export function useEntityStore(pinia?: Pinia): EntityStore {
  const normalizerStore = pinia ? useNormalizerStore(pinia) : useNormalizerStore()
  return normalizerStore.getStore()
}

/**
 * Invalidates (marks stale + refetches) all active queries that reference
 * the given entity. Use this when you know an entity is stale and want
 * dependent queries to refetch from the server.
 *
 * For WebSocket apps: usually you DON'T need this — entity store updates
 * propagate automatically via reactivity. Use this when you want to
 * force a server round-trip (e.g., after entity removal, or when you
 * receive a "stale" signal without the actual data).
 *
 * In component setup or composables, Pinia is auto-detected via inject.
 * Outside component context, pass the Pinia instance explicitly.
 *
 * @param entityType - The entity type (e.g., 'contact')
 * @param id - The entity ID (e.g., '42')
 * @param pinia - Optional Pinia instance. Required outside component setup.
 *
 * @example
 * ```typescript
 * import { invalidateEntity, useEntityStore } from 'pinia-colada-plugin-normalizer'
 *
 * // After removing an entity, refetch all queries that referenced it:
 * const entityStore = useEntityStore()
 * entityStore.remove('contact', '42')
 * invalidateEntity('contact', '42')
 *
 * // Or in a WebSocket handler for "entity deleted" events:
 * ws.on('CONTACT_DELETED', ({ contactId }) => {
 *   entityStore.remove('contact', contactId)
 *   invalidateEntity('contact', contactId)
 * })
 * ```
 */
export function invalidateEntity(
  entityType: string,
  id: string,
  pinia?: Pinia,
): void {
  const normalizerStore = pinia ? useNormalizerStore(pinia) : useNormalizerStore()
  const queryCache = normalizerStore.getQueryCache()

  if (!queryCache) {
    throw new Error(
      '[pinia-colada-plugin-normalizer] invalidateEntity() called before plugin installation. '
      + 'Make sure PiniaColadaNormalizer is installed via PiniaColada plugins option.',
    )
  }

  const entityKey = `${entityType}:${id}`

  // Scan all query entries for ones that reference this entity
  for (const entry of queryCache.getEntries()) {
    const meta = (entry as any).ext?.[NORM_META_KEY]?.value as NormMeta | undefined
    if (meta?.isNormalized && meta.entityKeys.includes(entityKey)) {
      // Refetch this entry — queryCache.fetch() re-runs the query function
      // and updates the entry state, which flows through our customRef setter.
      queryCache.fetch(entry).catch(() => {
        // Silently ignore fetch errors (entry may have been GC'd,
        // query may be disabled, etc.)
      })
    }
  }
}

/**
 * Update the data of a specific query, re-normalizing the result.
 *
 * The updater receives denormalized data (real entities, not refs)
 * and should return the new data. The result flows through the
 * customRef setter which re-normalizes it automatically.
 *
 * Use this for array operations (add/remove entities from list queries).
 *
 * @example
 * ```typescript
 * import { updateQueryData, useEntityStore } from 'pinia-colada-plugin-normalizer'
 *
 * // Add a new contact to a list query after creating it:
 * entityStore.set('contact', '99', newContact)
 * updateQueryData(['contacts'], (data) => [...(data as any[]), newContact])
 *
 * // Remove a contact from a list query:
 * updateQueryData(['contacts'], (data) =>
 *   (data as any[]).filter(c => c.contactId !== '42'))
 *
 * // Prepend to a list:
 * updateQueryData(['contacts'], (data) => [newContact, ...(data as any[])])
 * ```
 */
export function updateQueryData(
  key: unknown[],
  updater: (currentData: unknown) => unknown,
  pinia?: Pinia,
): void {
  const normalizerStore = pinia ? useNormalizerStore(pinia) : useNormalizerStore()
  const queryCache = normalizerStore.getQueryCache()

  if (!queryCache) {
    throw new Error(
      '[pinia-colada-plugin-normalizer] updateQueryData() called before plugin installation.',
    )
  }

  // Use Pinia Colada's built-in setQueryData — it reads via our getter
  // (denormalized) and writes via our setter (normalizes).
  queryCache.setQueryData(key, updater)
}

/**
 * Remove an entity from ALL normalized queries that reference it.
 *
 * Scans all query entries, finds ones that reference the entity,
 * and removes it from any arrays in the query data. Non-array data
 * is left unchanged (use `invalidateEntity` to refetch instead).
 *
 * Also removes the entity from the entity store. This is the
 * complete "delete entity" operation — removes from store + all views.
 *
 * @example
 * ```typescript
 * import { removeEntityFromAllQueries } from 'pinia-colada-plugin-normalizer'
 *
 * // Delete a contact — removes from entity store + all list queries:
 * removeEntityFromAllQueries('contact', '42')
 *
 * // In a WebSocket handler:
 * ws.on('CONTACT_DELETED', ({ contactId }) => {
 *   removeEntityFromAllQueries('contact', contactId)
 * })
 * ```
 */
export function removeEntityFromAllQueries(
  entityType: string,
  id: string,
  pinia?: Pinia,
): void {
  const normalizerStore = pinia ? useNormalizerStore(pinia) : useNormalizerStore()
  const queryCache = normalizerStore.getQueryCache()
  const entityStoreInstance = normalizerStore.getStore()
  const { entityDefs, defaultIdField } = normalizerStore.getEntityDefs()

  if (!queryCache) {
    throw new Error(
      '[pinia-colada-plugin-normalizer] removeEntityFromAllQueries() called before plugin installation.',
    )
  }

  const entityKey = `${entityType}:${id}`

  // Determine the ID field for this entity type
  const def = entityDefs[entityType]
  const idField = def?.idField ?? defaultIdField

  // Update queries FIRST (before removing from store), so that
  // denormalization still resolves the entity for ID matching.
  // Scan all normalized query entries that reference this entity.
  for (const entry of queryCache.getEntries()) {
    const meta = (entry as any).ext?.[NORM_META_KEY]?.value as NormMeta | undefined
    if (!meta?.isNormalized || !meta.entityKeys.includes(entityKey)) continue

    // Read denormalized data (via customRef getter)
    const currentState = entry.state.value
    if (currentState.status !== 'success' || currentState.data == null) continue

    // Remove the entity from arrays in the data
    const newData = removeFromData(currentState.data, entityType, id, idField, def?.getId)
    if (newData !== currentState.data) {
      // Write back through customRef setter (re-normalizes)
      entry.state.value = { ...currentState, data: newData }
    }
  }

  // Remove from entity store AFTER updating queries
  entityStoreInstance.remove(entityType, id)
}

/**
 * Recursively remove entities matching type+id from arrays in data.
 * Returns the same reference if nothing changed (structural sharing).
 * @internal
 */
function removeFromData(
  data: unknown,
  entityType: string,
  id: string,
  idField: string,
  getId?: (entity: EntityRecord) => string | null | undefined,
): unknown {
  if (data == null || typeof data !== 'object') return data

  if (Array.isArray(data)) {
    const filtered = data.filter((item) => {
      if (item == null || typeof item !== 'object') return true
      const record = item as EntityRecord
      // Check by getId function first (most specific)
      if (getId) {
        const extractedId = getId(record)
        if (extractedId != null && String(extractedId) === id) return false
      }
      // Check by idField — only match if we can confirm the entity type
      // to avoid false positives across different entity types sharing IDs
      if (record[idField] != null && String(record[idField]) === id) {
        // If __typename is present, verify it matches
        if (record.__typename != null) {
          if (record.__typename === entityType) return false
        } else {
          // No __typename — trust the idField match (user used defineEntity)
          return false
        }
      }
      return true
    })
    if (filtered.length === data.length) {
      // Nothing removed — recurse into items
      let changed = false
      const result = data.map((item) => {
        const newItem = removeFromData(item, entityType, id, idField, getId)
        if (newItem !== item) changed = true
        return newItem
      })
      return changed ? result : data
    }
    return filtered
  }

  // Walk object properties
  const record = data as Record<string, unknown>
  let changed = false
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    const newValue = removeFromData(value, entityType, id, idField, getId)
    result[key] = newValue
    if (newValue !== value) changed = true
  }
  return changed ? result : data
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
 * Used on the read path (customRef getter) and available as a public utility.
 * Entities in the store may themselves contain EntityRefs (nested entities),
 * so denormalization must be recursive.
 *
 * Supports structural sharing via an optional cache parameter: when provided,
 * returns the same object reference for entities whose ShallowRef value hasn't
 * changed — preventing unnecessary re-renders.
 *
 * Uses store.has() before store.get() to avoid creating phantom refs.
 * Uses a WeakSet for circular reference protection.
 */
export function denormalize(
  data: unknown,
  store: EntityStore,
  cache?: Map<string, { entity: EntityRecord; result: unknown }>,
): unknown {
  const visited = new WeakSet<object>()
  return walkAndDenormalize(data, store, visited, cache)
}

function walkAndDenormalize(
  data: unknown,
  store: EntityStore,
  visited: WeakSet<object>,
  cache?: Map<string, { entity: EntityRecord; result: unknown }>,
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
      const newItem = walkAndDenormalize(item, store, visited, cache)
      if (newItem !== item) changed = true
      return newItem
    })
    return changed ? result : data
  }

  const record = data as Record<string | symbol, unknown>
  if (isEntityRef(record)) {
    const entityType = record.entityType as string
    const id = record.id as string

    // Check existence first to avoid creating phantom refs
    if (!store.has(entityType, id)) return undefined

    // Read the ShallowRef — tracked by the outer computed for reactivity
    const entity = store.get(entityType, id).value
    if (entity == null) return undefined

    // Structural sharing: if cache provided and entity ref unchanged, reuse result
    if (cache) {
      const cacheKey = `${entityType}:${id}`
      const cached = cache.get(cacheKey)
      if (cached && cached.entity === entity) {
        return cached.result
      }
      const result = walkAndDenormalize(entity, store, visited, cache)
      cache.set(cacheKey, { entity, result })
      return result
    }

    return walkAndDenormalize(entity, store, visited, cache)
  }

  // Walk children with structural sharing
  let changed = false
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    const newValue = walkAndDenormalize(value, store, visited, cache)
    result[key] = newValue
    if (newValue !== value) changed = true
  }
  return changed ? result : data
}

function isEntityRef(obj: Record<string | symbol, unknown>): boolean {
  return obj[ENTITY_REF_MARKER] === true
}
