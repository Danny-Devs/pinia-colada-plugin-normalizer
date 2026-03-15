import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// In local dev, point to the plugin source for hot reload.
// On Vercel (or when src/ doesn't exist), use the npm package.
const localSrc = fileURLToPath(new URL('../src/index.ts', import.meta.url))
const useLocalSource = existsSync(localSrc)

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: useLocalSource
      ? { 'pinia-colada-plugin-normalizer': localSrc }
      : {},
  },
})
