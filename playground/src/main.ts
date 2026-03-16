import { createApp } from "vue";
import { createPinia } from "pinia";
import { PiniaColada } from "@pinia/colada";
import { PiniaColadaNormalizer, defineEntity } from "pinia-colada-plugin-normalizer";
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

app.mount("#app");
