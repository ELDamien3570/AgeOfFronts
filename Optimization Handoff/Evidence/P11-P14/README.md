# P11/P14 integration handoff

Base: `59c4eeb4696e6c8f91c730704ec9537f7f351a1b` (includes P01).
Branch: `codex/p11-p14-optimization` in the isolated managed worktree.
Node 24.18.0, Windows x64; installed lockfile dependencies reused by junction.
No dependency updates, default feature-gate changes, Art source edits, push,
merge or deployment.

## Integrator sequence

1. Cherry-pick the P11 fairness commit `94be373`, then the P11 capacity/pause
   component commit `710d337`, then the P14 presentation commit (listed in the final chat).
2. Review `shared-integration.patch` against the current integrator versions of
   `Simulation.ts`, `Protocol.ts`, and `SnapshotCodec.ts`. Apply individual
   hunks alongside P03 and other work; never replace whole shared files.
   `git apply --check` passes at this branch. The patch also adds the land
   integration regression `CommittedPlanningPause.test.ts`.
3. Run that regression, MovementAdmission, ShipMovementAdmission,
   PlannerFairness, SnapshotCodec, CanonicalStateStream, MultiplayerStateWorker,
   OnlineMatchSession and HudViewModel tests, then the common gates. Review
   optional `planningPaused` propagation in any newer replication journal.
4. Keep gates off until the dependent caller migrations and real hardware/
   browser acceptance are complete. This handoff is not release certification.

## Policy and compatibility review

The user selected stability. A finite full-arena retry handles temporary shared
capacity contention without increasing the arena. After three limited results,
committed land/ship legs pause and retain later waypoints; shorter replacement
orders can plan, while rejected replacements preserve the active order. The
land behavior and network status require the shared patch. The component ship
pause operates without it, but its HUD marker requires the optional callback.
Pause spends bounded bookkeeping, submits no further route searches, and does
not promise fewer disconnects without deployment evidence.

Historical planner metadata absence restores FIFO; version 2 retains its earlier
fair policy. Historical ship checkpoints without `pauseCommitted` retain their
old unbounded retry policy rather than silently changing persisted matches.
Diagnostics do not drive decisions or enter checkpoints. New render caches are
presentation-only and do not affect orders, physics or canonical replication.

## Validation

79 focused tests passed with the shared patch (nine files); another 12 passed
including the subsequently added legacy ship policy regression. The shared land
regression verifies restore, preserving later orders, no requests after pause,
wire status and clearing on replacement. After exporting/restoring the shared
files, TypeScript, production build, scoped Oxlint/ESLint and diff checks pass.
The known large-chunk build warning remains.

Final serial full suite: **1035 tests passed across 158 files**, 279.86 seconds,
with unchanged assertions and five-second deadlines. See final-tests.txt.
Earlier serial run: 1020 passed and one
five-second timeout in ShoreTransport's waiting island-slot test. The same test
failed against the untouched base planner in 5814 ms (5000 ms deadline), versus
5923 ms locally. No timeout was relaxed and no unrelated transport fix applied.
The final isolated run cleared that earlier timing failure; it remains useful
evidence of local timing variability, not a current failing gate.

## Browser evidence and limits

`browser-profile.json` records the same-seed ordinary-play comparison. HUD p95
improved from 5.1 to 3.0 ms; frame p95 and heap did not improve. No overall frame
or memory gain is certified. Local CPU/browser scheduling was uncontrolled.
The sample predates final numeric coarse bounds and ship culling refinements.

`browser-worker.json` records a real Chrome 154 module-worker regression: four
canonical packets, zero hidden views, held presentation, changed-back dirt,
removal, old/current acknowledgements and a fresh recovery baseline. Reproduce
with Vite and `tests/skirmish/browser/P14Projection.html`; click Run, then Release.
It uses real structured cloning/worker transfers but does not certify a live
WebSocket join/recovery or ten browsers. Existing session tests cover barriers.

54-player fairness is a bounded fixture (108 jobs), not a largest-map benchmark.
Future P06-P10 caller migration, broad pan/zoom/selection visual review, ARM,
largest-map and ten-real-browser capacity acceptance remain open. Maps and
runtime art used for browser checks were materialized from existing local LFS
objects; not every unrelated LFS asset was fetched or runtime-certified.
