<script setup lang="ts">
import { ref, reactive, computed, nextTick } from "vue";
import { useQuery } from "@pinia/colada";
import {
  useEntityStore,
  useOptimisticUpdate,
  onEntityAdded,
  onEntityUpdated,
  onEntityRemoved,
  updateQueryData,
  deleteEntity,
  useEntityQuery,
  useCachedEntity,
} from "pinia-colada-plugin-normalizer";

const entityStore = useEntityStore();

// ═══════════════════════════════════════════════
// 1. OPTIMISTIC UPDATES (prefix: opt-)
// ═══════════════════════════════════════════════
// Seed
entityStore.set("contact", "opt-1", {
  contactId: "opt-1",
  name: "Alice Chen",
  role: "Engineer",
  status: "active",
});

const { apply } = useOptimisticUpdate();
const optimisticStatus = ref<
  "idle" | "pending-success" | "pending-fail" | "rolled-back" | "committed"
>("idle");

function optimisticSuccess() {
  entityStore.replace("contact", "opt-1", {
    contactId: "opt-1",
    name: "Alice Chen",
    role: "Engineer",
    status: "active",
  });
  optimisticStatus.value = "pending-success";
  apply("contact", "opt-1", {
    contactId: "opt-1",
    name: "Alicia Chen",
    role: "Engineer",
    status: "active",
  });

  setTimeout(() => {
    optimisticStatus.value = "committed";
  }, 1500);
}

function optimisticFail() {
  entityStore.replace("contact", "opt-1", {
    contactId: "opt-1",
    name: "Alice Chen",
    role: "Engineer",
    status: "active",
  });
  optimisticStatus.value = "pending-fail";
  const rollback = apply("contact", "opt-1", {
    contactId: "opt-1",
    name: "Alicia Chen",
    role: "Engineer",
    status: "active",
  });

  setTimeout(() => {
    rollback();
    optimisticStatus.value = "rolled-back";
  }, 1500);
}

function resetOptimistic() {
  entityStore.replace("contact", "opt-1", {
    contactId: "opt-1",
    name: "Alice Chen",
    role: "Engineer",
    status: "active",
  });
  optimisticStatus.value = "idle";
}

const aliceName = computed(() => entityStore.get("contact", "opt-1").value?.name ?? "N/A");

// ═══════════════════════════════════════════════
// 2. REAL-TIME HOOKS (prefix: hook-)
// ═══════════════════════════════════════════════
let hookNextId = 1;
entityStore.set("contact", "hook-1", {
  contactId: "hook-1",
  name: "Bob Park",
  role: "Designer",
  status: "active",
});

interface HookEvent {
  time: string;
  type: "added" | "updated" | "removed";
  message: string;
}
const hookEvents = reactive<HookEvent[]>([]);

function logHook(type: HookEvent["type"], message: string) {
  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  hookEvents.unshift({ time, type, message });
  if (hookEvents.length > 10) hookEvents.pop();
}

// Only listen to hook- prefixed entities
onEntityAdded("contact", (e) => {
  if (!e.id.startsWith("hook-")) return;
  logHook("added", `Added: ${(e.data as any)?.name ?? e.id}`);
});
onEntityUpdated("contact", (e) => {
  if (!e.id.startsWith("hook-")) return;
  logHook("updated", `Updated: ${e.id} → ${(e.data as any)?.name}`);
});
onEntityRemoved("contact", (e) => {
  if (!e.id.startsWith("hook-")) return;
  logHook("removed", `Removed: ${(e.previousData as any)?.name ?? e.id}`);
});

function triggerAdd() {
  hookNextId++;
  const id = `hook-${hookNextId}`;
  entityStore.set("contact", id, {
    contactId: id,
    name: `Contact ${hookNextId}`,
    role: "New",
    status: "active",
  });
}

function triggerUpdate() {
  entityStore.set("contact", "hook-1", {
    contactId: "hook-1",
    name: `Bob Park (v${Date.now() % 1000})`,
    role: "Designer",
    status: "active",
  });
}

function triggerRemove() {
  // Find last hook- entity
  const all = entityStore.getByType("contact").value;
  const hookEntities = all.filter((e: any) => e.contactId?.startsWith("hook-"));
  if (hookEntities.length > 0) {
    const last = hookEntities[hookEntities.length - 1] as any;
    entityStore.remove("contact", last.contactId);
  }
}

// ═══════════════════════════════════════════════
// 3. ARRAY OPERATIONS (prefix: arr-)
// ═══════════════════════════════════════════════
let arrNextId = 3;
const arrFetchCount = ref(0);
const arrSeed = [
  { contactId: "arr-1", name: "Dana Kim", role: "Engineer", status: "active" },
  { contactId: "arr-2", name: "Eli Torres", role: "PM", status: "active" },
  { contactId: "arr-3", name: "Fiona Lee", role: "Designer", status: "active" },
];
for (const c of arrSeed) entityStore.set("contact", c.contactId, { ...c });

const { data: arrayDemoData } = useQuery({
  key: ["features", "arr-contacts"],
  query: async () => {
    arrFetchCount.value++;
    return arrSeed.map((c) => ({ ...c }));
  },
  normalize: true,
});

function addToList() {
  arrNextId++;
  const id = `arr-${arrNextId}`;
  const newContact = {
    contactId: id,
    name: `Contact ${arrNextId}`,
    role: "Added",
    status: "active",
  };
  entityStore.set("contact", id, newContact);
  updateQueryData(["features", "arr-contacts"], (data) => [...(data as any[]), newContact]);
}

function removeFirstFromList() {
  if (arrayDemoData.value && (arrayDemoData.value as any[]).length > 0) {
    const first = (arrayDemoData.value as any[])[0];
    deleteEntity("contact", first.contactId);
  }
}

// ═══════════════════════════════════════════════
// 4. ENTITY QUERIES (prefix: eq-)
// ═══════════════════════════════════════════════
entityStore.set("contact", "eq-1", {
  contactId: "eq-1",
  name: "Grace Wu",
  role: "Engineer",
  status: "active",
});
entityStore.set("contact", "eq-2", {
  contactId: "eq-2",
  name: "Henry Zhao",
  role: "Designer",
  status: "active",
});
entityStore.set("contact", "eq-3", {
  contactId: "eq-3",
  name: "Iris Patel",
  role: "PM",
  status: "inactive",
});

const activeContacts = useEntityQuery(
  "contact",
  (c) => (c.contactId as string)?.startsWith("eq-") && c.status === "active",
);
const inactiveContacts = useEntityQuery(
  "contact",
  (c) => (c.contactId as string)?.startsWith("eq-") && c.status === "inactive",
);

function toggleStatus() {
  const iris = entityStore.get("contact", "eq-3").value;
  if (iris) {
    entityStore.set("contact", "eq-3", {
      ...iris,
      status: iris.status === "active" ? "inactive" : "active",
    });
  }
}

// ═══════════════════════════════════════════════
// 5. CACHE REDIRECTS (prefix: cr-)
// ═══════════════════════════════════════════════
// Seed entities WITHOUT email — simulates what a list query would provide
// (list endpoints typically return summary data, not full detail)
const crContacts = [
  { contactId: "cr-1", name: "Jack Rivera", role: "Engineer", status: "active" },
  { contactId: "cr-2", name: "Kate Sato", role: "Designer", status: "active" },
  { contactId: "cr-3", name: "Leo Chen", role: "PM", status: "active" },
];

function crSeedEntities() {
  // Replace (not merge) to ensure email is NOT in the store
  for (const c of crContacts) entityStore.replace("contact", c.contactId, { ...c });
}
crSeedEntities();

const crSelectedId = ref<string | null>(null);

// useCachedEntity returns a function that reads from the entity store
const crPlaceholderFn = useCachedEntity("contact", () => crSelectedId.value ?? "");

// Simulate a slow detail fetch (750ms) — returns full data including email
const { data: crDetailData, status: crDetailStatus, isPlaceholderData: crIsPlaceholder } = useQuery({
  key: () => ["contact", crSelectedId.value!],
  query: async () => {
    await new Promise((r) => setTimeout(r, 750));
    const c = crContacts.find((c) => c.contactId === crSelectedId.value);
    return c ? { ...c, email: `${c.name.split(" ")[0].toLowerCase()}@acme.com` } : null;
  },
  enabled: computed(() => !!crSelectedId.value),
  normalize: true,
  placeholderData: crPlaceholderFn,
});

const crCardRef = ref<HTMLElement | null>(null);
const crBottomRef = ref<HTMLElement | null>(null);

function crSelect(id: string) {
  crSelectedId.value = id;
  // Scroll to bottom of card after DOM renders the detail view.
  // Double nextTick ensures the v-if content and query data are both rendered.
  nextTick(() => {
    nextTick(() => {
      crBottomRef.value?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  });
}

function crReset() {
  crSelectedId.value = null;
  // Re-seed entities WITHOUT email — this is the key:
  // replace() overwrites, so email from previous fetches is gone
  crSeedEntities();
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
        Apply instant UI updates with automatic rollback on failure. Transaction-based with server
        truth snapshots.
      </p>
      <div class="feature-demo">
        <div class="entity-display">
          <span class="label">Alice's name:</span>
          <span class="value">{{ aliceName }}</span>
          <span v-if="optimisticStatus.startsWith('pending')" class="badge pending">pending</span>
          <span v-else-if="optimisticStatus === 'committed'" class="badge success">committed</span>
          <span v-else-if="optimisticStatus === 'rolled-back'" class="badge danger"
            >rolled back</span
          >
        </div>
        <div class="feature-actions">
          <button
            class="btn btn-success"
            @click="optimisticSuccess"
            :disabled="optimisticStatus.startsWith('pending')"
          >
            Update (server accepts)
          </button>
          <button
            class="btn btn-danger"
            @click="optimisticFail"
            :disabled="optimisticStatus.startsWith('pending')"
          >
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
        <code>updateQueryData</code> and <code>deleteEntity</code>.
      </p>
      <div class="feature-demo">
        <div class="feature-actions">
          <button class="btn btn-success" @click="addToList">Add to List</button>
          <button class="btn btn-danger" @click="removeFirstFromList">Remove First</button>
        </div>
        <div class="list-display">
          <div class="list-header">
            <span class="label"
              >Query data ({{ (arrayDemoData as any[])?.length ?? 0 }} items):</span
            >
            <span class="fetch-counter">Network requests: {{ arrFetchCount }}</span>
          </div>
          <div v-if="arrayDemoData" class="entity-chips">
            <span v-for="c in arrayDemoData as any[]" :key="c.contactId" class="chip">
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
        <code>useEntityQuery</code> — reactive filtered views that update automatically when
        entities change.
      </p>
      <div class="feature-demo">
        <div class="feature-actions">
          <button class="btn btn-accent" @click="toggleStatus">Toggle Iris's Status</button>
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

    <!-- 5. Cache Redirects -->
    <section class="feature-card" ref="crCardRef">
      <h2 class="feature-title">Cache Redirects</h2>
      <p class="feature-desc">
        <code>useCachedEntity</code> + <code>autoRedirect</code> — click a contact to see
        name and role appear <strong>instantly</strong> from the entity store. The email field
        loads after a 750ms simulated fetch since the list query didn't include it.
      </p>
      <div class="feature-demo">
        <div class="feature-actions">
          <button
            v-for="c in crContacts"
            :key="c.contactId"
            :class="['btn', crSelectedId === c.contactId ? 'btn-accent' : 'btn-muted']"
            @click="crSelect(c.contactId)"
          >
            {{ c.name }}
          </button>
          <button class="btn btn-muted" @click="crReset">Reset</button>
        </div>
        <div v-if="crSelectedId" class="cr-detail">
          <div class="cr-detail-header">
            <span class="label">Detail view:</span>
            <span v-if="crIsPlaceholder" class="badge pending">
              from cache — fetching email...
            </span>
            <span v-else-if="crDetailStatus === 'success'" class="badge success">
              complete
            </span>
            <span v-else class="badge pending">loading...</span>
          </div>
          <div v-if="crDetailData" class="cr-fields">
            <div class="cr-field">
              <span class="cr-label">Name</span>
              <span class="cr-value">{{ (crDetailData as any).name }}</span>
            </div>
            <div class="cr-field">
              <span class="cr-label">Role</span>
              <span class="cr-value">{{ (crDetailData as any).role }}</span>
            </div>
            <div class="cr-field">
              <span class="cr-label">Email</span>
              <span v-if="(crDetailData as any).email" class="cr-value">
                {{ (crDetailData as any).email }}
              </span>
              <span v-else class="cr-value cr-shimmer">loading...</span>
            </div>
          </div>
        </div>
        <div v-else class="cr-detail empty">
          Click a contact above — it appears instantly from cache
        </div>
      </div>
      <div ref="crBottomRef"></div>
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
.btn-success {
  background: var(--success);
  color: #fff;
}
.btn-success:hover {
  filter: brightness(1.1);
}
.btn-danger {
  background: var(--danger);
  color: #fff;
}
.btn-danger:hover {
  filter: brightness(1.1);
}
.btn-accent {
  background: var(--accent);
  color: #fff;
}
.btn-accent:hover {
  filter: brightness(1.1);
}
.btn-muted {
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.btn-muted:hover {
  background: var(--surface-hover);
}

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
.label.success {
  color: var(--success);
}
.label.danger {
  color: var(--danger);
}

.value {
  font-size: 14px;
  font-weight: 500;
  font-family: monospace;
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
.badge.pending {
  background: var(--warning-bg);
  color: var(--warning);
}
.badge.success {
  background: var(--success-bg);
  color: var(--success);
}
.badge.danger {
  background: var(--danger-bg);
  color: var(--danger);
}

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

.log-entry.added {
  border-left-color: var(--success);
}
.log-entry.updated {
  border-left-color: var(--accent);
}
.log-entry.removed {
  border-left-color: var(--danger);
}
.log-time {
  color: var(--text-muted);
}
.log-type {
  font-weight: 600;
  min-width: 60px;
}
.log-entry.added .log-type {
  color: var(--success);
}
.log-entry.updated .log-type {
  color: var(--accent);
}
.log-entry.removed .log-type {
  color: var(--danger);
}
.log-msg {
  color: var(--text);
}

.list-display {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  background: var(--surface-raised);
  border-radius: 6px;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.fetch-counter {
  font-size: 12px;
  font-weight: 600;
  font-family: monospace;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--success-bg);
  color: var(--success);
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

.cr-detail {
  padding: 10px 14px;
  background: var(--surface-raised);
  border-radius: 6px;
}
.cr-detail.empty {
  color: var(--text-muted);
  font-size: 13px;
}
.cr-detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.cr-fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cr-field {
  display: flex;
  gap: 12px;
  align-items: baseline;
}
.cr-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  min-width: 50px;
}
.cr-value {
  font-size: 14px;
  color: var(--text);
}
.cr-shimmer {
  color: var(--text-muted);
  font-style: italic;
  font-size: 12px;
  animation: shimmer 1s ease-in-out infinite;
}
.cr-timing-log {
  max-height: 120px;
  overflow-y: auto;
}
@keyframes shimmer {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}
</style>
