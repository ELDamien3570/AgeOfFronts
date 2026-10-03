# P03 unit lifecycle checkpoint

Code commit: `a0e2aa1587b29c7101ebade7d85698ea7a45d657`, parent `2b411ee8b02170bbb6c117f63c70aca927b186c4`,
branch `codex/optimization-lifecycle-indexes`, isolated managed worktree.
Windows x64, Node 24.18.0, existing lockfile/dependencies.
Runtime identity: `783e9d22c21cc358506b0b2551b0c9220e738c794fe8aaa935fa4df6d689e3c2`.

## Implemented boundary

Canonical squads and ships now use the same explicit entity owner as buildings.
Public add/update methods clone external inputs; owned records retain stable
identity, fields and nested orders/routes are TypeScript read-only, and collection
and index views are frozen. Production movement, combat, refit, Army, boarding,
shore-transfer, casualty and removal writers use domain methods. Internal route
ports adopt finalized domain containers without copying an entire route on each
position update. Restore adopts rows from the aggregate's already cloned save.

Exact by-ID, owner, owner/kind, owner/definition, alive-owner and cargo groups
update through spawn/change/remove/restore hooks. Membership, cargo and dynamic
revisions have separate invalidation criteria; movement leaves membership/cargo
revisions unchanged. Buckets retain canonical source order after owner changes.
Deleted IDs and empty groups are released; retained index state scales with live
rows and their groups, without historical-ID tombstones. Ship removal also
releases retained naval facts. Squad removal releases its navigation state/work.

Tick ID-map reconstruction and full movement-stage cargo grouping are removed.
Owner counts, AI force/economic inputs, fleet iteration and cargo consumers use
maintained facts. Global enemy/spatial queries, additional legacy consumer
migration and recruitment-job query ownership remain further work; this record
does not claim every simulation scan is eliminated.

The optional `compareUnitIndexes` audit compares canonical records and all
membership/cargo groups without repair. It is off by default and excluded from
checkpoints. No persisted shape or experimental default changes.

## Correctness and deterministic work

Four new tests use a 128 by 96 all-land map, seed 47, one AI faction, no tribes,
AI disabled and legacy default rules. A 400-operation seeded sequence with at
most 32 reference squads and 32 reference ships compares independent canonical
owner/kind/definition/alive/cargo scans after mutations, including same-count
replacement, capture, casualties, refit and embark/landing relationships.
The tests also cover input/route alias isolation, stable identity, frozen views,
exact removal, reclaimed groups and revision/no-op behavior.

A saved two-squad world and a cold restored world continue for twelve ticks with
identical checkpoints. Twelve warm ticks and 240 owner queries add zero unit-index
rebuild scan rows. This measures derived-index work, not all simulation work.
Existing combat, shore, Army, naval, admission and snapshot tests exercise the
real production mutation paths. The shore fixture was corrected to retain owned
records rather than external input aliases; no assertion or timeout was relaxed.

## Local validation

The initial nine-file focused gate passed 63 tests. The first full run found
eight shore fixture failures and three unchanged map timeouts; its local raw log
is `.tmp-p03-unit-full-first.log`. After correcting fixture ownership and new
scoped lint findings, the final full run passed **1,034 tests in 158 files**, with
one worker and unchanged timeouts (293.04 seconds). Raw final log:
`.tmp-p03-unit-full-final.log`. This is a clean local full-suite result at this
source, superseding the earlier continuation's open local timing gate.

TypeScript, skirmish production build, whitespace and scoped Oxlint passed.
ESLint passed the other 59 owned files; full-file Simulation reports only the
unchanged legacy unused `tile` at line 978. The known Vite large-chunk warning
remains. There are no tracked Art/resources changes in this slice.

Mature-world memory, real-browser behavior, target ARM capacity and integrated
experimental-feature qualification remain unverified. P03 still has further
consumer migration and broader acceptance work; P04-P30 were not started by this
checkpoint. P11 and P14 remain reserved for the user's parallel session.

The user requested a pause after this testing gate and a rough estimate of
remaining code. Implementation pauses here; the full-roadmap authorization remains
the intended scope when the user resumes.
