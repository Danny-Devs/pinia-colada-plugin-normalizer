# ADR-001: Skip Field-Level Policies

**Status:** Accepted
**Date:** 2026-03-15
**Context:** Pre-1.0 review — council of 7 experts deliberated on competitive feature gaps

## Decision

We will NOT implement field-level policies (per-field merge strategies, per-field expiry, per-field invalidation) for the foreseeable future.

## Rationale

1. **`merge` function already provides full control.** Each `defineEntity` call accepts a custom `merge(existing, incoming)` function that gives users complete authority over how entity data is reconciled. Per-field logic can be implemented inside this function without framework support.

2. **Complexity cliff.** Apollo Client 2.x's `cacheRedirects` + `typePolicies` system (which includes per-field read/merge/keyArgs) is widely cited as the library's biggest DX problem. Per-field expiry implies field-level timestamps, partial entity invalidation, and field-level refetch triggers — an explosion of internal state that is hard to debug and hard to reason about.

3. **Scope discipline.** This plugin's value prop is REST-first normalized caching with a tiny footprint (~2.4K LOC). Adding field-level policies would double the codebase and move us toward "Apollo Client for REST" — a positioning that invites unfavorable comparisons rather than highlighting our strengths.

## Alternatives Considered

- **Per-field merge via type policies (Apollo-style):** Rejected — the `merge` function is simpler and more flexible.
- **Per-field expiry:** Rejected — if users need field-level staleness, they need a different tool (TanStack DB, custom store backend).

## Consequences

- Users who need per-field control use the `merge` function
- We maintain a small, auditable codebase
- Revisit if multiple users request it post-1.0 (track in GitHub Discussions)
