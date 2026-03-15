<script setup lang="ts">
/**
 * Contact detail WITH normalization.
 * Uses normalize: true — reads from the shared entity store.
 * Updates via entityStore.set() propagate here automatically.
 */
import { computed } from 'vue'
import { useQuery } from '@pinia/colada'
import { fetchContact, type Contact } from '../api/mock'

const props = defineProps<{ contactId: string | null; normalized: boolean }>()

const enabled = computed(() => !!props.contactId)

const { data: contact, status } = useQuery({
  key: () => ['contacts', props.contactId!],
  query: () => fetchContact(props.contactId!),
  enabled,
  normalize: true,
})
</script>

<template>
  <div class="panel">
    <div class="panel-header">
      <h2>Contact Detail</h2>
      <code class="query-key">['contacts', '{{ contactId }}']</code>
      <span class="mode-badge on">normalized</span>
    </div>

    <div v-if="!contactId" class="empty">Click a contact to view details</div>
    <div v-else-if="status === 'pending'" class="loading">Loading...</div>
    <div v-else-if="contact" class="detail">
      <div class="field">
        <label>Name</label>
        <span class="value">{{ (contact as Contact).name }}</span>
      </div>
      <div class="field">
        <label>Email</label>
        <span class="value">{{ (contact as Contact).email }}</span>
      </div>
      <div class="field">
        <label>Role</label>
        <span class="value">{{ (contact as Contact).role }}</span>
      </div>
      <div class="field">
        <label>Status</label>
        <span :class="['value', 'status-text', (contact as Contact).status]">
          {{ (contact as Contact).status }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel { padding: 16px; height: 100%; }
.panel-header { margin-bottom: 12px; }
h2 { margin: 0; font-size: 16px; color: var(--text); display: inline; }
.query-key {
  font-size: 11px; color: var(--text-muted); background: var(--surface-raised);
  padding: 2px 6px; border-radius: 3px; margin-left: 8px;
}
.mode-badge {
  font-size: 10px; padding: 2px 8px; border-radius: 10px; margin-left: 8px;
  font-weight: 600; vertical-align: middle;
}
.mode-badge.on { background: var(--success-bg); color: var(--success); }
.empty, .loading { color: var(--text-muted); font-style: italic; }
.detail { display: flex; flex-direction: column; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 2px; }
label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.value { font-size: 15px; color: var(--text); }
.status-text.active { color: var(--success); font-weight: 500; }
.status-text.inactive { color: var(--danger); font-weight: 500; }
</style>
