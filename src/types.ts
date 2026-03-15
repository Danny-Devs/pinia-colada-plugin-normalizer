/**
 * pinia-colada-plugin-normalizer
 *
 * Normalized entity caching plugin for Pinia Colada.
 *
 * @module pinia-colada-plugin-normalizer
 */

import type { ComputedRef, ShallowRef } from 'vue'

// ─────────────────────────────────────────────
// Entity Store Interface (the swappable contract)
// ─────────────────────────────────────────────

/**
 * A single entity record in the store.
 * Entities are plain objects with at least an ID field.
 */
export type EntityRecord = Record<string, unknown>

/**
 * Composite key that uniquely identifies an entity: type + id.
 *
 * @example 'contact:42', 'order:abc-123'
 */
export type EntityKey = `${string}:${string}`

// ─────────────────────────────────────────────
// Entity Type Registry
// ─────────────────────────────────────────────

/**
 * User-extensible type registry for entity types.
 * Augment this interface via module augmentation to get full type safety
 * across the entire API surface.
 *
 * @example
 * ```typescript
 * declare module 'pinia-colada-plugin-normalizer' {
 *   interface EntityRegistry {
 *     contact: { contactId: string; name: string; email: string }
 *     order: { orderId: string; total: number; status: string }
 *   }
 * }
 *
 * // Now fully typed:
 * entityStore.get('contact', '1')          // ShallowRef<Contact | undefined>
 * entityStore.set('contact', '1', data)    // data must match Contact
 * useEntityQuery('contact', c => c.name)   // c is Contact
 * onEntityAdded('contact', e => e.data)    // data is Contact | undefined
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EntityRegistry {}

/** Resolve entity type from registry, falling back to EntityRecord. */
export type ResolveEntity<K extends string> =
  K extends keyof EntityRegistry ? EntityRegistry[K] : EntityRecord

/**
 * Event emitted when the entity store changes.
 * When the entity type is registered in `EntityRegistry`, `data` and
 * `previousData` are typed accordingly.
 */
export interface EntityEvent<T extends EntityRecord = EntityRecord> {
  /** The type of change */
  type: 'set' | 'remove'
  /** Entity type (e.g., 'contact', 'order') */
  entityType: string
  /** Entity ID */
  id: string
  /** The full entity key */
  key: EntityKey
  /** The entity data (undefined for 'remove' events) */
  data: T | undefined
  /** The previous entity data (undefined if entity didn't exist before) */
  previousData: T | undefined
}

/**
 * The EntityStore interface — the core contract that all backends implement.
 *
 * This interface is designed to be backend-agnostic:
 * - Level 1: In-memory reactive Map (default, no persistence)
 * - Level 2: IndexedDB + Dexie (quick offline)
 * - Level 3: SQLite + WASM + OPFS (full query planner, IVM via triggers)
 *
 * Consumers interact through this interface and never know which backend
 * is running underneath.
 */
export interface EntityStore {
  // ── Writes ──────────────────────────────────

  /**
   * Store an entity. If it already exists, shallow-merges incoming data on top
   * of existing data ({ ...existing, ...incoming }). This preserves fields from
   * richer queries (e.g., detail fetch with email) when a lighter query refetches.
   *
   * Use `replace()` instead if you need to overwrite the entity completely.
   */
  set<K extends string & keyof EntityRegistry>(entityType: K, id: string, data: EntityRegistry[K]): void
  set(entityType: string, id: string, data: EntityRecord): void

  /**
   * Store an entity with full replacement (no merge).
   * Unlike `set()`, this overwrites the entity completely — any existing fields
   * not present in `data` are removed.
   *
   * Use this when you know the incoming data is the complete entity
   * (e.g., from a full server response or when the server intentionally removed fields).
   */
  replace<K extends string & keyof EntityRegistry>(entityType: K, id: string, data: EntityRegistry[K]): void
  replace(entityType: string, id: string, data: EntityRecord): void

  /**
   * Store multiple entities at once (batch write).
   * Uses shallow merge (same as `set()`).
   * More efficient than calling set() in a loop for backends that support transactions.
   */
  setMany(entities: Array<{ entityType: string; id: string; data: EntityRecord }>): void

  /**
   * Remove an entity from the store.
   */
  remove(entityType: string, id: string): void

  // ── Reads ───────────────────────────────────

  /**
   * Get a single entity by type and ID.
   * Returns a reactive ref that updates when the entity changes.
   */
  get<K extends string & keyof EntityRegistry>(entityType: K, id: string): ShallowRef<EntityRegistry[K] | undefined>
  get(entityType: string, id: string): ShallowRef<EntityRecord | undefined>

  /**
   * Get all entities of a given type.
   * Returns a computed ref that updates when any entity of that type changes.
   */
  getByType<K extends string & keyof EntityRegistry>(entityType: K): ComputedRef<EntityRegistry[K][]>
  getByType(entityType: string): ComputedRef<EntityRecord[]>

  /**
   * Get all entities of a given type as id+data pairs.
   * Non-reactive snapshot — use `getByType()` for reactive views.
   *
   * This returns the store's canonical IDs alongside entity data,
   * which is essential for features like indexes that need to map
   * IDs to field values. Unlike `getByType()` (which returns data only),
   * this preserves the ID that the store uses internally.
   */
  getEntriesByType(entityType: string): Array<{ id: string; data: EntityRecord }>

  /**
   * Check if an entity exists in the store.
   */
  has(entityType: string, id: string): boolean

  // ── Subscriptions ───────────────────────────

  /**
   * Subscribe to entity changes. Useful for:
   * - Syncing with external systems (WebSocket confirmations)
   * - Analytics / debugging
   * - Cross-tab synchronization
   *
   * Note: no event is emitted for no-op writes (when `set()` is called
   * with data identical to what's already stored). This preserves
   * referential identity and prevents unnecessary downstream work.
   *
   * @returns Unsubscribe function
   */
  subscribe<K extends string & keyof EntityRegistry>(
    listener: (event: EntityEvent<EntityRegistry[K]>) => void,
    filter: { entityType: K },
  ): () => void
  subscribe(
    listener: (event: EntityEvent) => void,
    filter?: { entityType?: string },
  ): () => void

  // ── Reference counting (GC support) ────────

  /**
   * Increment the reference count for an entity.
   * Called by the plugin when a query extracts this entity.
   * Entities created via direct `set()` (e.g., WebSocket) are untracked
   * and will NOT be collected by `gc()`.
   */
  retain(entityType: string, id: string): void

  /**
   * Decrement the reference count for an entity.
   * Called by the plugin when a query is removed or its entities change.
   */
  release(entityType: string, id: string): void

  /**
   * Remove entities with zero or negative reference counts.
   * Only affects entities that have been `retain()`ed at least once —
   * entities created via direct `set()` (never retained) are untouched.
   *
   * @returns Array of removed entity keys (e.g., ['contact:42', 'order:5'])
   */
  gc(): string[]

  // ── Lifecycle ───────────────────────────────

  /**
   * Clear all entities from the store.
   */
  clear(): void

  /**
   * Get a snapshot of all entities (for serialization / SSR hydration).
   */
  toJSON(): Record<EntityKey, EntityRecord>

  /**
   * Hydrate the store from a snapshot (SSR / persistence restore).
   */
  hydrate(snapshot: Record<EntityKey, EntityRecord>): void
}

// ─────────────────────────────────────────────
// Entity Definition (the escape hatch)
// ─────────────────────────────────────────────

/**
 * Configuration for an entity type. Only needed when conventions don't fit.
 *
 * Convention: objects with an `id` field are auto-detected as entities.
 * Use defineEntity() when your API uses non-standard ID fields.
 *
 * @typeParam T - The entity shape. Provides type safety for `getId` and `merge`
 *   callbacks. Defaults to `EntityRecord` if not specified.
 *
 * @example
 * interface Contact {
 *   contactId: string
 *   name: string
 *   email: string
 * }
 *
 * const contact = defineEntity<Contact>({
 *   idField: 'contactId',
 *   getId: (entity) => entity.contactId, // entity is typed as Contact
 *   merge: (existing, incoming) => ({ ...existing, ...incoming }), // both typed
 * })
 */
export interface EntityDefinition<T extends EntityRecord = EntityRecord> {
  /**
   * The field name that contains the entity's unique ID.
   * @default 'id'
   */
  idField?: string & keyof T | (string & {})

  /**
   * A function to extract the ID from an entity.
   * Use this for composite keys or computed IDs.
   * Takes precedence over `idField`.
   *
   * Must return `null` or `undefined` for objects that are NOT this entity type.
   * This is important when the same `getId` function could match unrelated objects.
   *
   * @example
   * // Composite key — only match objects that have both fields
   * getId: (entity) => {
   *   if (entity.orgId == null || entity.userId == null) return undefined
   *   return `${entity.orgId}-${entity.userId}`
   * }
   */
  getId?: (entity: T) => string | null | undefined

  /**
   * Custom merge function for this entity type.
   * Called instead of the default shallow merge when updating an existing entity.
   * If omitted, the default `{ ...existing, ...incoming }` merge is used.
   *
   * Use cases: pagination (array append), deep nested objects, counters, etc.
   *
   * @example
   * // Append to a replies array instead of replacing it
   * merge: (existing, incoming) => ({
   *   ...existing,
   *   ...incoming,
   *   replies: [...(existing.replies || []), ...(incoming.replies || [])],
   * })
   */
  merge?: (existing: T, incoming: T) => T
}

/**
 * Helper to define an entity configuration with type safety.
 *
 * @typeParam T - The entity shape. When provided, `getId`, `merge`, and
 *   `idField` get type-checked against your entity interface.
 *
 * @example
 * // Without generic (still works, no type checking on callbacks):
 * defineEntity({ idField: 'contactId' })
 *
 * // With generic (getId and merge are typed):
 * defineEntity<Contact>({ idField: 'contactId' })
 */
export function defineEntity<T extends EntityRecord = EntityRecord>(
  config: EntityDefinition<T>,
): EntityDefinition<T> {
  return config
}

// ─────────────────────────────────────────────
// Normalizer Plugin Options
// ─────────────────────────────────────────────

/**
 * Per-query normalization options, added to UseQueryOptions via module augmentation.
 */
export interface NormalizerQueryOptions {
  /**
   * Whether to normalize this query's response.
   * - `true`: normalize (extract entities, replace with references)
   * - `false`: skip normalization for this query
   * - Inherits from the global `autoNormalize` option if not set.
   */
  normalize?: boolean
}

/**
 * Options for the pinia-colada-plugin-normalizer plugin.
 */
export interface NormalizerPluginOptions {
  /**
   * Entity definitions for non-standard APIs.
   * Keys are entity type names, values are EntityDefinition configs.
   *
   * For standard APIs (objects with `id` field), no configuration needed.
   *
   * @example
   * {
   *   contact: defineEntity({ idField: 'contactId' }),
   *   order: defineEntity({ idField: 'orderId' }),
   * }
   */
  entities?: Record<string, EntityDefinition>

  /**
   * The default field name to look for when auto-detecting entities.
   * @default 'id'
   */
  defaultIdField?: string

  /**
   * Custom EntityStore implementation.
   * Defaults to the in-memory reactive store.
   *
   * Swap this for IndexedDB, SQLite, or any other backend.
   */
  store?: EntityStore

  /**
   * Whether to normalize query responses by default.
   * When false, only queries with `normalize: true` option are normalized.
   * @default false
   */
  autoNormalize?: boolean
}

// ─────────────────────────────────────────────
// Internal Symbols & Types
// ─────────────────────────────────────────────

/**
 * Symbol used to mark objects as entity references.
 * Using a Symbol prevents collision with any API data.
 * @internal
 */
export const ENTITY_REF_MARKER = Symbol('pinia-colada-entity-ref')

/**
 * Symbol key for storing normalization metadata in entry.ext.
 * Following the auto-refetch plugin pattern of using Symbols for ext keys.
 * @internal
 */
export const NORM_META_KEY = Symbol('pinia-colada-norm-meta')

/**
 * An entity reference that replaces the actual entity data in the query cache.
 * Uses a Symbol marker to prevent collision with API data (Issue #13 fix).
 * @internal
 */
export interface EntityRef {
  /** Symbol marker to identify this as a reference (not a string property) */
  [ENTITY_REF_MARKER]: true
  /** Entity type */
  entityType: string
  /** Entity ID */
  id: string
  /** Full entity key */
  key: EntityKey
}

/**
 * Normalization metadata stored per query entry in ext.
 * @internal
 */
export interface NormMeta {
  /** Whether this entry has been normalized */
  isNormalized: boolean
  /** Entity keys extracted from this entry's data */
  entityKeys: string[]
}

/**
 * The result of normalizing a query response.
 * @internal
 */
export interface NormalizationResult {
  /** The transformed data with entities replaced by references */
  normalized: unknown
  /** The entities extracted from the response */
  entities: Array<{ entityType: string; id: string; data: EntityRecord }>
}

// ─────────────────────────────────────────────
// Module Augmentation (Issue #5 fix)
// ─────────────────────────────────────────────

declare module '@pinia/colada' {
  // eslint-disable-next-line unused-imports/no-unused-vars
  interface UseQueryOptions<TData, TError, TDataInitial> extends NormalizerQueryOptions {}

  interface UseQueryOptionsGlobal extends NormalizerQueryOptions {}

  // eslint-disable-next-line unused-imports/no-unused-vars
  interface UseQueryEntryExtensions<TData, TError, TDataInitial> {
    /**
     * Normalization metadata for this entry.
     * Contains whether the entry was normalized and which entity keys were extracted.
     */
    [NORM_META_KEY]: ShallowRef<NormMeta>
  }
}
