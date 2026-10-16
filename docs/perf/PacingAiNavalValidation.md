# Pacing, AI and naval implementation validation

Date: 2026-10-05. Status: implemented locally; release qualification remains incomplete.

## Followed plan

The baseline was the working source immediately before this AI/naval/trade implementation, not Git HEAD. It already contained the earlier age, tribe and allied-victory fixes. Existing uncommitted work was preserved. PlacementPreview, Renderer and their separate edits were not authored by this task.

| Step | Implementation | Local evidence |
| --- | --- | --- |
| 1. Faster advancement | Advancement after Bronze costs 25% less gold and time; Stone to Bronze unchanged. | TribeAdvancement and advancement regression tests. |
| 2. Allied victory | Online completion waits for the final queued projection before terminating its session. | AlliedVictory, OnlineMatchSession and LiveMatch tests, including real wire encoding. |
| 3. Emergency invasion defense | A bounded response recalls the AI's offensive army, gathers available ground troops at the nearest completed city and counterattacks together. It works before Armies research. A faction with at most one completed living city keeps no squad reserve. Manual control, boarding, active refits and recovery ownership remain protected. Initial eligible batches receive orders before the whole roster scan finishes. | Stone-age response, partial scans, last-city mobilization, lease protection and checkpoint tests. |
| 4. Tribe development | Surviving non-tribe factions reaching the next age unlocks ordinary paid advancement with its normal two-tree requirement. Tribe squad capacity starts at 10 and adds 5 per age; trader capacity starts at 16 and adds 2. | TribeAdvancement, AgeSquadCaps and TradeFleet tests. |
| 5. Naval investment | Permanent two-purchase stop removed. A one-time four-vessel investment allowance replenishes from 35% of estimated income, bounded by capacity and actual affordability. Spending and losses survive mission replacement/restore. Heavy losses cause a finite consolidation pause. Threatened ports may use emergency reservation priority. Production spreads across available same-sea ports. Missions can concentrate up to the existing 64-vessel faction cap. | Purchase-window, replenishment, recovery ownership, 48-vessel concentration, bounded fact enumeration and checkpoint tests. |
| 6. Naval motion and interception | Patrol dwell waits removed. Short cardinal water connectors avoid global A* for routine legs. Staggered acquisition examines at most 256 nearby records and retains at most 32 candidates. Sampling rotates through crowded buckets. Ships pursue hostile vessels/cargo; a bounded merchant-route look-ahead proposes lane interception. Strategic fleets keep their patrol leg until arrival and authorize local pursuit when intercepting or raiding. Normal admission and exact capture/combat rules remain authoritative. | Continuous-motion, pending manual voyage, recovery, connector legality, dense sampling and interception tests; fleet stress benchmark. |
| 7. Sea trade | Merchant speed now uses the authored 70/76/82/88/94/100/106 values instead of fixed 55. Successful long voyages target 1.5x equivalent land income before capture and fleet costs. Execution and quotes share the formula. | All seven ages, partial cargo, bounded distance credit, allied/domestic destinations and actual delivery tests. |
| 8. Offensive opportunities | AI compares researched weapon/armor/counter damage using the existing damage resolver, troop strength, veteran tier, reload and a bounded range heuristic. Two strong squads may exploit an obsolete force; ordinary parity attacks retain personality requirements. Small superior forces no longer immediately retreat solely because of an old count threshold. Sleep keys use stable gameplay facts, avoiding index-rebuild differences on restore. | Superior-age opportunity, strength comparison, strategic declaration and restore-key tests. |

These are advisory planning estimates, not battle predictions. Terrain, cover, positioning and incoming reinforcements can change the result.

## Sea-trade contract

For map width W, the reference land route is L = max(12, 0.05 W), with land speed 50. Its cycle is 60 + 2 L * 256 / 50 ticks. The sea cycle is 60 + 2 R * 256 / merchantSpeed, where R is a single validated outward-route length, credited at most 2 W. Loading captures that route credit, sailing speed and equivalent land/sea cargo ratio for the shipment.

The target income multiplier rises from 0.75 to 1.5 across port separations from zero to 10% of map width. Separations below 1% of width also taper linearly. The payout includes equivalent cargo capacity, travel/handling time and the ordinary diplomatic multiplier. Distance-credit limits prevent unbounded detour rewards. Partial cargo earns proportionally less. Domestic water shipments still earn no payment. Prize cargo still uses ordinary salvage value.

The 1.5x comparison means equal technology/stack/handling conditions and the same diplomatic multiplier at the normal land-market radius. It does not mean every delivered ship has the same payout, or that observed income after supply shortages, capture and fleet expenses is guaranteed to be 1.5x.

## Fleet benchmark

Three sequential baseline/candidate runs; table shows medians. Isolated 250x180 map, friendly healthy warships, AI disabled, 120 warm-up ticks followed by 240 measured ticks. Ships are added directly for this synthetic load, above ordinary per-faction recruitment limits. Five compressed production-replication samples follow, separated by ten simulation ticks.

| Fleet | Metric | Baseline | Candidate |
| --- | --- | ---: | ---: |
| 256 | Fraction of ship-ticks moving | 9.55% | 100% |
| 256 | Mean simulation tick | 1.026 ms | 1.065 ms |
| 256 | p95 simulation tick | 1.854 ms | 1.665 ms |
| 1,024 | Fraction of ship-ticks moving | 9.68% | 100% |
| 1,024 | Mean simulation tick | 3.199 ms | 4.033 ms |
| 1,024 | p95 simulation tick | 4.925 ms | 5.616 ms |
| 1,024 | Compressed bytes per sampled packet | 10,645 | 15,383 |
| 1,024 | Mean encoding time, median run | 5.122 ms | 6.311 ms |

Continuous movement is a behavior gain with a cost: approximately +0.83 ms mean simulation time and +44.5% compressed bytes at 1,024 ships in this fixture. It is not an overall performance improvement. Timing varies with concurrent machine activity; the 256-ship p95 difference is not evidence of a reliable speedup. This does not certify rendering, dense hostile naval combat, browser input latency or live multiplayer throughput.

Raw results: out/pacing-baseline-final1..3.json and out/pacing-candidate-final1..3.json. These are local diagnostics, not committed fixtures.

## Seeded autoplay

Artificial 240x160 coastal map, four AI-controlled regular factions, Bronze start, standard bounded AI policies, seeds 47 and 72. Each checkpoint comparison restores a second simulation and advances both for 30 identical ticks.

At 4,000 ticks plus continuation (about 3m21s), baseline combat ticks were 0/0; candidate samples recorded 44/3. This supports earlier engagement in these samples, not faster completion of a human match.

Final 16,000-tick samples plus continuation (about 13m21s):

| Seed | Metric | Baseline | Final candidate |
| --- | --- | ---: | ---: |
| 47 | Combat ticks | 1,054 | 992 |
| 47 | Surviving ships | 3 | 21 |
| 47 | Factions at Classical or later | 0 | 0 |
| 72 | Combat ticks | 761 | 782 |
| 72 | Surviving ships | 12 | 147 |
| 72 | Factions at Classical or later | 1 | 2 |

The AI now sustains substantial fleets rather than the old tiny navy. Stronger defense also keeps factions fighting longer; these samples do not demonstrate a shorter conquest match. They do not establish that Modern is reached on the user's desired schedule. Autoplay timings were collected while other checks ran and should not be used for CPU comparisons between different resulting populations.

## Validation and outstanding findings

- Final full skirmish suite: 1,408 passed, 1 failed across 202 files.
- Remaining failure: PlaytestStability's placement-preview ownership invalidation test. It also fails using captured baseline simulation/AI/trade sources. No placement-preview fix was included here.
- Focused defense/naval/trade/online completion checks passed; final budget and concentration regressions passed.
- TypeScript --noEmit passed. Production Vite build passed, with the existing chunk-size warning.
- Final long candidate checkpoints continued identically for both seeds; short candidate checkpoints also matched.
- Longer baseline runs, and earlier intermediate candidate runs, exposed civilian-trade route/settlement divergence immediately after restore. The final samples passing does not prove that underlying issue is resolved. The exact cause is unconfirmed; restore qualification needs additional tracing/checkpoint phases before calling this multiplayer-release-ready.
- No live online match, complete large-map human conquest, ARM server qualification or Oracle deployment was performed.

## Reproduction

```powershell
node node_modules/vitest/vitest.mjs run --config vite.skirmish.config.ts tests/skirmish --maxWorkers=2 --testTimeout=15000
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build --config vite.skirmish.config.ts
node --import tsx tests/skirmish/pacingBenchmark.ts candidate
node --import tsx tests/skirmish/pacingAutoplay.ts candidate 16000
```

Autoplay writes its result JSON and first-divergence snapshots into out/, and exits unsuccessfully if a continuation differs. The captured local baseline is in out/pacing-baseline/, with out/baseline-loader.mjs and out/captured-loader.mjs to substitute those sources without reverting the working checkout. Use node --import tsx --import ./out/baseline-loader.mjs tests/skirmish/pacingAutoplay.ts baseline 16000 for that comparison.
