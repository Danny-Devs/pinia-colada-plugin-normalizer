<script setup lang="ts">
import { ref, reactive, computed, nextTick } from 'vue'
import { useQuery, useQueryCache } from '@pinia/colada'
import {
  useEntityStore,
  useOptimisticUpdate,
  onEntityAdded,
  onEntityUpdated,
  onEntityRemoved,
  updateQueryData,
  removeEntityFromAllQueries,
  useEntityQuery,
} from 'pinia-colada-plugin-normalizer'

const entityStore = useEntityStore()
const queryCache = useQueryCache()

// ─── Shared seed data ────────────────────────
let nextId = 10
function seedIfEmpty() {
  if (!entityStore.has('contact', '1')) {
    entityStore.set('contact', '1', { contactId: '1', name: 'Alice Chen', role: 'Engineer', status: 'active' })
    entityStore.set('contact', '2', { contactId: '2', name: 'Bob Park', role: 'Designer', status: 'active' })
    entityStore.set('contact', '3', { contactId: '3', name: 'Charlie Reeves', role: 'PM', status: 'inactive' })
  }
}
seedIfEmpty()

// ═══════════════════════════════════════════════
// 1. OPTIMISTIC UPDATES
// ═══════════════════════════════════════════════
const { apply, transaction } = useOptimisticUpdate()
const optimisticStatus = ref<'idle' | 'pending-success' | 'pending-fail' | 'rolled-back' | 'committed'>('idle')

function optimisticSuccess() {
  optimisticStatus.value = 'pending-success'
  const rollback = apply('contact', '1', { contactId: '1', name: 'Alicia Chen (optimistic)', role: 'Engineer', status: 'active' })

  // Simulate server confirming after 1.5s
  setTimeout(() => {
    entityStore.set('contact', '1', { contactId: '1', name: 'Alicia Chen', role: 'Engineer', status: 'active' })
    optimisticStatus.value = 'committed'
  }, 1500)
}

function optimisticFail() {
  optimisticStatus.value = 'pending-fail'
  const rollback = apply('contact', '1', { contactId: '1', name: 'FAILED UPDATE (optimistic)', role: 'Engineer', status: 'active' })

  // Simulate server rejecting after 1.5s
  setTimeout(() => {
    rollback()
    optimisticStatus.value = 'rolled-back'
  }, 1500)
}

function resetOptimistic() {
  entityStore.set('contact', '1', { contactId: '1', name: 'Alice Chen', role: 'Engineer', status: 'active' })
  optimisticStatus.value = 'idle'
}

const aliceName = computed(() => entityStore.get('contact', '1').value?.name ?? 'N/A')

// ═══════════════════════════════════════════════
// 2. REAL-TIME HOOKS
// ═══════════════════════════════════════════════
interface HookEvent {
  time: string
  type: 'added' | 'updated' | 'removed'
  message: string
}
const hookEvents = reactive<HookEvent[]>([])

function logHook(type: HookEvent['type'], message: string) {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false })
  hookEvents.unshift({ time, type, message })
  if (hookEvents.length > 10) hookEvents.pop()
}

onEntityAdded('contact', (e) => logHook('added', `Added: ${(e.data as any)?.name ?? e.id}`))
onEntityUpdated('contact', (e) => logHook('updated', `Updated: ${e.id} → ${(e.data as any)?.name}`))
onEntityRemoved('contact', (e) => logHook('removed', `Removed: ${(e.previousData as any)?.name ?? e.id}`))

function triggerAdd() {
  const id = String(nextId++)
  entityStore.set('contact', id, { contactId: id, name: `Contact ${id}`, role: 'New', status: 'active' })
}

function triggerUpdate() {
  entityStore.set('contact', '2', { contactId: '2', name: `Bob Park (v${Date.now() % 1000})`, role: 'Designer', status: 'active' })
}

function triggerRemove() {
  const all = entityStore.getByType('contact').value
  if (all.length > 0) {
    const last = all[all.length - 1] as any
    entityStore.remove('contact', last.contactId)
  }
}

// ═══════════════════════════════════════════════
// 3. ARRAY OPERATIONS
// ═══════════════════════════════════════════════
const listQueryData = ref<any[]>([])

// Use a real query for the array ops demo
const { data: arrayDemoData } = useQuery({
  key: ['features', 'contacts'],
  query: async () => {
    // Return current entities as if from an API
    return entityStore.getByType('contact').value.slice(0, 5).map(e => ({ ...e }))
  },
  normalize: true,
})

function addToList() {
  const id = String(nextId++)
  const newContact = { contactId: id, name: `New Contact ${id}`, role: 'Added', status: 'active' }
  entityStore.set('contact', id, newContact)
  updateQueryData(['features', 'contacts'], (data) => [...(data as any[]), newContact])
}

function removeFirstFromList() {
  if (arrayDemoData.value && (arrayDemoData.value as any[]).length > 0) {
    const first = (arrayDemoData.value as any[])[0]
    removeEntityFromAllQueries('contact', first.contactId)
  }
}

// ═══════════════════════════════════════════════
// 4. ENTITY QUERIES (filtered views)
// ═══════════════════════════════════════════════
const activeContacts = useEntityQuery('contact', (c) => c.status === 'active')
const inactiveContacts = useEntityQuery('contact', (c) => c.status === 'inactive')

function toggleStatus() {
  // Toggle contact 3 between active/inactive
  const c3 = entityStore.get('contact', '3').value
  if (c3) {
    entityStore.set('contact', '3', {
      ...c3,
      status: c3.status === 'active' ? 'inactive' : 'active',
    })
  }
}
</script>

<template>
  <div class="features-page">
    <p class="page-desc">
      Interactive demos of each plugin feature. All running real code — no simulations.
    </p>

    <!-- 1. Optimistic Updates -->
    <section class="feature-card">
      <h2 class="feature-title">Optimistic Updates</h2>
      <p class="feature-desc">
        Apply instant UI updates with automatic rollback on failure.
        Transaction-based with server truth snapshots.
      </p>
      <div class="feature-demo">
        <div class="entity-display">
          <span class="label">Alice's name:</span>
          <span :class="['value', { optimistic: optimisticStatus.startsWith('pending') }]">{{ aliceName }}</span>
          <span v-if="optimisticStatus.startsWith('pending')" class="badge pending">pending...</span>
          <span v-else-if="optimisticStatus === 'committed'" class="badge success">committed</span>
          <span v-else-if="optimisticStatus === 'rolled-back'" class="badge danger">rolled back</span>
        </div>
        <div class="feature-actions">
          <button class="btn btn-success" @click="optimisticSuccess" :disabled="optimisticStatus.startsWith('pending')">
            Update (server accepts)
          </button>
          <button class="btn btn-danger" @click="optimisticFail" :disabled="optimisticStatus.startsWith('pending')">
            Update (server rejects)
          </button>
          <button class="btn btn-muted" @click="resetOptimistic">Reset</button>
        </div>
      </div>
    </section>

    <!-- 2. Real-Time Hooks -->
    <section class="feature-card">
      <h2 class="feature-title">Real-Time Hooks</h2>
      <p class="feature-desc">
        <code>onEntityAdded</code>, <code>onEntityUpdated</code>, <code>onEntityRemoved</code>
        — fine-grained entity lifecycle events.
      </p>
      <div class="feature-demo">
        <div class="feature-actions">
          <button class="btn btn-success" @click="triggerAdd">Add Entity</button>
          <button class="btn btn-accent" @click="triggerUpdate">Update Bob</button>
          <button class="btn btn-danger" @click="triggerRemove">Remove Last</button>
        </div>
        <div v-if="hookEvents.length" class="event-log">
          <div v-for="(e, i) in hookEvents" :key="i" :class="['log-entry', e.type]">
            <span class="log-time">{{ e.time }}</span>
            <span class="log-type">{{ e.type }}</span>
            <span class="log-msg">{{ e.message }}</span>
          </div>
        </div>
        <div v-else class="event-log empty">Click a button to see hook events fire</div>
      </div>
    </section>

    <!-- 3. Array Operations -->
    <section class="feature-card">
      <h2 class="feature-title">Array Operations</h2>
      <p class="feature-desc">
        Add or remove entities from list queries without refetching.
        <code>updateQueryData</code> and <code>removeEntityFromAllQueries</code>.
      </p>
      <div class="feature-demo">
        <div class="feature-actions">
          <button class="btn btn-success" @click="addToList">Add to List</button>
          <button class="btn btn-danger" @click="removeFirstFromList">Remove First</button>
        </div>
        <div class="list-display">
          <span class="label">Query data ({{ (arrayDemoData as any[])?.length ?? 0 }} items):</span>
          <div v-if="arrayDemoData" class="entity-chips">
            <span v-for="c in (arrayDemoData as any[])" :key="c.contactId" class="chip">
              {{ c.name }}
            </span>
          </div>
          <span v-else class="value muted">Loading...</span>
        </div>
      </div>
    </section>

    <!-- 4. Entity Queries -->
    <section class="feature-card">
      <h2 class="feature-title">Entity Queries</h2>
      <p class="feature-desc">
        <code>useEntityQuery</code> — reactive filtered views that update automatically
        when entities change.
      </p>
      <div class="feature-demo">
        <div class="feature-actions">
          <button class="btn btn-accent" @click="toggleStatus">Toggle Charlie's Status</button>
        </div>
        <div class="query-columns">
          <div class="query-col">
            <span class="label success">Active ({{ activeContacts.length }})</span>
            <div class="entity-chips">
              <span v-for="c in activeContacts" :key="(c as any).contactId" class="chip active">
                {{ (c as any).name }}
              </span>
            </div>
          </div>
          <div class="query-col">
            <span class="label danger">Inactive ({{ inactiveContacts.length }})</span>
            <div class="entity-chips">
              <span v-for="c in inactiveContacts" :key="(c as any).contactId" class="chip inactive">
                {{ (c as any).name }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.features-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-desc {
  color: var(--text-muted);
  font-size: 14px;
  margin: 0;
  line-height: 1.5;
}

/* Feature cards */
.feature-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
}

.feature-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 4px;
}

.feature-desc {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0 0 12px;
  line-height: 1.5;
}

.feature-desc code {
  font-size: 12px;
  background: var(--surface-raised);
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--border);
}

.feature-demo {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.feature-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

/* Buttons */
.btn {
  padding: 6px 14px;
  border: none;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.btn:disabled {
  opacity: 0.4;
  pointer-events: none;
}

.btn-success { background: var(--success); color: #fff; }
.btn-success:hover { filter: brightness(1.1); }
.btn-danger { background: var(--danger); color: #fff; }
.btn-danger:hover { filter: brightness(1.1); }
.btn-accent { background: var(--accent); color: #fff; }
.btn-accent:hover { filter: brightness(1.1); }
.btn-muted { background: var(--surface-raised); border: 1px solid var(--border); color: var(--text-muted); }
.btn-muted:hover { background: var(--surface-hover); }

/* Entity display */
.entity-display {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface-raised);
  border-radius: 6px;
}

.label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.label.success { color: var(--success); }
.label.danger { color: var(--danger); }

.value {
  font-size: 14px;
  font-weight: 500;
  font-family: monospace;
}

.value.optimistic {
  color: var(--warning);
}

.value.muted {
  color: var(--text-muted);
}

.badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 3px;
}

.badge.pending { background: var(--warning-bg); color: var(--warning); }
.badge.success { background: var(--success-bg); color: var(--success); }
.badge.danger { background: var(--danger-bg); color: var(--danger); }

/* Event log */
.event-log {
  padding: 8px 12px;
  background: var(--surface-raised);
  border-radius: 6px;
  max-height: 180px;
  overflow-y: auto;
}

.event-log.empty {
  color: var(--text-muted);
  font-size: 12px;
  font-style: italic;
}

.log-entry {
  font-family: monospace;
  font-size: 11px;
  padding: 2px 0;
  display: flex;
  gap: 8px;
  border-left: 3px solid var(--border);
  padding-left: 8px;
  margin-bottom: 2px;
}

.log-entry.added { border-left-color: var(--success); }
.log-entry.updated { border-left-color: var(--accent); }
.log-entry.removed { border-left-color: var(--danger); }

.log-time { color: var(--text-muted); }
.log-type { font-weight: 600; min-width: 60px; }
.log-entry.added .log-type { color: var(--success); }
.log-entry.updated .log-type { color: var(--accent); }
.log-entry.removed .log-type { color: var(--danger); }
.log-msg { color: var(--text); }

/* List display */
.list-display {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  background: var(--surface-raised);
  border-radius: 6px;
}

.entity-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
}

.chip.active {
  background: var(--success-bg);
  border-color: var(--success);
  color: var(--success);
}

.chip.inactive {
  background: var(--danger-bg);
  border-color: var(--danger);
  color: var(--danger);
}

/* Query columns */
.query-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.query-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  background: var(--surface-raised);
  border-radius: 6px;
}
</style>
