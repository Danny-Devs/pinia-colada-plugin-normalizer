# Persistence

Save your entity cache so it survives page refreshes. On the next visit, entities are restored instantly — no server round-trip needed.

Persistence is **engine-based** (ADR-003): the in-memory store stays the synchronous source of truth for reads, and a swappable `StorageEngine` sits underneath as a write-behind durability substrate. Two engines ship built-in — **IndexedDB** (default, zero setup) and **SQLite over OPFS** (a real database file in the browser) — plus an in-memory engine for tests.

## Setup

```typescript
import { PiniaColadaNormalizer, useEntityStore, enablePersistence } from 'pinia-colada-plugin-normalizer'

// After Pinia + PiniaColada setup...
const entityStore = useEntityStore(pinia)
const { ready } = enablePersistence(entityStore)

// Wait for hydration before mounting (recommended)
await ready
app.mount('#app')
```

That's it. Entities are now persisted to IndexedDB automatically.

## How It Works

```
Page Load                          Normal Usage
───────────                        ────────────
Open IDB database                  Entity changes (set/remove)
  ↓                                  ↓
Read all entities (getAll)         Add to dirty set
  ↓                                  ↓
For each entity:                   Debounce 100ms
  if NOT already in memory           ↓
    → store.set()                  Flush: single IDB transaction
  else                               puts + deletes
    → skip (fresh wins)              ↓
  ↓                                Done (fire-and-forget)
ready resolves
```

**Key behaviors:**

- **Incremental writes** — Only changed entities are written to IDB, not the entire store. One entity change = one IDB put, not a full snapshot.
- **Fresh-wins hydration** — If a query fetches fresh data from the server before IDB finishes loading, the fresh data wins. Stale IDB data is skipped.
- **Debounced batching** — Rapid writes are batched into a single IDB transaction per debounce window (default 100ms).
- **Tab close protection** — Pending writes are flushed on `visibilitychange` and `beforeunload` events.
- **Graceful degradation** — If IDB is unavailable (private browsing, quota exceeded), the store continues working in memory. No crash.

## Options

```typescript
enablePersistence(entityStore, {
  // Storage engine (default: idbEngine({ dbName }) — IndexedDB)
  engine: sqliteEngine({ worker: () => new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' }) }),

  // IndexedDB database name — convenience for the default engine
  // (ignored when `engine` is provided; configure the engine directly)
  dbName: 'my-app-entities',

  // Debounce interval for write batching (default: 100ms)
  writeDebounce: 200,

  // Called when hydration completes
  onReady: () => console.log('Cache restored!'),

  // Called when persistence degrades
  onError: (err) => console.warn('Persistence disabled:', err),
})
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `engine` | `StorageEngine` | `idbEngine({ dbName })` | Durability substrate: `idbEngine`, `sqliteEngine`, `memoryEngine`, or your own |
| `dbName` | `string` | `'pcn_entities'` | Database name for the **default** engine |
| `writeDebounce` | `number` | `100` | Debounce interval (ms) for batching writes |
| `onReady` | `() => void` | — | Called when hydration from IDB completes |
| `onError` | `(error) => void` | — | Called when persistence degrades (quota, private browsing) |

## Return Value

`enablePersistence()` returns a `PersistenceHandle`:

```typescript
const { ready, flush, dispose } = enablePersistence(entityStore)
```

| Property | Type | Description |
| --- | --- | --- |
| `ready` | `Promise<void>` | Resolves when hydration from IDB is complete |
| `flush()` | `Promise<void>` | Force-flush pending writes immediately |
| `dispose()` | `void` | Unsubscribe and clean up (stops persisting) |

## Patterns

### Wait for hydration before rendering

```typescript
const { ready } = enablePersistence(entityStore)
await ready
app.mount('#app')
```

### Mount immediately, hydrate in background

```typescript
const { ready } = enablePersistence(entityStore)
app.mount('#app')
// Store starts empty, Vue reactivity fills in when hydration completes
```

### Clean up on logout

```typescript
const persistence = enablePersistence(entityStore)

function logout() {
  persistence.dispose()
  entityStore.clear()
  indexedDB.deleteDatabase('pcn_entities')
}
```

## Edge Cases

| Scenario | What happens |
| --- | --- |
| **Private browsing** | IDB may be unavailable or have zero quota. `enablePersistence` catches the error, calls `onError`, and the store runs memory-only. |
| **Quota exceeded** | IDB write fails. Persistence is disabled for the rest of the session. `onError` is called. Store continues in memory. |
| **Tab close before flush** | `visibilitychange` + `beforeunload` both attempt to flush pending writes. Neither is 100% reliable on mobile, but together they cover most cases. |
| **SSR** | `typeof indexedDB` check returns the no-op handle immediately. No IDB access on the server. |
| **Another tab upgrades the DB** | The `versionchange` event closes the connection gracefully, disabling persistence for this tab without blocking the other tab. |
| **`store.clear()`** | Emits a `remove` event per entity (since 0.2.0), so the durable copies are cleared too — a full reset in one call. |
| **Cache GC (`store.gc()`)** | Emits `evict` events: entities leave memory but the durable rows **survive** and re-hydrate next session (ADR-004). Only `remove`/`clear` delete durable data. |

## Storage Engines

### `idbEngine(options?)` — default

Raw IndexedDB, zero setup, zero dependencies. What you get when you call `enablePersistence(store)` with no engine.

### `sqliteEngine(options)` — SQLite over OPFS

A real SQLite database file in the browser, persisted on the Origin Private File System via the `opfs-sahpool` VFS (the fastest OPFS option — and it needs **no COOP/COEP headers**, so it works on any hosting). SQLite-WASM must run in a Worker, and **your app creates the worker file** so your bundler can resolve `@sqlite.org/sqlite-wasm` and its `.wasm` asset:

```bash
npm install @sqlite.org/sqlite-wasm   # optional peer dependency
```

```typescript
// src/sqlite.worker.ts — the whole file
import { runSqliteWorker } from 'pinia-colada-plugin-normalizer/sqlite-worker'
runSqliteWorker()
```

```typescript
import { enablePersistence, sqliteEngine } from 'pinia-colada-plugin-normalizer'

const { ready } = enablePersistence(entityStore, {
  engine: sqliteEngine({
    dbName: 'app.sqlite3', // OPFS file name
    worker: () => new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' }),
  }),
})
```

Vite users: add `optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] }` to `vite.config.ts` (per sqlite-wasm's own guidance).

If OPFS is unavailable (insecure context, old browser), the engine falls back to a transient in-memory database and reports it via `engine.persistent === false` plus a dev-mode warning — your app keeps working, just without durability.

Every row carries a `row_version` counter that increments on write — the causality hook that version-aware sync builds on later (ADR-005).

**Serialization note:** `sqliteEngine` stores entities as JSON. Fields must be JSON-serializable — `Date` objects round-trip as ISO strings (unlike `idbEngine`, which structured-clones), and a `BigInt` or circular field fails the whole batch (the error names the offending entity, and persistence degrades gracefully). For engine portability, keep entity fields JSON-safe.

**Peer version note:** every published `@sqlite.org/sqlite-wasm` version is a `-buildN` prerelease, so the plugin declares the peer as `*`; the practical floor is ≥ 3.50 (`opfs-sahpool` maturity).

### `memoryEngine()` — tests & SSR

Implements the contract with all I/O removed. `snapshot()` exposes engine contents for assertions. Also the reference implementation to read before writing a custom engine.

### Write your own

Implement the four-method `StorageEngine` interface (`open`, `loadAll`, `writeBatch`, `close`, plus an `isSupported` guard) and pass it as `engine`. The coordinator handles change detection, debouncing, evict-vs-remove semantics, EntityRef encoding, and graceful degradation — an engine only stores and retrieves opaque rows.

## Zero Dependencies

The default persistence path uses the raw IndexedDB API — no `idb`, no Dexie, no runtime dependencies added. The SQLite engine's `@sqlite.org/sqlite-wasm` is an **optional** peer dependency: apps that never use `sqliteEngine` never install or ship it.
