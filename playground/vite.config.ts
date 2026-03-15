import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // Point to the plugin source for development
      'pinia-colada-plugin-normalizer': fileURLToPath(
        new URL('../src/index.ts', import.meta.url),
      ),
    },
  },
})
