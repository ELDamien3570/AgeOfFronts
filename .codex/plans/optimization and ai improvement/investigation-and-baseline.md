# Investigation and baseline

Status: source investigation and limited diagnostics, not a capacity certification. September 30, 2026.

## What was inspected

The investigation followed `src/skirmish` simulation, progression, supply, combat, diplomacy, trade, routing, capture, worker snapshots, and faction inspection. The inherited OpenFront AI under `src/core/execution` was reviewed for assistance and betrayal concepts. The skirmish has its own gameplay model; attaching the inherited `Game` authority to it would create conflicting owners of gameplay state.

No source files were edited for the investigation. Temporary JavaScript harnesses ran through Node/tsx and operated on synthetic match instances in memory. Some measurements wrapped methods to time phases; those wrappers introduce overhead. The working tree contains ongoing changes from other work, so these are observations from a moving revision, not a pinned reproducible release benchmark.

## Existing foundations

- Simulation runs in a worker with a target of 20 ticks per second.
- Spatial grids, hierarchical land routing, shared movement corridors, bounded route work, staggered squad decisions, local avoidance, and narrow-passage coordination already exist.
- Strategic markers use WebGL2 instancing; detailed sprites remain a separate presentation workload.
- Building/tile snapshot deltas exist, but finding tile changes still scans the whole map.
- Expanded age, resource, equipment, trade, fortification, aviation, and diplomatic systems are present in the current working tree. Older design notes saying those systems are wholly absent should not be treated as current implementation evidence.

Do not propose adding a worker, spatial hashing, or hierarchical pathfinding as though none exists. Investigate duplicated work and the remaining costs within those systems.

## Current constraints and behaviour

| Finding | Evidence in the current source |
| --- | --- |
| Regular faction limit is 20, including the human; regular squad limit is 200. | [Protocol](../../../src/skirmish/Protocol.ts) and constructor validation in [Simulation](../../../src/skirmish/Simulation.ts). |
| Largest configured map adds 40 tribes; tribal squad cap is 10. | [FactionRules](../../../src/skirmish/FactionRules.ts). |
| Owners, claims, and capture pressure are eight-bit values. Zero is neutral and pressure 255 means contested. | `Simulation` arrays and `capture`; usable faction IDs therefore stop at 254, even though a byte can represent 255. |
| Tile snapshots pack owners and claimants into eight-bit fields. | [SnapshotCodec](../../../src/skirmish/SnapshotCodec.ts). Changing a setup cap alone cannot extend representation safely. |
| Capture eligibility is evaluated per nearby tile per squad. | `Simulation.capture` and [Expansion.canCapture](../../../src/skirmish/domain/Expansion.ts): unit definition lookup, all-building search, and fortification segment clearance. |
| Faction decisions repeatedly filter global entity collections. | `Simulation.thinkAi`, `Expansion.thinkProgression`, `thinkCapabilities`, and reserve/production paths. |
| Expanded AI scheduling assumes 20 regular faction slots. | `tick % 60 === (player.id % 20) * 3` in `thinkProgression`. Extra regular factions would share slots. |
| Research is attempted before opening construction. | `thinkProgression`: research loops precede city/barracks/factory placement; no shared spending reservation protects the opening. |
| Basic recruitment rotates infantry/ranged/mounted lines; production chooses the first compatible affordable recipe with a low output stock. | `Simulation.thinkAi` and `Expansion.thinkProgression`. They do not derive demand from an army plan. |
| Raids are triggered for selected individual squads and generally target the nearest enemy starting camp. | `Simulation.thinkAi`. There is no persistent force assembly, mission reinforcement, or conquest completion plan. |
| Alliance acceptance partly depends on matching player IDs modulo three. | `Expansion.thinkProgression`. Renewal is tied to allied victory mode rather than a personality/relationship policy. |
| Tribes receive progression and inventory state, but research, advancement, and diplomacy are explicitly restricted. | `Expansion.add`, `Expansion.command`, and [Diplomacy.action](../../../src/skirmish/domain/Diplomacy.ts). Evolution can reuse these domains, but needs an authored capability policy. |

## Headless opening diagnostic

Fixture: synthetic all-land 1000 x 500 `GameMapImpl`, seed 42, `ages-v1`, AI enabled, 19 regular AI opponents, tribes enabled. Run 120 ticks; discard the first 20 for step timing. Snapshot creation plus encoding was timed in eight samples, discarding the first. No browser, rendering, structured-clone transfer, realistic coastline/forests, or developed late-game economy was included.

| Measurement | Observed value |
| --- | --- |
| Factions | 60, including human and 40 tribes |
| Squads at the end of the opening sample | 340; this is not the initial deployment count |
| Buildings at that point | 40 |
| Constructor elapsed time | Approximately 6.57 seconds |
| Mean simulation step | 42.11 ms |
| Step 95th percentile | 78.60 ms |
| Maximum sampled step | 111.03 ms |
| Mean capture phase | 26.78 ms |
| Mean AI phase in the main simulation | 2.68 ms |
| Mean route-work phase | 4.64 ms |
| Mean snapshot creation and encoding | 12.97 ms |

The worker has 50 ms per normal-speed interval for stepping and publication together. These results identify capture and publication as priorities in this fixture; they do not predict a safe full-match population. Phase figures are instrumentation-dependent and should not be summed with overlapping subphase timings.

A separate 30-tick opening sample with extra nested instrumentation saw approximately 7,979 capture unit-definition and wall-clearance calls per tick with 295 squads. It reinforces the repeated-query finding, but timing-wrapper overhead makes it unsuitable for claiming a precise optimization speedup.

## Opening-budget diagnostic

Fixture: synthetic all-land 250 x 125 map, seed 42, one regular AI, no tribes, `ages-v1`, 1,800 ticks or 90 simulated seconds. Samples copied state at observation time so later research mutations did not alter earlier records.

| Milestone | Simulated time |
| --- | --- |
| AI researches Craft Workshops | First progression turn; its price uses all 3,000 starting gold |
| Six-second observation | Three squads, no buildings, 136 gold; Craft Workshops still researching |
| Barracks begins / completes | 18.3 / 23.3 seconds |
| City begins / completes | 48.3 / 56.3 seconds |
| Factory begins / completes | 75.3 / 85.3 seconds |

The opening eventually recovers through baseline income. This is a spending-priority problem, not evidence of a permanent deadlock. Correct budgets should reserve the configured construction and recruitment needs before discretionary research.

## Older stored stress results

The existing [skirmish documentation](../../../docs/AgeOfFrontsSkirmish.md) records trials with 4,000 squads, 1,280 ships, and 2,000 buildings. Stored integrated results show approximately 30 rendered FPS, but only about 14.08 simulation ticks/second on 500 x 250 and 10.67 on 1000 x 500. Those results predate later forest/expanded-age changes and are historical evidence, not current qualification.

Stored crowd profiles identified local avoidance as a major dense-army cost. The new opening sample has a different bottleneck. Profile representative mature matches before assuming either result describes every scenario.

## Primary references used for the proposal

- Mike Lewis, [Choosing Effective Utility-Based Considerations](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf): configurable decision scoring, eligibility checks, and cooldowns support the personality design.
- David Rez Graham, [Efficient, Event-Based Simulations](https://www.gameaipro.com/GameAIProOnlineEdition2021/GameAIProOnlineEdition2021_Chapter02_Efficient_Event_Based_Simulations.pdf): supports replacing unnecessary polling with scheduled events. Fixed simulation-tick ordering and deterministic work budgets are this project's proposed adaptation.
- Local inherited OpenFront [ally assistance](../../../src/core/execution/utils/AiAttackBehavior.ts) and [alliance behaviour](../../../src/core/execution/nation/NationAllianceBehavior.ts): useful examples of assessing relationships and betrayal risk. Their global troop model does not supply formation combat, resource-dependent recruitment, or the required persistent army operations.

## Required refresh before implementation

Pin the current revision/content hash and diagnostic configuration. Recheck the source findings, especially actively edited capture, snapshot, and expanded AI paths. Repeat integrated browser measurements with terrain, trade, walls, factories, aircraft, and multiple developed factions. Record correctness and simulation speed separately from rendering FPS.
