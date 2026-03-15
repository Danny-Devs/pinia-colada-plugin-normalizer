# How It Works

This page explains the internal architecture of pinia-colada-plugin-normalizer.

## The customRef Replacement Pattern

The plugin hooks into Pinia Colada's `extend` action to replace `entry.state` with a Vue `customRef`. This is the same pattern used by the [delay plugin](https://github.com/posva/pinia-colada/tree/main/plugins/delay) (confirmed by Eduardo in Discussion #531).

**On write** (customRef setter): When Pinia Colada sets query state, the setter extracts entities from the response, stores them in the entity store, and saves `EntityRef` references internally. EntityRefs use a Symbol marker to prevent collision with API data.

**On read** (customRef getter): When components access query data, the getter replaces EntityRef references with live reactive entity data from the store.

**On entity change**: `entityStore.set()` or `remove()` writes directly to the store. Vue reactivity propagates to all queries referencing that entity. The plugin subscribes to store events and triggers the customRef when referenced entities change — this handles removals and late-arriving entities that wouldn't be caught by normal reactivity tracking.

The result is transparent normalization: application code and other plugins don't know it exists.

## Entity Store

The default store is an in-memory reactive Map backed by `ShallowRef` per entity. This gives fine-grained reactivity — changing one entity only triggers re-renders in queries that reference it.

### EntityStore Interface

The store is defined as an interface, making the backend swappable:

| Method | Description |
| --- | --- |
| `set(type, id, data)` | Shallow-merge entity |
| `replace(type, id, data)` | Full replacement (no merge) |
| `setMany(entities)` | Batch write |
| `remove(type, id)` | Remove entity |
| `get(type, id)` | Reactive ref |
| `getByType(type)` | Reactive computed array |
| `getEntriesByType(type)` | Non-reactive snapshot of `{id, data}` pairs |
| `has(type, id)` | Check existence |
| `subscribe(listener, filter?)` | Entity change events |
| `retain(type, id)` / `release(type, id)` | Reference counting for GC |
| `gc()` | Collect unreferenced entities |
| `toJSON()` / `hydrate(snapshot)` | Serialization / SSR hydration |
| `clear()` | Remove all entities |

Possible backends:
- **Level 1**: In-memory reactive Map (default, no persistence)
- **Level 2**: IndexedDB + Dexie (offline support)
- **Level 3**: SQLite + WASM + OPFS (full query planner)

Pass a custom store via the `store` plugin option:

```typescript
PiniaColadaNormalizer({ store: myCustomStore });
```

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

The store supports serialization and hydration for SSR:

```typescript
// Server: serialize to JSON
const snapshot = entityStore.toJSON();

// Client: hydrate from snapshot
entityStore.hydrate(snapshot);
```

`toJSON()` and `hydrate()` handle nested EntityRefs correctly.

## Denormalization Cache

The customRef getter uses a per-entry denormalization cache for structural sharing. Each entity key maps to the last seen `ShallowRef` value and its denormalized result. When an entity's `ShallowRef` value hasn't changed (same object reference), the cached denormalized subtree is returned — same reference, no re-renders.

The cache is invalidated when:
- A referenced entity changes in the store
- An entity that was missing at first read arrives later (late-arriving entity)
- The query's own data is re-set (setter clears the cache)

This is similar to how React Query and TanStack Query implement structural sharing, but leverages Vue's reactivity system instead of deep equality checks.

## Entity Identification

Resolution order for identifying entities in a response:

1. **Explicit definitions**: Check `entityDefs` by matching `idField` or calling `getId`
2. **Convention-based**: Objects with the `defaultIdField` (default: `'id'`) AND a `__typename` string field
3. **Skip**: Objects with `id` but no `__typename` and no matching entity definition are left as-is to prevent ID collisions between unrelated types

Normalization is recursive — nested entities within entities are extracted and replaced with refs.
