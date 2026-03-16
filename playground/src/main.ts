import { createApp, ref } from "vue";
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

// Track how many entities were restored from IDB for the demo UI
const restoredCount = ref(0);
const countBefore = entityStore.getEntriesByType("contact").length;

const persistence = enablePersistence(entityStore, {
  dbName: "pcn_playground",
  onReady: () => {
    restoredCount.value = entityStore.getEntriesByType("contact").length - countBefore;
  },
  onError: (err) => console.warn("[playground] Persistence unavailable:", err),
});

app.provide("persistence", persistence);
app.provide("restoredCount", restoredCount);

persistence.ready.then(() => {
  app.mount("#app");
});
