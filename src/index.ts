/**
 * pinia-colada-plugin-normalizer
 *
 * Normalized entity caching plugin for Pinia Colada.
 *
 * @module pinia-colada-plugin-normalizer
 */

// Plugin
export { PiniaColadaNormalizer, useEntityStore, invalidateEntity, normalize, denormalize } from './plugin'

// Entity Store
export { createEntityStore } from './store'

// Types & Helpers
export { defineEntity } from './types'
export type {
  EntityStore,
  EntityRecord,
  EntityKey,
  EntityEvent,
  EntityDefinition,
  NormalizerPluginOptions,
  NormalizerQueryOptions,
} from './types'
