# ADR-006: The SyncAdapter Interface (Stage-3 Contract, Frozen Early)

**Status:** Proposed (interface frozen; implementation is Phase-4 Stage 3)
**Date:** 2026-07-12

## Context

Stage 3 turns the plugin into a full local-first data layer: the client database (ADR-003) synchronizes with any backend, Linear-style. The plugin's moat is *bring-your-own-backend* — so the sync **protocol** belongs to the plugin and the **transport** belongs to an adapter, exactly as `StorageEngine` split durability. Freezing the adapter contract now (while implementation is months out) prevents the same calcification risk ADR-005 flagged for versions: the first shipped adapter would otherwise define the interface by accident.

Reference architectures studied: Linear's sync engine (normalized in-memory model store + delta packets + transaction queue + partial bootstrap; see knowledge/local-first-landscape.md), PowerSync (client SDKs Apache-2.0; service FSL→Apache-after-2y), Turso sync-wasm, TanStack DB 0.6's query-driven sync. All converge on server-authoritative deltas over a cursor — that is the shape adopted here.

## Decision

### The contract

```typescript
/** A change arriving FROM the backend. */
interface RemoteChange {
  type: "set" | "remove";
  entityType: string;
  id: string;
  data?: EntityRecord;          // absent for remove
  version: string | number;      // authoritative ordering (fills EntityEvent.version, ADR-005)
}

/** A committed local write heading TO the backend (an outbox entry). */
interface LocalChange {
  mutationId: string;            // idempotency key, client-generated
  op: "set" | "remove";
  entityType: string;
  id: string;
  data?: EntityRecord;
  baseVersion?: string | number; // version the client last saw (server may use for conflict checks)
}

interface PushResult {
  results: Array<{
    mutationId: string;
    status: "ack" | "reject" | "transform";
    data?: EntityRecord;         // for transform: the server's corrected entity
    version?: string | number;
  }>;
}

/** Transport to one backend. Implement three methods; the coordinator does the rest. */
interface SyncAdapter {
  /** PULL: server → client. Cursor-based, resumable, batched. `null` cursor = initial sync. */
  pull(cursor: string | null): Promise<{ changes: RemoteChange[]; cursor: string; hasMore?: boolean }>;
  /** PUSH: client → server. Delivers outbox entries in order; per-change verdicts. */
  push(batch: LocalChange[]): Promise<PushResult>;
  /** Optional live channel (WebSocket/SSE). Absent → coordinator polls pull(). */
  subscribe?(onChanges: (changes: RemoteChange[]) => void): () => void;
}
```

### Coordinator semantics (`enableSync(store, { adapter, ... })`)

1. **The outbox is the existing optimistic-transaction system.** A local mutation = optimistic tx (already shipped, 0.2.0): `commit()` moves its mutations into a durable outbox (persisted via the StorageEngine, so pending pushes survive reloads); `push()` ack completes them; `reject` triggers the existing rollback machinery; `transform` applies the server's corrected entity then completes.
2. **Echo suppression by construction:** remote changes are applied inside an `isApplyingRemote` guard (same pattern as `isHydrating`), so they never re-enter the outbox.
3. **Version-aware apply:** a `RemoteChange` is applied only if its `version` is newer than the entity's last-known version (populates `EntityEvent.version`, upgrading fresh-wins from existence-based to version-based — ADR-005 §4 redeemed).
4. **ADR-004 holds at the sync boundary:** local `evict` is never pushed; remote `remove` is a semantic delete (store.remove → durable delete). `clear()` does not push deletes by default (a local reset is not an instruction to the fleet) — explicit fleet-wide deletion goes through normal removes.
5. **Device-local entity types** (pagination containers, UI state) are excluded via `sync: false` on `defineEntity` — per ADR-005 §2.
6. **Conflict posture: server-authoritative.** The server's verdict (ack/reject/transform) is final; the client rebases in-flight optimistic transactions on the post-apply state (clear-and-replay, which the tx system already implements). No CRDTs, no P2P — deliberately (ADR-005 §3).

### Adapter roadmap

`restAdapter` (reference implementation + the documented protocol for any custom backend) → `powerSyncAdapter` (client SDK is Apache-2.0; their service is self-hostable) → `tursoAdapter` (re-evaluate at their 1.0).

## Alternatives Considered

- **Adopt a vendor's protocol wholesale (PowerSync's or Electric's):** fastest to one backend, but the plugin's identity is backend-neutrality; the vendor protocol becomes *an adapter*, not *the interface*.
- **CRDT merge layer:** wrong fit for entity-graph + server-of-record apps (and cr-sqlite is dead — ADR-005); revisit only if a collaboration-editor use case ever becomes primary.
- **Event-sourcing (LiveStore-style):** powerful but demands the app re-model everything as events; violates the drop-in-plugin identity.

## Consequences

- Positive: three-method adapter surface = trivial to implement against any REST/GraphQL/WS backend; outbox reuses shipped machinery; the contract can be documented and community-tested before the coordinator exists.
- Negative: server-authoritative means offline conflicts resolve by server verdict, not merge — a known, documented tradeoff.
- Risks: interface may need a `rebase`/`schemaVersion` hook once real adapters exist; Proposed status signals fields may still be added (not changed) before Stage 3 lands.
