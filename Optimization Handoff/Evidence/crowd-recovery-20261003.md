# Crowd recovery and blocker diagnostics — 3 October 2026

Implementation: `8965f3db10cdd72412bec90a3302518ca1babe5d`, deployed to Oracle after the live match drained. The public smoke and production-image verification are recorded below.

## Reproduction

The retained 500-size Valles Kairulia match has ten regular AI, 25 tribes and all five AI policies enabled. At tick 43,800 (36.5 minutes), squads 126, 127, 346, 352, 412, 420, 489, 5166, 5228 and 5258 had active move intents but did not move for 300 additional ticks. They form nearby groups of two or four with roughly the minimum friendly clearance. All ten are standalone squads, rather than formal army members.

Instrumentation of the original solver found four zero velocity choices and six nonzero proposals cancelled by the swept collision guard. Repeated route repair treated moving neighbors as transient, while none of the mutually stopped movers yielded. The HUD's generic "Waiting for clearance" label did not identify that cause. An additional squad, 10502, was waiting around occupied destinations and deferred admission.

## Implemented behavior

- The physical avoidance solver retains the contributing crowd constraint IDs and exact commit-guard blockers. Squad presentation reports congestion, yielding, route planning, terrain, restricted passage or a blocked route. A stable waiting-start tick and up to eight blocker IDs replicate through full and sparse snapshots; waiting seconds are derived in the HUD rather than sent every tick. Clearing an order or embarking clears stale land status. Combat and refit presentation keep priority.
- A squad without a quarter-tile of progress for 20 ticks can receive a local recovery turn. Arbitration favors older waits and rotates a previously served leader. A turn lasts at most 60 ticks, contains at most eight nearby same-faction members and is limited to eight concurrent clusters. Short fixed yielding legs reduce alternating sidesteps. Boundary members make room, then the leader retries its normal route goal.
- Every recovery velocity checks terrain, fortifications, faction entry permission and simultaneous swept separation. The exact final collision guard remains authoritative. Recovery keeps existing orders, army ownership and queued destinations intact. It does not purchase capacity with global replans or teleportation.
- The army domain explicitly permits arrived formation members to yield while their army is still assembling, marching or regrouping. Explicit member orders detach or stop coordination; a player-issued Hold never receives this permission. After yielding, the army's existing slot assignment returns the member to its formation.
- Bounded local route repair and fresh destination admission remain available for occupied/held endpoints. Yield legs finish before requesting another route repair.

The first implementation exposed a large-army assembly regression: previously arrived members could surround a yielding marcher. The domain-owned automatic-slot permission fixed that failure; the original 50-member mixed-speed test and a new queued crowded-army test now complete. Tests also require a manually held member to remain exactly stationary.

## Validation

The combined skirmish batch passes **171 files / 1,143 tests**. After the last diagnostic and presentation cleanup, 51 movement/army/checkpoint/HUD tests and a 20-test crowd/HUD/transport-replication group pass. TypeScript and the production client build pass. Logs are under `data/investigation-20261003/crowd-*-tests.log`, `crowd-release-typecheck.log` and `crowd-release-build.log`.

New regressions reproduce the recorded four-squad jam, check complete simultaneous swept trajectories, sustained arrival, queue preservation, stable restored leases, reversed-storage determinism, waiting fairness, cluster limits, enemy exclusion, explicit Hold and sparse status removal. Existing tests cover opposing traffic, one-cell passages, occupied destinations, manual army priority and transport lifecycle.

An authenticated ten-peer local smoke on the committed source passed on 500 Valles / ten AI / 25 tribes. All thirty selected human squads and all ten regular AI physically displaced. Normal Barracks construction completed at tick 200; fifteen common canonical state samples agreed. Rejected commands and reconnect passed with no failures. Artifact: `data/investigation-20261003/crowd-local-smoke.json`.

## Mature replay and cost

An isolated Oracle ARM container has one CPU, 3 GB memory and no network. It replays the identical tick-43,800 checkpoint for 600 ticks. With the deployed pre-fix image (`1ebaec0`), all ten reproduced squads remain completely motionless. With recovery, all ten move, eight reach their original destinations, and the other two cover almost their entire route before encountering newly occupied final slots. A further 600-tick continuation resolves those remaining orders into nearby available slots and Hold; an occupied original point is not treated as a legal permanent destination.

The initial source-overlay comparison advanced 600 ticks in 34.66 seconds before recovery and 33.88 seconds with recovery. Final-window tick mean/p95 were 53.50/82.04 ms before recovery and 46.77/69.72 ms with recovery. Movement p95 increased from 8.22 to 11.65 ms while routing p95 fell from 34.59 to 9.86 ms. These runs follow different subsequent AI/battle trajectories as squads regain movement; they establish measured progress and bounded cost, rather than a precise universal speedup.

An additional source-overlay verification produced matching complete local and ARM checkpoints at tick 44,400; tick mean/p95 were 46.22/75.72 ms on ARM. Final production-image measurements and exact committed-source parity are appended below. Artifacts: `crowd-arm-baseline`, `crowd-arm-recovery`, `crowd-final-arm`, `crowd-final-local`, `crowd-occupied-continuation` and `crowd-checkpoint-parity.json`, under `data/investigation-20261003`.

Tick tails still exceed the 50 ms target on one ARM CPU. This fixes the reproduced permanent crowd stalls; it does not establish lag-free late games, arbitrary-crowd liveness, multiple mature simultaneous matches or native Opera qualification. Truly blocked terrain, enemy blockers and explicitly held obstructions retain their domain restrictions.

## Deployed production verification

The exact production image and committed local source replay tick 43,800 to 44,400 into identical complete checkpoints. On one isolated ARM CPU, the production image completes the 600 ticks in 33.16 seconds. Final-window tick mean/p95/p99 are 46.17/72.74/94.12 ms; movement p95 is 17.44 ms and routing p95 is 9.95 ms. Artifacts: `crowd-release-arm`, `crowd-release-local` and `crowd-release-checkpoint-parity.json`. This image contains the final embark-status clearing and combat/refit HUD priority.

Public Oracle match match-130 passes the authenticated ten-peer smoke. All thirty selected player squads and all ten regular AI physically move. Normal Barracks construction finishes at tick 208; 15 common canonical samples agree. Rejection and reconnect pass; publication-gap p95 ranges from 219 to 234 ms. The longest observed gap is 496 ms during the controlled reconnect. All five AI policy flags are true. These are protocol peers in one harness process; rendered multi-browser and native Opera qualification remain open. Artifact: `data/investigation-20261003/crowd-oracle-smoke.json`.

The documented release built before restarting, required zero active matches, backed up SQLite, and started healthy app/proxy containers. The app's embedded GIT_COMMIT and current-revision are `8965f3db10cdd72412bec90a3302518ca1babe5d`. Backup `multiplayer-20261003T110646Z.sqlite` passes integrity_check on a disposable copy, preserving the backup's read-only directory.

The final two-peer public water repeat, match match-134, exercises researched embarkation to open water, physical arrival afloat at tick 168, rejected impossible water unloading with cargo preserved, manual sailing back and physical landing at tick 192. Ten common canonical samples agree and reconnect passes. Publication-gap p95 is 224–221 ms. Artifact: `data/investigation-20261003/crowd-oracle-transport-smoke.json`. The smoke harness now rejects unknown/incomplete options before creating a match, preventing an incorrect transport flag from silently skipping the water checks. The transport option is `--water`.
