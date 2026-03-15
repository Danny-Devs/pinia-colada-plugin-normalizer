# Getting Started

Normalized entity caching plugin for [Pinia Colada](https://github.com/posva/pinia-colada). Store each entity once — update it in one place and every query sees the change. No more stale data from missed cache invalidations.

> [Live Playground](https://pinia-colada-plugin-normalizer.vercel.app)

## Installation

```bash
pnpm add pinia-colada-plugin-normalizer
```

Requires `@pinia/colada` >= 1.0.0, `pinia` >= 2.1.0, `vue` >= 3.3.0.

## Setup

Register the plugin with Pinia Colada:

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

## Basic Usage

Opt in per query with `normalize: true`:

```typescript
const { data } = useQuery({
  key: ["contacts"],
  query: () => fetchContacts(),
  normalize: true,
});
```

Or enable globally with `autoNormalize: true` in the plugin options:

```typescript
PiniaColadaNormalizer({ autoNormalize: true });
```

## The Problem

Pinia Colada stores data per query key. When the same entity appears in multiple queries, it lives as independent copies that can diverge:

```typescript
const { data: contacts } = useQuery({ key: ["contacts"], query: fetchContacts });
const { data: contact } = useQuery({ key: ["contacts", 5], query: () => fetchContact(5) });

// A mutation updates contact 5's name.
// Only one cache entry gets the update. The other is stale.
```

With normalization, contact 5 is stored once. Both queries read from the same entity. One write, all views update.

## Plugin Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `entities` | `Record<string, EntityDefinition>` | `{}` | Entity type configurations |
| `defaultIdField` | `string` | `'id'` | Default ID field for auto-detection |
| `store` | `EntityStore` | in-memory | Custom storage backend |
| `autoNormalize` | `boolean` | `false` | Normalize all queries by default |
