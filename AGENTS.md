# AGENTS.md — pinia-colada-plugin-normalizer

## What this project is

A normalized entity caching plugin for Pinia Colada (Vue's data-fetching library). Extracts entities from query responses, stores them once in a flat reactive store, and replaces duplicates with references. WebSocket events can write directly to the entity store.

## Architecture

- `src/types.ts` — EntityStore interface (swappable contract), defineEntity, module augmentation
- `src/store.ts` — In-memory EntityStore implementation (ShallowRef per entity, reactive Map, GC via retain/release)
- `src/plugin.ts` — Pinia Colada plugin (customRef replacement of `entry.state`), normalize/denormalize engines, useEntityStore composable (SSR-safe via defineStore)
- `src/composables.ts` — Real-time composables (WS hooks, optimistic updates, coalescer, entity queries, indexes)
- `src/persist.ts` — IndexedDB persistence (dirty-set tracking, debounced batch writes, fresh-wins hydration)
- `src/pagination.ts` — Pagination helpers (cursor, offset) for useInfiniteQuery merge recipes
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

157 tests across 6 test files covering:

- Normalize/denormalize engine (24 tests)
- EntityStore + GC (38 tests)
- Plugin integration + composables (59 tests)
- Composables standalone (11 tests)
- Persistence — IDB round-trip, fresh-wins, hydration flag, batching (11 tests)
- Pagination helpers (15 tests)

## Build

```bash
pnpm build       # outputs to dist/
```

## Competitive context

Positioning: **Apollo-style normalization with zero configuration and Vue-native performance.**

Key competitors analyzed (deep code-level comparison in `RESEARCH.md`):

- **normy** — pure normalize/denormalize engine, no reactivity, `@@key` string refs (fragile)
- **TanStack DB** — client-side reactive database, not a normalizer. Overkill for most apps.
- **Apollo InMemoryCache** — GraphQL-coupled, per-field dependency tracking, ~5,000+ LOC

Our core differentiators: transparent customRef integration, Vue-native reactivity, ~3,500 LOC / 0 deps, swappable EntityStore interface, IndexedDB persistence, zero-config for standard APIs.

Resolved gaps (March 2026):

- Per-entity denorm cache invalidation (was: clears ALL on ANY change)
- Entity GC via retain/release/gc (was: entities live forever)
- Custom merge policies via `defineEntity({ merge })` (was: shallow merge only)
- Equality check before merge + reference short-circuit (perf)

All competitive gaps from March 2026 analysis have been addressed.
See `SPEC.md` § "Competitive Gaps" for the full resolved list.

Anti-patterns to avoid (from competitors):

- Apollo's complexity spiral (don't chase features at cost of simplicity)
- Normy's `@@` string prefix (our Symbol approach is superior)
- TanStack DB's monolithic state manager (keep optimistic updates as composable layer)

## Important: do NOT

- Auto-normalize by default (false positives with non-entity objects)
- Use string markers for EntityRef (use Symbols)
- Add ext keys outside of `extend` handler
- Deep merge entities (shallow merge only — `{ ...existing, ...incoming }`)
- Use module-level singletons for state (breaks SSR)
- Write to `entry.state.value` in `after()` callbacks (bypasses action system)
- Build another plugin that replaces `entry.state` — only one plugin can own it (we do)
- Chase Apollo's feature set at the cost of bundle size/simplicity
- Embed optimistic update logic into the entity store (keep it as a composable layer)
