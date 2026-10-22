# Fixed formation travel: implementation and measurement

Measured gameplay source: `6bc32618d4ae7fab527a9498cd9f20e493a4fef5`. Test-fixture correction: `f2412f593e978cf7b135c1d4d834d8b8db861d3c`. Both have the identical `src` tree `335432075937eb31be729aff5f8c22bf0b0c3567`.

Ordinary travel now preserves the chosen formation shape and frontage. Map edges no longer require every member footprint to stay inside the map: the anchor stays in bounds, while members can overhang. Automatic width searches, conversion to travel columns, and winding-route conversion do not run under the new policy. Manual formation commands and explicit deployment-line layouts remain available.

The user explicitly directed that disabled walls/gates must not determine this movement policy. No replacement wall-navigation system was introduced. Existing occupied-cell collision checks are preserved for in-map cells; map-edge overhang does not move the anchor outside the world.

## Why the one-second wait happened

The traced modern infantry squad already had its route after one tick. At the north map edge, the old adapter narrowed its mass frontage from 256 to 192 fixed units and installed an eight-tick formation transition. At eight ticks per second, that transition alone required one second. Locomotion was paused during this ordinary automatic reform. This was an enforced formation behavior, not a requirement that the route search take one second.

## Exact original-command comparison on Oracle ARM

The diagnostic restored the original 75-minute authoritative checkpoint and applied the same 134 recorded actions through tick 36,200 in both modes. The historical mode exactly reproduced all 101 watched frames of the previously frozen squad-2 trace. The fixed mode changed only `options.formationTravel` and `checkpoint.options.formationTravel` to `fixed-v1`; reverting those two options makes the input envelope deeply equal to its original. No squads, resources, positions, routes, trade state, or planning progress were changed during migration. Both modes had zero immediate command-outcome mismatches.

Command `8b8dfabe-6596-4799-b43d-bc23d7614581-sea-probe-215`, applied at tick 36,121:

| Stage | Historical | Fixed |
| --- | ---: | ---: |
| Route committed | 1 tick / 125 ms | 1 tick / 125 ms |
| First turn | 10 ticks / 1,250 ms | 1 tick / 125 ms |
| First nonzero translation | 12 ticks / 1,500 ms | 3 ticks / 375 ms |
| Automatic travel-transition ticks | 8 | 0 |

The fixed response saves nine ticks (1,125 ms), a 75% reduction in time to first translation for this command. These are authoritative simulation durations, not client/network wall latency. The first nonzero translation is also the original probe's threshold crossing (>8 fixed units) in this exact case. Remaining delay is route admission, turning and acceleration; this result does not promise every move starts within 375 ms.

Evidence: `out/sea-trade/player-movement-6bc32618/exact-input-oracle.json`, `exact-input-inspect.json`, and the manifest-verified diagnostic bundle/source in `payload-manifest.json`. The offline container exited normally with no OOM. Its image HTTP healthcheck has no application endpoint during an offline replay and is not an online-game health measurement.

## Compatibility and validation contracts

`formationTravel: "fixed-v1"` is part of the shared new-match defaults used by both local and hosted matches. Missing policy retains historical behavior for saved games and replays. Existing in-flight transition poses are not teleported or discarded; an explicitly migrated checkpoint can finish those existing transitions safely. Ordinary movement under the new policy does not initiate a new automatic fold.

Terrain certification and its existing obstacle-area fast path share the same boundary rule. Only the in-map body portion is checked; the full-envelope 4,096-cell work cap remains in place. Root/carrier bounds, watercraft clearance, terrain medium, hostile body collision, and path-planner work limits retain their existing owners. No route cache, scheduler capacity or tick rate was changed in this pass.

Regression coverage includes all four edges and four corners; rejection of outside anchors; original eight-tick pause versus continuous movement; winding routes and failed future fit probes; occupied in-map blockers and fast/full certification agreement; manual formation changes, snapshot replication and explicit deployment-line completion; exact checkpoint restoration and continuation. Historical cache/spatial goldens retain their original hashes by omitting the new match default in their explicit legacy fixture.

## Live late-game qualification

The isolated 75-minute Migration checkpoint ran with three real WebSocket clients, the production decoder and the existing eligible units. The 60-squad stress commands use two simultaneous 30-squad orders, preserving the actual transport/UI limit. No units or resources were manufactured.

The measured 606.409-second window advanced 605.875 game seconds: **0.9991x average speed**, above the user's 0.9x average target. Mean tick cost was **93.60 ms**, p95 125.39 ms, p99 192.64 ms and maximum **346.69 ms**. 247/4847 ticks exceeded 125 ms. The earlier build's mean was 93.93 ms; the tiny difference is not evidence of a material CPU improvement. Its maximum was 334.64 ms.

There were no crashes, OOMs, client decoder failures or sampled state disagreements; all sent command groups completed. All received packets were decoded, and 388 sampled state comparisons agreed. No surviving member remained unresolved. Four members completed without translation; the full replay watch verified each was exactly at its assigned point when its route committed.

Current client-decoded response distributions, in seconds. Reaction means the first observed turn or translation; translation uses the existing >8-fixed-unit threshold. These are decoded-state response measurements, not rendered-pixel measurements.

| Selected squads | Sent groups | Member reaction p50 / p95 / p99 | Member translation p50 / p95 / p99 | Maximum member translation |
| --- | ---: | ---: | ---: | ---: |
| 1 | 40 | 0.250 / 0.461 / 0.579 | 0.475 / 0.904 / 1.021 | 1.021 |
| 8 | 21 | 0.263 / 0.408 / 0.429 | 0.317 / 0.988 / 1.049 | 1.049 |
| 30 | 20 | 0.282 / 0.391 / 0.430 | 0.733 / 1.007 / 1.195 | 1.301 |
| 60 | 20 | 0.410 / 0.613 / 0.777 | 0.919 / 1.266 / 1.353 | 1.794 |

Time until the last member was observed moving:

| Selected squads | Previous p50 / p95 | Fixed p50 / p95 | Fully moving groups, previous / fixed |
| --- | ---: | ---: | ---: |
| 1 | 0.522 / 1.065 | 0.475 / 0.904 | 38 / 40 |
| 8 | 0.823 / 1.934 | 0.767 / 1.003 | 38 / 21 |
| 30 | 1.034 / 1.353 | 1.034 / 1.290 | 20 / 20 |
| 60 | 1.345 / 1.580 | 1.266 / 1.794 | 19 / 19 |

The eight-squad tail improved substantially; the rare 60-squad tail was worse (1.580 to 1.794 s), although its per-member p95/p99 and typical whole-group response improved. Do not describe every latency percentile as improved. Both 60-squad p95 group figures are the maximum of 19 fully moving groups. One group per run includes members already at their assigned slots and is reported separately. Short/long distributions, raw distances, counts and all groups are retained in final-comparison.json. These runs adapt their commands to live eligible units and goals: 101/120 attempts were sent in the fixed run and 19 were skipped. The prior run sent 116 groups. This is a descriptive workload comparison, not a same-input causal latency estimate; the exact original-command diagnostic above isolates the policy change.

The 1.794-second member was modern-cavalry squad 9050. Its route and first turn occurred two ticks after application, commit after three ticks, and first translation after nine ticks. The watched full replay contains no automatic-travel transition for this sample. Its target heading changes at ticks 36,319, 36,320, 36,321 and 36,322 while the initial approach gives way to the full route. Its launch controller remains at zero speed while pivoting, then translates at tick 36,326. This identifies a separate remaining optimization opportunity in approach/full-route steering handoff; it should not be described as an unavoidable path-search delay or entirely as necessary turning. This pass does not change that handoff policy or turn rates. The pose trace and locomotion headings are preserved in canonical-replay-with-watch-arm.json.

Sea trade completed **9,920 returns**, 11,137 loads and 16,039 arrivals. There were 1074 naval traders initially and 1037 finally. All 551 surviving matched actors changed shipment; 546 also changed endpoint position. Final states: 393 returning, 564 outbound, 37 loading, 43 prize. These counters show continued trade progress; endpoint samples do not provide a per-port dwell distribution. Previously accepted first-use route delays were not changed by this formation pass.

Full Oracle authoritative replay: ticks 36000 to 40969, 3359 actions (248 commands, 1 controller change, 3110 road publications). Every final checkpoint section matched, with zero immediate outcome mismatches. The separate watched ARM replay also matches the same full server checkpoint while collecting diagnostic poses and commit arguments. Neither unpaced replay is used as a game-speed measurement.

Evidence: fixed-candidate-m75-01-analysis.json, fixed-candidate-m75-01-stages.json, final-comparison.json, the raw *-server/*-client directories, canonical-replay.json, replay-inspect.json and canonical-replay-with-watch-arm.json under out/sea-trade/player-movement-6bc32618.

## Validation

The final full suite has **3,466 passes**, one pre-existing failure, two expected failures and seven skips (3,476 tests; 477 files, of which 474 pass, one fails and two are skipped). The only failing test is RussianAssetIntegration.test.ts: machine-gun truck artwork Y=0.5390625 versus its 0.52 calibration bound. It was previously reproduced on the original checkout and no asset code changed in this pass. TypeScript, frontend build, multiplayer build and the isolated probe build pass. Historical cache/spatial golden hashes pass unchanged. Logs: out/sea-trade/fixed-formation-final-full-suite.log, fixed-formation-final-types.log, fixed-formation-frontend.log, fixed-formation-multiplayer.log, fixed-formation-probe.log and fixed-formation-legacy-fixtures.log.

## Deployment status

Only isolated Oracle test containers were used. Production was not promoted or restarted and remains at ea9514b1e40420aca9336dbbf583370301e1e52b. Final health is healthy with no active profiling containers. The primary Private-Matches checkout and the three pre-existing untracked handoff documents were preserved. The temporary task-specific SSH tunnel is closed. Results and stopped diagnostic containers are retained for audit. final-production-health.json records the verification.


## Additional portability observation

An extra Windows replay (same Node 24.18.0 version) completed all 3,359 actions without outcome mismatches but did not pass the strict final hash comparison. Its 15 differing values are locomotion heading/targetHeading floats, including copies inside admission origins, with absolute differences from 5.55e-17 to 4.44e-16 radians. Positions, routes, orders and other checkpoint values match. This failed diagnostic is retained in canonical-replay-with-watch-local.json and platform-difference.json; it is not counted as an exact replay pass. No rounding/quantization change was made to unrelated locomotion code. Both original and watched ARM verification require exact hashes.


## Completed-without-motion proof

| Squad | Commit tick | Current position | Assigned point |
| --- | ---: | --- | --- |
| 8076 | 40158 | (66688, 81280) | (66688, 81280) |
| 10682 | 40158 | (66688, 81280) | (66688, 81280) |
| 6943 | 40159 | (67488, 80960) | (67488, 80960) |
| 8596 | 40160 | (66688, 81280) | (66688, 81280) |


## Evidence links

- [Response distributions](<C:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/out/sea-trade/player-movement-6bc32618/final-comparison.json>)
- [Exact original-command comparison](<C:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/out/sea-trade/player-movement-6bc32618/exact-input-oracle.json>)
- [Original full Oracle replay](<C:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/out/sea-trade/player-movement-6bc32618/canonical-replay.json>)
- [Watched full Oracle replay](<C:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/out/sea-trade/player-movement-6bc32618/canonical-replay-with-watch-arm.json>)
- [Windows numerical differences](<C:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/out/sea-trade/player-movement-6bc32618/platform-difference.json>)
- [Full test suite log](<C:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/out/sea-trade/fixed-formation-final-full-suite.log>)
- [Final production health](<C:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/out/sea-trade/player-movement-6bc32618/final-production-health.json>)
