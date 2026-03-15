import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ command }) => ({
  plugins: [vue()],
  resolve: {
    alias:
      // Only alias to local source in dev (not during production builds).
      // Production builds use the npm package.
      command === 'serve'
        ? { 'pinia-colada-plugin-normalizer': fileURLToPath(new URL('../src/index.ts', import.meta.url)) }
        : {},
  },
}))
