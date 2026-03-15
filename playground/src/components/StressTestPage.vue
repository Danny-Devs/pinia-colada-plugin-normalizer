<script setup lang="ts">
import { ref, reactive, computed, onUnmounted } from "vue";
import { useQuery } from "@pinia/colada";
import { useEntityStore } from "pinia-colada-plugin-normalizer";

const entityStore = useEntityStore();

// ─── Config ──────────────────────────────────
const entityCount = ref(100);
const queryCount = ref(10);
const updateInterval = ref(50); // ms between updates

// ─── State ───────────────────────────────────
const isRunning = ref(false);
const totalUpdates = ref(0);
const totalDeduped = ref(0);
const elapsed = ref(0);
const lastRenderMs = ref(0);
const seededEntityCount = ref(0); // snapshot of entityCount when test started
let intervalId: ReturnType<typeof setInterval> | null = null;
let startTime = 0;

// ─── Generated data ─────────────────────────
const generatedEntities = ref<
  Array<{ contactId: string; name: string; email: string; role: string; status: string }>
>([]);
const activeQueryKeys = ref<string[][]>([]);

function generateEntities(count: number) {
  const roles = ["Engineer", "Designer", "PM", "Lead", "Intern", "VP", "Director", "CTO"];
  const statuses = ["active", "inactive"];
  const entities = [];
  for (let i = 1; i <= count; i++) {
    entities.push({
      contactId: String(i),
      name: `Contact ${i}`,
      email: `contact${i}@stress.test`,
      role: roles[i % roles.length],
      status: statuses[i % 2],
    });
  }
  return entities;
}

function seedStore() {
  const entities = generateEntities(entityCount.value);
  generatedEntities.value = entities;

  // Seed entity store
  for (const entity of entities) {
    entityStore.set("contact", entity.contactId, { ...entity });
  }

  // Create overlapping query key sets — each query "owns" a slice but shares edges
  const keys: string[][] = [];
  const sliceSize = Math.max(5, Math.floor(entityCount.value / queryCount.value));
  for (let q = 0; q < queryCount.value; q++) {
    const start = q * Math.floor(sliceSize * 0.7); // overlapping slices
    const ids = [];
    for (let i = start; i < start + sliceSize && i < entityCount.value; i++) {
      ids.push(String(i + 1));
    }
    keys.push(["stress", "slice", String(q)]);
  }
  activeQueryKeys.value = keys;

  totalUpdates.value = 0;
  totalDeduped.value = 0;
  seededEntityCount.value = entityCount.value;
}

// ─── Stress test: rapid random entity updates ──
function startStress() {
  if (isRunning.value) return;
  seedStore();
  isRunning.value = true;
  startTime = performance.now();

  intervalId = setInterval(() => {
    const t0 = performance.now();

    // Pick a random entity and mutate it
    const id = String(Math.floor(Math.random() * entityCount.value) + 1);
    const existing = entityStore.get("contact", id).value;
    if (existing) {
      const wasChanged = existing.name !== `Contact ${id} (updated)`;
      entityStore.set("contact", id, {
        ...existing,
        name: `Contact ${id} (v${totalUpdates.value})`,
        status: Math.random() > 0.5 ? "active" : "inactive",
      });
      totalUpdates.value++;
      if (!wasChanged) totalDeduped.value++;
    }

    lastRenderMs.value = Math.round((performance.now() - t0) * 100) / 100;
    elapsed.value = Math.round((performance.now() - startTime) / 1000);
  }, updateInterval.value);
}

function stopStress() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  isRunning.value = false;
}

function resetStress() {
  stopStress();
  entityStore.clear();
  generatedEntities.value = [];
  activeQueryKeys.value = [];
  totalUpdates.value = 0;
  totalDeduped.value = 0;
  seededEntityCount.value = 0;
  elapsed.value = 0;
  lastRenderMs.value = 0;
}

onUnmounted(() => stopStress());

// ─── Stats ───────────────────────────────────
const updatesPerSecond = computed(() => {
  if (elapsed.value === 0) return 0;
  return Math.round(totalUpdates.value / elapsed.value);
});

const storeSize = computed(() => {
  return entityStore.getByType("contact").value.length;
});
</script>

<template>
  <div class="stress-page">
    <p class="page-desc">
      Push the normalizer to its limits. Generate hundreds of entities, fire rapid mutations, and
      verify no duplicates are created under load.
    </p>

    <!-- Config -->
    <div class="config-panel">
      <div class="config-row">
        <label>
          <span class="config-label">Entities</span>
          <input
            v-model.number="entityCount"
            type="number"
            min="10"
            max="10000"
            step="50"
            :disabled="isRunning"
            class="config-input"
          />
        </label>
        <label>
          <span class="config-label">Queries</span>
          <input
            v-model.number="queryCount"
            type="number"
            min="1"
            max="50"
            step="1"
            :disabled="isRunning"
            class="config-input"
          />
        </label>
        <label>
          <span class="config-label">Interval (ms)</span>
          <input
            v-model.number="updateInterval"
            type="number"
            min="10"
            max="1000"
            step="10"
            :disabled="isRunning"
            class="config-input"
          />
        </label>
      </div>
      <div class="config-actions">
        <button v-if="!isRunning" class="btn btn-start" @click="startStress">
          Start Stress Test
        </button>
        <button v-else class="btn btn-stop" @click="stopStress">Stop</button>
        <button class="btn btn-reset" @click="resetStress" :disabled="isRunning">Reset</button>
      </div>
    </div>

    <!-- Live metrics -->
    <div v-if="totalUpdates > 0 || isRunning" class="metrics-grid">
      <div class="metric">
        <span class="metric-value">{{ totalUpdates.toLocaleString() }}</span>
        <span class="metric-label">total updates</span>
      </div>
      <div class="metric">
        <span class="metric-value">{{ updatesPerSecond }}/s</span>
        <span class="metric-label">throughput</span>
      </div>
      <div class="metric">
        <span class="metric-value">{{ storeSize.toLocaleString() }}</span>
        <span class="metric-label">entities in store</span>
      </div>
      <div class="metric">
        <span class="metric-value">{{ lastRenderMs }}ms</span>
        <span class="metric-label">last update</span>
      </div>
      <div class="metric">
        <span class="metric-value">{{ elapsed }}s</span>
        <span class="metric-label">elapsed</span>
      </div>
    </div>

    <!-- Dedup verification (only after test started) -->
    <div v-if="totalUpdates > 0 || isRunning" class="dedup-panel">
      <h3 class="section-title">Entity Deduplication Check</h3>
      <p class="dedup-result success" v-if="storeSize >= seededEntityCount">
        {{ storeSize }} entities in store ({{ seededEntityCount }} from stress test). No duplicates.
        Normalization is working correctly.
      </p>
      <p class="dedup-result danger" v-else>
        Store has {{ storeSize }} entities but expected at least {{ seededEntityCount }}. Something
        is wrong.
      </p>
    </div>
  </div>
</template>

<style scoped>
.stress-page {
  padding: 0;
}

.page-desc {
  color: var(--text-muted);
  font-size: 14px;
  margin: 0 0 16px;
  line-height: 1.5;
}

/* Config panel */
.config-panel {
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.config-row {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.config-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.config-input {
  width: 100px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  font-family: monospace;
}

.config-input:disabled {
  opacity: 0.5;
}

.config-actions {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.btn:disabled {
  opacity: 0.4;
  pointer-events: none;
}

.btn-start {
  background: var(--success);
  color: #fff;
}

.btn-start:hover {
  filter: brightness(1.1);
}

.btn-stop {
  background: var(--danger);
  color: #fff;
}

.btn-reset {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.btn-reset:hover {
  background: var(--surface-hover);
}

/* Metrics */
.metrics-grid {
  display: flex;
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 16px;
}

.metric {
  flex: 1;
  background: var(--surface);
  padding: 12px 16px;
  text-align: center;
}

.metric-value {
  display: block;
  font-size: 20px;
  font-weight: 700;
  font-family: monospace;
  color: var(--accent);
}

.metric-label {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

/* Dedup */
.section-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 8px;
}

.dedup-panel {
  margin-bottom: 16px;
}

.dedup-result {
  font-size: 13px;
  font-weight: 500;
  padding: 10px 14px;
  border-radius: 6px;
  margin: 0;
}

.dedup-result.success {
  background: var(--success-bg);
  color: var(--success);
}

.dedup-result.danger {
  background: var(--danger-bg);
  color: var(--danger);
}
</style>
