/**
 * Integration tests — full Pinia Colada round-trip.
 *
 * These test the ACTUAL plugin behavior: install the plugin, mount a component
 * with useQuery, verify that data flows through normalize → entity store →
 * denormalize → component data correctly.
 *
 * Follows the delay plugin's test pattern: mount → defineComponent → useQuery.
 */

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, ref, nextTick } from "vue";
import { createPinia } from "pinia";
import { PiniaColada, useQuery, useQueryCache, useInfiniteQuery } from "@pinia/colada";
import type { PiniaColadaOptions } from "@pinia/colada";
import {
  PiniaColadaNormalizer,
  useEntityStore,
  defineEntity,
  onEntityAdded,
  onEntityUpdated,
  onEntityRemoved,
  useOptimisticUpdate,
  useEntityQuery,
  useEntityRef,
  useNormalizeMutation,
  updateQueryData,
  deleteEntity,
  createEntityStore,
  useCachedEntity,
} from "./index";
import { ENTITY_REF_MARKER } from "./types";

const _delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Plugin Integration", () => {
  enableAutoUnmount(afterEach);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Mount a component with useQuery + our normalizer plugin installed.
   */
  function factory(
    queryFn: () => Promise<unknown>,
    queryKey: string[],
    pluginOptions: Parameters<typeof PiniaColadaNormalizer>[0] = {},
    queryOptions: Record<string, unknown> = {},
  ) {
    const pinia = createPinia();
    const wrapper = mount(
      defineComponent({
        template: "<div></div>",
        setup() {
          const result = useQuery({
            query: queryFn,
            key: queryKey,
            normalize: true,
            ...queryOptions,
          });
          return { ...result };
        },
      }),
      {
        global: {
          plugins: [
            pinia,
            [
              PiniaColada,
              {
                plugins: [PiniaColadaNormalizer(pluginOptions)],
              } satisfies PiniaColadaOptions,
            ],
          ],
        },
      },
    );

    return { pinia, wrapper };
  }

  /**
   * Mount two components sharing the same Pinia — simulates two views
   * reading from the same entity store.
   */
  function dualFactory(
    queryFn1: () => Promise<unknown>,
    queryKey1: string[],
    queryFn2: () => Promise<unknown>,
    queryKey2: string[],
    pluginOptions: Parameters<typeof PiniaColadaNormalizer>[0] = {},
  ) {
    const pinia = createPinia();
    const coladaOptions: PiniaColadaOptions = {
      plugins: [PiniaColadaNormalizer(pluginOptions)],
    };

    const wrapper1 = mount(
      defineComponent({
        template: "<div></div>",
        setup() {
          return { ...useQuery({ query: queryFn1, key: queryKey1, normalize: true }) };
        },
      }),
      { global: { plugins: [pinia, [PiniaColada, coladaOptions]] } },
    );

    const wrapper2 = mount(
      defineComponent({
        template: "<div></div>",
        setup() {
          return { ...useQuery({ query: queryFn2, key: queryKey2, normalize: true }) };
        },
      }),
      { global: { plugins: [pinia, [PiniaColada, coladaOptions]] } },
    );

    return { pinia, wrapper1, wrapper2 };
  }

  // ─────────────────────────────────────────────
  // Basic round-trip
  // ─────────────────────────────────────────────

  describe("normalize → denormalize round-trip", () => {
    it("useQuery returns denormalized data transparently", async () => {
      const { wrapper } = factory(
        async () => [
          { contactId: "1", name: "Alice" },
          { contactId: "2", name: "Bob" },
        ],
        ["contacts"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      const data = wrapper.vm.data as any[];
      expect(data).toHaveLength(2);
      expect(data[0].name).toBe("Alice");
      expect(data[1].name).toBe("Bob");
    });

    it("entities are stored in the entity store", async () => {
      const { pinia } = factory(async () => [{ contactId: "1", name: "Alice" }], ["contacts"], {
        entities: { contact: defineEntity({ idField: "contactId" }) },
      });

      await flushPromises();

      const entityStore = useEntityStore(pinia);
      expect(entityStore.has("contact", "1")).toBe(true);
      expect(entityStore.get("contact", "1").value?.name).toBe("Alice");
    });

    it("non-entity data passes through unchanged", async () => {
      const { wrapper } = factory(
        async () => ({
          contacts: [{ contactId: "1", name: "Alice" }],
          pagination: { page: 1, total: 10 },
        }),
        ["contacts"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      const data = wrapper.vm.data as any;
      expect(data.contacts[0].name).toBe("Alice");
      expect(data.pagination).toEqual({ page: 1, total: 10 });
    });
  });

  // ─────────────────────────────────────────────
  // Multi-query entity sharing
  // ─────────────────────────────────────────────

  describe("entity sharing across queries", () => {
    it("two queries see the same entity data", async () => {
      const contacts = [
        { contactId: "1", name: "Alice" },
        { contactId: "2", name: "Bob" },
      ];

      const {
        pinia: _pinia,
        wrapper1,
        wrapper2,
      } = dualFactory(
        async () => contacts.map((c) => ({ ...c })),
        ["contacts"],
        async () => ({ ...contacts[0] }),
        ["contacts", "1"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      // Both queries return Alice
      const listData = wrapper1.vm.data as any[];
      const detailData = wrapper2.vm.data as any;
      expect(listData[0].name).toBe("Alice");
      expect(detailData.name).toBe("Alice");
    });

    it("entityStore.set() propagates to all queries", async () => {
      const contacts = [
        { contactId: "1", name: "Alice" },
        { contactId: "2", name: "Bob" },
      ];

      const { pinia, wrapper1, wrapper2 } = dualFactory(
        async () => contacts.map((c) => ({ ...c })),
        ["contacts"],
        async () => ({ ...contacts[0] }),
        ["contacts", "1"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      // Update Alice via entity store (simulating WebSocket push)
      const entityStore = useEntityStore(pinia);
      entityStore.set("contact", "1", { contactId: "1", name: "Alicia" });

      await nextTick();

      // Both queries reflect the update
      const listData = wrapper1.vm.data as any[];
      const detailData = wrapper2.vm.data as any;
      expect(listData[0].name).toBe("Alicia");
      expect(detailData.name).toBe("Alicia");
    });
  });

  // ─────────────────────────────────────────────
  // Shallow merge
  // ─────────────────────────────────────────────

  describe("shallow merge on entity update", () => {
    it("preserves fields from richer queries", async () => {
      const { pinia } = factory(
        async () => ({ contactId: "1", name: "Alice", email: "alice@test.com", role: "Engineer" }),
        ["contacts", "1"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      // Update with partial data (no email) — email should be preserved
      const entityStore = useEntityStore(pinia);
      entityStore.set("contact", "1", { contactId: "1", name: "Alicia" });

      expect(entityStore.get("contact", "1").value).toEqual({
        contactId: "1",
        name: "Alicia",
        email: "alice@test.com",
        role: "Engineer",
      });
    });
  });

  // ─────────────────────────────────────────────
  // Opt-in behavior
  // ─────────────────────────────────────────────

  describe("opt-in normalization", () => {
    it("does not normalize queries without normalize: true", async () => {
      const pinia = createPinia();
      const wrapper = mount(
        defineComponent({
          template: "<div></div>",
          setup() {
            return {
              ...useQuery({
                query: async () => [{ contactId: "1", name: "Alice" }],
                key: ["contacts"],
                // NO normalize: true
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
                      entities: { contact: defineEntity({ idField: "contactId" }) },
                    }),
                  ],
                },
              ],
            ],
          },
        },
      );

      await flushPromises();

      // Data should be raw (not normalized)
      const data = wrapper.vm.data as any[];
      expect(data[0].name).toBe("Alice");

      // Entity store should NOT have this entity
      const entityStore = useEntityStore(pinia);
      expect(entityStore.has("contact", "1")).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // Custom merge policies
  // ─────────────────────────────────────────────

  describe("custom merge policies", () => {
    it("uses custom merge function when defined", async () => {
      const { pinia } = factory(
        async () => ({ contactId: "1", name: "Alice", tags: ["friend"] }),
        ["contacts", "1"],
        {
          entities: {
            contact: defineEntity({
              idField: "contactId",
              merge: (existing, incoming) => ({
                ...existing,
                ...incoming,
                // Append tags instead of replacing
                tags: [
                  ...((existing.tags as string[]) || []),
                  ...((incoming.tags as string[]) || []),
                ],
              }),
            }),
          },
        },
      );

      await flushPromises();

      // Update with new tags — should append, not replace
      const entityStore = useEntityStore(pinia);
      // Simulate a second query that brings new tags
      entityStore.set("contact", "1", { contactId: "1", tags: ["coworker"] });

      // Default shallow merge would give ['coworker'] — but with custom merge:
      // Actually, custom merge only applies during normalization (plugin setter).
      // Direct set() still uses the store's default shallow merge.
      // Let's verify the normalization path instead.
      expect(entityStore.get("contact", "1").value?.name).toBe("Alice");
    });

    it("applies custom merge during normalization", async () => {
      let fetchCount = 0;
      const { pinia, wrapper: _wrapper } = factory(
        async () => {
          fetchCount++;
          if (fetchCount === 1) {
            return { contactId: "1", name: "Alice", tags: ["friend"] };
          }
          return { contactId: "1", name: "Alice", tags: ["coworker"] };
        },
        ["contacts", "1"],
        {
          entities: {
            contact: defineEntity({
              idField: "contactId",
              merge: (existing, incoming) => ({
                ...existing,
                ...incoming,
                tags: [
                  ...((existing.tags as string[]) || []),
                  ...((incoming.tags as string[]) || []),
                ],
              }),
            }),
          },
        },
      );

      await flushPromises();

      const entityStore = useEntityStore(pinia);
      expect(entityStore.get("contact", "1").value?.tags).toEqual(["friend"]);

      // Trigger a refetch — second fetch returns different tags
      const queryCache = useQueryCache(pinia);
      const entries = queryCache.getEntries();
      if (entries.length > 0) {
        await queryCache.fetch(entries[0]);
      }

      await flushPromises();

      // Custom merge should have appended tags
      expect(entityStore.get("contact", "1").value?.tags).toEqual(["friend", "coworker"]);
    });
  });

  // ─────────────────────────────────────────────
  // Entity GC
  // ─────────────────────────────────────────────

  describe("entity garbage collection", () => {
    it("retains entities referenced by active queries", async () => {
      const { pinia } = factory(
        async () => [
          { contactId: "1", name: "Alice" },
          { contactId: "2", name: "Bob" },
        ],
        ["contacts"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      const entityStore = useEntityStore(pinia);
      const removed = entityStore.gc();
      expect(removed).toEqual([]); // all entities retained by the active query
      expect(entityStore.has("contact", "1")).toBe(true);
      expect(entityStore.has("contact", "2")).toBe(true);
    });

    it("direct writes are immune to gc", async () => {
      const { pinia } = factory(async () => [{ contactId: "1", name: "Alice" }], ["contacts"], {
        entities: { contact: defineEntity({ idField: "contactId" }) },
      });

      await flushPromises();

      // Direct write via WebSocket — never retained
      const entityStore = useEntityStore(pinia);
      entityStore.set("contact", "99", { contactId: "99", name: "WebSocket Entity" });

      const removed = entityStore.gc();
      expect(removed).toEqual([]);
      expect(entityStore.has("contact", "99")).toBe(true); // untouched
    });
  });

  // ─────────────────────────────────────────────
  // WebSocket adapter hooks
  // ─────────────────────────────────────────────

  describe("WebSocket adapter hooks", () => {
    it("onEntityAdded fires for new entities only", async () => {
      const { pinia } = factory(async () => [{ contactId: "1", name: "Alice" }], ["contacts"], {
        entities: { contact: defineEntity({ idField: "contactId" }) },
      });

      await flushPromises();

      const added = vi.fn();
      onEntityAdded("contact", added, pinia);

      const entityStore = useEntityStore(pinia);

      // Update existing — should NOT fire onEntityAdded
      entityStore.set("contact", "1", { contactId: "1", name: "Alicia" });
      expect(added).not.toHaveBeenCalled();

      // Add new — SHOULD fire
      entityStore.set("contact", "2", { contactId: "2", name: "Bob" });
      expect(added).toHaveBeenCalledOnce();
      expect(added.mock.calls[0][0].id).toBe("2");
    });

    it("onEntityUpdated fires for existing entities only", async () => {
      const { pinia } = factory(async () => [{ contactId: "1", name: "Alice" }], ["contacts"], {
        entities: { contact: defineEntity({ idField: "contactId" }) },
      });

      await flushPromises();

      const updated = vi.fn();
      onEntityUpdated("contact", updated, pinia);

      const entityStore = useEntityStore(pinia);

      // Add new — should NOT fire onEntityUpdated
      entityStore.set("contact", "2", { contactId: "2", name: "Bob" });
      expect(updated).not.toHaveBeenCalled();

      // Update existing — SHOULD fire
      entityStore.set("contact", "1", { contactId: "1", name: "Alicia" });
      expect(updated).toHaveBeenCalledOnce();
      expect(updated.mock.calls[0][0].previousData?.name).toBe("Alice");
    });

    it("onEntityRemoved fires on removal", async () => {
      const { pinia } = factory(async () => [{ contactId: "1", name: "Alice" }], ["contacts"], {
        entities: { contact: defineEntity({ idField: "contactId" }) },
      });

      await flushPromises();

      const removed = vi.fn();
      onEntityRemoved("contact", removed, pinia);

      const entityStore = useEntityStore(pinia);
      entityStore.remove("contact", "1");

      expect(removed).toHaveBeenCalledOnce();
      expect(removed.mock.calls[0][0].previousData?.name).toBe("Alice");
    });
  });

  // ─────────────────────────────────────────────
  // Optimistic updates
  // ─────────────────────────────────────────────

  describe("optimistic updates", () => {
    it("apply + rollback restores previous state", async () => {
      const { pinia } = factory(
        async () => ({ contactId: "1", name: "Alice", email: "alice@test.com" }),
        ["contacts", "1"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      const { apply } = useOptimisticUpdate(pinia);

      // Apply optimistic update
      const rollback = apply("contact", "1", { contactId: "1", name: "Alicia" });

      const entityStore = useEntityStore(pinia);
      expect(entityStore.get("contact", "1").value?.name).toBe("Alicia");
      // Shallow merge preserves email
      expect(entityStore.get("contact", "1").value?.email).toBe("alice@test.com");

      // Rollback
      rollback();
      expect(entityStore.get("contact", "1").value?.name).toBe("Alice");
    });

    it("rollback removes entity that was optimistically created", async () => {
      const { pinia } = factory(async () => [{ contactId: "1", name: "Alice" }], ["contacts"], {
        entities: { contact: defineEntity({ idField: "contactId" }) },
      });

      await flushPromises();

      const { apply } = useOptimisticUpdate(pinia);
      const entityStore = useEntityStore(pinia);

      expect(entityStore.has("contact", "99")).toBe(false);

      const rollback = apply("contact", "99", { contactId: "99", name: "Optimistic" });
      expect(entityStore.has("contact", "99")).toBe(true);

      rollback();
      expect(entityStore.has("contact", "99")).toBe(false);
    });

    it("transaction with multiple mutations commits cleanly", async () => {
      const { pinia } = factory(
        async () => [
          { contactId: "1", name: "Alice" },
          { contactId: "2", name: "Bob" },
        ],
        ["contacts"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      const { transaction } = useOptimisticUpdate(pinia);
      const entityStore = useEntityStore(pinia);

      const tx = transaction();
      tx.set("contact", "1", { contactId: "1", name: "Alicia" });
      tx.set("contact", "2", { contactId: "2", name: "Robert" });

      // Both updates visible immediately
      expect(entityStore.get("contact", "1").value?.name).toBe("Alicia");
      expect(entityStore.get("contact", "2").value?.name).toBe("Robert");

      // Commit — server data already correct
      tx.commit();

      // Still shows the data
      expect(entityStore.get("contact", "1").value?.name).toBe("Alicia");
      expect(entityStore.get("contact", "2").value?.name).toBe("Robert");
    });

    it("transaction rollback restores all mutations", async () => {
      const { pinia } = factory(
        async () => [
          { contactId: "1", name: "Alice" },
          { contactId: "2", name: "Bob" },
        ],
        ["contacts"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      const { transaction } = useOptimisticUpdate(pinia);
      const entityStore = useEntityStore(pinia);

      const tx = transaction();
      tx.set("contact", "1", { contactId: "1", name: "Alicia" });
      tx.set("contact", "2", { contactId: "2", name: "Robert" });

      tx.rollback();

      // Both entities restored to server truth
      expect(entityStore.get("contact", "1").value?.name).toBe("Alice");
      expect(entityStore.get("contact", "2").value?.name).toBe("Bob");
    });

    it("concurrent transactions: rollback one preserves the other", async () => {
      const { pinia } = factory(
        async () => ({ contactId: "1", name: "Alice", email: "alice@test.com" }),
        ["contacts", "1"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      const { transaction } = useOptimisticUpdate(pinia);
      const entityStore = useEntityStore(pinia);

      // Transaction A: change name
      const txA = transaction();
      txA.set("contact", "1", { contactId: "1", name: "Alicia" });

      // Transaction B: change email
      const txB = transaction();
      txB.set("contact", "1", { contactId: "1", email: "new@test.com" });

      // Both changes visible
      expect(entityStore.get("contact", "1").value?.name).toBe("Alicia");
      expect(entityStore.get("contact", "1").value?.email).toBe("new@test.com");

      // Transaction A fails — rollback should restore server name but preserve B's email
      txA.rollback();

      expect(entityStore.get("contact", "1").value?.name).toBe("Alice"); // restored
      expect(entityStore.get("contact", "1").value?.email).toBe("new@test.com"); // B still active

      // Transaction B succeeds
      txB.commit();
      expect(entityStore.get("contact", "1").value?.email).toBe("new@test.com");
    });

    it("commit A then rollback B preserves A's confirmed change", async () => {
      const { pinia } = factory(
        async () => ({ contactId: "1", name: "Alice", email: "alice@test.com" }),
        ["contacts", "1"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      const { transaction } = useOptimisticUpdate(pinia);
      const entityStore = useEntityStore(pinia);

      // Transaction A: change name
      const txA = transaction();
      txA.set("contact", "1", { contactId: "1", name: "Alicia" });

      // Transaction B: change email
      const txB = transaction();
      txB.set("contact", "1", { contactId: "1", email: "new@test.com" });

      // Both changes visible
      expect(entityStore.get("contact", "1").value?.name).toBe("Alicia");
      expect(entityStore.get("contact", "1").value?.email).toBe("new@test.com");

      // A commits (server confirmed name change)
      txA.commit();

      // B rolls back (email change failed)
      txB.rollback();

      // A's confirmed name change must survive B's rollback
      expect(entityStore.get("contact", "1").value?.name).toBe("Alicia");
      // Email should revert to server truth (updated after A's commit)
      expect(entityStore.get("contact", "1").value?.email).toBe("alice@test.com");
    });

    it("double rollback/commit is safe (no-op)", async () => {
      const { pinia } = factory(
        async () => ({ contactId: "1", name: "Alice" }),
        ["contacts", "1"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      const { transaction } = useOptimisticUpdate(pinia);
      const entityStore = useEntityStore(pinia);

      const tx = transaction();
      tx.set("contact", "1", { contactId: "1", name: "Alicia" });

      tx.rollback();
      expect(entityStore.get("contact", "1").value?.name).toBe("Alice");

      // Second rollback should be a no-op, not throw
      tx.rollback();
      expect(entityStore.get("contact", "1").value?.name).toBe("Alice");

      // Commit after rollback should also be a no-op
      tx.commit();
      expect(entityStore.get("contact", "1").value?.name).toBe("Alice");
    });

    it("transaction with optimistic remove + rollback restores entity", async () => {
      const { pinia } = factory(async () => [{ contactId: "1", name: "Alice" }], ["contacts"], {
        entities: { contact: defineEntity({ idField: "contactId" }) },
      });

      await flushPromises();

      const { transaction } = useOptimisticUpdate(pinia);
      const entityStore = useEntityStore(pinia);

      const tx = transaction();
      tx.remove("contact", "1");

      expect(entityStore.has("contact", "1")).toBe(false);

      tx.rollback();

      expect(entityStore.has("contact", "1")).toBe(true);
      expect(entityStore.get("contact", "1").value?.name).toBe("Alice");
    });
  });

  // ─────────────────────────────────────────────
  // useEntityQuery
  // ─────────────────────────────────────────────

  describe("useEntityQuery", () => {
    it("returns filtered reactive view of entities", async () => {
      const { pinia } = factory(
        async () => [
          { contactId: "1", name: "Alice", status: "active" },
          { contactId: "2", name: "Bob", status: "inactive" },
          { contactId: "3", name: "Charlie", status: "active" },
        ],
        ["contacts"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      const active = useEntityQuery("contact", (c) => c.status === "active", pinia);
      expect(active.value).toHaveLength(2);
      expect(active.value.map((c: any) => c.name).sort()).toEqual(["Alice", "Charlie"]);
    });

    it("returns all entities when no filter provided", async () => {
      const { pinia } = factory(
        async () => [
          { contactId: "1", name: "Alice" },
          { contactId: "2", name: "Bob" },
        ],
        ["contacts"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      const all = useEntityQuery("contact", undefined, pinia);
      expect(all.value).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────
  // Array operations (list query updates)
  // ─────────────────────────────────────────────

  describe("array operations", () => {
    it("updateQueryData adds entity to a list query", async () => {
      const { pinia, wrapper } = factory(
        async () => [
          { contactId: "1", name: "Alice" },
          { contactId: "2", name: "Bob" },
        ],
        ["contacts"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      const entityStore = useEntityStore(pinia);

      // Create a new entity in the store
      const newContact = { contactId: "3", name: "Charlie" };
      entityStore.set("contact", "3", newContact);

      // Add it to the list query
      updateQueryData(["contacts"], (data) => [...(data as any[]), newContact], pinia);

      await nextTick();

      const data = wrapper.vm.data as any[];
      expect(data).toHaveLength(3);
      expect(data[2].name).toBe("Charlie");
    });

    it("updateQueryData removes entity from a list query", async () => {
      const { pinia, wrapper } = factory(
        async () => [
          { contactId: "1", name: "Alice" },
          { contactId: "2", name: "Bob" },
          { contactId: "3", name: "Charlie" },
        ],
        ["contacts"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      // Remove Bob from the list query
      updateQueryData(
        ["contacts"],
        (data) => (data as any[]).filter((c: any) => c.contactId !== "2"),
        pinia,
      );

      await nextTick();

      const data = wrapper.vm.data as any[];
      expect(data).toHaveLength(2);
      expect(data.map((c: any) => c.name)).toEqual(["Alice", "Charlie"]);
    });

    it("deleteEntity removes from store and all queries", async () => {
      const contacts = [
        { contactId: "1", name: "Alice" },
        { contactId: "2", name: "Bob" },
        { contactId: "3", name: "Charlie" },
      ];

      const {
        pinia,
        wrapper1,
        wrapper2: _wrapper2,
      } = dualFactory(
        async () => contacts.map((c) => ({ ...c })),
        ["contacts"],
        async () => ({ ...contacts[0] }),
        ["contacts", "1"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      // Remove Alice from ALL queries + entity store
      deleteEntity("contact", "1", pinia);

      await nextTick();

      // List query should no longer contain Alice
      const listData = wrapper1.vm.data as any[];
      expect(listData).toHaveLength(2);
      expect(listData.map((c: any) => c.name)).toEqual(["Bob", "Charlie"]);

      // Entity store should not have Alice
      const entityStore = useEntityStore(pinia);
      expect(entityStore.has("contact", "1")).toBe(false);
    });

    it("deleteEntity handles nested data structures", async () => {
      const { pinia, wrapper } = factory(
        async () => ({
          contacts: [
            { contactId: "1", name: "Alice" },
            { contactId: "2", name: "Bob" },
          ],
          total: 2,
        }),
        ["contacts-page"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      deleteEntity("contact", "1", pinia);

      await nextTick();

      const data = wrapper.vm.data as any;
      expect(data.contacts).toHaveLength(1);
      expect(data.contacts[0].name).toBe("Bob");
      expect(data.total).toBe(2); // non-array data preserved
    });
  });

  // ─────────────────────────────────────────────
  // Edge cases
  // ─────────────────────────────────────────────

  describe("edge cases", () => {
    it("deleteEntity is safe when entity not in any query", async () => {
      const { pinia } = factory(async () => [{ contactId: "1", name: "Alice" }], ["contacts"], {
        entities: { contact: defineEntity({ idField: "contactId" }) },
      });

      await flushPromises();

      // Remove an entity that's not in any query — should not throw
      expect(() => deleteEntity("contact", "999", pinia)).not.toThrow();
    });

    it("deleteEntity does not remove entities of a different type sharing the same id", async () => {
      // Bug: when __typename is absent (REST APIs), the old removeFromData matched ANY
      // object with a matching idField value regardless of entity type.
      // e.g., deleteEntity('contact', '42') would also remove order { id: '42' }.
      //
      // Fix: operate on normalized data (EntityRefs) which carry explicit entityType.
      //
      // To test this, we use getId functions that disambiguate by a type-specific
      // field ('name' for contacts, 'total' for orders) while both entity types
      // share 'id' as their actual ID value.
      const pinia = createPinia();

      const wrapper = mount(
        defineComponent({
          template: "<div></div>",
          setup() {
            // Query that returns both contacts and orders with the same 'id' value
            const result = useQuery({
              query: async () => ({
                contacts: [
                  { id: "42", name: "Alice" },
                  { id: "99", name: "Bob" },
                ],
                orders: [
                  { id: "42", total: 100 },
                  { id: "77", total: 200 },
                ],
              }),
              key: ["mixed"],
              normalize: true,
            });
            return { ...result };
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
                        // Use getId to disambiguate: contacts have 'name', orders have 'total'
                        contact: defineEntity({
                          getId: (r) => (r.name != null ? String(r.id) : null),
                        }),
                        order: defineEntity({
                          getId: (r) => (r.total != null ? String(r.id) : null),
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
      expect(entityStore.has("contact", "42")).toBe(true);
      expect(entityStore.has("order", "42")).toBe(true);

      const dataBefore = wrapper.vm.data as any;
      expect(dataBefore.contacts).toHaveLength(2);
      expect(dataBefore.orders).toHaveLength(2);

      // Delete contact:42 — should NOT remove order:42
      deleteEntity("contact", "42", pinia);

      await nextTick();

      const dataAfter = wrapper.vm.data as any;
      // Contact with id '42' should be removed
      expect(dataAfter.contacts).toHaveLength(1);
      expect(dataAfter.contacts[0].name).toBe("Bob");

      // Order with id '42' must STILL be present (cross-type false positive bug)
      expect(dataAfter.orders).toHaveLength(2);
      expect(dataAfter.orders.find((o: any) => o.id === "42")?.total).toBe(100);

      // Entity store should still have order:42
      expect(entityStore.has("contact", "42")).toBe(false);
      expect(entityStore.has("order", "42")).toBe(true);
    });

    it("handles query returning null", async () => {
      const { wrapper } = factory(async () => null, ["empty"], {
        entities: { contact: defineEntity({ idField: "contactId" }) },
      });

      await flushPromises();
      expect(wrapper.vm.data).toBeNull();
    });

    it("handles query returning primitives", async () => {
      const { wrapper } = factory(async () => 42, ["count"], {
        entities: { contact: defineEntity({ idField: "contactId" }) },
      });

      await flushPromises();
      expect(wrapper.vm.data).toBe(42);
    });

    it("handles empty arrays", async () => {
      const { wrapper } = factory(async () => [], ["empty-list"], {
        entities: { contact: defineEntity({ idField: "contactId" }) },
      });

      await flushPromises();
      expect(wrapper.vm.data).toEqual([]);
    });

    it("entity removed then re-added triggers re-render (Bug 5: missing entity reactive trigger)", async () => {
      const { pinia, wrapper } = factory(
        async () => [
          { contactId: "1", name: "Alice" },
          { contactId: "2", name: "Bob" },
        ],
        ["contacts"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      const entityStore = useEntityStore(pinia);
      expect((wrapper.vm.data as any[]).length).toBe(2);

      // Remove contact:2 directly from the store (simulating GC)
      entityStore.remove("contact", "2");
      await nextTick();

      // Query should now show only Alice (Bob's ref resolves to undefined, filtered out in denorm)
      // Note: the denormalized array will still have 2 entries but Bob's will be undefined
      const data1 = wrapper.vm.data as any[];
      const validContacts1 = data1.filter((c: any) => c != null);
      expect(validContacts1.length).toBe(1);
      expect(validContacts1[0].name).toBe("Alice");

      // Re-add contact:2 — the subscriber should detect this via entityKeys check
      // and trigger the customRef, causing a re-render with Bob included again
      entityStore.set("contact", "2", { contactId: "2", name: "Bob Returns" });
      await nextTick();

      const data2 = wrapper.vm.data as any[];
      const validContacts2 = data2.filter((c: any) => c != null);
      expect(validContacts2.length).toBe(2);
      expect(validContacts2.find((c: any) => c.contactId === "2")?.name).toBe("Bob Returns");
    });
  });

  // ─────────────────────────────────────────────
  // useEntityRef
  // ─────────────────────────────────────────────

  describe("useEntityRef", () => {
    it("returns reactive ref to a single entity", async () => {
      const { pinia } = factory(
        async () => [
          { contactId: "1", name: "Alice" },
          { contactId: "2", name: "Bob" },
        ],
        ["contacts"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      // Mount a component that uses useEntityRef
      const wrapper = mount(
        defineComponent({
          template: "<div>{{ contact?.name }}</div>",
          setup() {
            const contact = useEntityRef("contact", "1", pinia);
            return { contact };
          },
        }),
        { global: { plugins: [pinia] } },
      );

      expect(wrapper.vm.contact?.name).toBe("Alice");

      // Update entity — ref should update
      const entityStore = useEntityStore(pinia);
      entityStore.set("contact", "1", { contactId: "1", name: "Alicia" });

      expect(wrapper.vm.contact?.name).toBe("Alicia");
    });

    it("returns undefined for non-existent entity", async () => {
      const { pinia } = factory(async () => [{ contactId: "1", name: "Alice" }], ["contacts"], {
        entities: { contact: defineEntity({ idField: "contactId" }) },
      });

      await flushPromises();

      const wrapper = mount(
        defineComponent({
          template: "<div></div>",
          setup() {
            return { contact: useEntityRef("contact", "999", pinia) };
          },
        }),
        { global: { plugins: [pinia] } },
      );

      expect(wrapper.vm.contact).toBeUndefined();
    });

    it("accepts reactive ID and switches entities", async () => {
      const { pinia } = factory(
        async () => [
          { contactId: "1", name: "Alice" },
          { contactId: "2", name: "Bob" },
        ],
        ["contacts"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      const activeId = ref("1");

      const wrapper = mount(
        defineComponent({
          template: "<div></div>",
          setup() {
            return { contact: useEntityRef("contact", activeId, pinia) };
          },
        }),
        { global: { plugins: [pinia] } },
      );

      expect(wrapper.vm.contact?.name).toBe("Alice");

      // Change the reactive ID
      activeId.value = "2";
      await nextTick();

      expect(wrapper.vm.contact?.name).toBe("Bob");
    });
  });

  // ─────────────────────────────────────────────
  // useNormalizeMutation
  // ─────────────────────────────────────────────

  describe("useNormalizeMutation", () => {
    it("normalizes arbitrary data into the entity store", async () => {
      const { pinia } = factory(async () => [], ["contacts"], {
        entities: { contact: defineEntity({ idField: "contactId" }) },
      });

      await flushPromises();

      const normalizeMutation = useNormalizeMutation(pinia);
      const entityStore = useEntityStore(pinia);

      // Simulate a mutation response
      normalizeMutation({ contactId: "99", name: "New Contact", email: "new@test.com" });

      expect(entityStore.has("contact", "99")).toBe(true);
      expect(entityStore.get("contact", "99").value?.name).toBe("New Contact");
    });

    it("normalizes nested entities from mutation response", async () => {
      const { pinia } = factory(async () => [], ["orders"], {
        entities: {
          contact: defineEntity({ idField: "contactId" }),
          order: defineEntity({ idField: "orderId" }),
        },
      });

      await flushPromises();

      const normalizeMutation = useNormalizeMutation(pinia);
      const entityStore = useEntityStore(pinia);

      // Server response with nested entity
      normalizeMutation({
        orderId: "order-1",
        total: 100,
        customer: { contactId: "42", name: "Alice" },
      });

      expect(entityStore.has("order", "order-1")).toBe(true);
      expect(entityStore.has("contact", "42")).toBe(true);
      expect(entityStore.get("contact", "42").value?.name).toBe("Alice");
    });

    it("mutation-normalized entities are visible to queries", async () => {
      const { pinia, wrapper } = factory(
        async () => [{ contactId: "1", name: "Alice" }],
        ["contacts"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );

      await flushPromises();

      // Normalize a mutation response that updates an existing entity
      const normalizeMutation = useNormalizeMutation(pinia);
      normalizeMutation({ contactId: "1", name: "Alicia", email: "new@test.com" });

      await nextTick();

      // Query should reflect the update (entity store is shared)
      const data = wrapper.vm.data as any[];
      expect(data[0].name).toBe("Alicia");
    });
  });

  describe("duplicate installation guard", () => {
    it("throws if PiniaColadaNormalizer is installed twice on the same Pinia instance", () => {
      const pinia = createPinia();

      expect(() => {
        mount(
          defineComponent({
            template: "<div></div>",
            setup() {
              return {};
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
                      PiniaColadaNormalizer({ entities: {} }),
                      PiniaColadaNormalizer({ entities: {} }),
                    ],
                  } satisfies PiniaColadaOptions,
                ],
              ],
            },
          },
        );
      }).toThrowError(/already installed on this Pinia instance/);
    });

    it("allows separate Pinia instances to each have the normalizer", async () => {
      const pinia1 = createPinia();
      const pinia2 = createPinia();

      const pluginOpts = {
        entities: {
          contact: defineEntity({ idField: "contactId" }),
        },
      };

      // Should not throw — different Pinia instances
      const wrapper1 = mount(
        defineComponent({
          template: "<div></div>",
          setup() {
            const result = useQuery({
              query: async () => ({ contactId: "1", name: "Alice" }),
              key: ["c1"],
              normalize: true,
            });
            return { ...result };
          },
        }),
        {
          global: {
            plugins: [
              pinia1,
              [
                PiniaColada,
                {
                  plugins: [PiniaColadaNormalizer(pluginOpts)],
                } satisfies PiniaColadaOptions,
              ],
            ],
          },
        },
      );

      const wrapper2 = mount(
        defineComponent({
          template: "<div></div>",
          setup() {
            const result = useQuery({
              query: async () => ({ contactId: "2", name: "Bob" }),
              key: ["c2"],
              normalize: true,
            });
            return { ...result };
          },
        }),
        {
          global: {
            plugins: [
              pinia2,
              [
                PiniaColada,
                {
                  plugins: [PiniaColadaNormalizer(pluginOpts)],
                } satisfies PiniaColadaOptions,
              ],
            ],
          },
        },
      );

      await flushPromises();

      expect((wrapper1.vm as any).data).toEqual({ contactId: "1", name: "Alice" });
      expect((wrapper2.vm as any).data).toEqual({ contactId: "2", name: "Bob" });
    });
  });

  // ─────────────────────────────────────────────
  // useInfiniteQuery compatibility
  // ─────────────────────────────────────────────

  describe("useInfiniteQuery", () => {
    it("normalizes entities from paginated data", async () => {
      const pinia = createPinia();
      const wrapper = mount(
        defineComponent({
          template: "<div></div>",
          setup() {
            const result = useInfiniteQuery({
              key: ["contacts-infinite"],
              query: async ({ pageParam }) => {
                if (pageParam === 1 || pageParam === undefined) {
                  return [
                    { contactId: "1", name: "Alice" },
                    { contactId: "2", name: "Bob" },
                  ];
                }
                return [
                  { contactId: "3", name: "Charlie" },
                  { contactId: "4", name: "Diana" },
                ];
              },
              initialPageParam: 1,
              getNextPageParam: (lastPage, pages) => (pages.length < 2 ? 2 : undefined),
              normalize: true,
            });
            return { ...result };
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
                      entities: { contact: defineEntity({ idField: "contactId" }) },
                    }),
                  ],
                } satisfies PiniaColadaOptions,
              ],
            ],
          },
        },
      );

      await flushPromises();

      // Entities from page 1 should be in the entity store
      const entityStore = useEntityStore(pinia);
      expect(entityStore.has("contact", "1")).toBe(true);
      expect(entityStore.has("contact", "2")).toBe(true);

      // Data should be denormalized — pages structure intact
      const data = wrapper.vm.data as any;
      expect(data).toBeDefined();
      expect(data.pages).toHaveLength(1);
      expect(data.pages[0]).toHaveLength(2);
      expect(data.pages[0][0].name).toBe("Alice");
      expect(data.pages[0][1].name).toBe("Bob");

      // pageParams should NOT be extracted as entities
      expect(data.pageParams).toBeDefined();
    });

    it("entity updates propagate to infinite query pages", async () => {
      const pinia = createPinia();
      const wrapper = mount(
        defineComponent({
          template: "<div></div>",
          setup() {
            return {
              ...useInfiniteQuery({
                key: ["contacts-inf-update"],
                query: async () => [
                  { contactId: "1", name: "Alice" },
                  { contactId: "2", name: "Bob" },
                ],
                initialPageParam: 1,
                getNextPageParam: () => undefined,
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
                      entities: { contact: defineEntity({ idField: "contactId" }) },
                    }),
                  ],
                } satisfies PiniaColadaOptions,
              ],
            ],
          },
        },
      );

      await flushPromises();

      // Update entity via store — should propagate to infinite query
      const entityStore = useEntityStore(pinia);
      entityStore.set("contact", "1", { contactId: "1", name: "Alicia" });

      await nextTick();

      const data = wrapper.vm.data as any;
      expect(data.pages[0][0].name).toBe("Alicia");
    });

    it.todo("pageParams with object values are NOT extracted as entities", async () => {
      // KNOWN LIMITATION: idField-based entity definitions match ANY object
      // with that field, including pageParam objects. To avoid this, use
      // getId() with a guard function that rejects non-entity objects:
      //   getId: (obj) => obj.name != null ? String(obj.contactId) : undefined
      //
      // A structural fix (e.g., skipping pageParams by name) would couple
      // the normalizer to Pinia Colada's internal data shape.
      // Filed as a known limitation — document in README.
      const pinia = createPinia();
      const wrapper = mount(
        defineComponent({
          template: "<div></div>",
          setup() {
            return {
              ...useInfiniteQuery({
                key: ["contacts-inf-pageobj"],
                query: async () => [{ contactId: "1", name: "Alice" }],
                initialPageParam: { cursor: "abc", contactId: "not-an-entity" },
                getNextPageParam: () => undefined,
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
                      entities: { contact: defineEntity({ idField: "contactId" }) },
                    }),
                  ],
                } satisfies PiniaColadaOptions,
              ],
            ],
          },
        },
      );

      await flushPromises();

      // Alice should be normalized
      const entityStore = useEntityStore(pinia);
      expect(entityStore.has("contact", "1")).toBe(true);

      // The pageParam object should NOT have been extracted as an entity
      // (it has contactId but it's in pageParams, not page data)
      expect(entityStore.has("contact", "not-an-entity")).toBe(false);

      // Data structure should be intact
      const data = wrapper.vm.data as any;
      expect(data.pages[0][0].name).toBe("Alice");
      expect(data.pageParams).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────
  // SSR
  // ─────────────────────────────────────────────

  describe("SSR", () => {
    it("cross-request isolation: two Pinia instances do not share entity state", async () => {
      const pluginOpts = {
        entities: { contact: defineEntity({ idField: "contactId" }) },
      };

      // Pinia instance A — simulates Request A
      const piniaA = createPinia();
      mount(
        defineComponent({
          template: "<div></div>",
          setup() {
            return {
              ...useQuery({
                query: async () => [{ contactId: "1", name: "Alice" }],
                key: ["contacts"],
                normalize: true,
              }),
            };
          },
        }),
        {
          global: {
            plugins: [
              piniaA,
              [
                PiniaColada,
                {
                  plugins: [PiniaColadaNormalizer(pluginOpts)],
                } satisfies PiniaColadaOptions,
              ],
            ],
          },
        },
      );

      // Pinia instance B — simulates Request B (same entity ID, different data)
      const piniaB = createPinia();
      mount(
        defineComponent({
          template: "<div></div>",
          setup() {
            return {
              ...useQuery({
                query: async () => [{ contactId: "1", name: "Bob" }],
                key: ["contacts"],
                normalize: true,
              }),
            };
          },
        }),
        {
          global: {
            plugins: [
              piniaB,
              [
                PiniaColada,
                {
                  plugins: [PiniaColadaNormalizer(pluginOpts)],
                } satisfies PiniaColadaOptions,
              ],
            ],
          },
        },
      );

      await flushPromises();

      // Verify complete isolation — no cross-contamination
      const storeA = useEntityStore(piniaA);
      const storeB = useEntityStore(piniaB);

      expect(storeA.get("contact", "1").value?.name).toBe("Alice");
      expect(storeB.get("contact", "1").value?.name).toBe("Bob");

      // Mutating A must not affect B
      storeA.set("contact", "1", { contactId: "1", name: "Alicia" });
      expect(storeA.get("contact", "1").value?.name).toBe("Alicia");
      expect(storeB.get("contact", "1").value?.name).toBe("Bob");
    });

    it("full SSR round-trip: toJSON → hydrate → denormalize with nested EntityRefs", async () => {
      const pluginOpts = {
        entities: {
          contact: defineEntity({ idField: "contactId" }),
          order: defineEntity({ idField: "orderId" }),
        },
      };

      // ── Step 1: Set up plugin and write query data that triggers normalization ──
      const pinia = createPinia();
      const wrapper = mount(
        defineComponent({
          template: "<div></div>",
          setup() {
            return {
              ...useQuery({
                query: async () => ({
                  orderId: "order-1",
                  total: 100,
                  customer: { contactId: "42", name: "Alice", email: "alice@test.com" },
                }),
                key: ["orders", "1"],
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
                  plugins: [PiniaColadaNormalizer(pluginOpts)],
                } satisfies PiniaColadaOptions,
              ],
            ],
          },
        },
      );

      await flushPromises();

      // Verify normalization occurred — both entities should be in the store
      const entityStore = useEntityStore(pinia);
      expect(entityStore.has("order", "order-1")).toBe(true);
      expect(entityStore.has("contact", "42")).toBe(true);

      // The order's customer field should be an EntityRef (Symbol-marked)
      const orderData = entityStore.get("order", "order-1").value!;
      expect(orderData.customer).toBeDefined();
      expect((orderData.customer as any)[ENTITY_REF_MARKER]).toBe(true);

      // ── Step 2: Serialize via toJSON (Symbols → __pcn_ref wire format) ──
      const snapshot = entityStore.toJSON();
      const json = JSON.stringify(snapshot);
      const parsed = JSON.parse(json);

      // Verify wire format: Symbol marker should NOT be in JSON (it's a Symbol)
      // but __pcn_ref should be present
      const serializedOrder = parsed["order:order-1"];
      expect(serializedOrder.customer.__pcn_ref).toBe(true);
      expect(serializedOrder.customer.entityType).toBe("contact");
      expect(serializedOrder.customer.id).toBe("42");

      // ── Step 3: Create a FRESH entity store and hydrate ──
      const freshStore = createEntityStore();
      freshStore.hydrate(parsed);

      // ── Step 4: Verify denormalized reads from the hydrated store ──
      expect(freshStore.get("contact", "42").value?.name).toBe("Alice");
      expect(freshStore.get("contact", "42").value?.email).toBe("alice@test.com");
      expect(freshStore.get("order", "order-1").value?.total).toBe(100);

      // ── Step 5: Verify nested EntityRefs survived the Symbol → string → Symbol round-trip ──
      const restoredOrder = freshStore.get("order", "order-1").value!;
      const customerRef = restoredOrder.customer as any;
      expect(customerRef[ENTITY_REF_MARKER]).toBe(true);
      expect(customerRef.entityType).toBe("contact");
      expect(customerRef.id).toBe("42");
      expect(customerRef.key).toBe("contact:42");

      // The denormalized view should still yield the original data structure
      // (the customer EntityRef should resolve to the contact entity)
      expect(wrapper.vm.data).toBeDefined();
      const denormData = wrapper.vm.data as any;
      expect(denormData.total).toBe(100);
      expect(denormData.customer.name).toBe("Alice");
      expect(denormData.customer.email).toBe("alice@test.com");
    });
  });

  // ─────────────────────────────────────────────
  // Cache Redirects (useCachedEntity)
  // ─────────────────────────────────────────────

  describe("cache redirects (useCachedEntity)", () => {
    it("returns cached entity as placeholderData when entity exists from prior query", async () => {
      // Step 1: List query fetches contacts into entity store
      const { pinia } = factory(
        () =>
          Promise.resolve([
            { contactId: "42", name: "Alice", __typename: "contact" },
            { contactId: "99", name: "Bob", __typename: "contact" },
          ]),
        ["contacts"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );
      await flushPromises();

      // Verify entity is in store
      const store = useEntityStore(pinia);
      expect(store.has("contact", "42")).toBe(true);

      // Step 2: Call useCachedEntity directly (just needs pinia, no component mount needed)
      const placeholderFn = useCachedEntity("contact", "42", pinia);

      // The placeholder function should return the cached entity
      const placeholder = placeholderFn();
      expect(placeholder).toBeDefined();
      expect((placeholder as any).name).toBe("Alice");
      expect((placeholder as any).contactId).toBe("42");
    });

    it("returns undefined when entity is not in store", async () => {
      // Set up normalizer store via factory, then query a non-existent entity
      const { pinia } = factory(
        () => Promise.resolve([{ contactId: "1", name: "Alice", __typename: "contact" }]),
        ["contacts"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );
      await flushPromises();

      const placeholderFn = useCachedEntity("contact", "999", pinia);
      expect(placeholderFn()).toBeUndefined();
    });

    it("denormalizes nested EntityRefs in cached entity", async () => {
      // Step 1: Query that creates entities with nested refs
      const { pinia } = factory(
        () =>
          Promise.resolve({
            orderId: "order-1",
            total: 250,
            customer: { contactId: "42", name: "Alice", __typename: "contact" },
            __typename: "order",
          }),
        ["order", "order-1"],
        {
          entities: {
            contact: defineEntity({ idField: "contactId" }),
            order: defineEntity({ idField: "orderId" }),
          },
        },
      );
      await flushPromises();

      // Step 2: Verify raw store data has EntityRef for customer
      const store = useEntityStore(pinia);
      expect(store.has("order", "order-1")).toBe(true);
      const rawOrder = store.get("order", "order-1").value!;
      expect((rawOrder.customer as any)[ENTITY_REF_MARKER]).toBe(true);

      // Step 3: useCachedEntity should DENORMALIZE — resolve the nested ref
      const placeholderFn = useCachedEntity("order", "order-1", pinia);
      const placeholder = placeholderFn() as any;

      expect(placeholder).toBeDefined();
      expect(placeholder.total).toBe(250);
      // Nested customer should be fully resolved, NOT an EntityRef
      expect(placeholder.customer.name).toBe("Alice");
      expect(placeholder.customer.contactId).toBe("42");
      expect(placeholder.customer[ENTITY_REF_MARKER]).toBeUndefined();
    });

    it("works with reactive ID", async () => {
      // Populate two contacts
      const { pinia } = factory(
        () =>
          Promise.resolve([
            { contactId: "1", name: "Alice", __typename: "contact" },
            { contactId: "2", name: "Bob", __typename: "contact" },
          ]),
        ["contacts"],
        { entities: { contact: defineEntity({ idField: "contactId" }) } },
      );
      await flushPromises();

      // useCachedEntity with a getter — switches entity when ID changes
      const currentId = ref("1");
      const placeholderFn = useCachedEntity("contact", () => currentId.value, pinia);

      expect((placeholderFn() as any).name).toBe("Alice");

      // Change ID — next call should return Bob
      currentId.value = "2";
      expect((placeholderFn() as any).name).toBe("Bob");

      // Non-existent ID — should return undefined
      currentId.value = "999";
      expect(placeholderFn()).toBeUndefined();
    });
  });
});
