# Research Notes — pinia-colada-plugin-normalizer

## Entity Replacement & Vue Reactivity

Vue's `reactive()` patches property-by-property on whole-entity replacement. When you replace an entity object, Vue internally diffs old vs new and only triggers watchers for properties that actually changed. This means "crude" whole-entity replacement is actually surgically precise at the reactivity level.

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
| `$onAction('extend')` + `scope.run()` | delay, dataUpdatedAt example | Initialize `ext[NORM_META_KEY]` as `ShallowRef` |
| `$onAction('setEntryState')` + `after()` | dataUpdatedAt example | Normalize data post-state-set |
| Symbol ext keys | auto-refetch's `REFETCH_TIMEOUT_KEY` | `NORM_META_KEY`, `ENTITY_REF_MARKER` |
| Module augmentation | All official plugins | `UseQueryOptions`, `UseQueryEntryExtensions` |

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
- Whole-entity replacement (Vue reactivity handles the diff)
- WebSocket-first design via `useEntityStore()` composable
- Swappable persistence (in-memory → IndexedDB → SQLite)
- Leverages Vue's built-in reactivity (no custom engine needed)
- Follows Pinia Colada v1.0.0 plugin patterns exactly

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

Our approach: replace the whole entity. Vue's reactivity diffs property-by-property internally. Same surgical precision, zero configuration, zero bugs from missing merge functions.

For non-entity nested data: don't normalize it at all. Leave it in the query cache as-is.

## Wave 1 Review Findings (13 issues)

### Fixed (10 issues)
1. **Naming** → `pinia-colada-plugin-normalizer`
2. **ext ShallowRef** → `ShallowRef<NormMeta>` initialized in `scope.run()`
3. **Args mutation** → moved to `after()` callback
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
