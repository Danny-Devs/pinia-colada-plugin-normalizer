# API Reference

Complete reference for all public exports from `pinia-colada-plugin-normalizer`.

## Plugin

### `PiniaColadaNormalizer(options?)`

Creates the normalizer plugin for Pinia Colada.

```typescript
import { PiniaColadaNormalizer } from "pinia-colada-plugin-normalizer";

app.use(PiniaColada, {
  plugins: [PiniaColadaNormalizer(options)],
});
```

**Options** (`NormalizerPluginOptions`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `entities` | `Record<string, EntityDefinition>` | `{}` | Entity type configurations via `defineEntity()` |
| `defaultIdField` | `string` | `'id'` | Default ID field for convention-based auto-detection |
| `store` | `EntityStore` | in-memory | Custom storage backend |
| `autoNormalize` | `boolean` | `false` | Normalize all queries by default |
| `autoRedirect` | `boolean` | `false` | Auto-serve cached entities as placeholderData for `[entityType, id]` keys |

### `defineEntity<T>(config)`

Configure an entity type with type safety.

```typescript
import { defineEntity } from "pinia-colada-plugin-normalizer";

const contact = defineEntity<Contact>({
  idField: "contactId",
  merge: (existing, incoming) => ({ ...existing, ...incoming }),
});
```

**Config** (`EntityDefinition<T>`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `idField` | `string & keyof T` | `'id'` | Field containing the entity ID |
| `getId` | `(entity: T) => string \| null \| undefined` | -- | Custom ID extraction. Takes precedence over `idField`. |
| `merge` | `(existing: T, incoming: T) => T` | shallow merge | Custom merge strategy |

## Entity Store Access

### `useEntityStore(pinia?)`

Returns the `EntityStore` instance used by the normalizer plugin. SSR-safe via `defineStore`.

```typescript
import { useEntityStore } from "pinia-colada-plugin-normalizer";

const entityStore = useEntityStore();
```

- In component setup or composables: Pinia is auto-detected via inject.
- Outside component context: pass the Pinia instance explicitly.

### `createEntityStore()`

Creates a standalone in-memory `EntityStore`. Primarily for testing or custom backends.

```typescript
import { createEntityStore } from "pinia-colada-plugin-normalizer";

const store = createEntityStore();
```

## Persistence

### `enablePersistence(store, options?)`

Enable IndexedDB persistence for an entity store. See the [Persistence guide](/persistence) for details.

```typescript
import { enablePersistence } from "pinia-colada-plugin-normalizer";

const { ready, flush, dispose } = enablePersistence(entityStore, {
  dbName: "my-app",
});
await ready;
```

**Options** (`PersistenceOptions`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `dbName` | `string` | `'pcn_entities'` | IndexedDB database name |
| `writeDebounce` | `number` | `100` | Debounce interval (ms) for batching writes |
| `onReady` | `() => void` | -- | Called when hydration from IDB completes |
| `onError` | `(error: unknown) => void` | -- | Called when persistence degrades |

**Returns** (`PersistenceHandle`):

| Property | Type | Description |
| --- | --- | --- |
| `ready` | `Promise<void>` | Resolves when hydration is complete |
| `flush()` | `Promise<void>` | Force-flush pending writes to IDB |
| `dispose()` | `void` | Unsubscribe and clean up |

## Entity Store Interface

The `EntityStore` interface. All methods are available on the object returned by `useEntityStore()`.

### Writes

| Method | Signature | Description |
| --- | --- | --- |
| `set` | `(type: string, id: string, data: EntityRecord) => void` | Shallow-merge entity (`{ ...existing, ...incoming }`) |
| `replace` | `(type: string, id: string, data: EntityRecord) => void` | Full replacement (no merge) |
| `setMany` | `(entities: Array<{entityType, id, data}>) => void` | Batch write |
| `remove` | `(type: string, id: string) => void` | Remove entity |

### Reads

| Method | Signature | Description |
| --- | --- | --- |
| `get` | `(type: string, id: string) => ShallowRef<T \| undefined>` | Reactive ref. Creates phantom ref if entity doesn't exist. |
| `getByType` | `(type: string) => ComputedRef<T[]>` | Reactive computed array. Memoized per type. |
| `getEntriesByType` | `(type: string) => Array<{id, data}>` | Non-reactive snapshot with canonical IDs |
| `has` | `(type: string, id: string) => boolean` | Check existence |

### Subscriptions

| Method | Signature | Description |
| --- | --- | --- |
| `subscribe` | `(listener: (event: EntityEvent) => void, filter?: {entityType?}) => () => void` | Entity change events. Returns unsubscribe function. |

### Reference Counting

| Method | Signature | Description |
| --- | --- | --- |
| `retain` | `(type: string, id: string) => void` | Increment refcount (called by plugin on normalize) |
| `release` | `(type: string, id: string) => void` | Decrement refcount (called by plugin on remove/renormalize) |
| `getRefCount` | `(type: string, id: string) => number \| undefined` | Current refcount. `undefined` if never retained (immune to GC). |
| `gc` | `() => string[]` | Collect entities with refcount <= 0. Returns removed keys. |

### Lifecycle

| Method | Signature | Description |
| --- | --- | --- |
| `clear` | `() => void` | Remove all entities |
| `toJSON` | `() => Record<EntityKey, EntityRecord>` | Serialize (SSR) |
| `hydrate` | `(snapshot: Record<EntityKey, EntityRecord>) => void` | Restore from snapshot (SSR) |

## Query Operations

### `invalidateEntity(entityType, id, pinia?)`

Refetch all active queries that reference the given entity.

```typescript
import { invalidateEntity } from "pinia-colada-plugin-normalizer";

invalidateEntity("contact", "42");
```

### `updateQueryData(key, updater, pinia?)`

Update a query's data directly. The updater receives denormalized data; the result is re-normalized automatically.

```typescript
import { updateQueryData } from "pinia-colada-plugin-normalizer";

updateQueryData(["contacts"], (data) => [...(data as any[]), newContact]);
```

### `deleteEntity(entityType, id, pinia?)`

Remove an entity from all normalized queries and the entity store. Operates on normalized state for type-safe matching.

```typescript
import { deleteEntity } from "pinia-colada-plugin-normalizer";

deleteEntity("contact", "42");
```

### `useNormalizeMutation(pinia?)`

Returns a function that normalizes arbitrary data into the entity store. Use in mutation `onSuccess` handlers.

```typescript
import { useNormalizeMutation } from "pinia-colada-plugin-normalizer";

const normalizeMutation = useNormalizeMutation();
// In onSuccess: normalizeMutation(response)
```

## Composables

### `useEntityRef(entityType, id, pinia?)`

Reactive computed ref to a single entity. Accepts `MaybeRefOrGetter<string>` for reactive IDs.

```typescript
import { useEntityRef } from "pinia-colada-plugin-normalizer";

const contact = useEntityRef("contact", () => route.params.id);
// contact.value is Contact | undefined
```

### `useCachedEntity(entityType, id, pinia?)`

Returns a `placeholderData`-compatible getter function for cache redirects.

```typescript
import { useCachedEntity } from "pinia-colada-plugin-normalizer";

const { data } = useQuery({
  key: ["contact", id],
  query: () => fetchContact(id),
  placeholderData: useCachedEntity("contact", () => id.value),
});
```

### `useEntityQuery(entityType, filter?, pinia?)`

Reactive filtered view of entities by type. Returns `ComputedRef<T[]>`.

```typescript
import { useEntityQuery } from "pinia-colada-plugin-normalizer";

const activeContacts = useEntityQuery("contact", (c) => c.status === "active");
```

### `createEntityIndex(entityType, fieldOrFn, pinia?)`

Creates a reactive index on an entity field for O(1) lookups. Returns `{ get, dispose }`.

```typescript
import { createEntityIndex } from "pinia-colada-plugin-normalizer";

const statusIndex = createEntityIndex("contact", "status");
const active = statusIndex.get("active"); // ComputedRef<Contact[]>
```

### `useOptimisticUpdate(pinia?)`

Transaction-based optimistic updates with rollback. Returns `{ apply, transaction }`.

```typescript
import { useOptimisticUpdate } from "pinia-colada-plugin-normalizer";

const { apply, transaction } = useOptimisticUpdate();

// Simple:
const rollback = apply("contact", "1", { name: "Alicia" });

// Multi-mutation:
const tx = transaction();
tx.set("contact", "1", { name: "Alicia" });
tx.commit(); // or tx.rollback()
```

**OptimisticTransaction interface:**

| Method | Description |
| --- | --- |
| `set(type, id, data)` | Apply an optimistic entity update |
| `remove(type, id)` | Optimistically remove an entity |
| `commit()` | Server confirmed — drop optimistic state |
| `rollback()` | Mutation failed — restore server truth, replay remaining transactions |

### `createCoalescer<T>(onFlush, delay?)`

Batch items and flush after a delay. Framework-agnostic.

```typescript
import { createCoalescer } from "pinia-colada-plugin-normalizer";

const coalescer = createCoalescer(async (keys) => {
  const entities = await api.fetchByIds(keys);
  // ...
}, 100);

coalescer.add("contact:42");
coalescer.flush(); // manual flush
```

## WebSocket Hooks

### `onEntityAdded(entityType, callback, pinia?)`

Fires when `set()` is called for an entity that didn't previously exist.

### `onEntityUpdated(entityType, callback, pinia?)`

Fires when `set()` or `replace()` is called for an entity that already exists.

### `onEntityRemoved(entityType, callback, pinia?)`

Fires when `remove()` is called.

All hooks receive an `EntityEvent<T>`:

```typescript
interface EntityEvent<T> {
  type: "set" | "remove";
  entityType: string;
  id: string;
  key: EntityKey;         // e.g. "contact:42"
  data: T | undefined;
  previousData: T | undefined;
}
```

All hooks auto-cleanup via `onScopeDispose` when called inside a Vue effect scope. They also return an unsubscribe function for manual cleanup.

## Per-Query Options

Added to `UseQueryOptions` via module augmentation:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `normalize` | `boolean` | inherits from `autoNormalize` | Whether to normalize this query's response |
| `redirect` | `false \| { entityType, getId? }` | inherits from `autoRedirect` | Cache redirect behavior for this query |

## Types

| Type | Description |
| --- | --- |
| `EntityStore` | The swappable store interface |
| `EntityRecord` | `Record<string, unknown>` — default entity shape |
| `EntityKey` | `` `${string}:${string}` `` — composite key (e.g. `"contact:42"`) |
| `EntityEvent<T>` | Store change event |
| `EntityDefinition<T>` | Config for `defineEntity()` |
| `EntityRegistry` | User-extensible type registry (module augmentation) |
| `ResolveEntity<K>` | Resolves entity type from registry, falls back to `EntityRecord` |
| `NormalizerPluginOptions` | Plugin options |
| `NormalizerQueryOptions` | Per-query options (`normalize`, `redirect`) |
| `OptimisticTransaction` | Transaction interface for optimistic updates |
| `PersistenceOptions` | Options for `enablePersistence()` |
| `PersistenceHandle` | Return type of `enablePersistence()` (`ready`, `flush`, `dispose`) |
| `CursorPaginationOptions<T>` | Options for `cursorPagination()` |
| `OffsetPaginationOptions<T>` | Options for `offsetPagination()` |
| `RelayPaginationOptions` | Options for `relayPagination()` |
| `RelayPageInfo` | Relay connection `pageInfo` shape |
| `RelayEdge<TNode>` | Relay connection edge shape |
| `RelayConnection<TNode>` | Full Relay connection response shape |

## Pagination Helpers

Merge recipe factories for `defineEntity({ merge })`. These control how paginated entities accumulate items across pages.

### `cursorPagination<T>(options)`

Merge function for cursor-based pagination. Appends or prepends items across page loads.

```typescript
import { cursorPagination, defineEntity } from "pinia-colada-plugin-normalizer";

const feed = defineEntity<Feed>({
  idField: "feedId",
  merge: cursorPagination({
    getCursor: (f) => f.endCursor,
    itemsField: "items",
    direction: "forward",
    dedupeKey: "id",
  }),
});
```

**Options** (`CursorPaginationOptions<T>`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `getCursor` | `(entity: T) => string \| number \| null` | *required* | Extract the cursor value |
| `itemsField` | `string` | `'items'` | Field containing the items array |
| `direction` | `'forward' \| 'backward'` | `'forward'` | Append or prepend new items |
| `dedupeKey` | `string` | -- | Field to deduplicate items by (newer wins) |

### `offsetPagination<T>(options)`

Merge function for offset-based pagination. Places items at correct positions in a sparse array.

```typescript
import { offsetPagination, defineEntity } from "pinia-colada-plugin-normalizer";

const list = defineEntity<ContactList>({
  idField: "listId",
  merge: offsetPagination({
    getOffset: (l) => l.offset,
    pageSize: 20,
    itemsField: "contacts",
  }),
});
```

**Options** (`OffsetPaginationOptions<T>`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `getOffset` | `(entity: T) => number` | *required* | Extract the current offset |
| `pageSize` | `number` | *required* | Page size |
| `itemsField` | `string` | `'items'` | Field containing the items array |
| `dedupeKey` | `string` | -- | Field to deduplicate items by (newer wins) |

### `relayPagination<T>(options?)`

Merge function for Relay-style GraphQL connection pagination. Handles `edges`, `cursor`, and `pageInfo` stitching.

```typescript
import { relayPagination, defineEntity } from "pinia-colada-plugin-normalizer";
import type { RelayConnection } from "pinia-colada-plugin-normalizer";

interface UsersConnection extends RelayConnection<User> {
  connectionId: string;
}

const usersConn = defineEntity<UsersConnection>({
  idField: "connectionId",
  merge: relayPagination(),
});
```

**Options** (`RelayPaginationOptions`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `edgesField` | `string` | `'edges'` | Field containing the edges array |
| `pageInfoField` | `string` | `'pageInfo'` | Field containing the pageInfo object |
| `direction` | `'forward' \| 'backward'` | `'forward'` | Append or prepend new edges |
| `dedupeByCursor` | `boolean` | `true` | Deduplicate edges by cursor value (newer wins) |

**Relay types:**

| Type | Description |
| --- | --- |
| `RelayPageInfo` | `{ hasNextPage, hasPreviousPage, startCursor, endCursor }` |
| `RelayEdge<TNode>` | `{ node: TNode, cursor: string }` |
| `RelayConnection<TNode>` | `{ edges: RelayEdge<TNode>[], pageInfo: RelayPageInfo }` |

## Deprecated

| Export | Replacement | Removal |
| --- | --- | --- |
| `removeEntityFromAllQueries` | `deleteEntity` | 1.0 |
