# Shared travel and relevant recomputation — 2026-10-14

Implemented on `1.5.7-10hz-prototype`, retaining **20 Hz**. The changes remain local and unpublished. Oracle was used for isolated profiling, then restored to its original `7e4ff0e0af75799c75a212557a99e7d0c7b1d1ce` image. No hardware or cloud billing configuration changed.

## Result

On the existing two-core ARM server, the complete candidate reduced mean simulation tick time **50.06 → 45.50 ms (9.1%)** against the preceding diplomacy/neutral-passage prototype. The two paired improvements were 11.1% and 7.0%. The mean of the two run p95 values fell **61.36 → 56.89 ms**, and p99 **66.22 → 63.53 ms**. These are simulation-only measurements, not online game-speed qualification.

| Comparison | ARM mean before | ARM mean after | What it establishes |
| --- | ---: | ---: | --- |
| Previous prototype → complete implementation | 50.06 ms | 45.50 ms | 9.1% less simulation CPU time in this continuation |
| Shared-travel implementation → final geometry/acquisition caches | 48.42 ms | 45.41 ms | 6.2% less time, with identical final checkpoint and visible-state hashes |
| Controlled army workload, previous prototype → complete implementation | 35.66 ms | 34.59 ms | 3.0% less time for the combined changes; not an isolated army-sharing gain |

The local Ryzen 7 3700X comparison of the complete implementation reduced mean **33.33 → 30.32 ms (9.0%)**. In an earlier separate local trial, shared travel alone did not demonstrate a CPU gain. Reducing army route jobs is useful, but it does not account for most simulation cost in this capture.

## What changed

- Route scheduling classifications and immutable cohort attribution are reused within an explicitly versioned scheduling read phase. Callers without the revision contract retain live reads. Commitment classification remains lazy so its first read occurs at the established scheduling point.
- New diplomacy route validity observes the affected owner's permissions and treaties. An unrelated alliance no longer cancels that owner's route jobs. Fortification invalidation remains conservative and global; this work does not claim to eliminate every unnecessary route invalidation.
- Physical formation envelopes survive administrative revision changes and can be shared across hypothetical records of the same squad. Exact shape, size, facing, transition time, unit variant and charge state remain cache inputs. History is bounded to eight entries per squad and 2,048 squad IDs. Prepared contact bodies still check their actual world pose.
- Acquisition wake regions observe eligible opponent owners. Moving neutral squads cannot dirty an enemy-only region. Factions with no eligible unit opponent skip unit-target searches, retaining charge/cycle progression, explicit structure-target handling and resolution of projectiles already fired. Removing a war against an eliminated faction invalidates both owners' permission views.
- Coordinated armies can follow a checked part of their shared corridor through short connectors. Obstructed or separated members retain deferred exact routing. Only members requiring reconnection enter the recovery cohort; ready members avoid collateral replanning. All actual squad movement still goes through formation, terrain, fortification, territorial permission and hostile-body validation.
- New games record `armyTravel: "corridors-v1"`. Their common marching pace is capped at the slowest ordinary member speed, removing the old 1.1 multiplier. Existing cursor lag/spacing smoothing remains. Old checkpoints without the marker retain the established travel behavior.

## Work reduction and remaining cost

In the cache-only ARM comparison, over 120 warm ticks plus 600 measured ticks, envelope reads fell **2,494,997 → 1,381,101 (44.6%)**. Calls through to `formationEnvelope` fell **333,494 → 139,081 (58.3%)**, with 194,413 projected-record reuses. These counters are wrapper/cache misses, **not counts of expensive geometry construction**; `FormationGeometry` also has its own cache. The history-only local trial was approximately flat, so the large counter reduction must not be presented as a proportional CPU improvement.

The controlled workload issued orders for seven existing-unit groups, 33 members total. Army route completions fell **82 → 42 (48.8%)**, while planner work fell **9,089 → 8,438 (7.2%)**. Three groups arrived in both versions; candidate arrivals were 507, 496 and 429 ticks versus 501, 493 and 432. One group remained in deployment and three never began marching during the observation. This is not proof that all seven orders completed. Candidate telemetry recorded 1,969 direct legs, five corridor legs, 26 recovery members and six direct admissions.

In the complete ARM comparison, phase means were approximately movement **15.57 → 15.07 ms**, combat **8.70 → 6.69 ms**, and routing **15.14 → 13.32 ms**. The remaining route workload includes substantial trade and other admission work. The captured game has few active army groups, so shared army routing cannot fix its entire routing bill.

## Method and scope

The exact previously approved match-259 map/checkpoint was restored at tick 51,514: 1,000 × 500 cells, initially 400 squads, 74 ships, 861 buildings and 516 traders. Its options specify two humans, 14 AI, 30 tribes and a Napoleonic starting age. All comparisons opt this older capture into the new diplomacy rules. The observed world differs from the original requested Migration scenario of approximately 700 squads and 300 warships; **that larger workload is not qualified by these numbers**.

Each comparison uses two reversed construction-order pairs, alternates execution order every measured tick, and performs 120 warm ticks followed by 600 measured ticks per world. Sources are frozen separately. The coordinated stage additionally disables AI decisions in both worlds and issues explicit existing-unit army movement commands. Neither units nor positions are fabricated. Worlds share a process, so garbage collection is not perfectly isolated; report paired timings rather than a single favorable trial.

ARM: Node 24.18.0, aarch64, existing two logical CPUs and approximately 12 GB RAM. Test containers used the existing image dependencies, read-only source mounts, no network, two CPUs, an 8 GB memory limit, dropped capabilities and no additional privileges. The final archive SHA-256 is `7743b910439cfb3e97b3ce10ae90c43e5cf0f2e78c8752dab70bc82d40d78bd9`.

Drivers and raw measurements are under `out/match-259-profile-20261014/`: `final-optimization-benchmark.ts`, `final-{recompute,travel,coordinated}-{arm,local}-result.json`, and `final-qualification.log`. Stage names are historical driver labels; use the comparison descriptions above to interpret them.

## Correctness and limitations

All **349 test files / 2,402 tests**, TypeScript and the production build passed. Tests cover classification revision/restore, permission locality, exact envelope revisions and physical changes, opponent-only wake regions, immediate war activation and elimination invalidation, checked corridors, blocked recovery, mixed-speed travel, bridge movement and checkpoint travel state.

The final cache-only candidate matches the earlier shared-travel implementation on every visible state in a 600-tick continuation. All four cache-only ARM runs also produced the identical checkpoint hash `01c2a484386f330a521dbbe43e7f19dd2d841467a21f582f9090cd2e9816792e` after 720 total ticks. Each version's complete and coordinated comparisons repeated its own final hashes. The full implementation intentionally changes owner-local route job lifetime and marching behavior, so before/after full hashes are not expected to match.

A separate uninterrupted-versus-mid-run-restore probe diverged four ticks after restoring at continuation tick 120. It also reproduced in both frozen earlier versions, including the pre-task prototype. Some AI squad orders changed from move to hold. This is an **existing continuation limitation**, not a passing parity check and not a proven regression from this work. Its root cause remains unresolved; unrelated AI persistence was not changed here.

These measurements exclude future human commands, network delivery, snapshot encoding, client catch-up and rendering. A 45.5 ms mean fits the 50 ms simulation budget on average, but tail ticks still exceed it. **Sustained 0.85x online speed is not proven**, and neither is the 700-squad/300-warship target. A multiplayer pipeline qualification is required before calling the lag solved. The present evidence does not justify using a 10 Hz switch to conceal remaining costs.

## Production recovery

Production had zero active matches when stopped. A fresh online SQLite backup was verified before the test: `/opt/ageoffronts/backups/multiplayer-sharedtravel-20261014T215351Z.sqlite`. The bounded run automatically restored the original app after all ARM stages finished at 22:01:14 UTC. Public HTTPS health reported healthy/open with zero active matches; database integrity returned `ok`, and production logs showed the coordinator listening. The prototype was **not deployed publicly**.
