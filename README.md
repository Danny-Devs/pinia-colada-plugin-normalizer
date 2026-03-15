# pinia-colada-plugin-normalizer

Normalized entity caching plugin for [Pinia Colada](https://github.com/posva/pinia-colada). Apollo-style normalization with zero configuration and Vue-native performance.

Store each entity **once**. Update it in one place, every query sees the change. No more stale data from missed cache invalidations.

- **Transparent** — uses Vue's `customRef` to intercept reads/writes. Your app code doesn't know normalization exists.
- **Minimal** — ~1,900 LOC, zero runtime dependencies. Just Vue + Pinia Colada.
- **Type-safe** — optional `EntityRegistry` for end-to-end typed entity access across the entire API.
- **Extensible** — swappable `EntityStore` interface for custom backends (IndexedDB, SQLite+WASM).

## Installation

```bash
pnpm add pinia-colada-plugin-normalizer
```

Requires `@pinia/colada` >= 1.0.0, `pinia` >= 2.1.0, `vue` >= 3.3.0.

## Quick Start

```typescript
import { PiniaColada } from '@pinia/colada'
import { PiniaColadaNormalizer, defineEntity } from 'pinia-colada-plugin-normalizer'

app.use(PiniaColada, {
  plugins: [
    PiniaColadaNormalizer({
      entities: {
        contact: defineEntity<Contact>({ idField: 'contactId' }),
        order: defineEntity<Order>({ idField: 'orderId' }),
      },
    }),
  ],
})
```

Opt in per query:

```typescript
const { data } = useQuery({
  key: ['contacts'],
  query: () => fetchContacts(),
  normalize: true,
})
```

## Type Safety

Augment the `EntityRegistry` interface for end-to-end typed access:

```typescript
declare module 'pinia-colada-plugin-normalizer' {
  interface EntityRegistry {
    contact: Contact
    order: Order
  }
}

// Now fully typed everywhere:
entityStore.get('contact', '1')           // ShallowRef<Contact | undefined>
entityStore.set('contact', '1', data)     // data must match Contact
useEntityQuery('contact', c => c.name)    // c is Contact
onEntityAdded('contact', e => e.data)     // data is Contact | undefined
```

Without the registry, everything defaults to `EntityRecord` — fully backwards compatible.

## The Problem

Pinia Colada stores data per query key. When the same entity appears in multiple queries, it lives as independent copies that can diverge:

```typescript
const { data: contacts } = useQuery({ key: ['contacts'], query: fetchContacts })
const { data: contact } = useQuery({ key: ['contacts', 5], query: () => fetchContact(5) })

// A mutation updates contact 5's name.
// Only one cache entry gets the update. The other is stale.
```

With normalization, contact 5 is stored once. Both queries read from the same entity. One write, all views update.

## Entity Store Writes

Write directly to the entity store — no invalidation needed:

```typescript
import { useEntityStore } from 'pinia-colada-plugin-normalizer'

const entityStore = useEntityStore()

// From a WebSocket event:
ws.on('CONTACT_UPDATED', (data) => {
  entityStore.set('contact', data.contactId, data)
})

// From a mutation response:
const { mutate } = useMutation({
  mutation: (data) => api.updateContact(data),
  onSuccess: (response) => {
    entityStore.set('contact', response.contactId, response)
    // All queries referencing this contact update instantly. No refetch.
  },
})
```

## Optimistic Updates

Transaction-based with rollback. Handles concurrent mutations correctly:

```typescript
import { useOptimisticUpdate } from 'pinia-colada-plugin-normalizer'

const { apply, transaction } = useOptimisticUpdate()

// Simple (single mutation):
const { mutate } = useMutation({
  mutation: (data) => api.updateContact(data),
  onMutate: (data) => apply('contact', data.contactId, data),
  onError: (_err, _vars, rollback) => rollback?.(),
})

// Multi-mutation transaction:
const tx = transaction()
tx.set('contact', '1', { name: 'Alicia' })
tx.set('order', '5', { status: 'confirmed' })
// On success: tx.commit()
// On failure: tx.rollback() — restores server truth, replays other active transactions
```

## Array Operations

Add or remove entities from list queries without refetching:

```typescript
import { updateQueryData, removeEntityFromAllQueries } from 'pinia-colada-plugin-normalizer'

// Add to a specific list query:
entityStore.set('contact', '99', newContact)
updateQueryData(['contacts'], (data) => [...(data as any[]), newContact])

// Remove from ALL queries + entity store (one call):
removeEntityFromAllQueries('contact', '42')
```

## Real-Time Hooks

Fine-grained entity lifecycle events:

```typescript
import { onEntityAdded, onEntityUpdated, onEntityRemoved } from 'pinia-colada-plugin-normalizer'

onEntityAdded('contact', (event) => toast.success(`${event.data.name} joined!`))
onEntityUpdated('contact', (event) => console.log('Updated:', event.id))
onEntityRemoved('contact', (event) => toast.info(`${event.previousData?.name} left`))
```

## Entity Queries & Indexes

Filtered reactive views and O(1) field lookups:

```typescript
import { useEntityQuery, createEntityIndex } from 'pinia-colada-plugin-normalizer'

// Filtered view (reactive, updates automatically)
const activeContacts = useEntityQuery('contact', c => c.status === 'active')

// Index for O(1) lookups by field value
const statusIndex = createEntityIndex('contact', 'status')
const active = statusIndex.get('active')   // ComputedRef<Contact[]>
```

## Coalescing

Batch multiple notifications into a single fetch:

```typescript
import { createCoalescer } from 'pinia-colada-plugin-normalizer'

const coalescer = createCoalescer(async (entityKeys) => {
  const entities = await api.fetchEntitiesByIds(entityKeys)
  for (const entity of entities) {
    entityStore.set('contact', entity.id, entity)
  }
}, 100) // 100ms batching window

ws.on('ENTITY_STALE', ({ key }) => coalescer.add(key))
```

## API Reference

### `PiniaColadaNormalizer(options?)`

Creates the plugin.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `entities` | `Record<string, EntityDefinition>` | `{}` | Entity type configurations |
| `defaultIdField` | `string` | `'id'` | Default ID field for auto-detection |
| `store` | `EntityStore` | in-memory | Custom storage backend |
| `autoNormalize` | `boolean` | `false` | Normalize all queries by default |

### `defineEntity<T>(config)`

Configure an entity type. The generic `T` provides type safety for callbacks.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `idField` | `string & keyof T` | `'id'` | Field containing the entity ID |
| `getId` | `(entity: T) => string \| null` | — | Custom ID extraction (for composite keys) |
| `merge` | `(existing: T, incoming: T) => T` | shallow merge | Custom merge strategy |

### `useEntityStore(pinia?)`

Access the entity store. Returns typed results when `EntityRegistry` is augmented.

### `invalidateEntity(entityType, id, pinia?)`

Refetch all active queries referencing the given entity.

### `updateQueryData(key, updater, pinia?)`

Update a query's data directly. Updater receives denormalized data, result is re-normalized.

### `removeEntityFromAllQueries(entityType, id, pinia?)`

Remove an entity from all normalized queries and the entity store.

### `useOptimisticUpdate(pinia?)`

Returns `{ apply, transaction }` for optimistic updates with rollback.

### `createCoalescer<T>(onFlush, delay?)`

Batch items and flush after a delay. Framework-agnostic.

### Entity Store Interface

| Method | Description |
|--------|-------------|
| `set(type, id, data)` | Shallow-merge entity |
| `replace(type, id, data)` | Full replacement (no merge) |
| `setMany(entities)` | Batch write |
| `remove(type, id)` | Remove entity |
| `get(type, id)` | Reactive ref (typed when registry used) |
| `getByType(type)` | Reactive computed array (typed when registry used) |
| `getEntriesByType(type)` | Non-reactive snapshot of `{id, data}` pairs |
| `has(type, id)` | Check existence |
| `subscribe(listener, filter?)` | Entity change events (typed when registry used) |
| `retain(type, id)` / `release(type, id)` | Reference counting for GC |
| `gc()` | Collect unreferenced entities |
| `toJSON()` / `hydrate(snapshot)` | Serialization / SSR hydration (handles nested EntityRefs) |
| `clear()` | Remove all entities |

## How It Works

Uses Vue's `customRef` to transparently intercept reads and writes on `entry.state`:

1. **On write:** When Pinia Colada sets query state, the customRef **setter** extracts entities, stores them in the entity store, and saves references internally
2. **On read:** When components access query data, the customRef **getter** replaces references with live reactive entity data
3. **On entity change:** `entityStore.set()` or `remove()` writes directly — Vue reactivity propagates to all queries referencing that entity. Entities that arrive late (out-of-order) or are removed and re-added trigger re-renders automatically.

Follows the [delay plugin](https://github.com/posva/pinia-colada/tree/main/plugins/delay)'s pattern of replacing entry properties with `customRef` during the `extend` hook. SSR-safe via `defineStore` scoping.

## License

[MIT](./LICENSE)
