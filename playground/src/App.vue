<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import AppHeader from './components/AppHeader.vue'
import ContactList from './components/ContactList.vue'
import ContactDetail from './components/ContactDetail.vue'
import ContactListRaw from './components/ContactListRaw.vue'
import ContactDetailRaw from './components/ContactDetailRaw.vue'
import DataInspector from './components/DataInspector.vue'
import FeaturesPage from './components/FeaturesPage.vue'
import StressTestPage from './components/StressTestPage.vue'
import { useDemo } from './composables/useDemo'
import * as mockApi from './api/mock'

const currentPage = ref('demo')
const selectedId = ref<string | null>('1')
const { normalized, entityWrites, rawUpdates, log, applyUpdate, resetDemo } = useDemo()
const clicked = reactive(new Set<string>())

// Re-reads fetchCount whenever log changes (log updates on every action)
const apiCalls = computed(() => {
  void log.length // track reactivity
  return mockApi.fetchCount
})

function toggleMode() {
  normalized.value = !normalized.value
  selectedId.value = '1'
  clicked.clear()
  mockApi.resetFetchCount()
  resetDemo()
}

function renameAlice() {
  clicked.add('alice')
  applyUpdate(
    { contactId: '1', name: 'Alicia Chen', email: 'alice@acme.com', role: 'Engineer', status: 'active' },
    'Alice → Alicia',
  )
}

function promoteBob() {
  clicked.add('bob')
  applyUpdate(
    { contactId: '2', name: 'Bob Park', email: 'bob@acme.com', role: 'Lead Designer', status: 'active' },
    'Bob → Lead Designer',
  )
}

function activateDiana() {
  clicked.add('diana')
  applyUpdate(
    { contactId: '4', name: 'Diana Lopez', email: 'diana@acme.com', role: 'Engineer', status: 'active' },
    'Diana → active',
  )
}
</script>

<template>
  <div class="app">
    <AppHeader :current-page="currentPage" @navigate="currentPage = $event" />

    <!-- Demo page -->
    <template v-if="currentPage === 'demo'">
      <p class="tagline">
        Store each record once. Update it in one place, every view reflects the change.
      </p>

      <!-- Control strip -->
      <div class="controls">
        <div class="control-left">
          <div class="toggle-group">
            <span class="toggle-label">Normalization</span>
            <button :class="['toggle-btn']" @click="toggleMode">
              <span class="toggle-option" :class="{ selected: !normalized }">OFF</span>
              <span class="toggle-option" :class="{ selected: normalized }">ON</span>
            </button>
          </div>
          <div class="control-divider"></div>
          <div class="action-group">
            <span class="action-label">Simulate update:</span>
            <button @click="renameAlice" :class="['action-btn', { applied: clicked.has('alice') }]" :disabled="clicked.has('alice')">Alice → Alicia</button>
            <button @click="promoteBob" :class="['action-btn', { applied: clicked.has('bob') }]" :disabled="clicked.has('bob')">Bob → Lead Designer</button>
            <button @click="activateDiana" :class="['action-btn', { applied: clicked.has('diana') }]" :disabled="clicked.has('diana')">Diana → active</button>
          </div>
        </div>
        <span class="api-counter">API calls: {{ apiCalls }}</span>
      </div>

      <!-- Mode hint -->
      <div :class="['mode-hint', normalized ? 'success' : 'warning']">
        <template v-if="normalized">
          With normalization, data is stored once and reactively shared across all queries. Click an update above — both views stay in sync instantly, with zero extra API calls.
        </template>
        <template v-else>
          Without normalization, the same data can end up duplicated across queries. When new data arrives and you only update one copy, the rest go stale. Click an update above — we only update the detail query's cache, so the list falls out of sync.
        </template>
      </div>

      <!-- Panels -->
      <div class="panels">
        <div class="panel-container">
          <ContactList
            v-if="normalized"
            :selected-id="selectedId"
            :normalized="true"
            @select="selectedId = $event"
          />
          <ContactListRaw
            v-else
            :selected-id="selectedId"
            @select="selectedId = $event"
          />
        </div>
        <div class="panel-container">
          <ContactDetail
            v-if="normalized"
            :contact-id="selectedId"
            :normalized="true"
          />
          <ContactDetailRaw
            v-else
            :contact-id="selectedId"
          />
        </div>
      </div>

      <!-- Event log -->
      <div v-if="log.length" class="event-log-bar">
        <div v-for="(entry, i) in log" :key="i" :class="['log-entry', entry.type]">
          <span class="log-time">{{ entry.time }}</span>
          <span class="log-msg">{{ entry.message }}</span>
        </div>
      </div>

      <!-- Data Inspector -->
      <DataInspector :normalized="normalized" />
    </template>

    <!-- Features page -->
    <FeaturesPage v-else-if="currentPage === 'features'" />

    <!-- Stress test page -->
    <StressTestPage v-else-if="currentPage === 'stress'" />
  </div>
</template>

<style>
:root, [data-theme="light"] {
  --bg: #ffffff;
  --surface: #ffffff;
  --surface-raised: #f8f9fa;
  --surface-hover: #f0f1f3;
  --text: #1a1a2e;
  --text-muted: #6c757d;
  --border: #e0e0e0;
  --accent: #1565c0;
  --accent-bg: #e3f2fd;
  --success: #2e7d32;
  --success-bg: #e8f5e9;
  --danger: #c62828;
  --danger-bg: #fce4ec;
  --warning: #e65100;
  --warning-bg: #fff3e0;
}

[data-theme="dark"] {
  --bg: #0d1117;
  --surface: #161b22;
  --surface-raised: #1c2128;
  --surface-hover: #262c36;
  --text: #e6edf3;
  --text-muted: #8b949e;
  --border: #30363d;
  --accent: #58a6ff;
  --accent-bg: #0d2240;
  --success: #56d364;
  --success-bg: #0d2818;
  --danger: #f85149;
  --danger-bg: #3d1214;
  --warning: #d29922;
  --warning-bg: #3d2e00;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  color: var(--text); background: var(--bg);
  transition: background 0.2s, color 0.2s;
}

.app { max-width: 960px; margin: 0 auto; padding: 0 16px 32px; }

/* Tagline */
.tagline { margin: 0 0 12px; color: var(--text-muted); font-size: 14px; line-height: 1.4; }

/* Control strip */
.controls {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 14px; padding: 10px 14px;
  background: var(--surface-raised); border: 1px solid var(--border); border-radius: 8px;
  gap: 12px; flex-wrap: wrap;
}
.control-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.toggle-group { display: flex; align-items: center; gap: 8px; }
.toggle-label { font-weight: 600; font-size: 13px; color: var(--text); }
.toggle-btn {
  display: flex; background: var(--surface); border: 1px solid var(--border);
  border-radius: 5px; overflow: hidden; cursor: pointer; padding: 0;
}
.toggle-option {
  padding: 5px 14px; font-size: 12px; font-weight: 600;
  color: var(--text-muted); transition: all 0.15s;
}
.toggle-option.selected { background: var(--accent); color: #fff; }
.control-divider { width: 1px; height: 24px; background: var(--border); }
.action-group { display: flex; align-items: center; gap: 6px; }
.action-label { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
.action-btn {
  padding: 5px 12px; border: 1.5px solid var(--accent); border-radius: 5px;
  background: var(--surface); color: var(--accent); cursor: pointer;
  font-size: 12px; font-weight: 500; transition: all 0.15s; white-space: nowrap;
}
.action-btn:hover { background: var(--accent-bg); }
.action-btn.applied { background: var(--accent); color: #fff; cursor: default; opacity: 0.7; }
.action-btn:disabled { pointer-events: none; }
.api-counter {
  font-family: monospace; font-size: 12px; font-weight: 600;
  padding: 4px 10px; border-radius: 4px; white-space: nowrap;
  background: var(--success-bg); color: var(--success);
}
.control-stats { flex-shrink: 0; }
.mini-stat {
  font-family: monospace; font-size: 12px; font-weight: 500;
  padding: 4px 10px; border-radius: 4px;
}
.mini-stat.success { background: var(--success-bg); color: var(--success); }
.mini-stat.danger { background: var(--danger-bg); color: var(--danger); }

/* Mode hint */
.mode-hint {
  margin-top: 8px; padding: 8px 14px; border-radius: 6px;
  font-size: 13px; font-weight: 500;
}
.mode-hint.success { background: var(--success-bg); color: var(--success); }
.mode-hint.warning { background: var(--danger-bg); color: var(--danger); }

/* Panels */
.panels {
  display: grid; grid-template-columns: 1fr 1fr; gap: 1px;
  background: var(--border); margin: 16px 0 20px;
  border: 2px solid var(--border); border-radius: 10px; overflow: hidden;
}
.panel-container { background: var(--surface); min-height: 200px; }

/* Event log */
.event-log-bar {
  margin-top: 8px; padding: 8px 14px;
  background: var(--surface-raised); border-radius: 6px;
  border: 1px solid var(--border);
}
.log-entry {
  font-family: monospace; font-size: 11px; padding: 2px 0;
  display: flex; gap: 8px;
  border-left: 3px solid var(--border); padding-left: 8px; margin-bottom: 1px;
}
.log-entry.update { border-left-color: var(--success); }
.log-entry.warning { border-left-color: var(--danger); }
.log-entry.info { border-left-color: var(--accent); }
.log-time { color: var(--text-muted); }
.log-msg { color: var(--text); }
</style>
