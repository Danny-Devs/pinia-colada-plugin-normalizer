# Changelog

## 0.3.0 (unreleased)

Phase-4 Stage 1: the SQLite durability engine (ADR-003 implemented).

### Features
- **`StorageEngine` interface** — persistence is now engine-based. The coordinator (`enablePersistence`) owns change detection, debouncing, evict-vs-remove semantics, EntityRef encoding, and graceful degradation; engines only store rows. `enablePersistence(store, { engine })` — fully backward-compatible (default remains IndexedDB).
- **`sqliteEngine()`** — SQLite-WASM persisted on OPFS (`opfs-sahpool` VFS: fastest, no COOP/COEP). Bring-your-own-worker pattern (`pinia-colada-plugin-normalizer/sqlite-worker` export) so the app's bundler resolves `@sqlite.org/sqlite-wasm` (new **optional** peer dep) and its wasm asset. Graceful fallback to a transient in-memory DB when OPFS is unavailable (`engine.persistent` reports which). Rows carry an incrementing `row_version` — the ADR-005 causality hook, live from day one.
- **`idbEngine()`** — the previous IndexedDB internals, extracted and exported.
- **`memoryEngine()`** — contract reference implementation for tests/SSR, with a `snapshot()` assertion hook.
- **Playground: SQLite page** — kill-the-tab demo; verified in a real browser: write→survives reload, evict→row survives, delete→row gone (ADR-004 observed end-to-end on real OPFS).
- **CI: trusted-publishing release workflow** — pushing a `v*` tag runs gates and publishes via npm OIDC (no tokens; requires the one-time trusted-publisher registration on npmjs.com).

### Tests
- StorageEngine contract suite (runs against every engine), coordinator×engine integration (incl. ADR-004 evict-vs-remove at the engine boundary), and the SQLite SQL core exercised against **real sqlite-wasm** (`:memory:`) in Node — schema idempotency, JSON round-trip, `row_version` bookkeeping, batch-transaction atomicity. 197 tests total (was 185).

### Docs
- persistence.md: Storage Engines section (sqlite worker setup, custom-engine guide); fixed stale `store.clear()` edge-case row (0.2.0 behavior).

## 0.2.0 (2026-07-12)

Audit-driven release (see `../AUDIT-2026-07-11.md`): two HIGH bug fixes and the three architectural decisions (ADR-003/004/005) that unblock Phase 4 (local-first).

### Breaking
- **`apply()` now returns `{ commit, rollback }`** instead of a bare rollback function. Previously, successful mutations leaked live transactions: a later rollback on the same entity restored a pre-first-mutation snapshot and replayed stale optimistic data over server-confirmed fields, and `activeTransactions`/`serverTruth` grew unbounded. Call `tx.commit()` in `onSuccess` and `tx.rollback()` in `onError`.
- **`EntityEvent.type` gains `"evict"`** and `EntityStore` gains `evict(type, id)` (ADR-004). `gc()` now evicts (memory-only; persistence keeps the durable row) instead of removing (semantic delete). Subscribers that pattern-match event types must handle `"evict"`; external EntityStore implementations must add the method.
- **`clear()` now emits a `remove` event per entity** (previously silent). Persistence clears durable copies; indexes, denorm caches, and live refs update instead of rendering ghosts.
- **`EntityStore` gains `update(type, id, updater)`** — atomic read-modify-write. Custom merge recipes now run through it, closing a lost-update window between the plugin's read and write.

### Fixes
- **`remove()`/`clear()` no longer orphan handed-out refs** — refs are set to `undefined` before map deletion, so `useEntityRef` and other watchers see deletions and track re-adds (previously they rendered the deleted entity forever).
- **`gc()` sweeps never-populated phantom refs** (created by `get()` misses) that no refcount tracks — previously immortal, one permanent map entry per visited-but-missing ID. Live watchers are re-triggered and re-establish tracking.
- **Persistence: writes made before the DB finishes opening are flushed once it opens** (previously stranded until the next store event or tab-hide).
- **Dev warning when an entity definition has neither `idField` nor `getId`** — such definitions only match via `__typename`; the docs previously claimed a `@default 'id'` that was never applied (docs corrected).

### Architecture (Phase-4 groundwork)
- **ADR-003:** SQLite-WASM/OPFS is a write-behind durability substrate under the in-memory read projection — not a store swap. Engine choice: official `@sqlite.org/sqlite-wasm` + `opfs-sahpool`.
- **ADR-004:** evict (memory-only) vs remove (semantic delete) split — local GC can never become fleet-wide data deletion under sync.
- **ADR-005:** `EntityEvent.version?` metadata slot reserved; pagination containers are device-local (never replicated); sync posture is server-authoritative (PowerSync / Turso-sync candidates) — **cr-sqlite plan retired** (project dead since 2024).

### Compatibility
- **@pinia/colada 1.3.1** — verified 2026-07-11: full suite, typecheck, build, and playground boot all green against 1.3.1 (dev dep and playground bumped from 1.1.0). Upstream 1.1→1.3 has no breaking changes — plugin API (`extend` hook, `entry.state` customRef, Symbol ext keys) untouched.

### Chore
- Drop unused `RelayConnection` type import in `pagination.spec.ts` (oxlint warning).

## 0.1.8 (2026-04-12)

### Features
- **`relayPagination()`** — Merge recipe for GraphQL Relay Connection Spec. Handles `edges` merge, cursor dedup, and `pageInfo` stitching (forward + backward). Exported types: `RelayPaginationOptions`, `RelayPageInfo`, `RelayEdge`, `RelayConnection`.
- **DevTools: cache redirect source** — Three-tier color-coded tags distinguish `autoRedirect` (green), per-query `redirect` (blue), and user-provided `placeholderData` (amber). `NormMeta.redirectSource` tracks provenance.

### Fixes
- **Dedup Map→Set** — All three pagination helpers (`cursorPagination`, `offsetPagination`, `relayPagination`) now use `Set` instead of `Map` for deduplication. The stored index values were unused and would have been stale after `splice` — a latent bug.
- **`RelayEdge.cursor` accepts `string | null`** — Matches the GraphQL Connection Spec (some APIs return `null` cursors on boundary edges).

### Compatibility
- **Pinia 3** — 171 tests pass on both Pinia 2.3.1 and 3.0.4. Peer dep tightened to `^2.2.6 || ^3.0.0`.

### Docs
- Pagination helpers section added to API reference (was missing all 3 helpers + types).
- Fixed stale Pinia peer dep in getting-started (`>= 2.1.0` → `^2.2.6 || ^3.0.0`).
- Fixed architecture page referencing Dexie (persistence uses raw IndexedDB).
- README: pagination section added, test count updated (157→171), LOC updated (~2,400→~4,000).

### Tests
- 157 → 171 tests. 14 new tests for relay pagination (11 unit + 1 integration) and edge cases (full page refresh, duplicate cursors within page, null cursors).

## 0.1.7 (2026-03-16)

No user-facing changes. Playground simplification only:

- Removed IDB persistence setup from the playground demo landing page (moved to a dedicated persistence demo) to reduce Vercel build complexity.
- Docs site configuration tweaks.

Plugin source is byte-identical to 0.1.6. Safe to skip this release if you are on 0.1.6.

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
