# Changelog

## 0.1.6 (2026-03-15)

### Features
- **`enablePersistence(store, options?)`** — IndexedDB persistence for the entity store. Entities survive page refresh. Incremental writes via dirty-set tracking (only changed entities flushed per debounce window). Fresh-wins hydration guard ensures server data takes precedence over stale IDB data. Zero runtime dependencies — uses raw IndexedDB API (~160 LOC).
- **Pagination helpers** — `cursorPagination()` and `offsetPagination()` for `useInfiniteQuery` merge recipes.
- **`getRefCount(type, id)`** — New `EntityStore` method exposing reference counts for DevTools/debugging.
- **DevTools polish** — ref count display, entity dependency graph, improved inspector layout.

### Production Hardening
- `onblocked` handler on IDB open — prevents indefinite hang when another tab holds the connection.
- `versionchange` listener — closes connection gracefully when another tab upgrades the DB.
- `flushing` guard prevents concurrent flush race conditions.
- `visibilitychange` + `beforeunload` lifecycle hooks flush pending writes on tab close.
- Graceful degradation: quota exceeded → disable + warn. Private browsing → memory-only. SSR → no-op.
- `_hydrating` flag suppresses write-storm during IDB restoration.
- `encodeEntityRefs`/`decodeEntityRefs` exported for persistence adapters (Symbol→string for structured clone).

### Docs
- New **Persistence** guide (setup, how-it-works diagram, options, patterns, edge cases).
- API reference updated with `enablePersistence`, `PersistenceOptions`, `PersistenceHandle`, `getRefCount`.
- VitePress docs site: 7 pages (added persistence).

### Tests
- 131 → 157 tests (+26): 11 persistence tests, 15 pagination tests.

## 0.1.5 (2026-03-15)

### Features
- **`autoRedirect`** — Convention-based cache redirects via `[entityType, id]` query key pattern. One flag in plugin options (`autoRedirect: true`) gives detail queries instant placeholderData from prior list fetches. Per-query overrides via `redirect: false` or `redirect: { entityType, getId }`.
- **`useCachedEntity(type, id)`** — Composable returning a `placeholderData`-compatible getter for manual cache redirect injection. Fully denormalizes nested EntityRefs before returning.
- **Playground: cache redirects demo** — 5th feature card in the interactive playground demonstrating zero-spinner list-to-detail navigation.

### Performance
- **`pauseTracking`/`resetTracking`** in customRef getter — Prevents leaked reactive dependencies from `store.get()` reads during denormalization. Without this, each entity read would create a direct component dependency on the entity's ShallowRef, causing double-firing. Uses `@vue/reactivity` internals (same pattern as Pinia core).

### Bug Fixes
- Externalize `@vue/reactivity` and `@vue/shared` in build config — prevents bundling Vue internals into the dist output.

### Docs
- npm badges (version, downloads, license) and direct npm/GitHub links in README header.

### Tests
- 123 → 131 tests (+8)

## 0.1.4 (2026-03-15)

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
