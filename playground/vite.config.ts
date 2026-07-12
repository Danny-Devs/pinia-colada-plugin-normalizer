import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// In dev: alias to raw source for hot reload.
// In build (Vercel): alias to built dist to avoid pnpm strict resolution
// issues with peer deps leaking from ../src/ outside the playground root.
const srcPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const distPath = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));
const workerSrcPath = fileURLToPath(new URL("../src/sqlite-worker.ts", import.meta.url));
const workerDistPath = fileURLToPath(new URL("../dist/sqlite-worker.mjs", import.meta.url));

export default defineConfig(({ command }) => ({
  plugins: [vue()],
  resolve: {
    alias: {
      // Subpath alias must come first — the bare-name alias would otherwise
      // shadow it (aliases match in order).
      "pinia-colada-plugin-normalizer/sqlite-worker":
        command === "serve" ? workerSrcPath : existsSync(workerDistPath) ? workerDistPath : workerSrcPath,
      "pinia-colada-plugin-normalizer":
        command === "serve" ? srcPath : existsSync(distPath) ? distPath : srcPath,
    },
  },
  optimizeDeps: {
    // Per sqlite-wasm's Vite guidance: pre-bundling breaks its .wasm/worker
    // asset resolution.
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
}));
