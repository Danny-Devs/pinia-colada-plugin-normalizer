<script setup lang="ts">
/**
 * Contact list WITHOUT normalization.
 * Uses standard Pinia Colada — no normalize option.
 * Each query stores its own independent copy of the data.
 */
import { useQuery } from '@pinia/colada'
import { fetchContacts, type ContactSummary } from '../api/mock'

defineProps<{ selectedId: string | null }>()
const emit = defineEmits<{ select: [id: string] }>()

const { data: contacts, status } = useQuery({
  key: ['raw', 'contacts'],
  query: fetchContacts,
  // No normalize: true — this is standard Pinia Colada behavior
})
</script>

<template>
  <div class="panel">
    <div class="panel-header">
      <h2>Contact List</h2>
      <code class="query-key">['raw', 'contacts']</code>
      <span class="mode-badge off">no normalization</span>
    </div>

    <div v-if="status === 'pending'" class="loading">Loading...</div>
    <ul v-else-if="contacts">
      <li
        v-for="contact in (contacts as ContactSummary[])"
        :key="contact.contactId"
        :class="{ selected: selectedId === contact.contactId }"
        @click="emit('select', contact.contactId)"
      >
        <div class="contact-info">
          <span class="name">{{ contact.name }}</span>
          <span class="role">{{ contact.role }}</span>
        </div>
        <span :class="['status-badge', contact.status]">{{ contact.status }}</span>
      </li>
    </ul>
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
.mode-badge.off { background: var(--danger-bg); color: var(--danger); }
.loading { color: var(--text-muted); }
ul { list-style: none; padding: 0; margin: 0; }
li {
  padding: 10px 12px; border-radius: 6px; cursor: pointer;
  display: flex; align-items: center; gap: 8px;
  transition: all 0.15s; border: 2px solid transparent;
}
li:hover { background: var(--surface-hover); }
li.selected { background: var(--accent-bg); border-color: var(--accent); }
.contact-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.name { font-weight: 500; color: var(--text); }
.role { font-size: 12px; color: var(--text-muted); }
.status-badge {
  font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 500;
}
.status-badge.active { background: var(--success-bg); color: var(--success); }
.status-badge.inactive { background: var(--danger-bg); color: var(--danger); }
</style>
