# pinia-colada-plugin-normalizer — TODO

## NEXT ACTION
- [ ] Write integration tests (actual Pinia Colada plugin + useQuery round-trip)
- [ ] Denormalize caching / structural sharing (avoid new objects every read)
- [x] **Fix denorm cache invalidation** — per-entity dependency tracking via denormCache keys, only invalidates affected queries
- [x] **Equality check before merge** — `set()`/`setMany()` skip merge when incoming fields are identical, preserving referential identity
- [x] **Reference identity short-circuit** — customRef setter skips normalization when `incoming === rawState`
- [ ] Post update in Discussion #531 with working customRef approach
- [ ] Remove dead `fromQueries` and `merge` fields from EntityDefinition (or implement them)

## Phase 1: Core MVP
- [x] Entity store (in-memory, reactive Map, ShallowRef per entity, batch writes)
- [x] Normalize on write (customRef setter, Symbol-based EntityRef)
- [x] Denormalize on read (customRef getter — transparent to consumers)
- [x] Recursive denormalization with circular ref protection
- [x] `defineEntity()` config for non-standard APIs
- [x] `useEntityStore()` composable for direct access (SSR-safe via defineStore)
- [x] Opt-in per query via `normalize` option (module augmentation)
- [x] Hybrid storage (entities normalized, hierarchies left as-is)
- [x] Circular reference protection (WeakSet visited tracker)
- [x] Symbol-based EntityRef marker (no API data collision)
- [x] Symbol-based ext key (following auto-refetch pattern)
- [x] Module augmentation (UseQueryOptions, UseQueryOptionsGlobal, UseQueryEntryExtensions)
- [x] scope.run() for reactive extensions
- [x] customRef replacement of entry.state (following delay plugin pattern)
- [x] SSR-safe entity store via defineStore (scoped per Pinia instance)
- [x] Cache-persister compatibility (customRef getter returns denormalized data)
- [x] has() correctness fix (accounts for placeholder refs from get())
- [x] Export normalize/denormalize from public API
- [x] Shallow merge on entity set (preserves enriched fields from richer queries)
- [x] Playground demo with normalization ON/OFF toggle, dark mode, data inspector
- [ ] Integration tests (Pinia Colada plugin + useQuery → fetch → normalize → read round-trip)
- [ ] Denormalize caching / structural sharing
- [ ] Post update in Discussion #531

## Phase 1.5: Competitive Parity (from competitor analysis, March 2026)
- [x] **Entity GC** — `retain()`/`release()`/`gc()` reference counting. Query-extracted entities are tracked; direct writes (WebSocket) are immune. Plugin auto-retains on normalize, auto-releases on entry removal.
- [x] **Per-type custom merge policies** — optional `merge` function on `EntityDefinition`. Applied during normalization. Default shallow merge unchanged. Enables pagination (array append), counters, deep nested objects.
- [x] **Array operations** — `updateQueryData(key, updater)` for explicit list modifications. `removeEntityFromAllQueries(type, id)` for automatic removal from all queries + entity store. Works through customRef pipeline.
- [x] **Document mutation-driven updates** — added zero-refetch pattern to SPEC.md and README.md. `entityStore.set()` in `onSuccess` → all queries update via reactivity.

## Phase 2: Real-Time
- [x] WebSocket adapter hooks — `onEntityAdded`, `onEntityUpdated`, `onEntityRemoved` composables
- [x] **Optimistic updates** — `useOptimisticUpdate` with transaction-based "clear and replay" rollback (inspired by TanStack DB). Supports concurrent transactions on same entity with independent rollback. `apply()` for simple single-mutation, `transaction()` for multi-mutation batches.
- [x] **Coalescing** — `createCoalescer` utility. Batches WS notifications with configurable delay, flushes as single batch for REST refetch.
- [ ] Review Danny's Gallatin three-way sync code for reference (BLOCKED — on work laptop)

## Phase 3: Performance & DX
- [x] **Entity queries** — `useEntityQuery(type, filterFn)` composable for filtered reactive entity views
- [x] **Manual index support** — `createEntityIndex(type, field)` for O(1) lookups by field value. Auto-updates on entity changes. `dispose()` for cleanup.
- [ ] Devtools integration — entity store visible via Pinia devtools since we use `defineStore`. Full custom panel deferred to Phase 5.
- [ ] TypeScript type inference for entity schemas — generic `defineEntity<T>()` deferred to Phase 5.

## Phase 4: Persistence & Scale
- [ ] Swappable persistence backends via EntityStore interface
- [ ] IndexedDB + Dexie adapter
- [ ] SQLite + WASM + OPFS adapter
- [ ] SSR hydration/dehydration (entity store toJSON/hydrate already implemented)

## BLOCKED
- [ ] Three-way sync code → Danny needs to grab from work laptop

## DONE
- [x] Research: normalization approaches (normalizr, normy, Apollo, TanStack DB)
- [x] Research: Pinia Colada v1.0.0 internals (query cache, plugin system, ext field, all official plugins)
- [x] Research: plugin writing guide (writing-plugins.md patterns, community plugins page)
- [x] Research: persistence backends (IndexedDB, SQLite WASM, OPFS, cr-sqlite)
- [x] Architecture design with expert council review
- [x] Eduardo endorsement via Discussion #531
- [x] Fork pinia-colada to Danny's GitHub (https://github.com/Danny-Devs/pinia-colada)
- [x] EntityStore TypeScript interface (swappable contract)
- [x] In-memory EntityStore implementation (Level 1 backend)
- [x] Plugin implementation (customRef replacement pattern)
- [x] defineEntity API
- [x] Wave 1 review (13 issues found)
- [x] Wave 2 fixes (10/13 issues fixed, 2 deferred, 1 documented)
- [x] Wave 3 coherence pass (all docs updated to reflect v1.0.0 patterns)
- [x] Adversarial review — found 3 critical bugs (broken read path, action bypass, SSR singleton)
- [x] Architecture fix: customRef replacement (normalize on set, denormalize on get)
- [x] Architecture fix: SSR-safe entity store via defineStore
- [x] Architecture fix: recursive denormalization with circular ref protection
- [x] Bug fix: has() returns false for placeholder refs from get()
- [x] SPEC.md, RESEARCH.md, TODO.md, AGENTS.md — fully consistent
- [x] Shallow merge on entity set (preserves enriched fields)
- [x] Playground demo: normalization ON/OFF toggle, dark/light mode, data inspector
- [x] Playground: honest two-mode demo (separate query sets, mutable mock server)
- [x] Playground: projected references in inspector (→ contact:1 { name, role, status })
- [x] Squashed commit history (39 → 8 clean commits)
