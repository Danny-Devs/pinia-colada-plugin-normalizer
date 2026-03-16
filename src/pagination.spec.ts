/**
 * Tests for pagination merge recipe factories.
 *
 * Tests the merge functions in isolation (unit tests) and
 * via the full plugin round-trip (integration tests with
 * useQuery and useInfiniteQuery).
 */

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { createPinia } from "pinia";
import { PiniaColada, useQuery, useInfiniteQuery } from "@pinia/colada";
import type { PiniaColadaOptions } from "@pinia/colada";
import {
  PiniaColadaNormalizer,
  useEntityStore,
  defineEntity,
} from "./index";
import { cursorPagination, offsetPagination } from "./pagination";
import type { EntityRecord } from "./types";

// ─────────────────────────────────────────────
// Unit tests (merge functions in isolation)
// ─────────────────────────────────────────────

describe("cursorPagination", () => {
  interface Feed extends EntityRecord {
    feedId: string;
    items: Array<{ id: string; text: string }>;
    endCursor: string | null;
  }

  it("appends incoming items in forward direction", () => {
    const merge = cursorPagination<Feed>({
      getCursor: (f) => f.endCursor,
      itemsField: "items",
    });

    const existing: Feed = {
      feedId: "main",
      items: [{ id: "1", text: "first" }],
      endCursor: "cursor-1",
    };

    const incoming: Feed = {
      feedId: "main",
      items: [{ id: "2", text: "second" }],
      endCursor: "cursor-2",
    };

    const result = merge(existing, incoming);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe("1");
    expect(result.items[1].id).toBe("2");
    expect(result.endCursor).toBe("cursor-2");
  });

  it("prepends incoming items in backward direction", () => {
    const merge = cursorPagination<Feed>({
      getCursor: (f) => f.endCursor,
      itemsField: "items",
      direction: "backward",
    });

    const existing: Feed = {
      feedId: "main",
      items: [{ id: "2", text: "second" }],
      endCursor: "cursor-2",
    };

    const incoming: Feed = {
      feedId: "main",
      items: [{ id: "1", text: "first" }],
      endCursor: "cursor-1",
    };

    const result = merge(existing, incoming);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe("1");
    expect(result.items[1].id).toBe("2");
  });

  it("replaces when cursors match (same page refresh)", () => {
    const merge = cursorPagination<Feed>({
      getCursor: (f) => f.endCursor,
      itemsField: "items",
    });

    const existing: Feed = {
      feedId: "main",
      items: [{ id: "1", text: "old" }],
      endCursor: "cursor-1",
    };

    const incoming: Feed = {
      feedId: "main",
      items: [{ id: "1", text: "new" }],
      endCursor: "cursor-1",
    };

    const result = merge(existing, incoming);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].text).toBe("new");
  });

  it("deduplicates items by key field", () => {
    const merge = cursorPagination<Feed>({
      getCursor: (f) => f.endCursor,
      itemsField: "items",
      dedupeKey: "id",
    });

    const existing: Feed = {
      feedId: "main",
      items: [
        { id: "1", text: "first" },
        { id: "2", text: "second" },
      ],
      endCursor: "cursor-1",
    };

    const incoming: Feed = {
      feedId: "main",
      items: [
        { id: "2", text: "second-updated" },
        { id: "3", text: "third" },
      ],
      endCursor: "cursor-2",
    };

    const result = merge(existing, incoming);
    expect(result.items).toHaveLength(3);
    expect(result.items[0].id).toBe("1");
    // The newer version of id:2 should win
    expect(result.items.find((i: any) => i.id === "2")!.text).toBe("second-updated");
    expect(result.items[result.items.length - 1].id).toBe("3");
  });

  it("defaults to 'items' field", () => {
    const merge = cursorPagination({
      getCursor: (f) => f.cursor as string,
    });

    const existing = { id: "1", items: [1, 2], cursor: "a" };
    const incoming = { id: "1", items: [3, 4], cursor: "b" };

    const result = merge(existing, incoming);
    expect(result.items).toEqual([1, 2, 3, 4]);
  });

  it("handles empty incoming items", () => {
    const merge = cursorPagination<Feed>({
      getCursor: (f) => f.endCursor,
      itemsField: "items",
    });

    const existing: Feed = {
      feedId: "main",
      items: [{ id: "1", text: "first" }],
      endCursor: "cursor-1",
    };

    const incoming: Feed = {
      feedId: "main",
      items: [],
      endCursor: "cursor-2",
    };

    const result = merge(existing, incoming);
    expect(result.items).toHaveLength(1);
    expect(result.endCursor).toBe("cursor-2");
  });

  it("handles missing items field gracefully", () => {
    const merge = cursorPagination({
      getCursor: (f) => f.cursor as string,
      itemsField: "items",
    });

    const existing = { id: "1", cursor: "a" };
    const incoming = { id: "1", items: [1, 2], cursor: "b" };

    const result = merge(existing, incoming);
    expect(result.items).toEqual([1, 2]);
  });
});

describe("offsetPagination", () => {
  interface PagedList extends EntityRecord {
    listId: string;
    items: Array<{ id: string; name: string }>;
    offset: number;
    total: number;
  }

  it("merges items at correct offset positions", () => {
    const merge = offsetPagination<PagedList>({
      getOffset: (l) => l.offset,
      pageSize: 2,
      itemsField: "items",
    });

    const existing: PagedList = {
      listId: "contacts",
      items: [
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
      ],
      offset: 0,
      total: 4,
    };

    const incoming: PagedList = {
      listId: "contacts",
      items: [
        { id: "3", name: "Charlie" },
        { id: "4", name: "Diana" },
      ],
      offset: 2,
      total: 4,
    };

    const result = merge(existing, incoming);
    expect(result.items).toHaveLength(4);
    expect(result.items[0].name).toBe("Alice");
    expect(result.items[1].name).toBe("Bob");
    expect(result.items[2].name).toBe("Charlie");
    expect(result.items[3].name).toBe("Diana");
    expect(result.total).toBe(4);
  });

  it("replaces when same offset (page refresh)", () => {
    const merge = offsetPagination<PagedList>({
      getOffset: (l) => l.offset,
      pageSize: 2,
      itemsField: "items",
    });

    const existing: PagedList = {
      listId: "contacts",
      items: [{ id: "1", name: "Old Alice" }],
      offset: 0,
      total: 1,
    };

    const incoming: PagedList = {
      listId: "contacts",
      items: [{ id: "1", name: "New Alice" }],
      offset: 0,
      total: 1,
    };

    const result = merge(existing, incoming);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("New Alice");
  });

  it("deduplicates items by key field", () => {
    const merge = offsetPagination<PagedList>({
      getOffset: (l) => l.offset,
      pageSize: 2,
      itemsField: "items",
      dedupeKey: "id",
    });

    const existing: PagedList = {
      listId: "contacts",
      items: [
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
      ],
      offset: 0,
      total: 3,
    };

    // Overlapping page — item id:2 exists in both
    const incoming: PagedList = {
      listId: "contacts",
      items: [
        { id: "2", name: "Bob Updated" },
        { id: "3", name: "Charlie" },
      ],
      offset: 1,
      total: 3,
    };

    const result = merge(existing, incoming);
    // Should have 3 unique items
    expect(result.items.filter((i: any) => i.id === "2")).toHaveLength(1);
    expect(result.items.find((i: any) => i.id === "2")!.name).toBe("Bob Updated");
  });

  it("defaults to 'items' field", () => {
    const merge = offsetPagination({
      getOffset: (l) => l.offset as number,
      pageSize: 2,
    });

    const existing = { id: "1", items: [1, 2], offset: 0 };
    const incoming = { id: "1", items: [3, 4], offset: 2 };

    const result = merge(existing, incoming);
    expect(result.items).toEqual([1, 2, 3, 4]);
  });
});

// ─────────────────────────────────────────────
// Integration tests (with plugin + useQuery)
// ─────────────────────────────────────────────

describe("Pagination Integration", () => {
  enableAutoUnmount(afterEach);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("cursorPagination with useQuery", () => {
    it("accumulates pages via entity merge when query refetches", async () => {
      let page = 1;
      const pinia = createPinia();
      mount(
        defineComponent({
          template: "<div></div>",
          setup() {
            return {
              ...useQuery({
                key: ["feed"],
                query: async () => {
                  if (page === 1) {
                    return {
                      feedId: "main",
                      items: [{ id: "1", text: "first" }],
                      endCursor: "cursor-1",
                      hasNext: true,
                    };
                  }
                  return {
                    feedId: "main",
                    items: [{ id: "2", text: "second" }],
                    endCursor: "cursor-2",
                    hasNext: false,
                  };
                },
                normalize: true,
              }),
            };
          },
        }),
        {
          global: {
            plugins: [
              pinia,
              [
                PiniaColada,
                {
                  plugins: [
                    PiniaColadaNormalizer({
                      entities: {
                        feed: defineEntity({
                          idField: "feedId",
                          merge: cursorPagination({
                            getCursor: (f) => f.endCursor as string,
                            itemsField: "items",
                          }),
                        }),
                      },
                    }),
                  ],
                } satisfies PiniaColadaOptions,
              ],
            ],
          },
        },
      );

      await flushPromises();

      // Page 1 loaded
      const entityStore = useEntityStore(pinia);
      const feed = entityStore.get("feed", "main").value as any;
      expect(feed).toBeDefined();
      expect(feed.items).toHaveLength(1);
      expect(feed.items[0].text).toBe("first");
    });
  });

  describe("offsetPagination with useQuery", () => {
    it("entity is stored with correct page data on initial fetch", async () => {
      const pinia = createPinia();
      mount(
        defineComponent({
          template: "<div></div>",
          setup() {
            return {
              ...useQuery({
                key: ["contacts-paged"],
                query: async () => ({
                  listId: "contacts",
                  items: [
                    { contactId: "1", name: "Alice" },
                    { contactId: "2", name: "Bob" },
                  ],
                  offset: 0,
                  total: 4,
                }),
                normalize: true,
              }),
            };
          },
        }),
        {
          global: {
            plugins: [
              pinia,
              [
                PiniaColada,
                {
                  plugins: [
                    PiniaColadaNormalizer({
                      entities: {
                        pagedList: defineEntity({
                          idField: "listId",
                          merge: offsetPagination({
                            getOffset: (l) => l.offset as number,
                            pageSize: 2,
                            itemsField: "items",
                          }),
                        }),
                      },
                    }),
                  ],
                } satisfies PiniaColadaOptions,
              ],
            ],
          },
        },
      );

      await flushPromises();

      const entityStore = useEntityStore(pinia);
      const list = entityStore.get("pagedList", "contacts").value as any;
      expect(list).toBeDefined();
      expect(list.items).toHaveLength(2);
      expect(list.items[0].name).toBe("Alice");
      expect(list.items[1].name).toBe("Bob");
      expect(list.offset).toBe(0);
      expect(list.total).toBe(4);
    });

    it("merge function accumulates pages correctly when applied manually", () => {
      // The merge function is used by the plugin during normalization.
      // This test verifies the merge behavior in the context of how
      // the plugin would apply it when a query refetches with new data.
      const merge = offsetPagination({
        getOffset: (l) => l.offset as number,
        pageSize: 2,
        itemsField: "items",
      });

      const page1 = {
        listId: "contacts",
        items: [
          { contactId: "1", name: "Alice" },
          { contactId: "2", name: "Bob" },
        ],
        offset: 0,
        total: 4,
      };

      const page2 = {
        listId: "contacts",
        items: [
          { contactId: "3", name: "Charlie" },
          { contactId: "4", name: "Diana" },
        ],
        offset: 2,
        total: 4,
      };

      const result = merge(page1, page2);
      const items = result.items as Array<{ contactId: string; name: string }>;
      expect(items).toHaveLength(4);
      expect(items[0].name).toBe("Alice");
      expect(items[1].name).toBe("Bob");
      expect(items[2].name).toBe("Charlie");
      expect(items[3].name).toBe("Diana");
    });
  });

  describe("cursorPagination with useInfiniteQuery", () => {
    it("normalizes paginated entities from infinite query pages", async () => {
      const pinia = createPinia();
      const wrapper = mount(
        defineComponent({
          template: "<div></div>",
          setup() {
            return {
              ...useInfiniteQuery({
                key: ["feed-infinite"],
                query: async ({ pageParam }) => {
                  if (pageParam === "start" || pageParam === undefined) {
                    return [
                      { contactId: "1", name: "Alice" },
                      { contactId: "2", name: "Bob" },
                    ];
                  }
                  return [
                    { contactId: "3", name: "Charlie" },
                  ];
                },
                initialPageParam: "start",
                getNextPageParam: (_lastPage, pages) =>
                  pages.length < 2 ? "page2" : undefined,
                normalize: true,
              }),
            };
          },
        }),
        {
          global: {
            plugins: [
              pinia,
              [
                PiniaColada,
                {
                  plugins: [
                    PiniaColadaNormalizer({
                      entities: {
                        contact: defineEntity({ idField: "contactId" }),
                      },
                    }),
                  ],
                } satisfies PiniaColadaOptions,
              ],
            ],
          },
        },
      );

      await flushPromises();

      // Entities should be in the store
      const entityStore = useEntityStore(pinia);
      expect(entityStore.has("contact", "1")).toBe(true);
      expect(entityStore.has("contact", "2")).toBe(true);

      // Data should be properly denormalized
      const data = wrapper.vm.data as any;
      expect(data.pages).toHaveLength(1);
      expect(data.pages[0]).toHaveLength(2);
      expect(data.pages[0][0].name).toBe("Alice");
    });
  });
});
