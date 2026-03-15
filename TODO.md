# pinia-colada-plugin-normalizer — TODO

## NEXT ACTION
- [ ] Scaffold plugin package (tsdown, package.json with `pinia-colada-plugin` keyword, Vitest)
- [ ] Write tests: normalize round-trip, circular refs, entity identification, Symbol markers
- [ ] Prototype read-path denormalization (customRef on `entry.state` vs computed wrapper)
- [ ] Build proof-of-concept demo (contacts list + contact detail, shared entity, WebSocket mock)
- [ ] Post update in Discussion #531 with POC

## Phase 1: Core MVP
- [x] Entity store (in-memory, reactive Map, ShallowRef per entity, batch writes)
- [x] Normalize on write (`after()` callback, Symbol-based EntityRef)
- [x] Denormalize engine (walk + follow refs back to entity store)
- [x] `defineEntity()` config for non-standard APIs
- [x] `useEntityStore()` composable for direct access (WebSocket integration)
- [x] Opt-in per query via `normalize` option (module augmentation)
- [x] Hybrid storage (entities normalized, hierarchies left as-is)
- [x] Circular reference protection (WeakSet visited tracker)
- [x] Symbol-based EntityRef marker (no API data collision)
- [x] Symbol-based ext key (following auto-refetch pattern)
- [x] Module augmentation (UseQueryOptions, UseQueryOptionsGlobal, UseQueryEntryExtensions)
- [x] scope.run() for reactive extensions
- [x] after() pattern for post-action normalization
- [ ] Read-path denormalization (customRef interception — transparent to consumers)
- [ ] Denormalize caching / structural sharing (avoid new objects every read)
- [ ] Tests (Vitest)
- [ ] Package scaffolding (tsdown, package.json)
- [ ] Proof-of-concept demo
- [ ] Post update in Discussion #531

## Phase 2: Real-Time
- [ ] WebSocket adapter hooks (onEntityAdded, onEntityUpdated, onEntityRemoved)
- [ ] Optimistic update primitives (three-layer sync)
- [ ] Coalescing support (WS notification → batch REST refetch)
- [ ] Review Danny's Gallatin three-way sync code for reference

## Phase 3: Performance & DX
- [ ] Helper utilities (selectEntities, filtered views)
- [ ] Manual index support (createIndex)
- [ ] Devtools integration
- [ ] TypeScript type inference for entity schemas

## Phase 4: Persistence & Scale
- [ ] Cache-persister compatibility strategy
- [ ] IndexedDB + Dexie adapter
- [ ] SQLite + WASM + OPFS adapter
- [ ] SSR hydration/dehydration

## BLOCKED
- [ ] Three-way sync code → Danny needs to grab from work laptop

## DONE
- [x] Research: normalization approaches (normalizr, normy, Apollo, TanStack DB)
- [x] Research: Pinia Colada v1.0.0 internals (query cache, plugin system, ext field, all official plugins)
- [x] Research: plugin writing guide (writing-plugins.md patterns, community plugins page)
- [x] Research: persistence backends (IndexedDB, SQLite WASM, OPFS, cr-sqlite)
- [x] Architecture design with expert council review
- [x] Eduardo endorsement via Discussion #531
- [x] Fork pinia-colada to Danny's GitHub (https://github.com/Danny-Devs/pinia-colada)
- [x] EntityStore TypeScript interface (swappable contract)
- [x] In-memory EntityStore implementation (Level 1 backend)
- [x] Plugin implementation (normalize + denormalize + useEntityStore)
- [x] defineEntity API
- [x] Wave 1 review (13 issues found)
- [x] Wave 2 fixes (10/13 issues fixed, 2 deferred, 1 documented)
- [x] Wave 3 coherence pass (all docs updated to reflect v1.0.0 patterns)
- [x] SPEC.md, RESEARCH.md, TODO.md — fully consistent
