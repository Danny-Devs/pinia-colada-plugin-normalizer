# Getting Started

Normalized entity caching plugin for [Pinia Colada](https://github.com/posva/pinia-colada). Store each entity **once** — update it in one place and every query sees the change. No more stale data from missed cache invalidations.

> [Live Playground](https://pinia-colada-plugin-normalizer.vercel.app)

## The Problem

Pinia Colada stores data per query key. When the same entity appears in multiple queries, it lives as independent copies that can diverge:

```typescript
const { data: contacts } = useQuery({ key: ["contacts"], query: fetchContacts });
const { data: contact } = useQuery({ key: ["contacts", 5], query: () => fetchContact(5) });

// A mutation updates contact 5's name.
// Only one cache entry gets the update. The other is stale.
```

## The Solution

With normalization, contact 5 is stored **once** in a flat entity store. Both queries read from the same entity. One write, all views update — no cache invalidation, no refetching.

This plugin uses Vue's `customRef` to transparently intercept reads and writes on Pinia Colada's query state. Your app code doesn't know normalization exists.

## Installation

```bash
pnpm add pinia-colada-plugin-normalizer
```

Requires `@pinia/colada` >= 1.0.0, `pinia` ^2.2.6 || ^3.0.0, `vue` >= 3.3.0.

## Quick Start

### 1. Register the plugin

```typescript
import { PiniaColada } from "@pinia/colada";
import { PiniaColadaNormalizer, defineEntity } from "pinia-colada-plugin-normalizer";

app.use(PiniaColada, {
  plugins: [
    PiniaColadaNormalizer({
      entities: {
        contact: defineEntity<Contact>({ idField: "contactId" }),
        order: defineEntity<Order>({ idField: "orderId" }),
      },
    }),
  ],
});
```

### 2. Opt in per query

```typescript
const { data } = useQuery({
  key: ["contacts"],
  query: () => fetchContacts(),
  normalize: true,
});
```

Or enable globally with `autoNormalize: true`:

```typescript
PiniaColadaNormalizer({ autoNormalize: true });
```

### 3. Write directly to the entity store

No invalidation needed — Vue reactivity propagates to all queries:

```typescript
import { useEntityStore } from "pinia-colada-plugin-normalizer";

const entityStore = useEntityStore();

// From a WebSocket event:
ws.on("CONTACT_UPDATED", (data) => {
  entityStore.set("contact", data.contactId, data);
});
```

## Plugin Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `entities` | `Record<string, EntityDefinition>` | `{}` | Entity type configurations via `defineEntity()` |
| `defaultIdField` | `string` | `'id'` | Default ID field for convention-based auto-detection |
| `store` | `EntityStore` | in-memory | Custom storage backend (IndexedDB, SQLite, etc.) |
| `autoNormalize` | `boolean` | `false` | Normalize all queries by default |
| `autoRedirect` | `boolean` | `false` | Auto-serve cached entities as placeholder data for `[entityType, id]` keys |

## What's Next

- [Entity Definitions](./entity-definitions) — configuring `defineEntity`, type safety via `EntityRegistry`
- [Real-Time Patterns](./real-time) — WebSocket hooks, optimistic updates, coalescing
- [Cache Redirects](./cache-redirects) — zero-spinner navigation with `autoRedirect` and `useCachedEntity`
- [Persistence](./persistence) — save entities to IndexedDB, survive page refreshes
- [How It Works](./architecture) — customRef internals, entity store, GC, SSR
- [API Reference](./api-reference) — complete list of exports, options, and types
