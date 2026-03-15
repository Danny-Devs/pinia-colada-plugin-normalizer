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

/**
 * Event emitted when the entity store changes.
 */
export interface EntityEvent {
  /** The type of change */
  type: 'set' | 'remove'
  /** Entity type (e.g., 'contact', 'order') */
  entityType: string
  /** Entity ID */
  id: string
  /** The full entity key */
  key: EntityKey
  /** The entity data (undefined for 'remove' events) */
  data: EntityRecord | undefined
  /** The previous entity data (undefined if entity didn't exist before) */
  previousData: EntityRecord | undefined
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
   * Store an entity. If it already exists, replaces it (whole-entity replacement).
   * Vue's reactivity handles property-level diffing automatically.
   */
  set(entityType: string, id: string, data: EntityRecord): void

  /**
   * Store multiple entities at once (batch write).
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
  get(entityType: string, id: string): ShallowRef<EntityRecord | undefined>

  /**
   * Get all entities of a given type.
   * Returns a computed ref that updates when any entity of that type changes.
   */
  getByType(entityType: string): ComputedRef<EntityRecord[]>

  /**
   * Check if an entity exists in the store.
   */
  has(entityType: string, id: string): boolean

  // ── Queries (the IVM extensibility point) ───

  /**
   * Run a derived query against the store.
   *
   * Level 1 (in-memory): wraps Vue computed() — brute force, fine for < 10K entities.
   * Level 2 (with indexes): uses manual index maps for O(k) lookups.
   * Level 3 (SQLite): delegates to SQL query planner with indexes and triggers.
   *
   * The function signature stays the same regardless of backend.
   */
  query<T>(queryFn: (entities: ReadonlyEntityMap) => T): ComputedRef<T>

  // ── Subscriptions ───────────────────────────

  /**
   * Subscribe to entity changes. Useful for:
   * - Syncing with external systems (WebSocket confirmations)
   * - Analytics / debugging
   * - Cross-tab synchronization
   *
   * @returns Unsubscribe function
   */
  subscribe(
    listener: (event: EntityEvent) => void,
    filter?: { entityType?: string },
  ): () => void

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

/**
 * Read-only view of the entity map, passed to query functions.
 * This prevents accidental mutations inside derived queries.
 */
export interface ReadonlyEntityMap {
  get(entityType: string, id: string): EntityRecord | undefined
  getByType(entityType: string): readonly EntityRecord[]
  has(entityType: string, id: string): boolean
  keys(): IterableIterator<EntityKey>
}

// ─────────────────────────────────────────────
// Entity Definition (the escape hatch)
// ─────────────────────────────────────────────

/**
 * Configuration for an entity type. Only needed when conventions don't fit.
 *
 * Convention: objects with an `id` field are auto-detected as entities.
 * Use defineEntity() when your API uses non-standard ID fields.
 */
export interface EntityDefinition {
  /**
   * The field name that contains the entity's unique ID.
   * @default 'id'
   */
  idField?: string

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
  getId?: (entity: EntityRecord) => string | null | undefined
}

/**
 * Helper to define an entity configuration with type safety.
 */
export function defineEntity(config: EntityDefinition): EntityDefinition {
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
