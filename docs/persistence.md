# Persistence

Save your entity cache to IndexedDB so it survives page refreshes. On the next visit, entities are restored instantly — no server round-trip needed.

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
  // IndexedDB database name (default: 'pcn_entities')
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
| `dbName` | `string` | `'pcn_entities'` | IndexedDB database name |
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
| **`store.clear()`** | Does not emit subscribe events, so IDB is not cleared. Use `dispose()` + `indexedDB.deleteDatabase()` for a full reset. |

## Zero Dependencies

The persistence layer uses the raw IndexedDB API — no `idb`, no Dexie, no runtime dependencies added. The entire implementation is ~150 lines.
