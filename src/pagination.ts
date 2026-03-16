/**
 * Pagination merge recipe factories for use with `defineEntity`.
 *
 * These return merge functions that append/prepend pages instead of
 * replacing them — designed for entities that represent paginated
 * collections (e.g., a feed, an infinite-scroll list).
 *
 * Works with both `useQuery` (manual load-more) and `useInfiniteQuery`
 * (Pinia Colada's built-in pagination).
 *
 * Inspired by Apollo Client's `relayStylePagination` and
 * `offsetLimitPagination`, but simpler — these are merge recipe
 * factories for `defineEntity`, not full pagination managers.
 *
 * @module pinia-colada-plugin-normalizer/pagination
 */

import type { EntityRecord } from "./types";

// ─────────────────────────────────────────────
// Cursor-based Pagination
// ─────────────────────────────────────────────

/**
 * Options for cursor-based pagination merge.
 */
export interface CursorPaginationOptions<T extends EntityRecord = EntityRecord> {
  /**
   * Extract the cursor value from the entity.
   * This determines where the entity's "page boundary" is.
   *
   * @example
   * getCursor: (feed) => feed.endCursor
   */
  getCursor: (entity: T) => string | number | null | undefined;

  /**
   * The field on the entity that contains the items array.
   * @default 'items'
   */
  itemsField?: string;

  /**
   * Merge direction.
   * - 'forward': append new items after existing ones (default)
   * - 'backward': prepend new items before existing ones
   * @default 'forward'
   */
  direction?: "forward" | "backward";

  /**
   * Whether to deduplicate items by a key field.
   * When set, items with the same key value are kept only once
   * (the newer version wins).
   * @default undefined (no dedup)
   */
  dedupeKey?: string;
}

/**
 * Creates a merge function for cursor-based pagination.
 *
 * Returns a merge function suitable for `defineEntity({ merge })`.
 * When the entity store merges an incoming entity with an existing one,
 * this function appends (or prepends) the items from the incoming page
 * onto the existing items, instead of replacing them.
 *
 * @example
 * ```typescript
 * import { defineEntity } from 'pinia-colada-plugin-normalizer'
 * import { cursorPagination } from 'pinia-colada-plugin-normalizer'
 *
 * const contactFeed = defineEntity<ContactFeed>({
 *   idField: 'feedId',
 *   merge: cursorPagination({
 *     getCursor: (feed) => feed.endCursor,
 *     itemsField: 'contacts',
 *     direction: 'forward',
 *   }),
 * })
 * ```
 */
export function cursorPagination<T extends EntityRecord = EntityRecord>(
  options: CursorPaginationOptions<T>,
): (existing: T, incoming: T) => T {
  const {
    getCursor,
    itemsField = "items",
    direction = "forward",
    dedupeKey,
  } = options;

  return (existing: T, incoming: T): T => {
    const existingItems = (existing[itemsField] as unknown[] | undefined) ?? [];
    const incomingItems = (incoming[itemsField] as unknown[] | undefined) ?? [];

    // If cursors match, this is a refresh of the same page — replace
    const existingCursor = getCursor(existing);
    const incomingCursor = getCursor(incoming);
    if (existingCursor != null && existingCursor === incomingCursor) {
      return { ...existing, ...incoming };
    }

    // Merge items based on direction
    let mergedItems: unknown[];
    if (direction === "backward") {
      mergedItems = [...incomingItems, ...existingItems];
    } else {
      mergedItems = [...existingItems, ...incomingItems];
    }

    // Deduplicate if requested
    if (dedupeKey) {
      const seen = new Map<unknown, number>();
      // Walk backwards so later items win
      for (let i = mergedItems.length - 1; i >= 0; i--) {
        const item = mergedItems[i];
        if (item != null && typeof item === "object") {
          const key = (item as Record<string, unknown>)[dedupeKey];
          if (key != null) {
            if (seen.has(key)) {
              // Remove the earlier duplicate
              mergedItems.splice(i, 1);
            } else {
              seen.set(key, i);
            }
          }
        }
      }
    }

    return {
      ...existing,
      ...incoming,
      [itemsField]: mergedItems,
    } as T;
  };
}

// ─────────────────────────────────────────────
// Offset-based Pagination
// ─────────────────────────────────────────────

/**
 * Options for offset-based pagination merge.
 */
export interface OffsetPaginationOptions<T extends EntityRecord = EntityRecord> {
  /**
   * Extract the current offset from the entity.
   *
   * @example
   * getOffset: (list) => list.offset
   */
  getOffset: (entity: T) => number;

  /**
   * Page size — used to determine where incoming items should be placed
   * in the merged array when offsets overlap.
   */
  pageSize: number;

  /**
   * The field on the entity that contains the items array.
   * @default 'items'
   */
  itemsField?: string;

  /**
   * Whether to deduplicate items by a key field.
   * @default undefined (no dedup)
   */
  dedupeKey?: string;
}

/**
 * Creates a merge function for offset-based pagination.
 *
 * Returns a merge function suitable for `defineEntity({ merge })`.
 * When the entity store merges an incoming entity with an existing one,
 * this function places incoming items at the correct offset position
 * within the existing items array.
 *
 * @example
 * ```typescript
 * import { defineEntity } from 'pinia-colada-plugin-normalizer'
 * import { offsetPagination } from 'pinia-colada-plugin-normalizer'
 *
 * const contactList = defineEntity<ContactList>({
 *   idField: 'listId',
 *   merge: offsetPagination({
 *     getOffset: (list) => list.offset,
 *     pageSize: 20,
 *     itemsField: 'contacts',
 *   }),
 * })
 * ```
 */
export function offsetPagination<T extends EntityRecord = EntityRecord>(
  options: OffsetPaginationOptions<T>,
): (existing: T, incoming: T) => T {
  const {
    getOffset,
    pageSize: _pageSize,
    itemsField = "items",
    dedupeKey,
  } = options;

  return (existing: T, incoming: T): T => {
    const existingItems = (existing[itemsField] as unknown[] | undefined) ?? [];
    const incomingItems = (incoming[itemsField] as unknown[] | undefined) ?? [];
    const existingOffset = getOffset(existing);
    const incomingOffset = getOffset(incoming);

    // If same offset, this is a refresh — replace the page
    if (existingOffset === incomingOffset) {
      return { ...existing, ...incoming };
    }

    // Place incoming items at the correct position.
    // Start with a copy of existing items, then overlay incoming at offset.
    const maxLen = Math.max(
      existingOffset + existingItems.length,
      incomingOffset + incomingItems.length,
    );
    const merged: unknown[] = Array.from({ length: maxLen });

    // Fill with existing items at their offset
    for (let i = 0; i < existingItems.length; i++) {
      merged[existingOffset + i] = existingItems[i];
    }

    // Overlay incoming items at their offset
    for (let i = 0; i < incomingItems.length; i++) {
      merged[incomingOffset + i] = incomingItems[i];
    }

    // Remove undefined gaps (sparse array cleanup)
    let mergedItems = merged.filter((item) => item !== undefined);

    // Deduplicate if requested
    if (dedupeKey) {
      const seen = new Map<unknown, number>();
      for (let i = mergedItems.length - 1; i >= 0; i--) {
        const item = mergedItems[i];
        if (item != null && typeof item === "object") {
          const key = (item as Record<string, unknown>)[dedupeKey];
          if (key != null) {
            if (seen.has(key)) {
              mergedItems.splice(i, 1);
            } else {
              seen.set(key, i);
            }
          }
        }
      }
    }

    // Use the incoming entity's metadata (offset, total, etc.) but keep merged items
    return {
      ...existing,
      ...incoming,
      [itemsField]: mergedItems,
    } as T;
  };
}
