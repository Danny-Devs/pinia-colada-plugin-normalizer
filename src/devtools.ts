/**
 * Vue DevTools integration for pinia-colada-plugin-normalizer.
 *
 * Provides:
 * - Custom inspector panel (entity store contents, ref counts, metadata)
 * - Timeline events (entity set/remove, normalize/denormalize)
 *
 * Dev-only: the entire module is tree-shaken in production builds
 * because it's conditionally imported behind a NODE_ENV check.
 *
 * @module pinia-colada-plugin-normalizer/devtools
 * @internal
 */

import { setupDevToolsPlugin } from "@vue/devtools-api";
import type { EntityStore, EntityEvent } from "./types";

const PLUGIN_ID = "pinia-colada-normalizer";
const INSPECTOR_ID = "normalizer-entities";
const TIMELINE_LAYER_ID = "normalizer:events";

/** Hex color for the timeline layer (Vue green) */
const NORMALIZER_COLOR = 0x42b883;

/**
 * Set up DevTools integration for the normalizer plugin.
 * Call this once during plugin installation.
 *
 * @param app - The Vue app instance (from pinia._a)
 * @param entityStore - The entity store instance to inspect
 * @internal
 */
export function setupDevtools(app: any, entityStore: EntityStore): void {
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
            children: entities.map((e) => ({
              id: `entity:${e.key}`,
              label: e.id,
            })),
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
          payload.state = {
            summary: [
              { key: "entityType", value: entityType },
              { key: "count", value: entries.length },
            ],
            entities: entries.map((e) => ({
              key: e.id,
              value: e.data,
            })),
          };
        } else if (nodeId.startsWith("entity:")) {
          // Individual entity selected — show data
          const key = nodeId.slice(7);
          const sepIdx = key.indexOf(":");
          const entityType = key.slice(0, sepIdx);
          const id = key.slice(sepIdx + 1);
          const data = entityStore.get(entityType, id).value;

          payload.state = {
            data: data
              ? Object.entries(data).map(([k, v]) => ({ key: k, value: v }))
              : [{ key: "(empty)", value: undefined }],
            metadata: [
              { key: "entityType", value: entityType },
              { key: "id", value: id },
              { key: "key", value: key },
              { key: "exists", value: entityStore.has(entityType, id) },
            ],
          };
        }
      });

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
