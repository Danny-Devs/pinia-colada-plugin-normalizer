# pinia-colada-plugin-normalizer

> Normalized entity caching plugin for Pinia Colada — endorsed by Eduardo (posva) for official docs listing.
> Name follows Eduardo's convention: `pinia-colada-plugin-` prefix (see `writing-plugins.md`).

## Origin

- **Discussion**: https://github.com/posva/pinia-colada/discussions/531
- **Eduardo's response** (2026-03-10): "This sounds amazing! ... I will gladly welcome a community plugin that I can add to docs"
- **Danny's production experience**: Built this pattern at Gallatin (Palantir Foundry Ontology + WebSocket push + normalization), replacing TanStack Query with Pinia + normalizr
- **Pinia Colada v1.0.0** — Plugin launched at v1.0.0 maturity, with official plugin guide and community plugins page ready for submissions

## Problem Statement

Pinia Colada's cache is document-based: each query key maps to one data blob. When the same entity appears in multiple queries, it lives as independent copies that can diverge. Updating one requires remembering to invalidate all others — miss one and you have a stale data bug.

For WebSocket-heavy apps where the server pushes entity updates, you want a single write to propagate everywhere — no invalidation, no refetch.

## Solution

A normalization plugin that:

1. **On write:** Intercepts query responses via `$onAction('setEntryState')` + `after()` callback, extracts entities (things with IDs), stores them in a shared entity store, replaces them with Symbol-marked references in the query cache
2. **On read:** Denormalizes references back into full objects. Vue's reactive dependency tracking propagates changes automatically
3. **WebSocket integration:** `useEntityStore()` composable provides direct entity store access. Events write directly to the entity store. All views update. No invalidation needed.

## Architecture

```
                    ┌──────────────────────────────────┐
                    │      Pinia Colada Cache           │
                    │   (stale tracking, GC, dedup)     │
                    │                                   │
                    │  entry.state.data = {             │
                    │    [Symbol]: true,                 │  ← EntityRef (Symbol marker)
                    │    entityType: 'contact',          │
                    │    id: '42',                       │
                    │    metadata: { page: 1 }           │  ← non-entity data stays here
                    │  }                                │
                    │  entry.ext[NORM_META_KEY] =        │
                    │    ShallowRef<NormMeta>            │  ← plugin metadata via ext
                    └──────────────┬────────────────────┘
                                   │ references
                    ┌──────────────▼────────────────────┐
                    │        EntityStore                 │
                    │   (flat, keyed by type+id)         │
                    │                                   │
                    │  'contact:42' → ShallowRef({      │
                    │    id: 42, name: 'Alice' })        │  ← ONE copy, reactive
                    └──────────────▲────────────────────┘
                                   │ direct write via useEntityStore()
                    ┌──────────────┴────────────────────┐
                    │     WebSocket / SSE / any push     │
                    └───────────────────────────────────┘
```

### Swappable Persistence Backends

The EntityStore defines an interface contract. Implementation is swappable:

```
              EntityStore Interface
              get / set / query / subscribe / toJSON / hydrate
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   ┌────────────┐ ┌────────────┐ ┌────────────┐
   │  In-Memory │ │ IndexedDB  │ │  SQLite    │
   │  (reactive │ │ + Dexie    │ │  + WASM    │
   │   Map)     │ │            │ │  + OPFS    │
   │            │ │            │ │            │
   │  Default.  │ │  Quick     │ │  Full SQL  │
   │  No persist│ │  offline.  │ │  query     │
   │  Level 1.  │ │  Level 1-2 │ │  planner.  │
   └────────────┘ └────────────┘ └────────────┘
```

## Design Decisions

### Opt-in normalization (not auto-detect)

Normalization is **opt-in per query** via `normalize: true` option, or globally via `autoNormalize: true`. This prevents false positives where non-entity objects with `id` fields (pagination cursors, config objects) would be incorrectly normalized.

- **`defineEntity()` escape hatch**: For non-standard ID fields, custom type names, merge strategies
- **Hybrid storage**: Only configured entity types are extracted. Everything else stays in the query cache as-is.
- **`__typename` auto-detection**: Objects with `__typename` + `id` are auto-detected (GraphQL convention)

```typescript
import { PiniaColada } from '@pinia/colada'
import { PiniaColadaNormalizer, defineEntity } from 'pinia-colada-plugin-normalizer'

app.use(PiniaColada, {
  plugins: [
    PiniaColadaNormalizer({
      entities: {
        contact: defineEntity({ idField: 'contactId' }),
        order: defineEntity({ idField: 'orderId' }),
      }
    })
  ]
})

// Per-query opt-in:
const { data } = useQuery({
  key: ['contacts'],
  query: () => fetchContacts(),
  normalize: true,  // opt-in for this query
})
```

### Why not pure normalizr-style schemas?

Too much boilerplate. Most APIs use `id`. Users shouldn't have to define their entire data shape upfront.

### Why not pure normy-style convention?

Breaks on real-world APIs with non-standard ID fields (`contactId`, `_id`, `uuid`), composite keys, or shared auto-increment IDs across types. Also, auto-normalizing everything causes false positives with non-entity objects.

### Whole-entity replacement over deep merging

- Apollo requires field-level merge functions (complex, fragile, error-prone)
- We replace the whole entity. Vue's `reactive()` diffs property-by-property internally and only triggers watchers for properties that actually changed
- This gives us the simplicity of replacement with the performance of surgical updates
- No GraphQL schema required

### Pinia Colada integration surface (minimal)

Following Eduardo's `writing-plugins.md` guide exactly:

1. **`$onAction('extend')`** — initialize `ext[NORM_META_KEY]` as `ShallowRef<NormMeta>` inside `scope.run()`
2. **`$onAction('setEntryState')` + `after()`** — normalize data after state is set, following the `dataUpdatedAt` example pattern
3. **`ext` field** — per-entry normalization metadata via Symbol key (following `auto-refetch` plugin's `REFETCH_TIMEOUT_KEY` pattern)
4. **Module augmentation** — `declare module '@pinia/colada'` extending `UseQueryOptions`, `UseQueryOptionsGlobal`, `UseQueryEntryExtensions`

### Safety measures

- **Symbol-based EntityRef marker** — prevents collision with API data (no string property conflicts)
- **Symbol-based ext key** — follows auto-refetch plugin pattern for ext storage
- **Circular reference protection** — `WeakSet<object>` visited tracker prevents infinite loops on cyclic API responses
- **No generic 'entity' fallback** — without `__typename` or explicit `defineEntity`, objects are NOT normalized (prevents ID collisions between unrelated types)

## Key Concepts (Plain English)

### Why normalization?

Without it: User 42 appears in 5 queries = 5 copies. Update one, the other 4 are stale. Miss an invalidation = bug.

With it: User 42 stored once. All queries hold references to that one copy. Update it once, everywhere sees the change.

### WebSocket + normalization = killer combo

Without: WS event arrives → figure out which query blobs contain that entity → invalidate each → miss one = bug.

With: WS event arrives → `useEntityStore().set('contact', '42', newData)` → done. Every view updates automatically.

### Computed scaling before IVM

Vue's `computed` handles moderate scale (< 10K entities) with no issues. We can extend this with:

1. **Index maps** — `Map<status, Set<entityId>>` maintained on writes → reads are O(k) not O(n)
2. **Sorted indexes** — pre-sorted arrays maintained on insert
3. **Compound indexes** — `Map<status, SortedArray>` for filtered+sorted views

These data structures extend computed scalability to tens of thousands before IVM is needed.

### IVM vs Query Planner vs Indexes

- **Indexes**: Pre-organized data for fast lookup (maintained on write, fast on read)
- **IVM**: When source data changes, update derived views incrementally (don't re-sort 10K items, just move the one that changed)
- **Query Planner**: Given a declarative query, automatically decides which indexes to use (SQLite gives us this for free)

They're independent but composable. Each layer adds capability.

### The three-layer sync (optimistic updates)

```
Layer 1: Server truth    — confirmed state from REST or WS confirmation
Layer 2: Optimistic      — local mutations not yet confirmed
Layer 3: Displayed       — projection of Layer 1 + Layer 2

Rules:
- WS confirms pending optimistic → drop optimistic, accept server truth
- WS arrives, no pending optimistic → update server truth directly
- Optimistic times out or rejected → drop optimistic, revert to server truth
- Conflict → server wins (last-write-wins)
```

### Transport agnostic

The plugin doesn't care where data comes from:
- REST, GraphQL, JSON-RPC, gRPC-Web, tRPC → through Pinia Colada queries → normalized on write
- WebSocket, SSE, WebRTC → direct writes to entity store via `useEntityStore()`
- IndexedDB, SQLite → persistence backends

## Comparisons

### vs normy (@normy/vue-query)

| | normy | pinia-colada-plugin-normalizer |
|---|---|---|
| Normalization | Convention only (`id` field) | Convention + `defineEntity` escape hatch |
| Control | Auto-normalize everything | Opt-in per query or globally |
| Storage | Inside query cache | Separate entity store (swappable backend) |
| WebSocket | Not designed for push | First-class via `useEntityStore()` |
| Offline | No | Roadmap (IndexedDB / SQLite) |
| Pinia Colada | Not integrated | Native plugin following v1.0.0 patterns |

### vs Apollo normalized cache

| | Apollo | pinia-colada-plugin-normalizer |
|---|---|---|
| Schema | Requires GraphQL schema | Convention-based, no schema needed |
| Merge strategy | Per-field merge functions (complex) | Whole-entity replacement (Vue handles diff) |
| Flexibility | All-or-nothing normalization | Hybrid: normalize entities, leave hierarchies |
| Transport | GraphQL only | Any (REST, GraphQL, RPC, WebSocket, SSE) |
| Bundle | ~30kb+ | Core ~2-5kb (estimated) |

### vs TanStack Query + TanStack DB

| | TanStack ecosystem | Our approach |
|---|---|---|
| Reactivity | Custom-built (React lacks fine-grained) | Vue's built-in (free, battle-tested) |
| Conceptual surface | Large (query + store + reactivity engine) | Small (query + normalize + Vue computed) |
| LOC | ~25K combined | ~6K estimated (leveraging Vue) |
| Query planner | Built-in | Roadmap via SQLite WASM |

## Composability with Pinia Colada Plugins

### Known plugin interactions

| Plugin | Interaction | Status |
|--------|------------|--------|
| `@pinia/colada-plugin-delay` | No conflict — delays `asyncStatus`, we modify `state.data` | ✅ Compatible |
| `@pinia/colada-plugin-retry` | No conflict — retries `fetch`, we hook `setEntryState` | ✅ Compatible |
| `@pinia/colada-plugin-auto-refetch` | No conflict — schedules refetches, we normalize responses | ✅ Compatible |
| `@pinia/colada-plugin-cache-persister` | **Conflict** — persister serializes EntityRef markers, not real data | ⚠️ Phase 4 |

### Cache-persister strategy (Phase 4)

The cache-persister serializes `entry.state.value` which after normalization contains EntityRef markers instead of real data. Options:
1. Serialize the entity store separately (via `entityStore.toJSON()`)
2. Hook into persister's serialization to denormalize before save
3. Persist entity store via its own storage backend (IndexedDB/SQLite)

## Roadmap

### Phase 1: Core (MVP)
- [x] Entity store (in-memory, reactive Map, ShallowRef per entity)
- [x] Normalize on write (`after()` callback, Symbol-based EntityRef)
- [ ] Denormalize on read (customRef interception — transparent to consumers)
- [x] `defineEntity()` config for non-standard APIs
- [x] Opt-in per query via `normalize` option (module augmentation)
- [x] Hybrid storage (entities normalized, hierarchies left as-is)
- [x] `useEntityStore()` composable for direct access
- [x] Circular reference protection
- [ ] Tests (Vitest)
- [ ] Package scaffolding (tsdown, package.json)
- [ ] Proof-of-concept demo
- [ ] Post update in Discussion #531

### Phase 2: Real-Time
- WebSocket adapter hooks (`onEntityAdded`, `onEntityUpdated`, `onEntityRemoved`)
- Direct entity store writes from push events
- Optimistic update primitives (three-layer sync)
- Coalescing support (WS notification → batch REST refetch)

### Phase 3: Performance & DX
- Helper utilities (`selectEntities`, filtered views)
- Manual index support (`createIndex('contact', 'status')`)
- Devtools integration
- TypeScript type inference for entity schemas

### Phase 4: Persistence & Scale
- Cache-persister compatibility strategy
- Swappable persistence backends via EntityStore interface
- IndexedDB + Dexie adapter (quick offline)
- SQLite + WASM + OPFS adapter (full query planner, IVM via triggers)
- Hydration/dehydration for SSR

### Phase 5: Moonshot
- cr-sqlite integration (conflict-free multi-device sync)
- Compound indexes and sorted views
- Full declarative query API
- Real-time sync engine (Electric-SQL style)

## Technical References

### Pinia Colada v1.0.0 plugin system

- **Plugin guide**: `docs/plugins/writing-plugins.md` — authoritative reference
- **Community listing**: `docs/plugins/community.md` — submit PR to add our plugin
- **Plugin pattern**: Factory function → `PiniaColadaPlugin` → `$onAction` subscriptions
- **ext rules**: Initialize ALL keys in `extend` via `scope.run()`, use `ShallowRef`, update via `.value` in `after()`
- **Module augmentation**: Required for type-safe options and extensions

### Official plugins (reference implementations)

| Plugin | What it demonstrates |
|--------|---------------------|
| `delay` | `customRef` replacement of `asyncStatus`, `scope.run()`, mutation support |
| `retry` | `after()` + `onError()` callbacks, retry logic |
| `auto-refetch` | Symbol ext keys, `setTimeout` management, `ensure` + `fetch` hooks |
| `cache-persister` | `PiniaColadaStorage` interface, serialization, hydration, debounced persistence |
| `tanstack-compat` | TanStack Query API compatibility layer |

### Browser persistence landscape

| Library | Purpose |
|---------|---------|
| **@sqlite.org/sqlite-wasm** | Official SQLite WASM build |
| **wa-sqlite** | Alternative WASM build, good OPFS support |
| **cr-sqlite** | SQLite + CRDTs for conflict-free multi-device sync |
| **electric-sql** | Postgres ↔ SQLite sync engine |
| **Dexie** | IndexedDB wrapper with nice API |

### Prior art

| Library | Approach |
|---------|---------|
| **normalizr** | Schema-based, manual, archived (2022) |
| **normy** | Convention-based, auto, active |
| **Apollo InMemoryCache** | GraphQL-only, deep merge, type policies |
| **TanStack DB** | Full client-side database with IVM + query planner |

## Open Questions

1. **Read path**: Should transparent denormalization use `customRef` on `entry.state` (like delay does with `asyncStatus`) or a `computed` wrapper? Need to prototype both.
2. **Pagination**: How does `defineEntity` interact with infinite scroll where entities arrive in pages?
3. **Denormalize caching**: Structural sharing to avoid creating new objects every read (Issue #8 from Wave 1 review)
4. **Danny's three-way sync code**: Review when available on work laptop — will inform Phase 2 optimistic update design
