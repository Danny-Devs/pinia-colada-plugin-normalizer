# Research Notes — pinia-colada-plugin-normalizer

## Entity Replacement & Vue Reactivity

The entity store uses shallow merge (`{ ...existing, ...incoming }`) when updating entities. This preserves fields from richer queries — a detail fetch that adds email won't be overwritten when a lighter list query refetches. Vue's reactivity diffs property-by-property internally, so only watchers for changed properties re-trigger.

### Scale thresholds for entity replacement + computed derivations

| Scale | Entity Replacement | Computed Derivations (filter/sort) |
|-------|-------------------|-----------------------------------|
| < 1K entities | Instant | Instant |
| 1K - 10K | Instant | Fine, maybe 1-5ms on re-eval |
| 10K - 100K | Instant | Noticeable (16ms+, potential frame drops) |
| 100K+ | Still fine | Needs IVM or SQLite query planner |

**Key insight:** Entity replacement scales forever. It's the derived views that need optimization at scale.

### Extending computed before IVM

1. **Index maps**: `Map<status, Set<entityId>>` maintained on writes → O(k) reads
2. **Sorted indexes**: Pre-sorted arrays maintained on insert
3. **Compound indexes**: `Map<status, SortedArray>` for filtered+sorted

These data structures push computed scalability to tens of thousands before IVM is needed.

## Pinia Colada v1.0.0 Internals

### Query cache entry structure

Each entry in the `_pc_query` Pinia store contains:

- `state: ShallowRef<DataState>` — `{ data, error, status: 'pending'|'success'|'error' }`
- `asyncStatus: ShallowRef<'idle' | 'loading'>` — separate from state.status
- `when: number` — last update timestamp
- `stale: boolean` (computed) — is data older than staleTime?
- `active: boolean` (computed) — any components using this?
- `deps: Set` — component/scope consumers
- `pending: { abortController, refreshCall } | null`
- `gcTimeout` — scheduled garbage collection timer
- `ext` — **plugin extension data (our hook point)**

### Features Pinia Colada adds over raw Pinia

1. **Stale-While-Revalidate** — staleTime (default 5s), show stale data + background refetch
2. **Garbage Collection** — gcTime (default 5min), auto-evict when no consumers
3. **Request Deduplication** — multiple components share one fetch
4. **Smart Refetch** — on mount, window focus, reconnect (configurable)
5. **Wildcard Invalidation** — invalidate by key prefix
6. **Dependency Tracking** — only active queries auto-refetch
7. **Plugin `ext` field** — per-entry extension data for plugins

### Plugin system (v1.0.0)

**Guide**: `docs/plugins/writing-plugins.md` — the authoritative reference for all plugin patterns.

**Plugin lifecycle for queries**:
1. `useQuery()` calls `queryCache.ensure(options)` → creates entry
2. First ensure triggers `extend(entry)` **once** — plugins attach `ext` here
3. `queryCache.fetch(entry)` executes the query function
4. `queryCache.setEntryState(entry, state)` is the state-update choke point
5. `queryCache.remove(entry)` removes entry (manual or GC)

**Critical rules from the guide**:
- ALL `ext` keys must be defined in `extend` (cannot add new keys later)
- Reactive extensions must be created inside `scope.run()`
- Use `after()` for post-action work (not pre-action args mutation)
- Module augmentation required for type-safe options and extensions
- Plugins run in installation order

### Official plugins (v1.0.0)

| Plugin | Purpose | Key patterns |
|--------|---------|-------------|
| `@pinia/colada-plugin-delay` | Delays `asyncStatus` to prevent spinner flash | `customRef` replacement, `scope.run()`, mutation support |
| `@pinia/colada-plugin-retry` | Auto-retry with backoff | `after()` + `onError()`, retry counting |
| `@pinia/colada-plugin-auto-refetch` | Auto-refresh on stale | **Symbol ext keys**, `setTimeout` management |
| `@pinia/colada-plugin-cache-persister` | Persist query cache to storage | `PiniaColadaStorage` interface, hydration, debounce |
| `@pinia/colada-plugin-debug` | Debug logging | Action observation |
| `@pinia/colada-plugin-tanstack-compat` | TanStack Query API compat | Migration helpers |
| `pinia-colada-plugin-recently-successful` | `recentlySuccessful` ref for mutations | Community plugin example |

**Community plugins page**: `docs/plugins/community.md` — where our plugin will be listed.

### Plugin integration patterns we use

| Pattern | Source | Our usage |
|---------|--------|-----------|
| Factory function | All official plugins | `PiniaColadaNormalizer(options)` |
| `$onAction('extend')` + `scope.run()` | delay, dataUpdatedAt example | Initialize `ext[NORM_META_KEY]` as `ShallowRef`, replace `entry.state` with `customRef` |
| `customRef` replacement of entry property | delay plugin (`entry.asyncStatus`) | Replace `entry.state` with customRef that normalizes on set, denormalizes on get |
| `defineStore` for plugin state | query cache (`_pc_query`), mutation cache | `_pc_normalizer` store scopes entity store per Pinia instance (SSR-safe) |
| Symbol ext keys | auto-refetch's `REFETCH_TIMEOUT_KEY` | `NORM_META_KEY`, `ENTITY_REF_MARKER` |
| Module augmentation | All official plugins | `UseQueryOptions`, `UseQueryEntryExtensions` |

### Key architectural insight (verified from internals)

**Why customRef works for `entry.state`:**
- `entry.state` is a `ShallowRef` on a `markRaw` plain object (query-store.ts:303-306) — replaceable
- `setEntryState` is the ONLY write site: `entry.state.value = state` (query-store.ts:783) — hits custom setter
- `useQuery` reads via `entry.value.state.value` (use-query.ts:199) — hits custom getter
- The entry object is not frozen/sealed — property reassignment works
- Eduardo confirmed this approach in Discussion #531: "I think so, yes. It should work out nicely because `state` is the source of truth"

## Pinia Colada vs TanStack Query

| Feature | TanStack Query | Pinia Colada |
|---------|---------------|--------------|
| Stale-while-revalidate | ✅ | ✅ |
| Garbage collection | ✅ | ✅ |
| Request dedup | ✅ | ✅ |
| Window focus refetch | ✅ | ✅ |
| Mutations | ✅ | ✅ |
| SSR/hydration | ✅ | ✅ |
| Infinite queries | ✅ Built-in | ✅ (v1.0.0) |
| Plugin system | ❌ Limited | ✅ First-class |
| Framework | Multi-framework | Vue only |
| Bundle | ~13kb | ~2kb |
| Pinia integration | ❌ | ✅ Native |

**Strategic advantage**: Pinia Colada's plugin system (`extend` + `ext` + `$onAction`) makes our normalization plugin possible in a way that TanStack Query can't match.

## Normalization Approaches Compared

### normalizr (archived)
- Schema-based, manual normalize/denormalize calls
- Pure utility — no cache/framework awareness
- Archived March 2022, no maintenance
- Danny used this in production at Gallatin

### normy (active)
- Convention-based (`id` field = entity)
- Automatic normalization (opt-out model)
- Integrations: react-query, vue-query, swr, rtk-query
- No WebSocket-first design
- No offline persistence

### Apollo InMemoryCache
- GraphQL-only, requires schema
- Deep merging with Type Policies (per-field merge functions)
- Complex, fragile — hundreds of GitHub issues about merge behavior
- Forces all-or-nothing normalization

### TanStack DB
- Full client-side database with custom reactivity engine
- IVM (db-ivm) + query planner
- React only (React lacks fine-grained reactivity, so they built their own)
- ~25K LOC combined with TanStack Query
- Overkill for most apps

### Our approach (pinia-colada-plugin-normalizer)
- Opt-in normalization (per-query or global) + `defineEntity` escape hatch
- Hybrid: normalize entities, leave hierarchies as-is
- Shallow merge (preserves enriched fields, Vue reactivity handles the diff)
- WebSocket-first design via `useEntityStore()` composable
- Swappable persistence (in-memory → IndexedDB → SQLite)
- Leverages Vue's built-in reactivity (no custom engine needed)
- Follows Pinia Colada v1.0.0 plugin patterns exactly

## Deep Competitor Architecture Analysis (March 2026)

Code-level comparison against source. ~1,100 LOC (ours) vs competitors.

### Architecture Comparison Table

| Dimension | **Ours** | **normy** | **TanStack DB** | **Apollo InMemoryCache** |
|---|---|---|---|---|
| **Storage** | `Map<string, Map<string, ShallowRef>>` (type → id → ref) | Flat `objects` dict keyed by `@@key` strings | `SortedMap` + optimistic `Map` overlay | Plain `{ [dataId]: StoreObject }` with Layer chain |
| **Identity** | `${type}:${id}`, auto from `__typename` or `defineEntity()` | User-provided `getNormalizationObjectKey()` | Explicit per-collection key field | `__typename` + `keyFields` via `typePolicies` |
| **Updates** | Shallow merge (`set`) or full overwrite (`replace`), batch via `setMany` | Deep merge on every normalize, no replace option | `partial` (Object.assign) or `full` per collection | `DeepMerger` + field-level `modify()` + `DELETE`/`INVALIDATE` modifiers |
| **Reactivity** | Vue `shallowRef` per entity + `computed` | **None** — framework-agnostic, adapter calls `setQueryData` | Custom event emitter + subscriptions | `optimism` dependency tracking, per-field dirty flags |
| **Read Path** | Denormalize on read (customRef getter), structural sharing | Denormalize on demand, recursive walk, no caching | Direct reads from 3-layer overlay (no normalization) | Memoized `executeSelectionSet`, cached via `optimism` |
| **Bundle** | ~1,100 LOC, 0 runtime deps | ~600 LOC, 0 deps | ~2,000+ LOC | ~1,400+ LOC core, 3 deps (`@wry/*`, `optimism`) |
| **GC** | None (entities outlive queries) | `removeQuery()` cleans deps | `cleanup()` per collection | Full reachability GC, `retain()`/`release()`, `evict()` |

### normy Deep Dive

**Storage**: Flat `objects` dictionary keyed by `@@{objectKey}` strings. Queries stored separately with normalized data, dependency lists, and `usedKeys` maps. Plain JS objects — no reactivity.

**Identity**: Entirely via user-provided `getNormalizationObjectKey()` callback. No auto-detection, no `__typename` convention. Simpler but less ergonomic than our approach.

**Updates**: Every `setQuery()` re-normalizes the entire query data and deep-merges into the objects store. `getQueriesToUpdate()` normalizes mutation data, diffs against stored objects, finds dependent queries, denormalizes them, returns updated data. The library doesn't write to any cache — it returns data and expects the adapter to call `setQueryData()`.

**What they have that we don't**:
- **Mutation-driven query updates** — `getQueriesToUpdate()` auto-finds and updates all queries affected by a mutation response. We have `invalidateEntity()` but it refetches rather than updating in-place.
- **Array operations** — `applyArrayOperations()` handles insertions/removals on mutation (e.g., "add this item to the list query"). We have nothing for this.
- **`usedKeys` tracking** — tracks which fields each query uses, preventing field bleed between queries.
- **`structuralSharing` short-circuit** — skips re-normalization if `data === previousData` (same reference).
- **`getQueryFragment` / `getObjectById`** — read individual entities from the normalized store without a query context.

**Our advantages over normy**:
- Built-in Vue reactivity (their adapter has to manually pipe changes through `setQueryData`)
- Structural sharing on denormalize (same entity ref = same output = no re-render)
- Entity event subscriptions (`subscribe()`)
- Batch writes (`setMany()`)
- Swappable storage backend (EntityStore interface)
- SSR safety (per-Pinia scoping vs. singleton state)
- Symbol-based refs (their `@@` prefix is a fragile string convention)

### TanStack DB Deep Dive

**Storage**: `SortedMap<TKey, TOutput>` for synced data + `Map` for optimistic upserts + `Set` for optimistic deletes. Three-layer overlay: synced base → optimistic deletes filter → optimistic upserts overlay. Reads check all three.

**Not a normalizer** — TanStack DB is a client-side reactive database. Each "collection" is independent. Cross-collection relationships are handled via joins at the IVM (Incremental View Maintenance) query layer, not via normalization.

**What they have that we don't**:
- **Optimistic mutation transactions** — first-class `Transaction` objects with states (pending → persisting → completed/failed), automatic rollback, per-mutation replay.
- **IVM dataflow graph** — dedicated `db-ivm` package with operators (filter, join, map, reduce, groupBy, orderBy, topK). Incremental updates flow through without re-querying.
- **Indexes** — auto, B-tree, lazy, reverse. We have none.
- **Sync protocol** — built-in sync with server, including truncate/rebuild, change cursors, conflict resolution.
- **Schema validation** — Standard Schema V1 integration.

**Our advantages over TanStack DB**:
- Automatic normalization from arbitrary nested API responses (they require explicit collection modeling)
- Cross-entity deduplication (same entity from two queries shares one store entry)
- Zero config for standard APIs (`__typename` + `id` auto-detection)
- Transparent integration (customRef is invisible to app code; TanStack DB requires rearchitecting your data layer)

### Apollo InMemoryCache Deep Dive

**Storage**: Flat `NormalizedCacheObject` (plain object `{ [dataId]: StoreObject }`). References use `{ __ref: "TypeName:id" }`. Layered architecture: `Root` → `Stump` → `Layer` for optimistic updates. Each layer overrides fields from below.

**Identity**: `__typename` + `keyFields` via `typePolicies`. Highly configurable with custom `keyFields` functions. Gold standard for GraphQL identity.

**Updates**: `DeepMerger` with `storeObjectReconciler` that preserves referential identity when values are deeply equal. `modify()` enables surgical field-level patches with `DELETE`, `INVALIDATE`, `readField`, `toReference` helpers.

**What they have that we don't**:
- **Per-field dependency tracking** — via `optimism`, changing `user.name` only invalidates queries that read `user.name`, not queries reading `user.email`. Our denorm cache clears entirely on any entity change.
- **Optimistic layers** — `Layer` chain allows stacking optimistic updates with clean rollback.
- **Garbage collection** — full reachability-based GC with `retain()`/`release()` reference counting.
- **Per-type-per-field merge functions** — `typePolicies` can define merge per type per field. Critical for pagination (appending arrays), nested objects, custom logic.
- **`modify()` / `evict()`** — surgical cache manipulation and removal.
- **Deep equality preservation** — `storeObjectReconciler` keeps existing references when deeply equal, preventing re-renders without explicit structural sharing.

**Our advantages over Apollo**:
- Framework-native reactivity (Vue shallowRef/computed vs. custom `optimism` system)
- REST/non-GraphQL support (any JSON API)
- Simplicity (~1,100 LOC vs. ~5,000+ for full Apollo cache)
- Swappable storage backend (clean EntityStore interface)
- Transparent integration (no query language, no selection sets, no schema definitions)

### Techniques Worth Adopting

1. **From Apollo: Equality check before merge** — Their reconciler checks `equal(existing, incoming)` and returns `existing` if equal, preserving referential identity. Our `{...existing, ...data}` always creates a new object. Cheap fix: compare before spreading.

2. **From Apollo: Per-entity dependency tracking on denorm** — Track which entity keys each query's denorm cache reads (a `Set<string>` per query). Only clear caches for queries that reference the changed entity. Single biggest perf win available (~50 LOC change).

3. **From normy: Reference identity short-circuit** — Skip normalization if `data === previousData`. Trivial fast path in our customRef setter.

4. **From TanStack DB: Optimistic overlay pattern** — Three-layer read (synced → deletes → optimistic) is cleaner than Apollo's Layer chain. Adaptable for our entity store as a composable layer.

5. **From Apollo: `retain()`/`release()` for GC** — Simple reference counting. When a query entry is created, retain its entity keys. When removed, release. GC collects entities with zero retainers.

### Anti-Patterns to Avoid

1. **Apollo's complexity spiral** — 5,000+ LOC, 3 runtime deps, Layer/Stump/Root hierarchy. Our simplicity is a feature. Don't chase their feature set at the cost of bundle size.
2. **Normy's `@@` string prefix** — Fragile magic string convention. Our Symbol-based `ENTITY_REF_MARKER` is strictly superior.
3. **Normy's full re-normalization on every setQuery** — O(n) in response size for every query update. Our normalize-in-setter / denormalize-in-getter amortizes this.
4. **TanStack DB's monolithic state manager** — 600+ LOC with entangled sync/optimistic/transaction logic. If we add optimistic updates, keep them as a separate composable layer.
5. **Apollo's GraphQL coupling** — Write path inseparable from selection sets and fragment resolution. Our framework-agnostic normalization is more reusable.

## Browser Persistence Landscape

### IndexedDB + Dexie
- Key-value with basic indexes, no joins
- Async-only, universal browser support
- Dexie provides nice API wrapper (~30kb)

### SQLite + WASM + OPFS
- Full SQL query planner, indexes, joins, ACID transactions
- 10-100x faster than IndexedDB for complex queries
- Synchronous access via OPFS in workers
- Heavier bundle (~300-800kb)
- Browser support: Chrome 102+, Firefox 111+, Safari 15.2+

### Key libraries
- **@sqlite.org/sqlite-wasm** — official SQLite WASM build
- **wa-sqlite** — alternative with good OPFS support
- **cr-sqlite** — SQLite + CRDTs for conflict-free multi-device sync
- **electric-sql** — Postgres ↔ SQLite sync engine

### SQLite strategic advantage
SQLite gives us Level 3 (query planner) for free. SQLite triggers can implement IVM. By the time we need this scale, OPFS browser support will be universal.

## Deep Merging: Why We Avoid It

Apollo's approach (per-field merge functions via Type Policies) is fragile because:
- Default behavior without merge functions silently replaces (drops data)
- Every nested array needs a custom merge function
- Users forget to add merge functions for new fields → subtle data loss
- Config surface grows with every entity type

Our approach: shallow merge (`{ ...existing, ...incoming }`). Incoming data overwrites matching fields, but existing fields not present in the incoming data are preserved. Vue's reactivity diffs property-by-property internally. Zero configuration, zero bugs from missing merge functions, and richer queries don't get overwritten by lighter ones.

For non-entity nested data: don't normalize it at all. Leave it in the query cache as-is.

## Wave 1 Review Findings (13 issues)

### Fixed (10 issues)
1. **Naming** → `pinia-colada-plugin-normalizer`
2. **ext ShallowRef** → `ShallowRef<NormMeta>` initialized in `scope.run()`
3. **Args mutation** → eliminated entirely (customRef setter handles normalization)
4. **scope.run()** → wraps all reactive ref creation in extend
5. **Module augmentation** → `UseQueryOptions`, `UseQueryOptionsGlobal`, `UseQueryEntryExtensions`
7. **Entity false positives** → removed generic `'entity'` fallback, require `__typename` or `defineEntity()`
9. **useEntityStore()** → composable for direct entity store access
10. **Per-query opt-in** → `normalize?: boolean` on `UseQueryOptions`
11. **ID collision** → eliminated by removing generic 'entity' type
12. **Circular refs** → `WeakSet<object>` visited tracker
13. **Marker collision** → `Symbol('pinia-colada-entity-ref')`

### Deferred (2 issues)
6. **Cache-persister interaction** → Phase 4 (entity store persistence)
8. **Denormalize structural sharing** → Phase 1 completion (requires customRef read interception)

## Danny's Production Experience (Gallatin)

- Built normalization pattern with Palantir Foundry Ontology + WebSocket
- Replaced TanStack Query with Pinia + normalizr
- WebSocket subscriptions push Ontology edits (added/updated/removed)
- Three-layer sync for concurrent optimistic + push reconciliation
- Some WS events don't carry full data → coalesce + REST refetch via BFF
- Deeply nested data from REST APIs stored hierarchically (not normalized)
- Pain points with TanStack Query: incorrect cache invalidation (too broad or wrong blobs)

**Code to review**: Danny's three-way sync glue code (on work laptop, will grab later)
