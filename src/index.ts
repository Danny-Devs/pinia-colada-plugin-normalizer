/**
 * pinia-colada-plugin-normalizer
 *
 * Normalized entity caching plugin for Pinia Colada.
 *
 * @module pinia-colada-plugin-normalizer
 */

// Plugin
export {
  PiniaColadaNormalizer, useEntityStore, invalidateEntity,
  updateQueryData, removeEntityFromAllQueries,
  useNormalizeMutation, normalize, denormalize,
} from './plugin'

// Entity Store
export { createEntityStore } from './store'

// Composables (Phase 2: Real-Time)
export {
  onEntityAdded,
  onEntityUpdated,
  onEntityRemoved,
  useOptimisticUpdate,
  createCoalescer,
} from './composables'
export type { OptimisticTransaction } from './composables'

// Composables (Phase 3: Performance & DX)
export {
  useEntityRef,
  useEntityQuery,
  createEntityIndex,
} from './composables'

// Types & Helpers
export { defineEntity } from './types'
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
} from './types'
