<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEntityStore } from 'pinia-colada-plugin-normalizer'
import { useQueryCache } from '@pinia/colada'

const props = defineProps<{ normalized: boolean }>()

const open = ref(true)
const entityStore = useEntityStore()
const queryCache = useQueryCache()
const flashKey = ref<string | null>(null)

// Reactive version counter — incremented on every entity store change
// so the computed snapshot re-evaluates. toJSON() reads raw Maps which
// aren't tracked by Vue, so we need this manual trigger.
const storeVersion = ref(0)

// Entity store snapshot
const storeSnapshot = computed(() => {
  void storeVersion.value // track changes
  return entityStore.toJSON()
})

// Query cache snapshot — filtered to show only current mode's queries
// In normalized mode, show the REFERENCE structure (what's actually stored),
// not the denormalized view (which is what components see via the customRef getter).
const cacheSnapshot = computed(() => {
  const entries = queryCache.getEntries()
  const result: Array<{ key: string; data: unknown; isNormalized: boolean }> = []
  for (const entry of entries) {
    const keyStr = entry.keyHash
    const isRawQuery = keyStr.includes('"raw"')
    if (props.normalized && isRawQuery) continue
    if (!props.normalized && !isRawQuery) continue

    const displayKey = keyStr.replace('["raw",', '[').replace(',"raw"', '')

    if (props.normalized) {
      // Show reference structure with projected fields.
      // Detail queries fetch full entity (with email),
      // list queries fetch lightweight (no email).
      const data = entry.state.value.data
      // Detail queries return a single object, list queries return an array
      const isDetailQuery = !Array.isArray(data)
      const refView = buildRefView(data, isDetailQuery)
      result.push({ key: displayKey, data: refView, isNormalized: true })
    } else {
      result.push({ key: displayKey, data: entry.state.value.data, isNormalized: false })
    }
  }
  return result
})

/**
 * Convert denormalized data back to a reference view for display.
 * Shows projected references: which fields this query fetches from the entity.
 */
function buildRefView(data: unknown, isDetailQuery: boolean): unknown {
  if (!data || typeof data !== 'object') return data
  if (Array.isArray(data)) return data.map((item) => buildRefView(item, isDetailQuery))

  const record = data as Record<string, unknown>
  if (record.contactId != null) {
    // Show the projected fields this query actually uses
    const fields = isDetailQuery
      ? '{ name, email, role, status }'
      : '{ name, role, status }'
    return `→ contact:${record.contactId} ${fields}`
  }
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    result[key] = buildRefView(value, isDetailQuery)
  }
  return result
}

// Count duplicated entities across cache blobs (for non-normalized view)
const duplicationInfo = computed(() => {
  const entityAppearances = new Map<string, number>()
  for (const entry of cacheSnapshot.value) {
    countEntities(entry.data, entityAppearances)
  }
  let duplicates = 0
  for (const count of entityAppearances.values()) {
    if (count > 1) duplicates += count - 1
  }
  return { total: entityAppearances.size, duplicates }
})

function countEntities(data: unknown, map: Map<string, number>) {
  if (!data || typeof data !== 'object') return
  if (Array.isArray(data)) {
    data.forEach(item => countEntities(item, map))
    return
  }
  const record = data as Record<string, unknown>
  if (record.contactId) {
    const key = `contact:${record.contactId}`
    map.set(key, (map.get(key) || 0) + 1)
  }
  for (const value of Object.values(record)) {
    if (typeof value === 'object' && value) countEntities(value, map)
  }
}

// Single subscription for both version tracking and flash animation
entityStore.subscribe((event) => {
  storeVersion.value++
  flashKey.value = event.key
  setTimeout(() => { flashKey.value = null }, 600)
})

function formatData(data: unknown): string {
  return JSON.stringify(data, (key, value) => {
    if (typeof value === 'symbol') return '[Symbol]'
    return value
  }, 2)
}

</script>

<template>
  <div class="inspector">
    <button class="toggle" @click="open = !open">
      {{ open ? '▼' : '▶' }} Under the Hood — Data Structures
    </button>

    <div v-if="open" class="content">
      <div class="columns">
        <!-- LEFT: Query Cache -->
        <div class="column">
          <h3>Query Cache <span class="dim">(what Pinia Colada stores)</span></h3>
          <div v-for="entry in cacheSnapshot" :key="entry.key" class="cache-entry">
            <div class="entry-key">{{ entry.key }}</div>
            <pre class="entry-data">{{ formatData(entry.data) }}</pre>
          </div>
          <div v-if="!normalized" class="metric warning">
            {{ duplicationInfo.duplicates }} duplicate {{ duplicationInfo.duplicates === 1 ? 'entity' : 'entities' }} — each query stores its own copy
          </div>
          <div v-else class="metric success">
            → references point to the entity store. Each query derives only the fields it needs — but the entity is stored once.
          </div>
        </div>

        <!-- RIGHT: Entity Store -->
        <div class="column">
          <h3>Entity Store <span class="dim">(flat, normalized)</span></h3>
          <template v-if="normalized">
            <div
              v-for="(entity, key) in storeSnapshot"
              :key="key"
              :class="['store-entry', { flash: flashKey === key }]"
            >
              <span class="entity-key">{{ key }}</span>
              <pre class="entity-data">{{ formatData(entity) }}</pre>
            </div>
            <div class="metric success">
              {{ Object.keys(storeSnapshot).length }} {{ Object.keys(storeSnapshot).length === 1 ? 'entity' : 'entities' }}, each stored once
            </div>
          </template>
          <div v-else class="empty-store">
            <span class="dim">N/A — No entity store when normalization is OFF.</span>
            <span class="dim">Each query stores its own copy of every entity.</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inspector { border-top: 1px solid var(--border); }
.toggle {
  width: 100%;
  padding: 10px 16px;
  background: var(--surface-raised);
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-muted);
  text-align: left;
  font-weight: 500;
}
.toggle:hover { background: var(--surface-hover); }
.content { padding: 0 16px 16px; background: var(--surface-raised); }
.columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.column { min-width: 0; }
h3 { margin: 8px 0; font-size: 13px; color: var(--text); }
.dim { color: var(--text-muted); font-weight: 400; }

.cache-entry, .store-entry {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 6px;
  transition: background 0.3s;
}
.store-entry.flash { background: var(--success-bg); }
.entry-key, .entity-key {
  font-family: monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 4px;
  display: block;
}
.entry-data, .entity-data {
  font-family: monospace;
  font-size: 11px;
  color: var(--text-muted);
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
.metric {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 4px;
  margin-top: 8px;
  font-weight: 500;
}
.metric.success { background: var(--success-bg); color: var(--success); }
.metric.warning { background: var(--danger-bg); color: var(--danger); }
.empty-store {
  padding: 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
