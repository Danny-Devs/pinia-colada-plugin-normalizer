/**
 * Pinia Colada Normalizer plugin.
 *
 * Hooks into Pinia Colada's query cache via $onAction subscriptions:
 * 1. 'extend' — replace entry.state with a customRef that normalizes on write
 *    and denormalizes on read (the "customRef replacement" pattern).
 *
 * This eliminates the setEntryState after() hook entirely. Writes go through
 * the customRef setter (normalize), reads go through the getter (denormalize).
 * Transparent to all other plugins and application code.
 *
 * SSR-safe: entity store is scoped per Pinia instance via defineStore.
 *
 * Integration surface: 1 action hook (extend) + ext field.
 * Follows the delay plugin's pattern of replacing entry properties with customRef.
 * Eduardo confirmed this approach in Discussion #531.
 *
 * @module pinia-colada-plugin-normalizer
 */

import { customRef, onScopeDispose, shallowRef } from "vue";
import { pauseTracking, resetTracking } from "@vue/reactivity";
import type { PiniaColadaPlugin } from "@pinia/colada";
import { defineStore, type Pinia } from "pinia";
import type {
  EntityRecord,
  EntityRef,
  NormalizerPluginOptions,
  NormalizationResult,
  EntityStore,
  EntityDefinition,
  NormMeta,
} from "./types";
import { ENTITY_REF_MARKER, NORM_META_KEY } from "./types";
import { createEntityStore } from "./store";

/**
 * Split an entity key like 'contact:42' into ['contact', '42'].
 * @internal
 */
function splitEntityKey(key: string): [string, string] {
  const idx = key.indexOf(":");
  return [key.slice(0, idx), key.slice(idx + 1)];
}

/**
 * Write extracted entities to the store, respecting custom merge policies.
 * Entities with a custom merge function are processed individually;
 * the rest are batched for efficiency.
 * @internal
 */
function writeEntitiesToStore(
  entities: NormalizationResult["entities"],
  entityDefs: Record<string, EntityDefinition>,
  store: EntityStore,
): void {
  const customMergeEntities = entities.filter(
    (e) => entityDefs[e.entityType]?.merge,
  );
  const regularEntities = entities.filter(
    (e) => !entityDefs[e.entityType]?.merge,
  );

  if (regularEntities.length > 0) {
    store.setMany(regularEntities);
  }
  for (const entity of customMergeEntities) {
    const mergeFn = entityDefs[entity.entityType].merge!;
    if (store.has(entity.entityType, entity.id)) {
      const existing = store.get(entity.entityType, entity.id).value!;
      store.replace(entity.entityType, entity.id, mergeFn(existing, entity.data));
    } else {
      store.set(entity.entityType, entity.id, entity.data);
    }
  }
}

// ─────────────────────────────────────────────
// SSR-safe entity store via defineStore
// ─────────────────────────────────────────────

const NORMALIZER_STORE_ID = "_pc_normalizer";

/**
 * Pinia store that scopes the entity store per Pinia instance.
 * This prevents SSR cross-request contamination — each app gets its own store.
 * @internal
 */
const useNormalizerStore = /* @__PURE__ */ defineStore(NORMALIZER_STORE_ID, () => {
  let store: EntityStore = createEntityStore();
  let qCache: any = null;
  let eDefs: Record<string, EntityDefinition> = {};
  let defIdField = "id";
  function setStore(s: EntityStore) {
    store = s;
  }
  function getStore() {
    return store;
  }
  function setQueryCache(qc: any) {
    qCache = qc;
  }
  function getQueryCache() {
    return qCache;
  }
  function setEntityDefs(defs: Record<string, EntityDefinition>, defaultId: string) {
    eDefs = defs;
    defIdField = defaultId;
  }
  function getEntityDefs() {
    return { entityDefs: eDefs, defaultIdField: defIdField };
  }
  return { getStore, setStore, getQueryCache, setQueryCache, setEntityDefs, getEntityDefs };
});

// ─────────────────────────────────────────────
// Duplicate-install guard
// ─────────────────────────────────────────────

/**
 * Maps each Pinia instance to the plugin callback that installed the normalizer.
 * If a DIFFERENT callback tries to install on the same Pinia, it's a duplicate.
 * Re-installs from the same callback (e.g., multiple app.use(PiniaColada) sharing
 * one Pinia) are allowed — they just re-initialize the same config.
 * @internal
 */
const installedPluginByPinia = /* @__PURE__ */ new WeakMap<Pinia, Function>();

// ─────────────────────────────────────────────
// Plugin Factory
// ─────────────────────────────────────────────

/**
 * Creates the normalizer plugin for Pinia Colada.
 *
 * Architecture: customRef replacement pattern.
 * - In the `extend` hook, entry.state is replaced with a customRef.
 * - The setter normalizes incoming data (extracts entities, stores them,
 *   saves EntityRefs internally).
 * - The getter denormalizes on read (replaces EntityRefs with live store data).
 * - `setEntryState` calls `entry.state.value = state` which hits the setter.
 * - `useQuery` reads `entry.state.value` which hits the getter.
 * - All transparent to other plugins and application code.
 *
 * @example
 * ```typescript
 * import { PiniaColada } from '@pinia/colada'
 * import { PiniaColadaNormalizer, defineEntity } from 'pinia-colada-plugin-normalizer'
 *
 * app.use(PiniaColada, {
 *   plugins: [
 *     PiniaColadaNormalizer({
 *       entities: {
 *         contact: defineEntity({ idField: 'contactId' }),
 *       }
 *     })
 *   ]
 * })
 * ```
 */
export function PiniaColadaNormalizer(options: NormalizerPluginOptions = {}): PiniaColadaPlugin {
  const {
    entities: entityDefs = {},
    defaultIdField = "id",
    store: userStore,
    autoNormalize = false,
    autoRedirect = false,
  } = options;

  const pluginCallback: PiniaColadaPlugin = ({ queryCache, pinia, scope }) => {
    // Guard: prevent silent state overwrite from duplicate installation.
    // A different plugin callback on the same Pinia means two PiniaColadaNormalizer()
    // calls in the same plugins array — that's a bug. Re-installs from the same
    // callback (e.g., dualFactory sharing one Pinia across two app mounts) are fine.
    const existingPlugin = installedPluginByPinia.get(pinia);
    if (existingPlugin && existingPlugin !== pluginCallback) {
      throw new Error(
        "[pinia-colada-plugin-normalizer] PiniaColadaNormalizer is already installed on this Pinia instance. " +
          "Installing it twice would silently overwrite entity definitions and query cache. " +
          "Remove the duplicate plugin registration.",
      );
    }
    installedPluginByPinia.set(pinia, pluginCallback);

    // Get the per-Pinia-instance normalizer store (SSR-safe)
    const normalizerStore = useNormalizerStore(pinia);
    if (userStore) {
      normalizerStore.setStore(userStore);
    }
    normalizerStore.setQueryCache(queryCache);
    normalizerStore.setEntityDefs(entityDefs, defaultIdField);
    const entityStoreInstance = normalizerStore.getStore();

    // DevTools integration (dev-only, tree-shaken in production)
    if (process.env.NODE_ENV !== "production") {
      const app = (pinia as any)._a;
      if (app) {
        import("./devtools").then(({ setupDevtools }) => {
          setupDevtools(app, entityStoreInstance);
        });
      }
    }

    queryCache.$onAction(({ name, args }) => {
      // ── extend: initialize ext + customRef replacement ──
      // Called once per entry creation. Must use scope.run() for reactive refs.
      // Must define ALL ext keys here (cannot add new keys later).
      //
      // We replace entry.state with a customRef that:
      // - setter: normalizes incoming data (extract entities → store → save refs)
      // - getter: denormalizes on read (replace EntityRefs with live entity data)
      //
      // This follows the delay plugin's pattern of replacing entry.asyncStatus.
      if (name === "extend") {
        const [entry] = args;
        scope.run(() => {
          // Initialize ext metadata
          entry.ext[NORM_META_KEY] = shallowRef<NormMeta>({
            isNormalized: false,
            entityKeys: new Set<string>(),
          });

          // ── Auto-redirect: serve cached entity as placeholderData ──
          // If autoRedirect is enabled (or per-query redirect is configured),
          // check if the query key matches a [entityType, id] pattern and
          // the entity exists in the store. If so, inject it as placeholderData
          // for instant display while the real query fetches.
          const redirectOpt = entry.options?.redirect;
          if (redirectOpt !== false && entry.state.value.status === "pending") {
            let redirectEntityType: string | undefined;
            let redirectId: string | undefined;

            if (redirectOpt && typeof redirectOpt === "object") {
              // Explicit per-query redirect config
              redirectEntityType = redirectOpt.entityType;
              redirectId = redirectOpt.getId
                ? redirectOpt.getId(entry.key)
                : entry.key.length >= 2 ? String(entry.key[1]) : undefined;
            } else if (autoRedirect && entry.key.length === 2 && typeof entry.key[0] === "string") {
              // Convention-based: [entityType, id] where entityType is registered
              const candidateType = entry.key[0];
              if (candidateType in entityDefs) {
                redirectEntityType = candidateType;
                redirectId = String(entry.key[1]);
              }
            }

            if (redirectEntityType && redirectId
              && !(entry as any).placeholderData
              && entityStoreInstance.has(redirectEntityType, redirectId)) {
              const rawEntity = entityStoreInstance.get(redirectEntityType, redirectId).value;
              if (rawEntity != null) {
                // Denormalize to resolve nested EntityRefs before handing to the template
                (entry as any).placeholderData = denormalize(rawEntity, entityStoreInstance);
              }
            }
          }

          // Check if this query should be normalized
          const shouldNormalize = entry.options?.normalize ?? autoNormalize;
          if (!shouldNormalize) return;

          // Capture the current state value — this becomes our internal storage.
          // The customRef manages this directly instead of delegating to the
          // original ShallowRef.
          let rawState = entry.state.value;

          // Per-entity denormalization cache for structural sharing.
          // Maps entityKey → { entity: last ShallowRef value, result: denormalized output }.
          // When an entity's ShallowRef value hasn't changed (same object reference),
          // we return the cached denormalized subtree — same reference, no re-renders.
          const denormCache = new Map<string, { entity: EntityRecord; result: unknown }>();

          // Cached top-level state object — returned if denormalized data is the same ref.
          type State = typeof rawState;
          let cachedState: State | null = null;
          let cachedData: unknown = null;

          // Shared trigger function — set inside customRef, used by the subscriber
          // to notify the customRef when a referenced entity changes.
          let triggerCustomRef: (() => void) | null = null;

          // Invalidate denorm cache when a REFERENCED entity changes.
          // Two checks:
          // 1. denormCache.has(key) — entity was denormalized on a previous read
          // 2. entityKeys.includes(key) — entity is referenced by this query's
          //    normalized data but was missing at denormalization time (returned
          //    undefined, never entered denormCache). Without this check, entities
          //    that arrive after the first denormalization would never trigger
          //    a re-render because no reactive dependency was created for them.
          const unsubDenormWatcher = entityStoreInstance.subscribe((event) => {
            const inCache = denormCache.has(event.key);
            const inEntityKeys =
              !inCache && entry.ext[NORM_META_KEY].value.entityKeys.has(event.key);

            if (inCache || inEntityKeys) {
              denormCache.clear();
              cachedState = null;
              cachedData = null;
              // Trigger the customRef so consumers re-read denormalized data.
              // For entity updates, Vue reactivity from store.get().value would
              // also trigger re-reads. But for removals (shallowRef orphaned, not
              // reassigned) and for entityKeys-only hits (entity was missing at
              // first read), no reactive dep exists — we must trigger manually.
              // Calling trigger redundantly for updates is harmless (Vue batches).
              if (triggerCustomRef) {
                triggerCustomRef();
              }
            }
          });

          // Clean up subscription when the effect scope is disposed (SSR teardown).
          // This prevents memory leaks when the app is unmounted without going
          // through the 'remove' action for every entry.
          onScopeDispose(unsubDenormWatcher);

          // Also store on the entry for cleanup on explicit entry removal.
          // Using a non-enumerable property to avoid polluting the entry.
          Object.defineProperty(entry, "_normUnsub", {
            value: unsubDenormWatcher,
            configurable: true,
          });

          // Expose raw (normalized) state accessor for deleteEntity.
          // This allows operating on EntityRefs directly for type-safe
          // matching, avoiding cross-type false positives.
          Object.defineProperty(entry, "_normRawState", {
            get: () => rawState,
            configurable: true,
          });

          // Replace entry.state with a customRef that normalizes on write
          // and denormalizes on read.
          entry.state = customRef((track, trigger) => {
            triggerCustomRef = trigger;
            return {
              get(): State {
                track();
                // Denormalize on read: replace EntityRefs with live store data.
                //
                // pauseTracking() prevents denormalize's ShallowRef reads from
                // leaking into the component's reactive scope. Without this,
                // each entity read during denormalize creates a direct dependency
                // from the component to that entity's ShallowRef — redundant
                // because the subscriber mechanism (above) already handles
                // triggering re-reads via triggerCustomRef(). The leaked deps
                // cause double-firing on entity updates.
                //
                // This pattern matches Pinia's internal use of pauseTracking
                // from @vue/reactivity. Note: this is an internal Vue API with
                // no semver stability guarantee, but is stable in practice and
                // used by Pinia, VueUse, and Vue core itself.
                if (rawState.status === "success" && rawState.data != null) {
                  pauseTracking();
                  let data: unknown;
                  try {
                    data = denormalize(rawState.data, entityStoreInstance, denormCache);
                  } finally {
                    resetTracking();
                  }
                  // Structural sharing: return the same state object if data hasn't changed
                  if (data === cachedData && cachedState != null) {
                    return cachedState;
                  }
                  cachedData = data;
                  cachedState = { ...rawState, data } as State;
                  return cachedState;
                }
                return rawState;
              },
              set(incoming: State) {
                // Short-circuit: skip normalization if same reference
                if (incoming === rawState) return;

                // Normalize on write: extract entities, replace with refs.
                // Wrapped in try/catch so a malformed response doesn't crash
                // the query cache — falls back to storing raw data.
                if (incoming.status === "success" && incoming.data != null) {
                  let result: NormalizationResult;
                  try {
                    result = normalize(incoming.data, entityDefs, defaultIdField);
                  } catch (err) {
                    console.warn(
                      "[pinia-colada-plugin-normalizer] normalize() threw — storing raw data.",
                      err,
                    );
                    rawState = incoming;
                    cachedState = null;
                    cachedData = null;
                    trigger();
                    return;
                  }
                  if (result.entities.length > 0) {
                    writeEntitiesToStore(result.entities, entityDefs, entityStoreInstance);

                    // GC lifecycle: retain new keys FIRST, then release old ones.
                    // This order prevents a transient zero-refcount window for
                    // entities present in both old and new sets.
                    const newEntityKeys = new Set(
                      result.entities.map((e) => `${e.entityType}:${e.id}`),
                    );
                    for (const key of newEntityKeys) {
                      const [type, id] = splitEntityKey(key);
                      entityStoreInstance.retain(type, id);
                    }
                    const oldMeta = entry.ext[NORM_META_KEY].value;
                    if (oldMeta.isNormalized) {
                      for (const key of oldMeta.entityKeys) {
                        const [type, id] = splitEntityKey(key);
                        entityStoreInstance.release(type, id);
                      }
                    }

                    // Update ext metadata via ShallowRef .value
                    entry.ext[NORM_META_KEY].value = {
                      isNormalized: true,
                      entityKeys: newEntityKeys,
                    };

                    rawState = { ...incoming, data: result.normalized } as State;
                  } else {
                    rawState = incoming;
                  }
                } else {
                  rawState = incoming;
                }
                // Invalidate top-level cache on any setter call
                cachedState = null;
                cachedData = null;
                trigger();
              },
            };
          }) as typeof entry.state;
        });
      }

      // ── remove: release entity refs for GC + cleanup subscription ──
      // When a query entry is removed (GC or manual), release its entity keys
      // so gc() can collect unreferenced entities, and unsubscribe the
      // denorm cache watcher to prevent memory leaks.
      if (name === "remove") {
        const [entry] = args;
        const meta = (entry as any).ext?.[NORM_META_KEY]?.value as NormMeta | undefined;
        if (meta?.isNormalized) {
          for (const key of meta.entityKeys) {
            const [type, id] = splitEntityKey(key);
            entityStoreInstance.release(type, id);
          }
        }
        // Unsubscribe the denorm cache watcher
        const unsub = (entry as any)._normUnsub as (() => void) | undefined;
        if (unsub) unsub();
      }
    });
  };

  return pluginCallback;
}

// ─────────────────────────────────────────────
// Entity Store Access (SSR-safe)
// ─────────────────────────────────────────────

/**
 * Returns the entity store instance used by the normalizer plugin.
 * SSR-safe: uses defineStore to scope per Pinia instance.
 * Must be called after the plugin is installed.
 *
 * In component setup or composables, Pinia is auto-detected via inject.
 * Outside component context (e.g., standalone services), pass the Pinia
 * instance explicitly — same pattern as `useMutationCache(pinia)`.
 *
 * @param pinia - Optional Pinia instance. Required outside component setup.
 *
 * @example
 * ```typescript
 * import { useEntityStore } from 'pinia-colada-plugin-normalizer'
 *
 * // In a component or composable (auto-detected):
 * const entityStore = useEntityStore()
 *
 * // Outside component context (e.g., WebSocket service):
 * const entityStore = useEntityStore(pinia)
 *
 * ws.on('CONTACT_UPDATED', (data) => {
 *   entityStore.set('contact', data.contactId, data)
 * })
 * ```
 */
export function useEntityStore(pinia?: Pinia): EntityStore {
  const normalizerStore = pinia ? useNormalizerStore(pinia) : useNormalizerStore();
  return normalizerStore.getStore();
}

/**
 * Invalidates (marks stale + refetches) all active queries that reference
 * the given entity. Use this when you know an entity is stale and want
 * dependent queries to refetch from the server.
 *
 * For WebSocket apps: usually you DON'T need this — entity store updates
 * propagate automatically via reactivity. Use this when you want to
 * force a server round-trip (e.g., after entity removal, or when you
 * receive a "stale" signal without the actual data).
 *
 * In component setup or composables, Pinia is auto-detected via inject.
 * Outside component context, pass the Pinia instance explicitly.
 *
 * @param entityType - The entity type (e.g., 'contact')
 * @param id - The entity ID (e.g., '42')
 * @param pinia - Optional Pinia instance. Required outside component setup.
 *
 * @example
 * ```typescript
 * import { invalidateEntity, useEntityStore } from 'pinia-colada-plugin-normalizer'
 *
 * // After removing an entity, refetch all queries that referenced it:
 * const entityStore = useEntityStore()
 * entityStore.remove('contact', '42')
 * invalidateEntity('contact', '42')
 *
 * // Or in a WebSocket handler for "entity deleted" events:
 * ws.on('CONTACT_DELETED', ({ contactId }) => {
 *   entityStore.remove('contact', contactId)
 *   invalidateEntity('contact', contactId)
 * })
 * ```
 */
export function invalidateEntity(entityType: string, id: string, pinia?: Pinia): void {
  const normalizerStore = pinia ? useNormalizerStore(pinia) : useNormalizerStore();
  const queryCache = normalizerStore.getQueryCache();

  if (!queryCache) {
    throw new Error(
      "[pinia-colada-plugin-normalizer] invalidateEntity() called before plugin installation. " +
        "Make sure PiniaColadaNormalizer is installed via PiniaColada plugins option.",
    );
  }

  const entityKey = `${entityType}:${id}`;

  // Scan all query entries for ones that reference this entity
  for (const entry of queryCache.getEntries()) {
    const meta = (entry as any).ext?.[NORM_META_KEY]?.value as NormMeta | undefined;
    if (meta?.isNormalized && meta.entityKeys.has(entityKey)) {
      // Refetch this entry — queryCache.fetch() re-runs the query function
      // and updates the entry state, which flows through our customRef setter.
      queryCache.fetch(entry).catch(() => {
        // Silently ignore fetch errors (entry may have been GC'd,
        // query may be disabled, etc.)
      });
    }
  }
}

/**
 * Update the data of a specific query, re-normalizing the result.
 *
 * The updater receives denormalized data (real entities, not refs)
 * and should return the new data. The result flows through the
 * customRef setter which re-normalizes it automatically.
 *
 * Use this for array operations (add/remove entities from list queries).
 *
 * @example
 * ```typescript
 * import { updateQueryData, useEntityStore } from 'pinia-colada-plugin-normalizer'
 *
 * // Add a new contact to a list query after creating it:
 * entityStore.set('contact', '99', newContact)
 * updateQueryData(['contacts'], (data) => [...(data as any[]), newContact])
 *
 * // Remove a contact from a list query:
 * updateQueryData(['contacts'], (data) =>
 *   (data as any[]).filter(c => c.contactId !== '42'))
 *
 * // Prepend to a list:
 * updateQueryData(['contacts'], (data) => [newContact, ...(data as any[])])
 * ```
 */
export function updateQueryData(
  key: unknown[],
  updater: (currentData: unknown) => unknown,
  pinia?: Pinia,
): void {
  const normalizerStore = pinia ? useNormalizerStore(pinia) : useNormalizerStore();
  const queryCache = normalizerStore.getQueryCache();

  if (!queryCache) {
    throw new Error(
      "[pinia-colada-plugin-normalizer] updateQueryData() called before plugin installation.",
    );
  }

  // Use Pinia Colada's built-in setQueryData — it reads via our getter
  // (denormalized) and writes via our setter (normalizes).
  queryCache.setQueryData(key, updater);
}

/**
 * Returns a function that normalizes arbitrary data into the entity store.
 * Use this in mutation `onSuccess` handlers to auto-extract entities
 * from server responses — no manual `entityStore.set()` calls needed.
 *
 * Entities are stored as "untracked" (no retain/release), same as
 * WebSocket-created entities. They are immune to GC.
 *
 * **Important**: If using with optimistic updates, the optimistic
 * transaction should be committed (or will be rolled back on error)
 * before the server response is normalized. The standard `onMutate` →
 * `onSuccess` → `onError` lifecycle handles this correctly when using
 * `apply()` which auto-rolls-back on error.
 *
 * @example
 * ```typescript
 * import { useNormalizeMutation, useOptimisticUpdate } from 'pinia-colada-plugin-normalizer'
 *
 * // Basic usage — auto-extract entities from mutation response:
 * const normalizeMutation = useNormalizeMutation()
 * const { mutate } = useMutation({
 *   mutation: (data) => api.updateContact(data),
 *   onSuccess: (response) => normalizeMutation(response),
 * })
 *
 * // With optimistic updates:
 * const { apply } = useOptimisticUpdate()
 * const { mutate } = useMutation({
 *   mutation: (data) => api.updateContact(data),
 *   onMutate: (data) => apply('contact', data.contactId, data),
 *   onSuccess: (response) => normalizeMutation(response),
 *   onError: (_err, _vars, rollback) => rollback?.(),
 * })
 * ```
 */
export function useNormalizeMutation(pinia?: Pinia): (data: unknown) => void {
  const normalizerStore = pinia ? useNormalizerStore(pinia) : useNormalizerStore();
  const entityStoreInstance = normalizerStore.getStore();
  const { entityDefs, defaultIdField } = normalizerStore.getEntityDefs();

  return (data: unknown) => {
    const result = normalize(data, entityDefs, defaultIdField);
    if (result.entities.length > 0) {
      writeEntitiesToStore(result.entities, entityDefs, entityStoreInstance);
    }
  };
}

/**
 * Delete an entity completely — removes from the entity store AND
 * from all normalized query data that references it.
 *
 * Scans all query entries, finds ones that reference the entity,
 * and removes it from any arrays in the query data. Non-array data
 * is left unchanged (use `invalidateEntity` to refetch instead).
 *
 * Uses the normalized (raw) state for type-safe matching — EntityRefs
 * carry both `entityType` and `id`, so there's no ambiguity even when
 * multiple entity types share the same `idField` name.
 *
 * @example
 * ```typescript
 * import { deleteEntity } from 'pinia-colada-plugin-normalizer'
 *
 * // Delete a contact — removes from entity store + all list queries:
 * deleteEntity('contact', '42')
 *
 * // In a WebSocket handler:
 * ws.on('CONTACT_DELETED', ({ contactId }) => {
 *   deleteEntity('contact', contactId)
 * })
 * ```
 */
export function deleteEntity(entityType: string, id: string, pinia?: Pinia): void {
  const normalizerStore = pinia ? useNormalizerStore(pinia) : useNormalizerStore();
  const queryCache = normalizerStore.getQueryCache();
  const entityStoreInstance = normalizerStore.getStore();

  if (!queryCache) {
    throw new Error(
      "[pinia-colada-plugin-normalizer] deleteEntity() called before plugin installation.",
    );
  }

  const entityKey = `${entityType}:${id}`;

  // Operate on NORMALIZED data (rawState) which contains EntityRefs.
  // EntityRefs have explicit entityType + id, so matching is type-safe —
  // no false positives when different entity types share the same idField.
  for (const entry of queryCache.getEntries()) {
    const meta = (entry as any).ext?.[NORM_META_KEY]?.value as NormMeta | undefined;
    if (!meta?.isNormalized || !meta.entityKeys.has(entityKey)) continue;

    // Access the raw normalized state (contains EntityRefs, not denormalized data)
    const rawState = (entry as any)._normRawState;
    if (!rawState || rawState.status !== "success" || rawState.data == null) continue;

    // Remove matching EntityRefs from arrays in the normalized data
    const newData = removeRefFromData(rawState.data, entityType, id);
    if (newData !== rawState.data) {
      // Denormalize the cleaned data, then write back through the customRef
      // setter which re-normalizes it. This ensures all internal state
      // (rawState, entityKeys, GC refcounts) stays consistent.
      const denormalized = denormalize(newData, entityStoreInstance);
      const currentState = entry.state.value;
      entry.state.value = { ...currentState, data: denormalized };
    }
  }

  // Remove from entity store AFTER updating queries
  entityStoreInstance.remove(entityType, id);
}

/**
 * Recursively remove EntityRefs matching entityType+id from arrays
 * in normalized data. Operates on the raw normalized state where
 * entities are represented as EntityRef objects with explicit
 * entityType and id — no heuristic field matching needed.
 *
 * Returns the same reference if nothing changed (structural sharing).
 * @internal
 */
function removeRefFromData(data: unknown, entityType: string, id: string): unknown {
  if (data == null || typeof data !== "object") return data;

  if (Array.isArray(data)) {
    const filtered = data.filter((item) => {
      if (item == null || typeof item !== "object") return true;
      const record = item as Record<string | symbol, unknown>;
      // Match EntityRefs by their explicit entityType + id
      if (isEntityRef(record)) {
        return !(record.entityType === entityType && record.id === id);
      }
      return true;
    });
    if (filtered.length === data.length) {
      // Nothing removed at this level — recurse into items
      let changed = false;
      const result = data.map((item) => {
        const newItem = removeRefFromData(item, entityType, id);
        if (newItem !== item) changed = true;
        return newItem;
      });
      return changed ? result : data;
    }
    // Items were filtered out — also recurse into remaining items
    return filtered.map((item) => removeRefFromData(item, entityType, id));
  }

  // Skip EntityRefs themselves (they're leaf nodes in normalized data)
  const record = data as Record<string | symbol, unknown>;
  if (isEntityRef(record)) return data;

  // Walk object properties
  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const newValue = removeRefFromData(value, entityType, id);
    result[key] = newValue;
    if (newValue !== value) changed = true;
  }
  return changed ? result : data;
}

// ─────────────────────────────────────────────
// Normalization Engine
// ─────────────────────────────────────────────

/**
 * Walks a data structure, extracts entities (objects with IDs),
 * and replaces them with EntityRef references.
 *
 * Non-entity data (no ID field, deeply nested hierarchies) is left as-is.
 * This is the "hybrid" approach — normalize selectively.
 *
 * Uses a WeakSet for circular reference detection (Issue #12 fix).
 * @internal
 */
export function normalize(
  data: unknown,
  entityDefs: Record<string, EntityDefinition>,
  defaultIdField: string,
): NormalizationResult {
  const extractedEntities: NormalizationResult["entities"] = [];
  const visited = new WeakSet<object>();

  const normalized = walkAndNormalize(data, entityDefs, defaultIdField, extractedEntities, visited);

  return { normalized, entities: extractedEntities };
}

function walkAndNormalize(
  data: unknown,
  entityDefs: Record<string, EntityDefinition>,
  defaultIdField: string,
  extracted: NormalizationResult["entities"],
  visited: WeakSet<object>,
): unknown {
  // Null / undefined / primitives — pass through
  if (data == null || typeof data !== "object") {
    return data;
  }

  // Circular reference protection (Issue #12 fix)
  if (visited.has(data)) {
    return data; // Return as-is, don't recurse
  }
  visited.add(data);

  // Arrays — walk each element
  if (Array.isArray(data)) {
    return data.map((item) =>
      walkAndNormalize(item, entityDefs, defaultIdField, extracted, visited),
    );
  }

  // Objects — check if this is an entity
  const record = data as EntityRecord;
  const entityInfo = identifyEntity(record, entityDefs, defaultIdField);

  if (entityInfo) {
    const { entityType, id } = entityInfo;

    // Recursively normalize nested entities within this entity
    const normalizedEntity: EntityRecord = {};
    for (const [key, value] of Object.entries(record)) {
      normalizedEntity[key] = walkAndNormalize(
        value,
        entityDefs,
        defaultIdField,
        extracted,
        visited,
      );
    }

    // Extract the entity
    extracted.push({ entityType, id, data: normalizedEntity });

    // Replace with a reference (using Symbol marker, Issue #13 fix)
    const ref: EntityRef = {
      [ENTITY_REF_MARKER]: true,
      entityType,
      id,
      key: `${entityType}:${id}`,
    };
    return ref;
  }

  // Not an entity — walk children but keep the structure intact
  const result: EntityRecord = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = walkAndNormalize(value, entityDefs, defaultIdField, extracted, visited);
  }
  return result;
}

/**
 * Determines if an object is an entity and extracts its type and ID.
 *
 * Resolution order:
 * 1. Check explicit entityDefs (by matching field names or getId function)
 * 2. Fall back to convention (has `defaultIdField` → entity)
 *    BUT only if the entity type can be determined (via __typename or entityDefs).
 *    Generic fallback to 'entity' type is DISABLED to prevent ID collisions
 *    between unrelated objects (Issue #7, #11 fix).
 *
 * Returns null if the object is not an entity.
 */
function identifyEntity(
  record: EntityRecord,
  entityDefs: Record<string, EntityDefinition>,
  defaultIdField: string,
): { entityType: string; id: string } | null {
  // Check explicit definitions first
  for (const [entityType, def] of Object.entries(entityDefs)) {
    if (def.getId) {
      const id = def.getId(record);
      if (id != null) return { entityType, id: String(id) };
    }
    if (def.idField && record[def.idField] != null) {
      return { entityType, id: String(record[def.idField]) };
    }
  }

  // Convention-based: look for the default ID field
  if (record[defaultIdField] != null) {
    // Only auto-detect if we can determine the type.
    // __typename is the GraphQL convention.
    // Without a type, we SKIP auto-detection to prevent ID collisions
    // between unrelated objects (e.g., user id:1 vs order id:1).
    if (typeof record.__typename === "string") {
      return { entityType: record.__typename, id: String(record[defaultIdField]) };
    }
    // No type information available — skip normalization for this object.
    // Users should use defineEntity() for REST APIs without __typename.
    return null;
  }

  return null;
}

// ─────────────────────────────────────────────
// Denormalization Engine (recursive)
// ─────────────────────────────────────────────

/**
 * Denormalizes data by recursively replacing EntityRef references with live
 * entity data from the store.
 *
 * Used on the read path (customRef getter) and available as a public utility.
 * Entities in the store may themselves contain EntityRefs (nested entities),
 * so denormalization must be recursive.
 *
 * Supports structural sharing via an optional cache parameter: when provided,
 * returns the same object reference for entities whose ShallowRef value hasn't
 * changed — preventing unnecessary re-renders.
 *
 * Uses store.has() before store.get() to avoid creating phantom refs.
 * Uses a WeakSet for circular reference protection.
 * @internal
 */
export function denormalize(
  data: unknown,
  store: EntityStore,
  cache?: Map<string, { entity: EntityRecord; result: unknown }>,
): unknown {
  const visited = new WeakSet<object>();
  return walkAndDenormalize(data, store, visited, cache);
}

function walkAndDenormalize(
  data: unknown,
  store: EntityStore,
  visited: WeakSet<object>,
  cache?: Map<string, { entity: EntityRecord; result: unknown }>,
): unknown {
  if (data == null || typeof data !== "object") {
    return data;
  }

  if (visited.has(data as object)) {
    return data;
  }
  visited.add(data as object);

  if (Array.isArray(data)) {
    let changed = false;
    const result = data.map((item) => {
      const newItem = walkAndDenormalize(item, store, visited, cache);
      if (newItem !== item) changed = true;
      return newItem;
    });
    // Backtrack: allow this array to be revisited from other paths.
    // Circular refs are still caught because the array is in `visited`
    // during its own subtree traversal.
    visited.delete(data);
    return changed ? result : data;
  }

  const record = data as Record<string | symbol, unknown>;
  if (isEntityRef(record)) {
    const entityType = record.entityType as string;
    const id = record.id as string;

    // Check existence first to avoid creating phantom refs
    if (!store.has(entityType, id)) return undefined;

    // Read the ShallowRef — tracked by the outer computed for reactivity
    const entity = store.get(entityType, id).value;
    if (entity == null) return undefined;

    // Structural sharing: if cache provided and entity ref unchanged, reuse result
    if (cache) {
      const cacheKey = `${entityType}:${id}`;
      const cached = cache.get(cacheKey);
      if (cached && cached.entity === entity) {
        return cached.result;
      }
      const result = walkAndDenormalize(entity, store, visited, cache);
      cache.set(cacheKey, { entity, result });
      return result;
    }

    return walkAndDenormalize(entity, store, visited, cache);
  }

  // Walk children with structural sharing
  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const newValue = walkAndDenormalize(value, store, visited, cache);
    result[key] = newValue;
    if (newValue !== value) changed = true;
  }
  // Backtrack: allow this object to be revisited from other ref paths.
  // Circular refs are still caught because the object is in `visited`
  // during its own subtree traversal.
  visited.delete(data as object);
  return changed ? result : data;
}

function isEntityRef(obj: Record<string | symbol, unknown>): boolean {
  return obj[ENTITY_REF_MARKER] === true;
}
