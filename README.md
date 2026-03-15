# pinia-colada-plugin-normalizer

Normalized entity caching plugin for [Pinia Colada](https://github.com/posva/pinia-colada). Apollo-style normalization with zero configuration and Vue-native performance.

Store each entity **once**. Update it in one place, every query sees the change. No more stale data from missed cache invalidations.

- **Transparent** — uses Vue's `customRef` to intercept reads/writes. Your app code doesn't know normalization exists.
- **Minimal** — ~1,100 LOC, zero runtime dependencies. Just Vue + Pinia Colada.
- **WebSocket-first** — write directly to the entity store from push events, all views update automatically.
- **Extensible** — swappable `EntityStore` interface for custom backends (IndexedDB, SQLite+WASM).

## The Problem

Pinia Colada stores data per query key. When the same entity appears in multiple queries, it lives as independent copies that can diverge:

```typescript
// Both queries contain contact id=5, stored separately
const { data: contacts } = useQuery({ key: ['contacts'], query: fetchContacts })
const { data: contact } = useQuery({ key: ['contacts', 5], query: () => fetchContact(5) })

// A WebSocket event updates contact 5's name.
// Only one cache entry gets the update. The other is stale.
```

## The Solution

This plugin extracts entities from query responses, stores them in a shared reactive store, and replaces duplicates with references. Update an entity once, all queries reflect the change automatically.

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

## Installation

```bash
pnpm add pinia-colada-plugin-normalizer
```

Requires `@pinia/colada` >= 1.0.0, `pinia` >= 2.1.0, `vue` >= 3.3.0.

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
| `getId` | `(entity) => string` | — | Custom ID extraction (for composite keys) |

### `useEntityStore()`

Access the entity store from components or composables. Use for direct writes (WebSocket events) or reads.

### `EntityStore` interface

The storage backend is swappable. Default is an in-memory reactive Map. The interface supports future backends (IndexedDB, SQLite+WASM):

- `set(type, id, data)` / `setMany(entities)` / `remove(type, id)`
- `get(type, id)` — returns reactive `ShallowRef`
- `getByType(type)` — returns `ComputedRef<Entity[]>`
- `query(fn)` — derived reactive query
- `subscribe(listener, filter?)` — entity change events
- `toJSON()` / `hydrate(snapshot)` — serialization

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
const active = statusIndex.get('active')   // ComputedRef<EntityRecord[]>
```

## Array Operations (List Query Updates)

Add or remove entities from list queries after create/delete mutations:

```typescript
import { updateQueryData, removeEntityFromAllQueries } from 'pinia-colada-plugin-normalizer'

// Add to a specific list query:
entityStore.set('contact', '99', newContact)
updateQueryData(['contacts'], (data) => [...(data as any[]), newContact])

// Remove from ALL queries + entity store (one call does everything):
removeEntityFromAllQueries('contact', '42')
```

## How It Works

Uses Vue's `customRef` to transparently intercept both reads and writes on `entry.state`:

1. **On write:** When Pinia Colada sets query state, the customRef **setter** fires — extracts entities (objects matching `defineEntity` configs or with `__typename` + `id`), stores them in the entity store, saves references internally
2. **On read:** When components access query data, the customRef **getter** fires — replaces references with live reactive entity data from the store
3. **WebSocket:** `useEntityStore().set()` writes directly to the entity store — Vue reactivity propagates to all queries that reference that entity

This approach follows the [delay plugin](https://github.com/posva/pinia-colada/tree/main/plugins/delay)'s pattern of replacing entry properties with `customRef` during the `extend` hook. SSR-safe via `defineStore` scoping.

## License

[MIT](./LICENSE)
