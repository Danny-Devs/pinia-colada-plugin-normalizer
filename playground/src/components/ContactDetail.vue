<script setup lang="ts">
/**
 * Contact detail WITH normalization + autoRedirect.
 * Uses key ['contact', id] — matches the registered entity type,
 * so autoRedirect serves cached data instantly from list queries.
 * Updates via entityStore.set() propagate here automatically.
 */
import { computed } from "vue";
import { useQuery } from "@pinia/colada";
import { fetchContact, type Contact } from "../api/mock";

const props = defineProps<{ contactId: string | null; normalized: boolean }>();

const enabled = computed(() => !!props.contactId);

const { data: contact, status, isPlaceholderData } = useQuery({
  key: () => ["contact", props.contactId!],
  query: () => fetchContact(props.contactId!),
  enabled,
  normalize: true,
});
</script>

<template>
  <div class="panel">
    <div class="panel-header">
      <h2>Contact Detail</h2>
      <code class="query-key">['contact', '{{ contactId }}']</code>
      <span class="mode-badge on">normalized</span>
      <span v-if="isPlaceholderData" class="mode-badge cached">instant cache</span>
    </div>

    <div v-if="!contactId" class="empty">Click a contact to view details</div>
    <div v-else-if="status === 'pending' && !contact" class="loading">Loading...</div>
    <div v-else-if="contact" class="detail">
      <div class="field">
        <label>Name</label>
        <span class="value">{{ (contact as Contact).name }}</span>
      </div>
      <div class="field">
        <label>Email</label>
        <span v-if="(contact as Contact).email" class="value">{{ (contact as Contact).email }}</span>
        <span v-else class="value placeholder-shimmer">loading...</span>
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
.panel {
  padding: 16px;
  height: 100%;
}
.panel-header {
  margin-bottom: 12px;
}
h2 {
  margin: 0;
  font-size: 16px;
  color: var(--text);
  display: inline;
}
.query-key {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface-raised);
  padding: 2px 6px;
  border-radius: 3px;
  margin-left: 8px;
}
.mode-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 10px;
  margin-left: 8px;
  font-weight: 600;
  vertical-align: middle;
}
.mode-badge.on {
  background: var(--success-bg);
  color: var(--success);
}
.mode-badge.cached {
  background: var(--accent-bg);
  color: var(--accent);
  animation: flash 0.6s ease-out;
}
@keyframes flash {
  0% { opacity: 0; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.1); }
  100% { transform: scale(1); }
}
.placeholder-shimmer {
  color: var(--text-muted);
  font-style: italic;
  font-size: 13px;
  animation: shimmer 1s ease-in-out infinite;
}
@keyframes shimmer {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}
.empty,
.loading {
  color: var(--text-muted);
  font-style: italic;
}
.detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.value {
  font-size: 15px;
  color: var(--text);
}
.status-text.active {
  color: var(--success);
  font-weight: 500;
}
.status-text.inactive {
  color: var(--danger);
  font-weight: 500;
}
</style>
