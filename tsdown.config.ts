import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  sourcemap: true,
  dts: {
    build: true,
  },
  deps: {
    onlyAllowBundle: [],
    neverBundle: ['vue', 'pinia', '@pinia/colada'],
  },
  target: 'esnext',
  clean: true,
})
