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

// Persistence (Phase 4: IndexedDB)
export { enablePersistence } from "./persist";
export type { PersistenceOptions, PersistenceHandle } from "./persist";

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
  EntityRecord,
  EntityKey,
  EntityEvent,
  EntityDefinition,
  EntityRegistry,
  ResolveEntity,
  NormalizerPluginOptions,
  NormalizerQueryOptions,
} from "./types";
