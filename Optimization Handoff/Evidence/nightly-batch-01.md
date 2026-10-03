# Nightly optimization integration checkpoint

Code: `cd4a46c64c2db606876609547bc39bcff080e2f2`.
Branch: `codex/optimization-lifecycle-indexes`.
Runtime compatibility identity:
`d281f6d2bffe32f0c2b5dd04fc99d4a588de8ac7db8f27b17ece11ceed9658d3`.
Windows x64, Node 24.18.0. Experimental AI/planning defaults remain unchanged.

## Local implementation boundary

- **P03 complete locally:** building/unit/cargo lifecycle facts plus maintained
  recruitment owner/producer queues and remaining hot ID consumers. Countdown
  updates retain queue views; cancellation preserves actual producer heads and
  refunds once. Domain imports rebuild facts. Warm navigation cleanup uses
  removal hooks; imported orphan state keeps the first-step cleanup boundary.
- **P04 partial:** explicit controlled resource geometry and ownership revisions,
  resources by tile/owner, exact unversioned import validation, static recipe ID
  lookup and canonical producer lookup. Ownership/yield changes do not rebuild
  placement exclusions. Decoder transport revisions warm preview geometry.
  Completed-producer capability/allocation work is still open.
- **P05 complete locally:** strategic interception uses actual local candidates,
  blast walls use deduplicated exact circle queries in canonical wall order,
  static collision bodies follow geometry/producer revisions, and empty gun
  nests skip exact searches through a conservative occupied-cell gate. New
  occupants are visible in the same rebuilt combat stage; no delayed retaliation
  deadline is introduced. Actual health/cooldown reads use canonical buildings.
  Moving unit grids still rebuild at mutation-safe combat boundaries. Dense
  occupied sectors retain necessary exact local work.
- **P11/P14 integrated:** supplied 94be373, 710d337 and 44ceb21 were cherry-picked
  as 4eae4d7, a24b7a0 and e8e4eb5. Shared pause/codec changes and parallel fixtures
  were migrated through this branch's domain ownership. The parallel browser
  evidence reports HUD improvement only, with no frame/heap improvement claim.
- **P12 partial:** bounded independent entity/resource cursors, compact squad/
  ship/detail deltas, remove/re-add order, exact full extraction on overflow or
  restore, retained canonical decoding and decoder entity limits. The immediate
  worker capture borrows canonical records until synchronous encoding/transfer,
  avoiding the previous full entity DTO projection. Unversioned callers retain
  full reference extraction. Domain expansion metadata still uses the existing
  full coherent slab; broader metadata reduction remains open.
- **P13 complete locally:** one immutable encoded baseline keyed by an executor
  mutation version. Every advancing/controller/join mutation invalidates it,
  including same-tick changes. Baseline/normal-stream cursors stay independent;
  client epoch/sequence envelopes are not cached. Superseded or closed captures
  release references. Cache/extraction diagnostics do not enter checkpoints.

The user deferred P17, P20, P21, P22 and P25 to the next update. Dependent
acceptance requiring them remains open; this checkpoint is not an all-roadmap
or target-capacity acceptance.

## Validation

- Initial P11/P14 integration: 84 focused tests passed, nine files; TypeScript passed.
- Hot-loop/resource/recruitment/projectile/checkpoint integration: 48 focused
  tests passed, ten files, 15.02 seconds.
- Replication/baseline integration: 29 of 30 passed initially. The new comparator
  was corrected to omit the resource ownership wire hint from domain equality;
  all four replication/cache tests then passed. The full suite below covers
  this correction and the actual worker cache test.
- Combined full suite: **1,061 passed, one failed, 1,062 tests in 163 files**,
  249.76 seconds. The only failure was the new retained-collision fixture
  assuming a camp building before spawn. The fixture now explicitly creates a
  building and asserts nonzero allocation; its five tests passed in 2.23 seconds.
  Production code did not change for that fixture correction. Following the
  user's batching instruction, the full suite was not repeated for this test-only
  correction. This is full-suite coverage plus a targeted repair, not a single
  clean 1,062-test run.
- TypeScript passed after widening a collision-position parameter to the tile
  fields it actually reads. Production build passed (known large-chunk warning).
- Whitespace and scoped Oxlint passed. ESLint passed the 38 owned files other
  than Simulation; full Simulation retains only the known unused `tile` at
  line 992. No assertion or timeout was weakened.
- Raw local log: `.tmp-batch1-integration.log` (ignored, retained in the worktree).

## Independent fixtures and deterministic limits

Hot-loop fixtures use 96x64 land, seed 47, ages-v1, one AI, no tribes and AI
disabled. Recruitment tests execute 300 seeded queue mutations with at most 32
jobs and compare owner/producer results to independent filters. Resource tests
exercise 100 ownership changes across 16 nodes, then yield, geometry and restore;
warm controlled queries perform no signature scan or geometry rebuild.
Wall-circle tests compare 200 walls across 40 exact circles, including duplicate
cells and dead walls. Empty nests skip eight searches, then fire on the first
enemy-arrival tick. Static collision bodies allocate once across twelve warm
combat/projectile cycles and refresh on capture without allocating again.

Replication fixtures compare decoded domain state against fresh full extraction
through 100 mutations, reverts, remove/re-add and restore. Quiet extraction reads
zero squad/ship/building/resource rows and creates zero unit/detail payload rows.
Each entity journal retains at most **32,768 IDs** and requests full fallback
on overflow/restore. A two-ID fixture proves overflow fallback and cursor
independence. The decoder retains at most the existing gameplay envelope of
200 squads and 64 ships per possible owner ID (255). Baseline retention is one
encoded state under the existing producer/consumer transport ceilings.

These counters establish local correctness and bounded retained work. They do
not establish mature-world transient-memory convergence, ten-browser behavior,
ARM capacity, production multiplayer load or release readiness. No push, merge,
deployment or concurrent artwork change was performed.
