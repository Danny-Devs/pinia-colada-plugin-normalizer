# LESSONS.md — append-only failure log

> Every recurring mistake gets encoded so the next agent never makes it again.
> Encoding strength: lint > test > AGENTS.md > this file. Entries here also
> explain WHY the stronger encodings exist.

## [2026-07-12] — Peer ranges never match prerelease-only packages

**Mistake:** Declared `"@sqlite.org/sqlite-wasm": ">=3.50.0"` as an (optional) peer dependency. Every published version of that package is a `-buildN` prerelease (e.g. `3.53.0-build1`), and semver excludes prereleases from any range that doesn't carry a same-version-tuple prerelease comparator — so the range matched **zero** installable versions and `npm install` hard-failed for exactly the consumers following our own docs.

**Why it happened:** Assumed a floor-style range is always safe; never checked the upstream package's versioning scheme. Our own test suite couldn't catch it because optional peers aren't auto-installed and pnpm only warns.

**Fix:** Peer range set to `"*"` (npm special-cases it for prereleases); real floor documented in prose (docs/persistence.md). Encoded as a regression test: `engines.spec.ts › packaging › sqlite-wasm peer range stays '*'`.

**For future agents:** Before writing any dependency range, check whether the upstream publishes prerelease-tagged versions (`npm view <pkg> versions`) — if all versions are prereleases, only `"*"` (or an explicit prerelease comparator) will ever match.

## [2026-07-12] — Never gate worker terminate() on the worker replying

**Mistake:** `sqliteEngine.close()` did `call("close").finally(() => w.terminate())` — termination waited for the worker's reply. A dispose during an in-flight `open()` (component unmount, Vite HMR during boot) got the `close` answered first, the worker died before `open` ever replied, the pending promise never settled, and `enablePersistence().ready` hung forever. A crashed worker likewise never replies, leaking the worker and its OPFS pool locks.

**Why it happened:** Modeled close as a normal RPC instead of a shutdown; shutdown paths must never depend on the cooperating party being alive.

**Fix:** Unconditional terminate behind a 500ms deadline + reject-and-clear the whole pending map on shutdown, so every caller settles. Encoded as regression tests: `engines.spec.ts › sqliteEngine lifecycle` (both the in-flight-open and dead-worker cases, with a protocol-faithful fake worker).

**For future agents:** In any RPC-over-worker design, `close()` must (1) settle every pending promise and (2) terminate on a deadline regardless of replies. If a cleanup path can only complete when the other side cooperates, it will eventually hang.
