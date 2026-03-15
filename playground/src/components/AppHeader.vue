<script setup lang="ts">
import { useColorMode } from '@vueuse/core'

defineProps<{
  currentPage: string
}>()

const emit = defineEmits<{
  navigate: [page: string]
}>()

const colorMode = useColorMode({ attribute: 'data-theme' })

function toggleTheme() {
  colorMode.value = colorMode.value === 'dark' ? 'light' : 'dark'
}
</script>

<template>
  <header class="app-header">
    <div class="header-left">
      <h1 class="header-title">pinia-colada-plugin-normalizer</h1>
      <nav class="header-nav">
        <button
          :class="['nav-btn', { active: currentPage === 'demo' }]"
          @click="emit('navigate', 'demo')"
        >
          Demo
        </button>
        <button
          :class="['nav-btn', { active: currentPage === 'stress' }]"
          @click="emit('navigate', 'stress')"
        >
          Stress Test
        </button>
      </nav>
    </div>
    <div class="header-right">
      <a
        href="https://github.com/Danny-Devs/pinia-colada-plugin-normalizer"
        target="_blank"
        rel="noopener"
        class="github-link"
        title="View on GitHub"
      >
        <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
        </svg>
      </a>
      <button class="theme-toggle" @click="toggleTheme">
        {{ colorMode === 'dark' ? '☀️' : '🌙' }}
      </button>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 20px;
}

.header-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.header-nav {
  display: flex;
  gap: 2px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px;
}

.nav-btn {
  padding: 5px 14px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.nav-btn:hover {
  color: var(--text);
  background: var(--surface-hover);
}

.nav-btn.active {
  background: var(--accent);
  color: #fff;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.github-link {
  color: var(--text-muted);
  display: flex;
  align-items: center;
  transition: color 0.15s;
}

.github-link:hover {
  color: var(--text);
}

.theme-toggle {
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 14px;
}
</style>
