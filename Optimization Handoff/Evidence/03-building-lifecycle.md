# P03 building lifecycle slice

This is the first local P03 slice. Squad, ship and cargo lifecycle ownership
remain open, so P03 and its dependent stages are not accepted as complete.

## Source and environment

Code commit: `1fe9ede1b8ee9c093032d0257423fb90c4e022ab`.
Parent: `d8c1509`, branch `codex/optimization-lifecycle-indexes`, isolated
managed checkout. Windows x64 Node 24.18.0, existing lockfile and dependencies.
Runtime identity: `f1a19b5fb9ef323f43bd24912791dd21961533d75a50622119e36c0f06fb4d28`.

The user approved read-only collections/records and explicit domain mutation
methods, including affected fixtures. Canonical building inputs are cloned.
The owned record keeps its identity, its fields are TypeScript read-only, and
collection/index views are frozen. Production writers use add/update/remove
methods. Unsafe casts can bypass TypeScript; the opt-in development audit
reports indexed fact drift and does not repair authoritative state.

## Implemented boundary

Building identity, owner/type groups, legal-stack representatives, nearby
towers, completed/alive legacy production, and the highest live ID are derived
from explicit spawn/change/remove/restore hooks. The maximum-ID heap keeps
exactly live entries and positions, without historical-ID tombstones. Empty
owner/type/tile/income buckets are reclaimed. Removal also releases naval
building facts and sequence nodes.

Geometry revisions change on membership/type/tile, producer revisions on
owner/type/tier/alive/readiness/geometry, and dynamic revisions on changed fields.
Countdowns, damage that preserves eligibility, and weapon cooldowns do not
invalidate static geometry. Local stack representative order matches canonical
source order, including mixed-type reference fixtures. Only a changed stack is
visited; ordinary commands enforce the existing ten-building stack ceiling.

Construction, capture, paid upgrades, repair, weapon/launch cooldowns and damage
route through the lifecycle owner. Repeated building count, identity, owner,
recruitment, city-income and AI economic-snapshot consumers use the maintained
facts. No new persisted fields or experimental default are introduced.

`compareBuildingIndexes` is false by default and excluded from checkpoints.
It compares maintained facts against canonical full-array references on queries
and completed ticks. Restore reconstructs the index from checkpoint rows.

## Deterministic correctness and work evidence

The independent fixture uses a 128 by 96 all-land map, seed 47, one AI faction,
no tribes and AI disabled (legacy default ruleset). After initial buildings are
removed, 300 seeded lifecycle mutations with at most 32 reference records
compare identity/order, exact owner/type/tile groups, completed/alive income and
highest live ID after each mutation. Development verification also checks
tower sectors, representatives and heap membership.

Six lifecycle tests cover cloned input ownership, same-count replacement,
stable live record identity, independent revisions and no-op updates, complete
removal, unfinished-producer coastal death/revival, development audit failures, and restored deterministic continuation.
Twelve warm ticks with 240 owner queries add zero index rebuild scan rows.
A saved world and a cold restored world continue for twelve more ticks with
equal checkpoints; enabling comparison mode also leaves checkpoints equal.

These are algorithmic correctness counters on small fixtures, not mature-world,
largest-map, browser, memory-convergence or ARM capacity measurements.

## Local validation at code commit 1fe9ede1b8ee9c093032d0257423fb90c4e022ab

The focused six-file lifecycle/naval/production/index gate passed 37 tests.
The corrected source's full suite ran 1,030 tests in 157 files with one worker:
1,029 passed and the unchanged five-second tribe frontier test timed out.
An unchanged rerun of the entire Tribes file passed all eight tests. That exact
frontier test also timed out on the pre-P02 source baseline at `14fafeb`.
All assertions passed across these runs, but the full-suite timing gate remains
open; the rerun is not presented as a clean full-suite result. No timeout or
assertion was weakened. Ignored raw logs are `.tmp-p03-full-final.log` and
`.tmp-p03-typecheck-final.log` in this managed worktree.

TypeScript, production build, whitespace, scoped Oxlint and scoped ESLint passed.
The unchanged legacy `Simulation.ts` unused `tile` still fails full-file ESLint
and is excluded from the clean scoped ESLint claim. Known Vite large-chunk and
asset-plugin timing warnings remain. Committed Wall Kit and map LFS objects were
materialized from the existing local cache solely in this isolated checkout;
there are no tracked Art or resources changes.

This is a local source checkpoint. Squad/ship/cargo ownership, P03 acceptance,
full-suite timing qualification and mature-world/browser/ARM capacity remain
open. No default, push, merge or deployment changed in this slice.
