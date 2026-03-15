import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  sourcemap: true,
  dts: {
    build: true,
  },
  deps: {
    onlyBundle: [],
    neverBundle: ["vue", "pinia", "@pinia/colada", "@vue/devtools-api"],
  },
  target: "esnext",
  clean: true,
});
