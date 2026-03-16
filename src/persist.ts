/**
 * IndexedDB persistence for the entity store.
 *
 * Saves entities to IndexedDB incrementally (only changed entities per flush)
 * and restores them on the next page load. Uses the existing EntityStore
 * subscribe mechanism for change detection.
 *
 * Zero runtime dependencies — uses raw IndexedDB API.
 * Gracefully degrades if IDB is unavailable (private browsing, SSR, quota).
 *
 * @module pinia-colada-plugin-normalizer
 */

import type { EntityStore, EntityRecord } from "./types";
import { encodeEntityRefs, decodeEntityRefs } from "./store";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface PersistenceOptions {
  /** IndexedDB database name. @default 'pcn_entities' */
  dbName?: string;
  /** Debounce interval (ms) for batching writes. @default 100 */
  writeDebounce?: number;
  /** Called when hydration from IDB completes. */
  onReady?: () => void;
  /** Called when persistence degrades (quota exceeded, IDB unavailable). */
  onError?: (error: unknown) => void;
}

export interface PersistenceHandle {
  /** Resolves when hydration from IDB is complete. */
  ready: Promise<void>;
  /** Force-flush pending writes to IDB immediately. */
  flush(): Promise<void>;
  /** Unsubscribe from store changes and remove event listeners. */
  dispose(): void;
}

// ─────────────────────────────────────────────
// IDB Helpers (raw API, no dependencies)
// ─────────────────────────────────────────────

const STORE_NAME = "entities";

function openDatabase(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // If another tab holds a connection and we need to upgrade, open hangs
    // indefinitely without this handler. Reject so the ready promise settles.
    request.onblocked = () => reject(new Error("IDB open blocked by another connection"));
  });
}

function idbGetAll(db: IDBDatabase): Promise<{ keys: IDBValidKey[]; values: unknown[] }> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => resolve({ keys: keysReq.result, values: valsReq.result });
    tx.onerror = () => reject(tx.error);
  });
}

function idbWriteBatch(
  db: IDBDatabase,
  puts: Array<{ key: string; value: unknown }>,
  deletes: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const { key, value } of puts) {
      store.put(value, key);
    }
    for (const key of deletes) {
      store.delete(key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─────────────────────────────────────────────
// enablePersistence
// ─────────────────────────────────────────────

/**
 * Enable IndexedDB persistence for an entity store.
 *
 * On startup, hydrates the store from IDB (fresh-wins: skips entities
 * already in memory). Subscribes to store changes and writes back
 * to IDB incrementally — only changed entities are flushed, in a single
 * IDB transaction per debounce window.
 *
 * Gracefully degrades if IDB is unavailable (private browsing, quota
 * exceeded, SSR). The in-memory store continues to work normally.
 *
 * **Note:** `store.clear()` does not emit subscribe events, so it won't
 * clear IDB. To fully reset persisted state, call `dispose()` and delete
 * the IDB database via `indexedDB.deleteDatabase(dbName)`.
 *
 * @example
 * ```typescript
 * import { useEntityStore, enablePersistence } from 'pinia-colada-plugin-normalizer'
 *
 * const entityStore = useEntityStore()
 * const { ready } = enablePersistence(entityStore)
 * await ready // entities from last session are restored
 * ```
 */
export function enablePersistence(
  store: EntityStore,
  options: PersistenceOptions = {},
): PersistenceHandle {
  const {
    dbName = "pcn_entities",
    writeDebounce = 100,
    onReady,
    onError,
  } = options;

  // ── State ──────────────────────────────────
  const dirtySaves = new Map<string, unknown>(); // key → encoded data
  const dirtyDeletes = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let db: IDBDatabase | null = null;
  let disabled = false;
  let isHydrating = false;
  let disposed = false;
  let flushing = false;

  // ── SSR guard ──────────────────────────────
  if (typeof indexedDB === "undefined") {
    return {
      ready: Promise.resolve(),
      flush: () => Promise.resolve(),
      dispose: () => {},
    };
  }

  // ── Subscribe to store changes ─────────────
  // IMPORTANT: store.subscribe fires synchronously within store.set().
  // The isHydrating guard relies on this — if subscribe were async/batched,
  // hydration would trigger a write-storm (re-persisting loaded entities).
  const unsub = store.subscribe((event) => {
    if (isHydrating || disabled || disposed) return;

    const key = event.key;
    if (event.type === "set" && event.data != null) {
      dirtySaves.set(key, encodeEntityRefs(event.data));
      dirtyDeletes.delete(key);
    } else if (event.type === "remove") {
      dirtyDeletes.add(key);
      dirtySaves.delete(key);
    }
    scheduleFlush();
  });

  // ── Flush logic ────────────────────────────
  function scheduleFlush(): void {
    if (flushTimer || disabled || disposed) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, writeDebounce);
  }

  async function flush(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!db || disabled || disposed || flushing) return;
    if (dirtySaves.size === 0 && dirtyDeletes.size === 0) return;

    flushing = true;
    const puts = Array.from(dirtySaves.entries()).map(([key, value]) => ({ key, value }));
    const deletes = Array.from(dirtyDeletes);
    dirtySaves.clear();
    dirtyDeletes.clear();

    try {
      await idbWriteBatch(db, puts, deletes);
    } catch (err) {
      disabled = true;
      onError?.(err);
      if (process.env.NODE_ENV !== "production") {
        console.warn("[pcn-persist] Write failed, persistence disabled:", err);
      }
    } finally {
      flushing = false;
      // If new writes arrived during the flush, schedule another
      if (dirtySaves.size > 0 || dirtyDeletes.size > 0) {
        scheduleFlush();
      }
    }
  }

  // ── Hydration ──────────────────────────────
  const ready = openDatabase(dbName)
    .then(async (database) => {
      if (disposed) { database.close(); return; }
      db = database;

      // If another tab opens this DB with a higher version, close gracefully
      // to unblock the other tab's upgrade. Persistence is disabled for this tab.
      db.onversionchange = () => {
        db?.close();
        db = null;
        disabled = true;
      };

      isHydrating = true;
      try {
        const { keys, values } = await idbGetAll(db);
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i] as string;
          const separatorIndex = key.indexOf(":");
          if (separatorIndex === -1) continue;

          const entityType = key.slice(0, separatorIndex);
          const id = key.slice(separatorIndex + 1);

          // Fresh-wins: skip entities already in memory (e.g., from a server fetch
          // that completed before IDB finished loading)
          if (!store.has(entityType, id)) {
            store.set(entityType, id, decodeEntityRefs(values[i]) as EntityRecord);
          }
        }
      } finally {
        isHydrating = false;
      }

      onReady?.();
    })
    .catch((err) => {
      disabled = true;
      onError?.(err);
      if (process.env.NODE_ENV !== "production") {
        console.warn("[pcn-persist] IDB unavailable, running memory-only:", err);
      }
    });

  // ── Lifecycle hooks ────────────────────────
  // Flush on tab hide (mobile) and before unload (desktop close).
  // Neither is 100% reliable, but together they cover most cases.
  function onVisibilityChange(): void {
    if (document.visibilityState === "hidden") flush();
  }
  function onBeforeUnload(): void {
    flush();
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", onBeforeUnload);
  }

  // ── Public handle ──────────────────────────
  function dispose(): void {
    disposed = true;
    unsub();
    if (flushTimer) clearTimeout(flushTimer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", onBeforeUnload);
    }
    db?.close();
  }

  return { ready, flush, dispose };
}
