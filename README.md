# pinia-colada-plugin-normalizer

Normalized entity caching plugin for [Pinia Colada](https://github.com/posva/pinia-colada). Apollo-style normalization with zero configuration and Vue-native performance.

Store each entity **once**. Update it in one place, every query sees the change. No more stale data from missed cache invalidations.

- **Transparent** — uses Vue's `customRef` to intercept reads/writes. Your app code doesn't know normalization exists.
- **Minimal** — ~1,000 LOC, zero runtime dependencies. Just Vue + Pinia Colada.
- **WebSocket-first** — write directly to the entity store from push events, all views update automatically.
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
        contact: defineEntity({ idField: 'contactId' }),
        order: defineEntity({ idField: 'orderId' }),
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

## The Problem

Pinia Colada stores data per query key. When the same entity appears in multiple queries, it lives as independent copies that can diverge:

```typescript
const { data: contacts } = useQuery({ key: ['contacts'], query: fetchContacts })
const { data: contact } = useQuery({ key: ['contacts', 5], query: () => fetchContact(5) })

// A mutation updates contact 5's name.
// Only one cache entry gets the update. The other is stale.
```

With normalization, contact 5 is stored once. Both queries read from the same entity. One write, all views update.

## WebSocket Integration

Write directly to the entity store from push events — no invalidation needed:

```typescript
import { useEntityStore } from 'pinia-colada-plugin-normalizer'

const entityStore = useEntityStore()

ws.on('CONTACT_UPDATED', (data) => {
  entityStore.set('contact', data.contactId, data)
  // Every query referencing this contact updates automatically
})
```

## Mutation Updates (Zero Refetch)

When a mutation returns the updated entity, write it directly — all queries update automatically:

```typescript
const { mutate } = useMutation({
  mutation: (data) => api.updateContact(data),
  onSuccess: (response) => {
    entityStore.set('contact', response.contactId, response)
    // All queries referencing this contact update instantly. No refetch.
  },
})
```

## Optimistic Updates

Instant UI updates with transaction-based rollback. Handles concurrent mutations correctly:

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

## API

### `PiniaColadaNormalizer(options?)`

Creates the plugin. Options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `entities` | `Record<string, EntityDefinition>` | `{}` | Entity type configurations |
| `defaultIdField` | `string` | `'id'` | Default ID field for auto-detection |
| `store` | `EntityStore` | in-memory | Custom storage backend |
| `autoNormalize` | `boolean` | `false` | Normalize all queries by default |

### `defineEntity(config)`

Configure an entity type:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `idField` | `string` | `'id'` | Field containing the entity ID |
| `getId` | `(entity) => string \| null` | — | Custom ID extraction (for composite keys) |
| `merge` | `(existing, incoming) => entity` | shallow merge | Custom merge strategy per entity type |

### `useEntityStore(pinia?)`

Access the entity store from components or composables. Accepts an optional Pinia instance for use outside component setup (e.g., WebSocket services).

### `invalidateEntity(entityType, id, pinia?)`

Refetch all active queries that reference the given entity. Use when you know an entity is stale and want to force a server round-trip.

### `updateQueryData(key, updater, pinia?)`

Update a query's data directly, re-normalizing the result. The updater receives denormalized data and should return the new data. Use for array operations (add/remove entities from list queries).

```typescript
// Add a new contact to a list query:
entityStore.set('contact', '99', newContact)
updateQueryData(['contacts'], (data) => [...(data as any[]), newContact])
```

### `removeEntityFromAllQueries(entityType, id, pinia?)`

Remove an entity from all normalized queries and the entity store in one call. Complete "delete entity" operation.

```typescript
removeEntityFromAllQueries('contact', '42')
```

### Entity Store

The storage backend is swappable. Default is an in-memory reactive Map:

| Method | Description |
|--------|-------------|
| `set(type, id, data)` | Shallow-merge entity (`{ ...existing, ...incoming }`) |
| `replace(type, id, data)` | Full replacement (no merge) |
| `setMany(entities)` | Batch write (shallow merge) |
| `remove(type, id)` | Remove an entity |
| `get(type, id)` | Reactive `ShallowRef<EntityRecord \| undefined>` |
| `getByType(type)` | `ComputedRef<EntityRecord[]>` |
| `has(type, id)` | Check existence |
| `subscribe(listener, filter?)` | Entity change events |
| `retain(type, id)` / `release(type, id)` | Reference counting for GC |
| `gc()` | Collect entities with zero references |
| `toJSON()` / `hydrate(snapshot)` | Serialization / SSR hydration |
| `clear()` | Remove all entities |

### Real-Time Hooks

Fine-grained entity lifecycle events:

```typescript
import { onEntityAdded, onEntityUpdated, onEntityRemoved } from 'pinia-colada-plugin-normalizer'

onEntityAdded('contact', (event) => toast.success(`${event.data.name} joined!`))
onEntityUpdated('contact', (event) => console.log('Updated:', event.id))
onEntityRemoved('contact', (event) => toast.info(`${event.previousData?.name} left`))
```

### Entity Queries & Indexes

Filtered reactive views and O(1) field lookups:

```typescript
import { useEntityQuery, createEntityIndex } from 'pinia-colada-plugin-normalizer'

// Filtered view (reactive, updates automatically)
const activeContacts = useEntityQuery('contact', c => c.status === 'active')

// Index for O(1) lookups by field value
const statusIndex = createEntityIndex('contact', 'status')
const active = statusIndex.get('active')   // ComputedRef<EntityRecord[]>
```

## How It Works

Uses Vue's `customRef` to transparently intercept both reads and writes on `entry.state`:

1. **On write:** When Pinia Colada sets query state, the customRef **setter** fires — extracts entities (objects matching `defineEntity` configs or with `__typename` + `id`), stores them in the entity store, saves references internally
2. **On read:** When components access query data, the customRef **getter** fires — replaces references with live reactive entity data from the store
3. **On entity update:** `entityStore.set()` writes directly — Vue reactivity propagates to all queries that reference that entity

This approach follows the [delay plugin](https://github.com/posva/pinia-colada/tree/main/plugins/delay)'s pattern of replacing entry properties with `customRef` during the `extend` hook. SSR-safe via `defineStore` scoping.

## License

[MIT](./LICENSE)
