# Neutral squad passage: isolated change and measurement

Branch: `1.5.7-10hz-prototype`. Local changes only; no push, deployment or tick-rate change.

## Change

The shared `collisionHostile` predicate in `Simulation.ts` now uses current combat hostility rather than non-alliance. Neutral squads allow passage through one another. War and raid opponents still block root trajectories and exact formation sweeps. The same predicate feeds formation placement, recruitment spacing, landing, approach checks, local avoidance and detours; the policy is not patched separately into individual callers.

Existing bounded friendly soft-spacing preferences remain; this is removal of hard neutral blocking, not removal of all non-hostile neighbor queries. Terrain, walls, territorial-entry rules and peace protection remain separate. Legacy diplomacy still treats non-allied factions as hostile, so old-match behavior is preserved.

## Validation

78 tests passed across nine relevant files: new neutral passage, raid diplomacy, avoidance broad phase, authoritative formations, formation contact/runtime/locomotion/stopping and ship movement admission. The new integrated formation-sweep test verifies neutral passage, raid blocking, war blocking, passage after peace and continued wall blocking. TypeScript, production Vite build and diff whitespace checks passed. Existing build chunk-size warnings remain.

## Isolated comparison

Both variants use the new diplomacy rules. Baseline is a frozen copy of the immediately preceding local diplomacy prototype under `out/match-259-profile-20261014/neutral-collision-baseline/src`. Candidate changes the collision predicate. This compares neutral blocking with neutral passage, not legacy diplomacy with new diplomacy.

Same captured match-259 checkpoint at tick 51,514 and Mediterranean 1000 x 500 map. Each world warms up 120 ticks and measures 1,200 more at 20 Hz. Two pairs reverse construction order and alternate tick execution order. Total: 2,400 measured ticks per variant. Tests and build finished before timing. Node 24.18.0, Windows x64, Ryzen 7 3700X. Simulation only; no future human commands, renderer, replication encoder or network measurements. Worlds share one process, so garbage collection can reflect both worlds.

| Pair | Version | Mean tick ms | p95 ms | p99 ms | Mean movement ms |
| --- | --- | ---: | ---: | ---: | ---: |
| Baseline then candidate | Neutral blocking | 39.34 | 50.98 | 63.08 | 13.52 |
| Baseline then candidate | Neutral passage | 38.33 | 48.27 | 63.33 | 12.64 |
| Candidate then baseline | Neutral passage | 36.11 | 46.52 | 51.79 | 11.69 |
| Candidate then baseline | Neutral blocking | 37.97 | 48.49 | 56.99 | 13.33 |

Two-run average total tick: **38.65 -> 37.22 ms (-3.7%)**. Movement: **13.43 -> 12.17 ms (-9.4%)**. Mean improvement appears in both pairs (about 2.6% and 4.9%). p95 improved in both; p99 slightly worsened in the first and improved in the second. This is a modest local gain, not proof that tail stalls are solved.

End state: baseline 459 squads/75 ships/887 buildings/551 traders, candidate 460/75/887/547. Both had zero recorded formal wars; legacy implicit conflicts are not reinstated by this comparison. Movement improvement is not explained by a smaller final squad population, although changed positions and behavior can change workload over the measured interval.

Pending route count: 116 baseline vs 104 candidate. Oldest pending age: 571 vs 651 ticks. A smaller queue does not establish better worst-case order latency. Routing itself did not improve: two-run phase means approximately 10.08 vs 10.22 ms. Movement remains the largest phase at roughly 12.17 ms; movement plus routing remains about 60% of total candidate tick time.

Both repetitions of each variant reproduced their final serialized checkpoint hash:

- Baseline: `01dc3dff459ba790225d9fe8549679253fd29dafa71da4d5af24de6567ece45e`
- Candidate: `2d334c0f5c88865e0bc20648eb43a86fec4bf5bf637ba1d289eb42688e004b88`

Different outcomes are expected because neutral passage changes movement. Within-version repeatability is not full multiplayer determinism qualification.

Raw ignored evidence: `out/match-259-profile-20261014/neutral-collision-result.json`, `neutral-collision-pair.log`, `neutral-collision-pair.ts`, and the frozen baseline directory. Reproduce with `node node_modules/tsx/dist/cli.mjs out/match-259-profile-20261014/neutral-collision-pair.ts 1200` without competing CPU-heavy work.

This does not prove the 0.85x target on Oracle ARM, nor the larger Migration 700-squad/300-warship scenario. It is the later captured match-259 state. The evidence supports keeping neutral passage and continuing source-level work on routing and formation/movement costs before selecting 10 Hz.
