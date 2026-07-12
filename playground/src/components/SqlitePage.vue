<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from "vue";
import {
  useEntityStore,
  enablePersistence,
  sqliteEngine,
  type PersistenceHandle,
  type SqliteEngine,
} from "pinia-colada-plugin-normalizer";

// A dedicated store namespace for this demo: notes live under the same
// entity store as the rest of the playground, but persist through SQLite
// (separate OPFS file — independent from the IDB demo).
const store = useEntityStore();

const engine = ref<SqliteEngine | null>(null);
const handle = ref<PersistenceHandle | null>(null);
const status = ref<"booting" | "ready" | "degraded">("booting");
const bootMs = ref<number | null>(null);
const text = ref("");

// getByType is the REACTIVE view (getEntriesByType is a one-shot snapshot
// and would never recompute after hydration).
const notes = store.getByType("sqlite_note");
const noteEntries = computed(() =>
  notes.value.slice().sort((a, b) => Number(b.id) - Number(a.id)),
);

onMounted(async () => {
  const eng = sqliteEngine({
    dbName: "playground_notes.sqlite3",
    worker: () => new Worker(new URL("../sqlite.worker.ts", import.meta.url), { type: "module" }),
  });
  engine.value = eng;

  const t0 = performance.now();
  const h = enablePersistence(store, {
    engine: eng,
    writeDebounce: 50,
    onError: () => (status.value = "degraded"),
  });
  handle.value = h;
  await h.ready;
  bootMs.value = Math.round(performance.now() - t0);
  if (status.value !== "degraded") status.value = "ready";
});

onUnmounted(() => {
  // Flush and release the worker when navigating away from the page.
  handle.value?.flush().finally(() => handle.value?.dispose());
});

function addNote() {
  const body = text.value.trim();
  if (!body) return;
  const id = String(Date.now());
  store.set("sqlite_note", id, { id, body, createdAt: new Date().toLocaleTimeString() });
  text.value = "";
}

function deleteNote(id: string) {
  store.remove("sqlite_note", id); // semantic delete → SQLite row deleted
}

function evictAllFromMemory() {
  // Cache trimming: entities leave memory, SQLite rows survive (ADR-004).
  // Reload the page (or re-open) to watch them re-hydrate.
  for (const { id } of store.getEntriesByType("sqlite_note")) {
    store.evict("sqlite_note", id);
  }
}
</script>

<template>
  <div class="sqlite-page">
    <section class="panel">
      <h2>SQLite over OPFS — a database in your browser</h2>
      <p class="lede">
        Notes below are written through the entity store into
        <strong>SQLite-WASM</strong> persisted on the
        <strong>Origin Private File System</strong> (<code>opfs-sahpool</code> VFS, dedicated
        worker). Add a few, <strong>kill the tab</strong>, come back — they're still here.
      </p>

      <div class="status-row">
        <span :class="['badge', status]">
          {{
            status === "booting"
              ? "booting…"
              : status === "degraded"
                ? "engine degraded (memory-only)"
                : engine?.persistent
                  ? `OPFS ✓ durable${bootMs != null ? ` — hydrated in ${bootMs}ms` : ""}`
                  : "OPFS unavailable — transient in-memory DB"
          }}
        </span>
        <span class="badge neutral">{{ notes.length }} notes in memory</span>
      </div>

      <form class="note-form" @submit.prevent="addNote">
        <input v-model="text" placeholder="Write a note, then kill the tab…" />
        <button type="submit" :disabled="status === 'booting'">Add</button>
      </form>

      <ul class="notes">
        <li v-for="note in noteEntries" :key="String(note.id)">
          <span class="note-body">{{ note.body }}</span>
          <span class="note-time">{{ note.createdAt }}</span>
          <button class="danger" title="Semantic delete — removes the SQLite row too" @click="deleteNote(String(note.id))">
            delete
          </button>
        </li>
      </ul>

      <div class="actions">
        <button @click="evictAllFromMemory" title="Drops notes from memory only — SQLite keeps them. Reload to re-hydrate.">
          Evict all from memory (rows survive)
        </button>
      </div>

      <p class="hint">
        <strong>delete</strong> emits a <code>remove</code> event → the SQLite row is deleted.
        <strong>Evict</strong> emits <code>evict</code> → memory drops it, the row survives and
        re-hydrates on reload. That distinction (ADR-004) is what makes cache trimming safe once a
        sync engine replicates deletions.
      </p>
    </section>
  </div>
</template>

<style scoped>
.sqlite-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 1.5rem;
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.lede {
  color: var(--text-secondary, #666);
  line-height: 1.5;
}
.status-row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.badge {
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.8rem;
  border: 1px solid currentColor;
}
.badge.ready {
  color: #0a7d38;
}
.badge.booting {
  color: #9a6700;
}
.badge.degraded {
  color: #c0392b;
}
.badge.neutral {
  color: var(--text-secondary, #666);
}
.note-form {
  display: flex;
  gap: 0.5rem;
}
.note-form input {
  flex: 1;
  padding: 0.5rem 0.75rem;
}
.notes {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.notes li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border, #ddd);
  border-radius: 6px;
}
.note-body {
  flex: 1;
}
.note-time {
  font-size: 0.75rem;
  color: var(--text-secondary, #888);
}
button.danger {
  color: #c0392b;
}
.hint {
  font-size: 0.85rem;
  color: var(--text-secondary, #777);
  line-height: 1.5;
}
</style>
