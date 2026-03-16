# Real-Time Patterns

The normalizer provides composables for WebSocket integration, optimistic updates, batch fetching, and direct entity access.

## Entity Store Writes

Write directly to the entity store — changes propagate to all queries referencing that entity via Vue reactivity. No invalidation needed.

```typescript
import { useEntityStore } from "pinia-colada-plugin-normalizer";

const entityStore = useEntityStore();

ws.on("CONTACT_UPDATED", (data) => {
  entityStore.set("contact", data.contactId, data);
});
```

From a mutation response:

```typescript
const { mutate } = useMutation({
  mutation: (data) => api.updateContact(data),
  onSuccess: (response) => {
    entityStore.set("contact", response.contactId, response);
    // All queries referencing this contact update instantly. No refetch.
  },
});
```

## Lifecycle Hooks

Fine-grained entity lifecycle events. Auto-cleaned up when the component scope is disposed.

```typescript
import { onEntityAdded, onEntityUpdated, onEntityRemoved } from "pinia-colada-plugin-normalizer";

onEntityAdded("contact", (event) => {
  toast.success(`${event.data.name} joined!`);
});

onEntityUpdated("contact", (event) => {
  console.log("Updated:", event.id, event.previousData, "->", event.data);
});

onEntityRemoved("contact", (event) => {
  toast.info(`${event.previousData?.name} left`);
});
```

Each hook accepts:
- `entityType` — filter events to a single type
- `callback` — receives an `EntityEvent` with `type`, `entityType`, `id`, `key`, `data`, and `previousData`
- `pinia?` — optional Pinia instance (required outside component context)

Returns an unsubscribe function. If called inside a Vue effect scope, cleanup is automatic via `onScopeDispose`.

## useEntityRef

Reactive ref to a single entity — ideal for WebSocket apps where entities arrive via push:

```typescript
import { useEntityRef } from "pinia-colada-plugin-normalizer";

// Static ID:
const contact = useEntityRef("contact", "42");

// Reactive ID (e.g., from route params):
const contact = useEntityRef("contact", () => route.params.id);

// contact.value is Contact | undefined (typed when EntityRegistry is augmented)
```

`useEntityRef` is NOT retained for GC — entities accessed this way are immune to garbage collection (same as direct `store.get()`).

## Optimistic Updates

Transaction-based with rollback. Handles concurrent mutations correctly.

### Simple (single mutation)

`apply()` creates a one-shot transaction and returns a rollback function:

```typescript
import { useOptimisticUpdate } from "pinia-colada-plugin-normalizer";

const { apply } = useOptimisticUpdate();

const { mutate } = useMutation({
  mutation: (data) => api.updateContact(data),
  onMutate: (data) => apply("contact", data.contactId, data),
  onError: (_err, _vars, rollback) => rollback?.(),
});
```

### Multi-mutation transaction

For mutations that touch multiple entities:

```typescript
const { transaction } = useOptimisticUpdate();

const tx = transaction();
tx.set("contact", "1", { name: "Alicia" });
tx.set("order", "5", { status: "confirmed" });
// On success: tx.commit()
// On failure: tx.rollback() — restores server truth, replays other active transactions
```

Rollback uses a "clear and replay" approach inspired by TanStack DB: server truth is restored, then remaining active transactions are replayed on top. This handles concurrent mutations correctly:

1. Transaction A updates contact:1 name
2. Transaction B updates contact:1 email
3. Transaction A fails -> rollback restores server truth, replays B's email update

## useNormalizeMutation

Auto-extract entities from mutation responses without manual `entityStore.set()` calls:

```typescript
import { useNormalizeMutation } from "pinia-colada-plugin-normalizer";

const normalizeMutation = useNormalizeMutation();

const { mutate } = useMutation({
  mutation: (data) => api.updateContact(data),
  onSuccess: (response) => normalizeMutation(response),
});
```

## Array Operations

Add or remove entities from list queries without refetching:

```typescript
import { updateQueryData, deleteEntity } from "pinia-colada-plugin-normalizer";

// Add to a specific list query:
entityStore.set("contact", "99", newContact);
updateQueryData(["contacts"], (data) => [...(data as any[]), newContact]);

// Remove from ALL queries + entity store (one call):
deleteEntity("contact", "42");
```

`deleteEntity` scans all normalized queries, removes matching entity references from arrays, and removes the entity from the store. It operates on the normalized (raw) state for type-safe matching — EntityRefs carry both `entityType` and `id`, so there are no false positives even when entity types share the same `idField`.

## Coalescing

Batch multiple notifications into a single fetch:

```typescript
import { createCoalescer } from "pinia-colada-plugin-normalizer";

const coalescer = createCoalescer(async (entityKeys) => {
  const entities = await api.fetchEntitiesByIds(entityKeys);
  for (const entity of entities) {
    entityStore.set("contact", entity.id, entity);
  }
}, 100); // 100ms batching window

ws.on("ENTITY_STALE", ({ key }) => coalescer.add(key));
```

Use this when WebSocket events signal "entity X changed" without carrying the full data. Instead of one REST call per event, coalesce them into a single batch fetch.

## Entity Queries and Indexes

Filtered reactive views and O(1) field lookups:

```typescript
import { useEntityQuery, createEntityIndex } from "pinia-colada-plugin-normalizer";

// Filtered view (reactive, updates automatically)
const activeContacts = useEntityQuery("contact", (c) => c.status === "active");

// All contacts (no filter)
const allContacts = useEntityQuery("contact");

// Index for O(1) lookups by field value
const statusIndex = createEntityIndex("contact", "status");
const active = statusIndex.get("active"); // ComputedRef<Contact[]>

// Custom extractor function
const roleIndex = createEntityIndex("contact", (c) => c.department as string);
const engineers = roleIndex.get("engineering");

// Clean up manually (or auto via onScopeDispose)
statusIndex.dispose();
```

## Invalidation

Force a server round-trip for all queries referencing an entity:

```typescript
import { invalidateEntity } from "pinia-colada-plugin-normalizer";

// After removing an entity, refetch all queries that referenced it:
entityStore.remove("contact", "42");
invalidateEntity("contact", "42");
```

Usually not needed in WebSocket apps since entity store updates propagate automatically via reactivity.
