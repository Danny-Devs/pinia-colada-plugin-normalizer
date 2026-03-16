# Cache Redirects

Cache redirects let detail pages display data **instantly** when the entity was already fetched by a list query — zero loading spinner while the full data loads in the background.

## The Pattern

A list page fetches contacts. The user clicks one. The detail page query starts fetching, but the contact's data is already in the entity store from the list query. Cache redirects serve that cached entity as `placeholderData` while the real fetch runs.

```
List query fetches [contact:1, contact:2, contact:3]
    → entities stored in entity store

User navigates to /contacts/2
    → detail query key: ['contact', '2']
    → autoRedirect detects contact:2 exists in store
    → serves it as placeholderData (instant render)
    → real fetch runs in background
    → when fetch completes, real data replaces placeholder
```

## Automatic (autoRedirect)

Enable with one flag:

```typescript
PiniaColadaNormalizer({
  entities: { contact: defineEntity({ idField: "contactId" }) },
  autoRedirect: true,
});
```

Now any query with key `['contact', id]` auto-serves from cache:

```typescript
const { data, isPlaceholderData } = useQuery({
  key: ["contact", id],
  query: () => fetchContact(id),
  normalize: true,
});
// data is available INSTANTLY if contact was fetched by a prior list query.
// isPlaceholderData is true until the real fetch completes.
```

### The 2-Segment Convention

`autoRedirect` uses a simple convention to detect detail queries:

- Query key has **exactly 2 segments**: `[entityType, entityId]`
- The first segment matches a **registered entity type** (a key in your `entities` config)
- The entity **exists** in the store

Queries that don't match are skipped:
- 1-segment keys like `['contacts']` (list queries)
- 3+-segment keys like `['contact', '42', 'orders']` (nested resources)
- Keys where the first segment isn't a registered entity type

### Per-Query Overrides

Disable for a specific query:

```typescript
useQuery({
  key: ["contact", id],
  query: () => fetchContact(id),
  redirect: false,
});
```

Custom mapping for non-standard keys:

```typescript
useQuery({
  key: ["dashboard-contact", id],
  query: () => fetchContact(id),
  redirect: { entityType: "contact" },
});
```

Custom ID extraction:

```typescript
useQuery({
  key: ["user-profile", "settings", userId],
  query: () => fetchProfile(userId),
  redirect: {
    entityType: "user",
    getId: (key) => String(key[2]),
  },
});
```

## Manual (useCachedEntity)

For full control, use `useCachedEntity` directly as `placeholderData`:

```typescript
import { useCachedEntity } from "pinia-colada-plugin-normalizer";

const { data, isPlaceholderData } = useQuery({
  key: ["contact", id],
  query: () => fetchContact(id),
  placeholderData: useCachedEntity("contact", () => id.value),
});
```

`useCachedEntity` returns a getter function that:
1. Checks if the entity exists in the store
2. If it does, denormalizes it (resolving nested EntityRefs) and returns it
3. If not, returns `undefined` (no placeholder)

This is what `autoRedirect` uses internally. Use it directly when:
- Your query key doesn't follow the 2-segment convention
- You need a different entity type than what the key implies
- You want cache redirects on specific queries without enabling `autoRedirect` globally

## Handling Partial Data

Placeholder data is often **partial**. A list query may return `{ contactId, name }` but the detail page renders `email`, `phone`, etc. Those fields will be `undefined` until the real fetch completes.

Guard partial fields in your template:

```vue
<template>
  <h1>{{ data?.name }}</h1>

  <!-- Only show fields that may be missing from list data -->
  <div v-if="!isPlaceholderData">
    <p>{{ data?.email }}</p>
    <p>{{ data?.phone }}</p>
  </div>
  <div v-else>
    <Skeleton />
  </div>
</template>
```

Or use optional chaining to gracefully handle missing fields:

```vue
<p>{{ data?.email ?? 'Loading...' }}</p>
```

## How It Works Internally

When `autoRedirect` is enabled, the plugin checks during the `extend` hook (when a query entry is created):

1. Is the query in `pending` status? (First load, no data yet)
2. Does `redirect` !== `false`? (Not explicitly disabled)
3. Does the query key match the 2-segment convention (or have an explicit `redirect` config)?
4. Does the entity exist in the store?

If all conditions are met, the entity data is denormalized and injected as `placeholderData` on the entry. Pinia Colada then serves this to the component while the real query runs.
