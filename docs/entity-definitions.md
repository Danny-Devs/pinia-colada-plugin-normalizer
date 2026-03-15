# Entity Definitions

Entity definitions tell the normalizer how to identify and manage your entities. For GraphQL APIs with `__typename`, no configuration is needed. For REST APIs, use `defineEntity()`.

## Convention-Based Detection

Objects with a `__typename` field and the default ID field (`id`) are auto-detected:

```typescript
// GraphQL response — auto-detected, no config needed
{
  __typename: "Contact",
  id: "42",
  name: "Alicia"
}
```

Without `__typename`, the normalizer skips auto-detection to prevent ID collisions between unrelated objects (e.g., user `id:1` vs order `id:1`). Use `defineEntity()` for REST APIs.

## defineEntity with idField

For APIs that use a non-standard ID field:

```typescript
import { defineEntity } from "pinia-colada-plugin-normalizer";

PiniaColadaNormalizer({
  entities: {
    contact: defineEntity<Contact>({ idField: "contactId" }),
    order: defineEntity<Order>({ idField: "orderId" }),
  },
});
```

The generic type parameter `<Contact>` provides type safety for callbacks like `getId` and `merge`.

## defineEntity with getId

For composite keys or computed IDs, use `getId`:

```typescript
const membership = defineEntity<Membership>({
  getId: (entity) => {
    if (entity.orgId == null || entity.userId == null) return undefined;
    return `${entity.orgId}-${entity.userId}`;
  },
});
```

`getId` takes precedence over `idField`. Return `null` or `undefined` for objects that are not this entity type.

## Custom Merge Functions

By default, entities are shallow-merged (`{ ...existing, ...incoming }`). Override this for special cases:

```typescript
const thread = defineEntity<Thread>({
  idField: "threadId",
  merge: (existing, incoming) => ({
    ...existing,
    ...incoming,
    replies: [...(existing.replies || []), ...(incoming.replies || [])],
  }),
});
```

Use cases: pagination (array append), deep nested objects, counters.

## EntityRegistry Type Augmentation

For end-to-end type safety, augment the `EntityRegistry` interface:

```typescript
declare module "pinia-colada-plugin-normalizer" {
  interface EntityRegistry {
    contact: Contact;
    order: Order;
  }
}
```

This provides typed results across the entire API:

```typescript
entityStore.get("contact", "1");          // ShallowRef<Contact | undefined>
entityStore.set("contact", "1", data);    // data must match Contact
useEntityQuery("contact", (c) => c.name); // c is Contact
onEntityAdded("contact", (e) => e.data);  // data is Contact | undefined
```

Without the registry, everything defaults to `EntityRecord` (a `Record<string, unknown>`) — fully backwards compatible.

## API Reference

```typescript
defineEntity<T>(config: EntityDefinition<T>): EntityDefinition<T>
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `idField` | `string & keyof T` | `'id'` | Field containing the entity ID |
| `getId` | `(entity: T) => string \| null` | — | Custom ID extraction (for composite keys) |
| `merge` | `(existing: T, incoming: T) => T` | shallow merge | Custom merge strategy |
