# ADR-002: Defer Partial DenormCache Invalidation

**Status:** Deferred
**Date:** 2026-03-15
**Context:** Pre-1.0 performance review

## Decision

We will keep full denormCache invalidation (clear entire cache on any entity change) rather than implementing partial invalidation (clear only the changed entity key).

## Current Behavior

When any entity referenced by a query changes, the entire `denormCache` for that query is cleared. The next read re-walks the full query tree, resolving all EntityRefs from the store.

## Why Defer

1. **Correctness is guaranteed.** Full-clear is always correct — it just does more work than strictly necessary.

2. **Partial invalidation requires dependency tracking.** Entities can be nested (order contains customer contains address). Changing `address:5` must invalidate not just its own cache entry but also `customer:42` and `order:1` if they contain refs to it. This requires building and maintaining an entity dependency graph at normalization time.

3. **Sub-millisecond for typical apps.** For apps with dozens to hundreds of entities per query, the full tree re-walk is imperceptible. The optimization only matters at 10K+ entities in a single query response.

## Benchmark Results (2026-03-15)

Stress test: 1,000 iterations of `denormalize()` per entity count, no denormCache (worst case — simulates full cache invalidation).

| Entities | Per-call time | Verdict |
|----------|--------------|---------|
| 150 | 0.06ms | Invisible |
| 500 | 0.16ms | Invisible |
| 1,000 | 0.33ms | Well under 16ms frame budget |
| 5,000 | 1.78ms | Acceptable |
| 10,000 | 3.74ms | Noticeable but not janky |

**Conclusion:** The O(n) re-walk stays sub-4ms even at 10K entities in a single query. Most real apps have 10-200 entities per query. Partial invalidation would only matter above ~50K entities in a single query, which is unrealistic (you'd paginate long before that).

## When to Revisit

- If profiling shows denormalization is a measurable bottleneck (>5ms per read)
- If users report UI jank on entity updates in large lists
- The LA talk demo is safe at any reasonable entity count
- Implementation path: track parent→child entity refs during normalization, invalidate transitively on change
