/**
 * Vue DevTools integration for pinia-colada-plugin-normalizer.
 *
 * Provides:
 * - Custom inspector panel (entity store contents, ref counts, metadata)
 * - Timeline events (entity set/remove, normalize/denormalize)
 * - Per-entity ref count display (retain/release for GC visibility)
 * - Query reference tracking (which queries reference each entity)
 * - Normalization metadata per query entry
 * - Entity dependency graph (nested EntityRef detection)
 *
 * Dev-only: the entire module is tree-shaken in production builds
 * because it's conditionally imported behind a NODE_ENV check.
 *
 * @module pinia-colada-plugin-normalizer/devtools
 * @internal
 */

import { setupDevToolsPlugin } from "@vue/devtools-api";
import type { EntityStore, EntityEvent, NormMeta, EntityRecord } from "./types";
import { ENTITY_REF_MARKER, NORM_META_KEY } from "./types";

const PLUGIN_ID = "pinia-colada-normalizer";
const INSPECTOR_ID = "normalizer-entities";
const TIMELINE_LAYER_ID = "normalizer:events";

/** Hex color for the timeline layer (Vue green) */
const NORMALIZER_COLOR = 0x42b883;

/**
 * Find all EntityRef markers in an entity's stored data.
 * Returns an array of { field, entityType, id } describing dependencies.
 * @internal
 */
function findEntityRefs(
  data: EntityRecord,
  prefix = "",
): Array<{ field: string; entityType: string; id: string }> {
  const refs: Array<{ field: string; entityType: string; id: string }> = [];
  for (const [key, value] of Object.entries(data)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === "object") {
      const record = value as Record<string | symbol, unknown>;
      if (record[ENTITY_REF_MARKER] === true) {
        refs.push({
          field: fieldPath,
          entityType: record.entityType as string,
          id: record.id as string,
        });
      } else if (Array.isArray(value)) {
        value.forEach((item, idx) => {
          if (item != null && typeof item === "object") {
            const itemRecord = item as Record<string | symbol, unknown>;
            if (itemRecord[ENTITY_REF_MARKER] === true) {
              refs.push({
                field: `${fieldPath}[${idx}]`,
                entityType: itemRecord.entityType as string,
                id: itemRecord.id as string,
              });
            } else {
              refs.push(
                ...findEntityRefs(
                  item as EntityRecord,
                  `${fieldPath}[${idx}]`,
                ),
              );
            }
          }
        });
      } else {
        refs.push(...findEntityRefs(value as EntityRecord, fieldPath));
      }
    }
  }
  return refs;
}

/**
 * Set up DevTools integration for the normalizer plugin.
 * Call this once during plugin installation.
 *
 * @param app - The Vue app instance (from pinia._a)
 * @param entityStore - The entity store instance to inspect
 * @param queryCache - The Pinia Colada query cache for query reference tracking
 * @internal
 */
export function setupDevtools(app: any, entityStore: EntityStore, queryCache?: any): void {
  setupDevToolsPlugin(
    {
      id: PLUGIN_ID,
      label: "Normalizer 📦",
      packageName: "pinia-colada-plugin-normalizer",
      homepage: "https://github.com/Danny-Devs/pinia-colada-plugin-normalizer",
      componentStateTypes: ["normalizer entities"],
      app,
    },
    (api) => {
      // ── Custom Inspector ──────────────────────────

      api.addInspector({
        id: INSPECTOR_ID,
        label: "Normalizer 📦",
        icon: "storage",
        treeFilterPlaceholder: "Search entities...",
        noSelectionText: "Select an entity type or entity to inspect.",
        actions: [
          {
            icon: "delete_sweep",
            tooltip: "Run garbage collection",
            action: () => {
              const removed = entityStore.gc();
              if (removed.length > 0) {
                api.addTimelineEvent({
                  layerId: TIMELINE_LAYER_ID,
                  event: {
                    time: api.now(),
                    title: "🗑️ GC",
                    subtitle: `removed ${removed.length}`,
                    data: { removed },
                  },
                });
              }
              api.sendInspectorTree(INSPECTOR_ID);
              api.sendInspectorState(INSPECTOR_ID);
            },
          },
          {
            icon: "content_copy",
            tooltip: "Copy store snapshot (toJSON)",
            action: () => {
              const snapshot = entityStore.toJSON();
              // eslint-disable-next-line no-console
              console.log(
                "[normalizer] Store snapshot:",
                JSON.stringify(snapshot, null, 2),
              );
            },
          },
        ],
      });

      // Populate the inspector tree with entity types → entities
      api.on.getInspectorTree((payload) => {
        if (payload.inspectorId !== INSPECTOR_ID) return;

        const snapshot = entityStore.toJSON();
        const filter = payload.filter?.toLowerCase() || "";

        // Group by entity type
        const typeMap = new Map<string, Array<{ id: string; key: string }>>();
        for (const key of Object.keys(snapshot)) {
          const sepIdx = key.indexOf(":");
          const entityType = key.slice(0, sepIdx);
          const id = key.slice(sepIdx + 1);
          if (filter && !entityType.includes(filter) && !id.includes(filter)) continue;
          if (!typeMap.has(entityType)) typeMap.set(entityType, []);
          typeMap.get(entityType)!.push({ id, key });
        }

        payload.rootNodes = Array.from(typeMap.entries()).map(
          ([entityType, entities]) => ({
            id: `type:${entityType}`,
            label: entityType,
            tags: [
              {
                label: `${entities.length}`,
                textColor: 0xffffff,
                backgroundColor: NORMALIZER_COLOR,
              },
            ],
            children: entities.map((e) => {
              const refCount = entityStore.getRefCount(entityType, e.id);
              const tags = [];
              if (refCount != null) {
                tags.push({
                  label: `rc:${refCount}`,
                  textColor: 0xffffff,
                  backgroundColor: refCount > 0 ? 0x42b883 : 0xff6b6b,
                });
              } else {
                tags.push({
                  label: "untracked",
                  textColor: 0xffffff,
                  backgroundColor: 0x999999,
                });
              }
              return {
                id: `entity:${e.key}`,
                label: e.id,
                tags,
              };
            }),
          }),
        );
      });

      // Populate inspector state when a node is selected
      api.on.getInspectorState((payload) => {
        if (payload.inspectorId !== INSPECTOR_ID) return;

        const nodeId = payload.nodeId;

        if (nodeId.startsWith("type:")) {
          // Entity type selected — show summary
          const entityType = nodeId.slice(5);
          const entries = entityStore.getEntriesByType(entityType);

          // Count normalization metadata from query cache
          let queryCount = 0;
          if (queryCache) {
            try {
              for (const entry of queryCache.getEntries()) {
                const meta = (entry as any).ext?.[NORM_META_KEY]?.value as NormMeta | undefined;
                if (meta?.isNormalized) {
                  for (const ek of meta.entityKeys) {
                    if (ek.startsWith(`${entityType}:`)) {
                      queryCount++;
                      break;
                    }
                  }
                }
              }
            } catch {
              // queryCache may not support getEntries
            }
          }

          payload.state = {
            summary: [
              { key: "entityType", value: entityType },
              { key: "count", value: entries.length },
              { key: "referencingQueries", value: queryCount },
            ],
            entities: entries.map((e) => ({
              key: e.id,
              value: e.data,
            })),
          };
        } else if (nodeId.startsWith("entity:")) {
          // Individual entity selected — show data + ref counts + query refs + dependencies
          const key = nodeId.slice(7);
          const sepIdx = key.indexOf(":");
          const entityType = key.slice(0, sepIdx);
          const id = key.slice(sepIdx + 1);
          const data = entityStore.get(entityType, id).value;
          const refCount = entityStore.getRefCount(entityType, id);

          // Build metadata section
          const metadata: Array<{ key: string; value: unknown }> = [
            { key: "entityType", value: entityType },
            { key: "id", value: id },
            { key: "key", value: key },
            { key: "exists", value: entityStore.has(entityType, id) },
          ];

          // Ref count / GC status
          if (refCount != null) {
            metadata.push({ key: "refCount", value: refCount });
            metadata.push({
              key: "gcEligible",
              value: refCount <= 0 ? "yes (will be collected on gc())" : "no (retained by queries)",
            });
          } else {
            metadata.push({
              key: "refCount",
              value: "untracked (immune to GC — created via direct set())",
            });
          }

          // Find which queries reference this entity
          const referencingQueries: Array<{ key: string; value: unknown }> = [];
          if (queryCache) {
            try {
              for (const entry of queryCache.getEntries()) {
                const meta = (entry as any).ext?.[NORM_META_KEY]?.value as NormMeta | undefined;
                if (meta?.isNormalized && meta.entityKeys.has(key)) {
                  referencingQueries.push({
                    key: JSON.stringify(entry.key),
                    value: {
                      isNormalized: meta.isNormalized,
                      entityKeysCount: meta.entityKeys.size,
                    },
                  });
                }
              }
            } catch {
              // queryCache may not support getEntries
            }
          }

          // Entity dependency graph — find nested EntityRefs in stored data
          const dependencies: Array<{ key: string; value: string }> = [];
          if (data) {
            const refs = findEntityRefs(data);
            for (const ref of refs) {
              dependencies.push({
                key: ref.field,
                value: `${ref.entityType}:${ref.id}`,
              });
            }
          }

          payload.state = {
            data: data
              ? Object.entries(data).map(([k, v]) => ({ key: k, value: v }))
              : [{ key: "(empty)", value: undefined }],
            metadata,
            ...(referencingQueries.length > 0
              ? { "referencing queries": referencingQueries }
              : {}),
            ...(dependencies.length > 0
              ? { "entity dependencies": dependencies }
              : {}),
          };
        }
      });

      // ── Normalization Metadata Inspector ────────
      // When queryCache is available, add a secondary section for norm metadata
      if (queryCache) {
        api.addInspector({
          id: `${INSPECTOR_ID}-queries`,
          label: "Normalizer Queries 📊",
          icon: "query_stats",
          treeFilterPlaceholder: "Search queries...",
          noSelectionText: "Select a query to view normalization metadata.",
        });

        api.on.getInspectorTree((payload) => {
          if (payload.inspectorId !== `${INSPECTOR_ID}-queries`) return;
          const filter = payload.filter?.toLowerCase() || "";

          try {
            const entries = queryCache.getEntries();
            payload.rootNodes = entries
              .map((entry: any) => {
                const keyStr = JSON.stringify(entry.key);
                if (filter && !keyStr.toLowerCase().includes(filter)) return null;
                const meta = entry.ext?.[NORM_META_KEY]?.value as NormMeta | undefined;
                const tags = [];
                if (meta?.isNormalized) {
                  tags.push({
                    label: `${meta.entityKeys.size} entities`,
                    textColor: 0xffffff,
                    backgroundColor: NORMALIZER_COLOR,
                  });
                } else {
                  tags.push({
                    label: "not normalized",
                    textColor: 0xffffff,
                    backgroundColor: 0x999999,
                  });
                }
                // Check for auto-redirect placeholder
                if ((entry as any).placeholderData != null) {
                  tags.push({
                    label: "placeholder",
                    textColor: 0xffffff,
                    backgroundColor: 0xf0ad4e,
                  });
                }
                return {
                  id: `query:${keyStr}`,
                  label: keyStr,
                  tags,
                };
              })
              .filter(Boolean);
          } catch {
            payload.rootNodes = [];
          }
        });

        api.on.getInspectorState((payload) => {
          if (payload.inspectorId !== `${INSPECTOR_ID}-queries`) return;

          const nodeId = payload.nodeId;
          if (!nodeId.startsWith("query:")) return;

          const keyStr = nodeId.slice(6);

          try {
            for (const entry of queryCache.getEntries()) {
              if (JSON.stringify(entry.key) !== keyStr) continue;

              const meta = (entry as any).ext?.[NORM_META_KEY]?.value as NormMeta | undefined;

              const normMetadata: Array<{ key: string; value: unknown }> = [
                { key: "queryKey", value: entry.key },
                { key: "isNormalized", value: meta?.isNormalized ?? false },
                { key: "entityKeysCount", value: meta?.entityKeys?.size ?? 0 },
                {
                  key: "hasPlaceholderData",
                  value: (entry as any).placeholderData != null,
                },
              ];

              const entityKeys: Array<{ key: string; value: string }> = [];
              if (meta?.entityKeys) {
                for (const ek of meta.entityKeys) {
                  const refCount = (() => {
                    const sepIdx = ek.indexOf(":");
                    return entityStore.getRefCount(ek.slice(0, sepIdx), ek.slice(sepIdx + 1));
                  })();
                  entityKeys.push({
                    key: ek,
                    value: refCount != null ? `refCount: ${refCount}` : "untracked",
                  });
                }
              }

              payload.state = {
                "normalization metadata": normMetadata,
                ...(entityKeys.length > 0 ? { "entity keys": entityKeys } : {}),
              };
              break;
            }
          } catch {
            // queryCache may not support getEntries
          }
        });
      }

      // ── Timeline Layer ────────────────────────────

      api.addTimelineLayer({
        id: TIMELINE_LAYER_ID,
        label: "Normalizer 📦",
        color: NORMALIZER_COLOR,
      });

      // Subscribe to entity changes and emit timeline events
      entityStore.subscribe((event: EntityEvent) => {
        const isAdd = event.type === "set" && event.previousData == null;
        const isUpdate = event.type === "set" && event.previousData != null;
        const isRemove = event.type === "remove";

        const title = isAdd
          ? `➕ ${event.entityType}:${event.id}`
          : isUpdate
            ? `✏️ ${event.entityType}:${event.id}`
            : `🗑️ ${event.entityType}:${event.id}`;

        const subtitle = isAdd ? "added" : isUpdate ? "updated" : "removed";

        api.addTimelineEvent({
          layerId: TIMELINE_LAYER_ID,
          event: {
            time: api.now(),
            title,
            subtitle,
            data: {
              entityType: event.entityType,
              id: event.id,
              key: event.key,
              data: event.data,
              previousData: event.previousData,
            },
            logType: isRemove ? "warning" : "default",
          },
        });

        // Refresh the inspector when entities change
        api.sendInspectorTree(INSPECTOR_ID);
        api.sendInspectorState(INSPECTOR_ID);
      });
    },
  );
}
