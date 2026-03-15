# pinia-colada-plugin-normalizer

Normalized entity caching plugin for [Pinia Colada](https://github.com/posva/pinia-colada).

Store each entity **once**. Update it in one place, every query sees the change. No more stale data from missed cache invalidations.

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

## How It Works

Uses Vue's `customRef` to transparently intercept both reads and writes on `entry.state`:

1. **On write:** When Pinia Colada sets query state, the customRef **setter** fires — extracts entities (objects matching `defineEntity` configs or with `__typename` + `id`), stores them in the entity store, saves references internally
2. **On read:** When components access query data, the customRef **getter** fires — replaces references with live reactive entity data from the store
3. **WebSocket:** `useEntityStore().set()` writes directly to the entity store — Vue reactivity propagates to all queries that reference that entity

This approach follows the [delay plugin](https://github.com/posva/pinia-colada/tree/main/plugins/delay)'s pattern of replacing entry properties with `customRef` during the `extend` hook. SSR-safe via `defineStore` scoping.

## License

[MIT](./LICENSE)
