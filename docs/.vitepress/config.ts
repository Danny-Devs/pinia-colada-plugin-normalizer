import { defineConfig } from "vitepress";

export default defineConfig({
  title: "pinia-colada-plugin-normalizer",
  description: "Normalized entity caching for Pinia Colada",
  srcExclude: ["**/README.md"],

  themeConfig: {
    nav: [
      { text: "Guide", link: "/" },
      { text: "API Reference", link: "/api-reference" },
      {
        text: "GitHub",
        link: "https://github.com/Danny-Devs/pinia-colada-plugin-normalizer",
      },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/" },
          { text: "Entity Definitions", link: "/entity-definitions" },
          { text: "Real-Time Patterns", link: "/real-time" },
          { text: "Cache Redirects", link: "/cache-redirects" },
          { text: "How It Works", link: "/architecture" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "API Reference", link: "/api-reference" },
        ],
      },
    ],

    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/Danny-Devs/pinia-colada-plugin-normalizer",
      },
    ],
  },
});
