# How It Works

This page explains the internal architecture of pinia-colada-plugin-normalizer.

## High-Level Flow

```
┌─────────────────────────────────────────────────────┐
│                   Pinia Colada                      │
│                                                     │
│  useQuery() ──► entry.state (customRef)             │
│                    │                                │
│              ┌─────┴──────┐                         │
│              │  SETTER    │    ◄── fetch response    │
│              │ normalize  │                         │
│              └─────┬──────┘                         │
│                    │                                │
│         ┌─────────┴────────────┐                    │
│         │                      │                    │
│         ▼                      ▼                    │
│   ┌──────────┐         ┌─────────────┐              │
│   │ EntityRef│         │ EntityStore │              │
│   │ (in raw  │         │ (flat map)  │              │
│   │  state)  │         │             │              │
│   └──────────┘         │ contact:1 ──┤              │
│         │              │ contact:2 ──┤              │
│         │              │ order:5   ──┤              │
│         │              └─────────────┘              │
│         │                      │                    │
│              ┌─────┴──────┐    │                    │
│              │  GETTER    │ ◄──┘  (reactive reads)  │
│              │ denormalize│                         │
│              └─────┬──────┘                         │
│                    │                                │
│                    ▼                                │
│              component reads                        │
│              live entity data                       │
└─────────────────────────────────────────────────────┘
```

## The customRef Replacement Pattern

The plugin hooks into Pinia Colada's `extend` action to replace `entry.state` with a Vue `customRef`. This is the same pattern used by the [delay plugin](https://github.com/posva/pinia-colada/tree/main/plugins/delay) (confirmed by Eduardo in Discussion #531).

**On write** (customRef setter): When Pinia Colada sets query state, the setter extracts entities from the response, stores them in the entity store, and saves `EntityRef` references internally. EntityRefs use a Symbol marker to prevent collision with API data.

**On read** (customRef getter): When components access query data, the getter replaces EntityRef references with live reactive entity data from the store. The getter uses `pauseTracking()`/`resetTracking()` from `@vue/reactivity` to prevent the entity store's `ShallowRef` reads from leaking into the component's reactive scope — this avoids double-firing on entity updates.

**On entity change**: `entityStore.set()` or `remove()` writes directly to the store. The plugin subscribes to store events and triggers the customRef when referenced entities change. This handles two cases that normal reactivity misses:
1. Entity removals (the ShallowRef is orphaned, not reassigned)
2. Late-arriving entities (entity was missing at first read, so no reactive dep was created)

The result is transparent normalization: application code and other plugins don't know it exists.

## Normalize / Denormalize Engines

### Normalize (write path)

The `normalize()` function walks a data structure recursively:

1. For each object, check if it's an entity (via `identifyEntity()`)
2. If it is: extract it, store it, and replace with an `EntityRef`
3. If not: walk children but keep structure intact
4. Arrays are walked element by element
5. Circular references are detected via `WeakSet`

Entity identification resolution order:
1. **Explicit definitions** — Check `entityDefs` by matching `idField` or calling `getId`
2. **Convention-based** — Objects with `defaultIdField` AND a `__typename` string field
3. **Skip** — Objects with `id` but no `__typename` and no matching definition are left as-is (prevents ID collisions)

### Denormalize (read path)

The `denormalize()` function walks data recursively:

1. When it encounters an `EntityRef`, look up the entity in the store
2. The entity itself may contain nested EntityRefs, so denormalization is recursive
3. Circular reference protection via `WeakSet` with backtracking (`visited.delete` after recursion) to allow shared entities across multiple ref paths
4. Missing entities return `undefined`

## Entity Store Internals

The default store is an in-memory reactive `Map<EntityKey, ShallowRef>`. Each entity gets its own `ShallowRef`, providing fine-grained reactivity — changing one entity only triggers re-renders in queries that reference it.

### EntityStore Interface

The store is defined as an interface, making the backend swappable:

| Method | Description |
| --- | --- |
| `set(type, id, data)` | Shallow-merge entity (`{ ...existing, ...incoming }`) |
| `replace(type, id, data)` | Full replacement (no merge) |
| `setMany(entities)` | Batch write (more efficient for backends with transactions) |
| `remove(type, id)` | Remove entity |
| `get(type, id)` | Reactive ref (creates phantom ref if entity doesn't exist yet) |
| `getByType(type)` | Reactive computed array (memoized per type) |
| `getEntriesByType(type)` | Non-reactive snapshot of `{id, data}` pairs |
| `has(type, id)` | Check existence |
| `subscribe(listener, filter?)` | Entity change events |
| `retain(type, id)` / `release(type, id)` | Reference counting for GC |
| `gc()` | Collect unreferenced entities |
| `toJSON()` / `hydrate(snapshot)` | Serialization / SSR hydration (handles nested EntityRefs) |
| `clear()` | Remove all entities |

Possible backends:
- **Level 1**: In-memory reactive Map (default, no persistence)
- **Level 2**: IndexedDB, raw API (offline support — shipped in 0.1.6)
- **Level 3**: SQLite + WASM + OPFS (full query planner)

## Denormalization Cache (Structural Sharing)

The customRef getter uses a per-entry denormalization cache. Each entity key maps to the last seen `ShallowRef` value and its denormalized result. When an entity's `ShallowRef` value hasn't changed (same object reference), the cached denormalized subtree is returned — same reference, no re-renders.

The cache is invalidated when:
- A referenced entity changes in the store
- An entity that was missing at first read arrives later (late-arriving entity)
- The query's own data is re-set (setter clears the cache)

This is similar to how TanStack Query implements structural sharing, but leverages Vue's reactivity system instead of deep equality checks.

## Subscriber System

Each normalized query entry subscribes to the entity store. The subscriber checks two conditions:

1. `denormCache.has(key)` — entity was denormalized on a previous read
2. `entityKeys.has(key)` — entity is referenced by the query's normalized data but was missing during denormalization (returned `undefined`, never entered denormCache)

When either condition is true, the denorm cache is cleared and the customRef is triggered, causing consumers to re-read denormalized data.

## GC Lifecycle

The plugin uses reference counting to track which entities are in use:

1. **retain**: Called when a query extracts an entity during normalization. Increments the reference count.
2. **release**: Called when a query is removed or its entities change. Decrements the reference count.
3. **gc()**: Removes entities with zero or negative reference counts. Only affects entities that have been `retain()`ed at least once — entities created via direct `entityStore.set()` (e.g., from WebSocket events) are untracked and immune to GC.

The retain/release order matters: on re-normalization, new keys are retained first, then old keys are released. This prevents a transient zero-refcount window for entities present in both old and new sets.

## SSR Safety

The entity store is scoped per Pinia instance via `defineStore`. Each server request gets its own store — no cross-request contamination.

```typescript
// Internally uses defineStore for per-instance scoping
const useNormalizerStore = defineStore("_pc_normalizer", () => {
  // store, queryCache, entityDefs all scoped here
});
```

Serialization and hydration for SSR:

```typescript
// Server: serialize to JSON
const snapshot = entityStore.toJSON();

// Client: hydrate from snapshot
entityStore.hydrate(snapshot);
```

`toJSON()` and `hydrate()` encode EntityRefs via a `__pcn_ref` wire format, since `JSON.stringify` silently drops Symbol keys.

## pauseTracking / resetTracking

The customRef getter wraps denormalization in `pauseTracking()`/`resetTracking()` from `@vue/reactivity`. This prevents `store.get().value` reads during denormalization from creating direct reactive dependencies from the component to each entity's ShallowRef.

Without this, every entity read during denormalization would add a dependency, and when any entity changes, the component would re-render twice: once from the subscriber (via `triggerCustomRef`) and once from the direct ShallowRef dependency.

This is the same pattern used by Pinia internally. While `pauseTracking` is technically an internal Vue API, it's stable in practice and used by Pinia, VueUse, and Vue core.
