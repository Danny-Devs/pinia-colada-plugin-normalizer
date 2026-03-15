/**
 * Pinia Colada Normalizer plugin.
 *
 * Hooks into Pinia Colada's query cache via $onAction subscriptions:
 * 1. 'extend' — initialize ext metadata with scope.run() (ShallowRef)
 * 2. 'setEntryState' — normalize on write via after() callback
 *
 * Integration surface: 2 action hooks + ext field.
 * Follows patterns from Eduardo's writing-plugins.md guide and the
 * dataUpdatedAt example (ShallowRef + scope.run + after).
 *
 * @module pinia-colada-plugin-normalizer
 */

import { shallowRef } from 'vue'
import type { PiniaColadaPlugin } from '@pinia/colada'
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
// Plugin Factory
// ─────────────────────────────────────────────

/**
 * Creates the normalizer plugin for Pinia Colada.
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
    store = createEntityStore(),
    autoNormalize = false,
  } = options

  // Expose the store instance so useEntityStore() can access it
  _pluginStore = store

  return ({ queryCache, scope }) => {
    queryCache.$onAction(({ name, args, after }) => {
      // ── extend: initialize ext metadata ──────────
      // Called once per entry creation. Must use scope.run() for reactive refs.
      // Must define ALL ext keys here (cannot add new keys later).
      if (name === 'extend') {
        const [entry] = args
        scope.run(() => {
          entry.ext[NORM_META_KEY] = shallowRef<NormMeta>({
            isNormalized: false,
            entityKeys: [],
          })
        })
      }

      // ── setEntryState: normalize on write ────────
      // Uses after() callback following Eduardo's dataUpdatedAt pattern.
      // We normalize AFTER the state is set, then immediately update it
      // with the normalized version.
      if (name === 'setEntryState') {
        const [entry, state] = args

        // Only normalize successful responses with data
        if (state.status !== 'success' || state.data == null) return

        // Check per-query option first, then global setting
        const shouldNormalize = entry.options?.normalize ?? autoNormalize
        if (!shouldNormalize) return

        after(() => {
          // Normalize the data: extract entities, replace with references
          const result = normalize(state.data, entityDefs, defaultIdField)

          if (result.entities.length > 0) {
            // Write entities to the store (batch for efficiency)
            store.setMany(result.entities)

            // Update ext metadata via ShallowRef .value
            entry.ext[NORM_META_KEY].value = {
              isNormalized: true,
              entityKeys: result.entities.map(
                (e) => `${e.entityType}:${e.id}`,
              ),
            }

            // Update entry state with normalized data (references instead of entities)
            // This triggers a second state update, but it's necessary to follow
            // the after() pattern correctly.
            entry.state.value = {
              ...entry.state.value,
              data: result.normalized,
            }
          }
        })
      }

      // ── remove: cleanup ──────────────────────────
      if (name === 'remove') {
        // Entities persist in the store even after query entries are GC'd.
        // This is intentional for WebSocket scenarios where entities
        // outlive individual queries.
        // Future: optional reference counting for entity GC.
      }
    })
  }
}

// ─────────────────────────────────────────────
// Entity Store Access (Issue #9 fix)
// ─────────────────────────────────────────────

/**
 * Module-level store reference, set during plugin initialization.
 * @internal
 */
let _pluginStore: EntityStore | undefined

/**
 * Returns the entity store instance used by the normalizer plugin.
 * Must be called after the plugin is installed.
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
  if (!_pluginStore) {
    throw new Error(
      '[pinia-colada-plugin-normalizer] useEntityStore() called before plugin installation. '
      + 'Make sure PiniaColadaNormalizer is installed via PiniaColada plugins option.',
    )
  }
  return _pluginStore
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

/**
 * Denormalizes data by replacing EntityRef references with live entity data
 * from the store.
 *
 * This is used on the read path to reconstruct the original data shape
 * with reactive entity data.
 */
export function denormalize(
  data: unknown,
  store: EntityStore,
): unknown {
  if (data == null || typeof data !== 'object') {
    return data
  }

  if (Array.isArray(data)) {
    return data.map((item) => denormalize(item, store))
  }

  // Check if this is an entity reference (Symbol-based, Issue #13 fix)
  const record = data as Record<string | symbol, unknown>
  if (isEntityRef(record)) {
    // Return the live reactive entity from the store
    return store.get(record.entityType as string, record.id as string).value
  }

  // Walk children
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    result[key] = denormalize(value, store)
  }
  return result
}

function isEntityRef(obj: Record<string | symbol, unknown>): obj is EntityRef {
  return obj[ENTITY_REF_MARKER] === true
}
