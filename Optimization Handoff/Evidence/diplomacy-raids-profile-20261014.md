# Diplomacy prototype: implementation and late-game comparison

Branch: `1.5.7-10hz-prototype`. Baseline: `7e4ff0e0af75799c75a212557a99e7d0c7b1d1ce`. Changes are local and have not been pushed or deployed. Simulation remains 20 Hz; no nomads, shared group paths or formation-geometry redesign are included.

## Result

The diplomacy change passed its behavioral checks, but **did not reduce average total tick cost in this captured-state comparison**. Two-run means were 38.66 ms baseline and 38.65 ms candidate. This is effectively flat, not evidence of a measurable throughput gain. Tail tick times improved in both pairs.

Routing and combat became cheaper, but movement became more expensive as more squads survived. The candidate ended with 459 squads versus 372 baseline, 551 traders versus 514, and 887 buildings versus 876. Less incidental warfare does not automatically mean fewer simulated entities. These results do not establish improved economy balance or an end to army overproduction in fresh games.

The remaining routing and formation/movement work still warrants investigation before a 10 Hz decision. This implementation alone is **not qualified for 0.85x on Oracle ARM**.

## Implemented contract

- New normal single-player and multiplayer matches record `diplomacyRules: raids-v1`. Old checkpoints and replays without the marker retain legacy behavior. An existing production match is not silently converted.
- Neutrality, alliance, war, directional embargo/raid, combat permission and capture permission are distinct. Only formal war permits foreign territory/building capture and deliberate structure attacks. Raid combat includes naval units; bombardment requires war.
- Human successful trade interception starts or refreshes a raid automatically. New physical entry into non-allied territory declares war; ownership changing beneath a stationary squad does not. Don't embargo suppresses peacetime automatic theft, not wartime theft; existing raids expire normally.
- Accepted peace clears war/raids and protects for one minute. Protected entry is blocked while existing occupants can leave. Projectiles retain launch permissions so already-fired shots resolve after peace or alliance. Existing strategic-blast collateral rules remain.
- AI cannot turn observed threats or incidental contact into permissions. Optional invasions prefer passable unclaimed frontiers; retaliation and personality exceptions remain. Readiness and an exact prospective land-route certificate precede formal declaration. A naval transport expedition planner is not added.
- The explicit AI raid authority entry point opens an embargo before interception, grants no capture permission and respects peace/exemptions. This stage does not add a new regular-faction neutral trade-raid mission chooser; no nomad mission planner is implemented.
- AI offers and responds to neutral peace. Five-minute pair cooldown, 30-second AI-to-human recipient limit and meaningful-context changes suppress repeated offers. States and cooldowns persist. Peace and exemptions work even when alliances are disabled.
- Effective permission changes invalidate routing/combat reads; offer metadata and theft timestamp refreshes do not. Projectile launches reuse immutable faction permission lists until permissions change. New-rule pair projections bypass legacy implicit-conflict construction.

The complete choices and initial personality thresholds are in `Optimization Handoff/Plans/diplomacy-raids-contract-20261014.md`. Those thresholds need fresh-match balance observation.

## Verification

- Full regression: **346 files, 2,390 tests passed** (`diplomacy-verified-all-tests.log`).
- Final affected regression: **10 files, 94 tests passed**. Subsequent authority checks (explicit AI raid and rejection of new actions in legacy matches) passed **24 tests across two files**, including all 17 raid-diplomacy tests; the full run above contained the preceding 15-test version of that file.
- TypeScript passed after the final authority change. Production Vite build passed; its existing large-chunk warning remains.
- Browser review exercised the actual EmpireView and command authority in a local fixture: raid display, incoming peace popup, acceptance, protected-peace display and removal of Declare War. Screenshot: `out/match-259-profile-20261014/diplomacy-peace-ui.png`. This is UI interaction proof, not an online multiplayer performance measurement.
- No live match was restarted or instrumented during this implementation. Oracle health reported one active match, so no competing heavy ARM benchmark was launched.

## Comparison method

Local Node 24.18.0, Windows x64, AMD Ryzen 7 3700X (16 logical CPUs). Frozen baseline source was exported from the commit above. Each version restores the same captured map and match-259 checkpoint at tick 51,514, warms up 120 ticks, then measures 1,200 ticks (60 simulated seconds). Two pairs reverse construction order; measured ticks alternate which world steps first. Each version therefore has 2,400 measured ticks. The final run followed the tests and was restarted after compilation completed to avoid competing test/compiler work.

The captured Mediterranean map is 1000 x 500 with 400 squads, 74 ships, 861 buildings and 516 traders. This is the later match-259 capture, **not** the earlier unavailable roughly 600-squad half-speed state or the synthetic Migration 700-squad/300-warship target.

The candidate explicitly opts a cloned legacy fixture into new rules for this counterfactual comparison. This is not a save-migration procedure. Existing implicit offensive commitments may become recovery/neutrality under the new authority. No future human orders, networking, renderer or snapshot encoder are measured. Two worlds share one process; garbage collection is included in step time but can be influenced by both worlds. Use these timings as a paired local simulation result, not predicted Oracle game speed.

| Pair | Version | Mean ms | p95 ms | p99 ms |
| --- | --- | ---: | ---: | ---: |
| Baseline then candidate | Baseline | 38.58 | 54.73 | 66.99 |
| Baseline then candidate | Candidate | 39.12 | 51.03 | 59.35 |
| Candidate then baseline | Candidate | 38.18 | 49.77 | 57.09 |
| Candidate then baseline | Baseline | 38.73 | 53.19 | 60.38 |

| Timed phase, two-run mean | Baseline ms | Candidate ms | Change |
| --- | ---: | ---: | ---: |
| Routing | 12.07 | 10.13 | -16.1% |
| Movement | 10.11 | 13.29 | +31.4% |
| Combat | 8.35 | 6.89 | -17.5% |
| Capture | 1.01 | 1.53 | +52.2% |

Movement plus routing is about 61% of candidate tick time. This is phase timing, not fresh V8 function attribution or a count of geometry cache misses. It supports pursuing repeated route classification and formation/movement work; it does not demonstrate that a particular proposed optimization will close the ARM gap.

Pending route counts at the end were 106 baseline versus 116 candidate; oldest pending age was 1,367 versus 571 ticks. Fewer old waits should not be confused with a smaller queue or proven player order latency.

Each version reproduced its final serialized checkpoint hash across the reversed pair:

- Baseline: `ccd4d9e81e99f06582bae744fe98a738be894a67e8385902163661e82dfea411`
- Candidate: `140ba8a7d58f292f04da779e06b66e82764baf7257e63e21ded09660ca8e19ba`

Different versions are intentionally not canonically equal. Matching hashes within each version demonstrate repeatable continuation for this input; they are not a long-run multiplayer determinism qualification.

Local ignored evidence: `out/match-259-profile-20261014/diplomacy-pair-result.json`, `diplomacy-pair.log`, `diplomacy-pair.ts`, frozen `diplomacy-baseline-source/src`, and the previously captured checkpoint/map under `aof-match-259-live-profile/`. Reproduce with `node node_modules/tsx/dist/cli.mjs out/match-259-profile-20261014/diplomacy-pair.ts 1200` after other CPU-heavy work finishes.

At 20 Hz, 0.85x permits roughly 58.8 ms of average wall time per tick before accounting for scheduling interactions and tails. The local 38.65 ms result cannot be substituted for an ARM measurement. The next performance qualification needs an isolated ARM continuation and then a comparable live multiplayer game under new rules.
