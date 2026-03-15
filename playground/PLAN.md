# Playground POC — pinia-colada-plugin-normalizer

> Revised after unanimous expert council: simplify to 3 panels, one-button "holy shit" moment, clean code Eduardo can teach from.

## Purpose

This isn't just a "does it work" test. This is the demo we link in Discussion #531 and what Eduardo evaluates. It must clearly demonstrate **why you'd want normalized entity caching** in a way that someone can clone, run, and immediately understand.

**Eduardo evaluates plugins by**: (1) does it feel like a natural Pinia Colada extension, (2) is the code clean enough to teach from, (3) does it solve a real problem. He reads the source code, not just clicks the demo.

## What we're showing off

### Core value props to demonstrate

| Strength | How we show it | What the user sees |
|----------|---------------|-------------------|
| **Multi-query deduplication** | Same contact appears in 3 different queries (list, detail, team members) | Update contact name once → all 3 views reflect it instantly |
| **WebSocket push without invalidation** | Simulated WS panel pushes entity updates | Click "simulate WS event" → entity store updates → all views update. No refetch, no invalidation. |
| **Hybrid normalization** | Contacts are normalized, team metadata is not | DevTools-style panel shows entity store (flat) alongside query cache (with refs + raw data) |
| **defineEntity with custom ID** | Contacts use `contactId`, not `id` | Config is visible in source, proves escape hatch works |
| **useEntityStore() composable** | WebSocket handler uses it directly | Clean 3-line WS integration code visible in demo |
| **Zero stale data** | Side-by-side views of the same entity | Edit in one panel, see it change in all others simultaneously |

### What we're NOT showing (save for later)

- Persistence (Phase 4)
- IVM / query planner (Phase 4-5)
- Optimistic updates / three-layer sync (Phase 2)
- SSR hydration

## App concept: Real-Time Contact Manager

A single-page app with 4 panels visible simultaneously:

```
┌─────────────────────────────┬──────────────────────────────┐
│                             │                              │
│   CONTACT LIST              │   CONTACT DETAIL             │
│   useQuery(['contacts'])    │   useQuery(['contacts', id]) │
│                             │                              │
│   • Alice Chen ←── click    │   Name: Alice Chen           │
│   • Bob Park        to      │   Email: alice@acme.com      │
│   • Charlie Reeves  select  │   Team: Engineering          │
│                             │   Status: active             │
│                             │                              │
├─────────────────────────────┼──────────────────────────────┤
│                             │                              │
│   TEAM VIEW                 │   ENTITY STORE INSPECTOR     │
│   useQuery(['teams', id])   │   (DevTools-style panel)     │
│                             │                              │
│   Engineering:              │   Entity Store:              │
│   • Alice Chen  ← same     │   contact:1 → { name: ... }  │
│   • Charlie     ← entities │   contact:2 → { name: ... }  │
│                             │                              │
│   Marketing:                │   Query Cache:               │
│   • Bob Park                │   ['contacts'] → [ref, ref]  │
│                             │   ['contacts', 1] → ref      │
│                             │   ['teams', 'eng'] → { ... } │
│                             │                              │
├─────────────────────────────┴──────────────────────────────┤
│                                                            │
│   WEBSOCKET SIMULATOR                                      │
│                                                            │
│   [Update Alice's name to "Alicia"]  [Push new contact]    │
│   [Remove Bob]  [Update team metadata]  [Bulk update 10]   │
│                                                            │
│   Event log:                                               │
│   14:03:22 SET contact:1 { name: "Alicia" }               │
│   14:03:19 SET contact:3 { status: "inactive" }           │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## Data model

```typescript
// Entities (normalized)
interface Contact {
  contactId: string  // custom ID field — demonstrates defineEntity
  name: string
  email: string
  teamId: string
  status: 'active' | 'inactive'
  avatarUrl: string
}

// Not normalized (stays in query cache as-is)
interface Team {
  teamId: string
  name: string
  description: string
  memberCount: number  // denormalized count — intentionally NOT normalized
}

// API responses
interface ContactListResponse {
  contacts: Contact[]
  pagination: { page: number; total: number }  // not normalized
}

interface TeamResponse {
  team: Team          // not normalized (no defineEntity for teams)
  members: Contact[]  // normalized — same contacts as in contact list
}
```

## Plugin configuration (visible in demo source)

```typescript
PiniaColadaNormalizer({
  entities: {
    contact: defineEntity({
      idField: 'contactId',
    }),
    // Note: no defineEntity for Team — it stays in query cache as-is
    // This demonstrates the hybrid approach
  },
})
```

## Technical implementation

### Mock API
- `fetchContacts()` — returns ContactListResponse
- `fetchContact(id)` — returns single Contact
- `fetchTeam(teamId)` — returns TeamResponse with embedded Contact members
- All return the SAME contact objects with SAME contactIds — proving deduplication

### Mock WebSocket
- `SimulatedWebSocket` class that emits events on button click
- Events: `CONTACT_UPDATED`, `CONTACT_ADDED`, `CONTACT_REMOVED`
- Handler uses `useEntityStore().set()` directly — shows the clean integration

### Entity Store Inspector
- Real-time view of `entityStore.toJSON()` — shows the flat entity map
- Shows which queries hold references vs raw data
- Highlights entities as they update (flash animation)
- This is the "wow" panel — makes normalization visible and tangible

### Key interactions to demo

1. **Click a contact** → detail panel shows it. Both list and detail share the same entity.
2. **Click "Update Alice's name"** → WS event fires → entity store updates → ALL THREE panels (list, detail, team members) update simultaneously. Inspector shows the single entity change.
3. **Click "Push new contact"** → entity store gets new contact. List query still shows old data (not refetched) — but the entity IS in the store. This shows the boundary: WS writes to entity store, but query structure needs a refetch/invalidation to include new items.
4. **Click "Update team metadata"** → only the team view updates. Contacts unchanged. Shows hybrid: team data is not normalized, lives in query cache.

### File structure

```
playground/
├── PLAN.md           ← this file
├── index.html
├── src/
│   ├── main.ts       ← app setup, plugin config
│   ├── App.vue       ← 4-panel layout
│   ├── api/
│   │   └── mock.ts   ← mock API with shared contact data
│   ├── components/
│   │   ├── ContactList.vue       ← useQuery(['contacts'])
│   │   ├── ContactDetail.vue     ← useQuery(['contacts', id])
│   │   ├── TeamView.vue          ← useQuery(['teams', teamId])
│   │   ├── EntityInspector.vue   ← entity store + query cache visualization
│   │   └── WebSocketSimulator.vue ← push event buttons + event log
│   └── ws/
│       └── simulator.ts  ← mock WS with useEntityStore() integration
└── vite.config.ts
```

## Success criteria

1. **Visual**: Someone who has never heard of normalization watches the demo for 30 seconds and understands the value
2. **Code**: The plugin setup is < 10 lines. The WS integration is < 5 lines. The complexity is in the PLUGIN, not the consumer.
3. **Eduardo**: He can clone, `pnpm dev`, and see it work. No config, no API keys, no external deps.
4. **Discussion #531**: Screenshots/GIF of the 4-panel layout with a WS event propagating across all views is the killer visual for the discussion update.
