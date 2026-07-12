/**
 * pinia-colada-plugin-normalizer
 *
 * Normalized entity caching plugin for Pinia Colada.
 *
 * @module pinia-colada-plugin-normalizer
 */

// Plugin
export {
  PiniaColadaNormalizer,
  useEntityStore,
  invalidateEntity,
  updateQueryData,
  deleteEntity,
  useNormalizeMutation,
} from "./plugin";

/** @deprecated Use `deleteEntity` instead. Will be removed in 1.0. */
export { deleteEntity as removeEntityFromAllQueries } from "./plugin";

// Entity Store
export { createEntityStore } from "./store";

// Composables (Phase 2: Real-Time)
export {
  onEntityAdded,
  onEntityUpdated,
  onEntityRemoved,
  useOptimisticUpdate,
  createCoalescer,
} from "./composables";
export type { OptimisticTransaction } from "./composables";

// Composables (Phase 3: Performance & DX)
export { useEntityRef, useEntityQuery, createEntityIndex } from "./composables";

// Composables (Phase 4: Cache Redirects)
export { useCachedEntity } from "./composables";

// Persistence (Phase 4: write-behind durability — ADR-003)
export { enablePersistence } from "./persist";
export type { PersistenceOptions, PersistenceHandle } from "./persist";

// Storage engines (swappable durability substrates)
export { idbEngine } from "./engines/idb";
export type { IdbEngineOptions } from "./engines/idb";
export { memoryEngine } from "./engines/memory";
export type { MemoryEngine } from "./engines/memory";
export { sqliteEngine } from "./engines/sqlite";
export type { SqliteEngine, SqliteEngineOptions } from "./engines/sqlite";
// (worker side: import { runSqliteWorker } from 'pinia-colada-plugin-normalizer/sqlite-worker')

// Pagination Helpers
export { cursorPagination, offsetPagination, relayPagination } from "./pagination";
export type {
  CursorPaginationOptions,
  OffsetPaginationOptions,
  RelayPaginationOptions,
  RelayPageInfo,
  RelayEdge,
  RelayConnection,
} from "./pagination";

// Types & Helpers
export { defineEntity } from "./types";
export type {
  EntityStore,
  StorageEngine,
  EntityRecord,
  EntityKey,
  EntityEvent,
  EntityDefinition,
  EntityRegistry,
  ResolveEntity,
  NormalizerPluginOptions,
  NormalizerQueryOptions,
} from "./types";
