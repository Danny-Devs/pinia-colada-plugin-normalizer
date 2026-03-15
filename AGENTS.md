# AGENTS.md — pinia-colada-plugin-normalizer

## What this project is

A normalized entity caching plugin for Pinia Colada (Vue's data-fetching library). Extracts entities from query responses, stores them once in a flat reactive store, and replaces duplicates with references. WebSocket events can write directly to the entity store.

## Architecture

- `src/types.ts` — EntityStore interface (swappable contract), defineEntity, module augmentation
- `src/store.ts` — In-memory EntityStore implementation (ShallowRef per entity, reactive Map)
- `src/plugin.ts` — Pinia Colada plugin (customRef replacement of `entry.state`), normalize/denormalize engines, useEntityStore composable (SSR-safe via defineStore)
- `src/index.ts` — Public API barrel export

### Core pattern: customRef replacement

The plugin replaces `entry.state` (a `ShallowRef`) with a `customRef` during the `extend` hook:
- **Setter**: normalizes incoming data — extracts entities into the store, saves EntityRefs internally
- **Getter**: denormalizes on read — replaces EntityRefs with live reactive entity data from the store

This follows the delay plugin's pattern (which replaces `entry.asyncStatus` with a `customRef`). Eduardo confirmed this approach for `entry.state` in Discussion #531.

### SSR safety

Entity store is scoped per Pinia instance via `defineStore('_pc_normalizer')`. Each SSR request creates a fresh Pinia → fresh entity store. No module-level singletons.

## Key conventions

- Follows Pinia Colada v1.0.0 plugin patterns exactly (see `writing-plugins.md` in pinia-colada repo)
- Uses `scope.run()` for reactive extensions in `extend` handler
- customRef in `extend` (not `after()` in `setEntryState`) — single action hook, no write-back
- Symbol-based ext keys and EntityRef markers (no string property collisions)
- Module augmentation for type-safe options and extensions
- Opt-in normalization (`autoNormalize: false` by default)
- Recursive denormalization with circular ref protection (WeakSet)

## Testing

```bash
pnpm test        # run tests once
pnpm test:watch  # watch mode
```

43 tests covering normalize/denormalize engine + EntityStore.
Integration tests (actual Pinia Colada round-trip) are TODO.

## Build

```bash
pnpm build       # outputs to dist/
```

## Important: do NOT

- Auto-normalize by default (false positives with non-entity objects)
- Use string markers for EntityRef (use Symbols)
- Add ext keys outside of `extend` handler
- Deep merge entities (whole-entity replacement only)
- Use module-level singletons for state (breaks SSR)
- Write to `entry.state.value` in `after()` callbacks (bypasses action system)
