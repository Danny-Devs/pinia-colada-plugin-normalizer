import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// In dev: alias to raw source for hot reload.
// In build (Vercel): alias to built dist to avoid pnpm strict resolution
// issues with peer deps leaking from ../src/ outside the playground root.
const srcPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const distPath = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));

export default defineConfig(({ command }) => ({
  plugins: [vue()],
  resolve: {
    alias: {
      "pinia-colada-plugin-normalizer":
        command === "serve" ? srcPath : existsSync(distPath) ? distPath : srcPath,
    },
  },
}));
