# Match-265 border navigation fix and AI withdrawal profile

Date: 2026-10-14 (ARM run completed 2026-10-15 UTC).
Baseline: published `a0d27b15eb36d2dc6f5848c0e71caa39a8ea0735`.
Candidate: uncommitted working-tree changes, frozen under `out/border-fix-20261014/candidate/src` before packaging. No public deployment or push performed.
ARM input archive SHA256: `BEF8B11403577137CB74D04ECB111E5040090BB314AAE05B51F3E9959C66735C`.

## Behavior

Smoothing, local repair, exact repair, route connectors and committed movement now share territorial entry policy. A permitted endpoint does not authorize crossing another neutral or peace-protected country. Human intentional entry retains automatic invasion; peace-protected entry remains blocked.

A blocked steering leg stops issuing movement/repair intent. Its queued replacement wakes on relevant navigation revision, start-cell change or available planner capacity with existing bounded retry semantics. An actually unreachable AI move finishes its mission instead of restarting the same physical recovery loop. This does not classify admission backpressure as unreachable.

AI squads stranded by lost permission get one persisted 30-simulation-second withdrawal episode. It owns movement through the existing recovery lease and detaches coordinated army membership. Withdrawal may traverse the current host country to exit, but cannot enter another forbidden country or leave and re-enter the host in one shortcut. A second border change does not extend the deadline. There is no automatic war. Human squads do not receive this rule; human takeover clears it immediately.

If withdrawal cannot finish, the squad enters a blocked hold with its recovery lease retained until its position becomes legally accessible. It does not retry indefinitely, teleport, or declare war. This is explicitly a blocked recovery state, not an alternate-goal planner. Three captured squads (5837, 6616, 7867) reached it in both ARM runs. HUD exposes withdrawal countdown and blocked state. Checkpoint and packed/legacy snapshot validation cover the new state.

## Method

Exact approved match-265 capture, tick 22434, Migration 1000x500, initially 588 squads, 94 ships, 812 buildings and 693 traders. Two 700-tick pairs per machine, construction order reversed between pairs and execution order alternated each tick. Each implementation receives a private cloned checkpoint/map. No future human commands, sockets, encoder, renderer or wall-time tick scheduling. Includes restore warm-up and the entire 600-tick grace period. Gameplay intentionally diverges between baseline and candidate.

Local Windows measurements and the actual 2-logical-CPU Oracle ARM host were tested separately. ARM used the existing deployed image with read-only frozen source/input mounts, no network, no public ports, two CPUs and an 8 GiB memory cap. The public app was stopped with user authorization; the bounded runner restored its original image on exit.

## Results

| Metric | Baseline | Candidate |
|---|---:|---:|
| ARM pair 1 mean tick | 96.84 ms | 76.79 ms |
| ARM pair 2 mean tick | 89.38 ms | 70.20 ms |
| ARM mean across pairs | 93.11 ms | 73.49 ms |
| ARM p95, pairs 1 / 2 | 117.48 / 102.68 ms | 93.08 / 80.41 ms |
| ARM p99, pairs 1 / 2 | 166.83 / 111.24 ms | 130.31 / 87.44 ms |
| ARM movement phase, paired mean | 38.51 ms | 19.22 ms |
| ARM routing phase, paired mean | 18.50 ms | 18.19 ms |
| ARM combat phase, paired mean | 14.17 ms | 13.10 ms |
| ARM AI phase, paired mean | 11.04 ms | 11.13 ms |
| ARM restricted squad-ticks, each run | 6620 | 1222 |
| Local paired mean tick | 65.74 ms | 53.04 ms |
| Local restricted squad-ticks, each run | 5849 | 1194 |

ARM tick time fell 21.07%, movement cost 50.10%, restricted squad-ticks 81.54%. Local tick time fell 19.31%.

At the existing 50 ms simulated step, `50 / mean tick cost` gives simulation-only capacity about 0.537x -> 0.680x on ARM. This is not a live multiplayer pace measurement and does not certify 0.85x. Reaching 0.85x requires at most 58.82 ms average before pipeline overhead: at least another 14.67 ms, or about 20% of candidate cost. Routing, remaining movement and combat still dominate. No 10 Hz change was made.

Separate 300-tick instrumented local audit: repair attempts 3834 -> 735; accepted repairs 3087 -> 525. All 530 segments in candidate accepted repairs passed the authoritative entry certificate, including legitimate grace traversal; zero illegal segments. The earlier strict baseline 120-tick audit found 896 of 1243 accepted detours from legal starting positions entered forbidden land. Different audit lengths are not presented as an equal-duration illegal-count comparison.

## Repeatability and checks

Within each implementation and host, both final deserialized checkpoints are deeply equal and snapshot hashes match. Candidate raw checkpoint hashes also match within each host. Baseline raw V8 serialization hashes differ despite deep state equality; raw serialized bytes alone are not canonical equality evidence. ARM and Windows are not claimed to produce identical cross-host checkpoints.

- Full suite: 350 files, 2413 tests passed.
- Final focused checks after safety refinements: 4 files, 36 tests passed, including 12 new navigation/withdrawal tests.
- TypeScript passed; final production skirmish build passed; git diff whitespace check passed.
- User-authorized production stop completed; original `ageoffronts:a0d27b15eb36d2dc6f5848c0e71caa39a8ea0735` restored, healthy, restart count zero.
- Public HTTPS `/healthz`: admission open, zero active matches, no stalled matches.
- SQLite pre-test backup: `/opt/ageoffronts/backups/multiplayer-borderfix-20261015T002140Z.sqlite`, integrity `ok`. Live database integrity after restart: `ok`.

Raw evidence: `out/border-fix-20261014/paired-700.json`, `arm-results/paired-700.json`, final checkpoint files, `leg-audit.json`, test/build logs. Inputs remain under `out/border-live-a0d27b15/border-match265`.
