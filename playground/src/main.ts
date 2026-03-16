import { createApp } from "vue";
import { createPinia } from "pinia";
import { PiniaColada } from "@pinia/colada";
import {
  PiniaColadaNormalizer,
  defineEntity,
  useEntityStore,
  enablePersistence,
} from "pinia-colada-plugin-normalizer";
import App from "./App.vue";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(PiniaColada, {
  plugins: [
    PiniaColadaNormalizer({
      entities: {
        contact: defineEntity({ idField: "contactId" }),
      },
      autoRedirect: true,
    }),
  ],
});

// Enable IndexedDB persistence — entities survive page refresh
const entityStore = useEntityStore(pinia);
const persistence = enablePersistence(entityStore, {
  dbName: "pcn_playground",
  onReady: () => console.log("[playground] Entity cache restored from IndexedDB"),
  onError: (err) => console.warn("[playground] Persistence unavailable:", err),
});

// Expose for the App component to show persistence status
app.provide("persistence", persistence);

persistence.ready.then(() => {
  app.mount("#app");
});
