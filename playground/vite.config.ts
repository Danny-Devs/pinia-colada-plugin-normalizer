import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";

export default defineConfig(() => ({
  plugins: [vue()],
  resolve: {
    alias: {
      // Always alias to local source — playground should track the latest code.
      "pinia-colada-plugin-normalizer": fileURLToPath(
        new URL("../src/index.ts", import.meta.url),
      ),
      // The plugin source lives outside playground/, so its imports
      // (like @vue/reactivity) can't resolve from playground/node_modules
      // under pnpm's strict resolution. Alias to the playground's copy.
      "@vue/reactivity": fileURLToPath(
        new URL("./node_modules/@vue/reactivity", import.meta.url),
      ),
    },
  },
}));
