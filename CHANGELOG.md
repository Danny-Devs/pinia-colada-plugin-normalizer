# Changelog

## 0.1.4 (unreleased)

### Features
- **`useEntityRef(type, id)`** — Reactive computed ref to a single entity. Accepts `MaybeRefOrGetter<string>` for reactive IDs (e.g., `useEntityRef('contact', () => route.params.id)`). No GC tracking — immune to garbage collection.
- **`useCachedEntity(type, id)`** — Returns a getter function that denormalizes entity data, resolving nested EntityRefs. Use as `placeholderData` in `useQuery` for instant cache redirects.
- **`useNormalizeMutation()`** — Returns a function that normalizes arbitrary data into the entity store. Use in mutation `onSuccess` handlers for auto entity extraction.
- **`deleteEntity(type, id)`** — Replaces `removeEntityFromAllQueries`. Operates on normalized EntityRefs for type-safe matching, fixing cross-type false positives when entity types share the same `idField`.
- **`getEntriesByType(type)`** — New `EntityStore` method returning `{id, data}` pairs. Non-reactive snapshot that exposes canonical store IDs.
- **Duplicate-install guard** — Throws if `PiniaColadaNormalizer` is installed twice on the same Pinia instance.

### Bug Fixes
- **CRITICAL**: Optimistic `commit()` now updates server truth for concurrent transactions. Previously, committing transaction A then rolling back transaction B would lose A's confirmed changes.
- **IMPORTANT**: `store.get()` phantom refs now bump type version on `set()`, fixing stale `getByType()` results.
- **IMPORTANT**: `toJSON()`/`hydrate()` now encode EntityRefs via `__pcn_ref` wire format, fixing SSR hydration where Symbol keys were silently dropped by `JSON.stringify`.
- **IMPORTANT**: Denorm cache subscriber now checks `entityKeys` AND triggers `customRef`, fixing stale reads when entities are removed or arrive out of order.
- Denormalize visited set now backtracks (`visited.delete` after recursion), allowing shared entities across multiple ref paths in the public `denormalize()` API.
- `onScopeDispose` added for entity store subscriptions, preventing memory leaks on SSR app teardown.
- `replace()` now skips no-op writes when data is the same reference.
- Error boundary in customRef setter — `normalize()` failures fall back to storing raw data instead of crashing the query cache.

### Production Hardening
- `entityKeys` converted from `Array` to `Set` in `NormMeta` (O(1) subscriber lookups).
- `getByType()` memoized per entity type (avoids duplicate computed refs).
- `@pinia/colada` peer dependency pinned to `>=1.0.0 <2.0.0`.
- Auto `onScopeDispose` cleanup on all WS hooks (`onEntityAdded`, `onEntityUpdated`, `onEntityRemoved`) and `createEntityIndex`.

### Breaking Changes (pre-1.0)
- `removeEntityFromAllQueries` renamed to `deleteEntity` (deprecated alias kept until 1.0).
- `normalize`/`denormalize` removed from public exports (now `@internal`).

### Tests
- 95 → 123 tests (+28)
- SSR cross-request isolation test
- Full SSR round-trip: `toJSON` → `JSON.stringify` → `hydrate` → verify EntityRef survival
- `useInfiniteQuery` compatibility tests (pagination + entity updates)
- Known limitation documented: `pageParams` with object values containing entity-like fields can trigger false-positive extraction

## 0.1.3 (2026-03-15)

### Features
- `EntityRegistry` type registry for end-to-end type safety via module augmentation
- Generic `defineEntity<T>()` for typed `getId`, `merge`, and `idField` callbacks

## 0.1.2 (2026-03-15)

### Features
- `EntityRegistry` type registry (initial release)

## 0.1.1 (2026-03-14)

### Bug Fixes
- `retain()` before `release()` ordering to prevent transient zero-refcount window

## 0.1.0 (2026-03-13)

Initial release. Core MVP with:
- Normalized entity caching via `customRef` replacement pattern
- In-memory reactive `EntityStore` (ShallowRef per entity)
- `defineEntity()` for non-standard APIs
- Opt-in per query (`normalize: true`)
- Entity GC with reference counting
- Custom merge policies
- WebSocket hooks (`onEntityAdded`, `onEntityUpdated`, `onEntityRemoved`)
- Transaction-based optimistic updates with concurrent rollback
- Event coalescing for batch fetches
- Entity queries (`useEntityQuery`) and indexes (`createEntityIndex`)
- Array operations (`updateQueryData`, `removeEntityFromAllQueries`)
- SSR-safe via `defineStore` scoping
- Interactive playground deployed to Vercel
