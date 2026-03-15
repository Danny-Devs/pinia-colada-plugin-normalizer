# AGENTS.md — pinia-colada-plugin-normalizer

## What this project is

A normalized entity caching plugin for Pinia Colada (Vue's data-fetching library). Extracts entities from query responses, stores them once in a flat reactive store, and replaces duplicates with references. WebSocket events can write directly to the entity store.

## Architecture

- `src/types.ts` — EntityStore interface (swappable contract), defineEntity, module augmentation
- `src/store.ts` — In-memory EntityStore implementation (ShallowRef per entity, reactive Map)
- `src/plugin.ts` — Pinia Colada plugin (hooks into extend + setEntryState), normalize/denormalize engines, useEntityStore composable
- `src/index.ts` — Public API barrel export

## Key conventions

- Follows Pinia Colada v1.0.0 plugin patterns exactly (see `writing-plugins.md` in pinia-colada repo)
- Uses `scope.run()` for reactive extensions in `extend` handler
- Uses `after()` callback for post-action work (not pre-action args mutation)
- Symbol-based ext keys and EntityRef markers (no string property collisions)
- Module augmentation for type-safe options and extensions
- Opt-in normalization (`autoNormalize: false` by default)

## Testing

```bash
pnpm test        # run tests once
pnpm test:watch  # watch mode
```

43 tests covering normalize/denormalize engine + EntityStore.

## Build

```bash
pnpm build       # outputs to dist/
```

## Important: do NOT

- Auto-normalize by default (false positives with non-entity objects)
- Use string markers for EntityRef (use Symbols)
- Add ext keys outside of `extend` handler
- Deep merge entities (whole-entity replacement only)
