import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";

export default defineConfig(({ command }) => ({
  plugins: [vue()],
  resolve: {
    alias: {
      // Always alias to local source — playground should track the latest code.
      "pinia-colada-plugin-normalizer": fileURLToPath(
        new URL("../src/index.ts", import.meta.url),
      ),
    },
  },
}));
