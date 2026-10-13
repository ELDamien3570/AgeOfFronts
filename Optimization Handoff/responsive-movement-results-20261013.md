# Responsive movement implementation and validation

## Gameplay changes

Natural mountains remain visible and keep their existing movement speed, but
no longer exclude land or amphibious routes. The carrier determines water
legality; formation edges may overlap natural terrain. Walls and map bounds
retain physical checks. Formation planning no longer builds or rechecks
reservations for other squads' present or queued positions. Drawn deployments
can target enemy formations. Ordinary Move changes to Attack at close hostile
contact ahead, abandons the interrupted destination, and preserves explicit
Shift orders. Orders away from contact and cavalry withdrawal are respected.
Defended-shore landings reserve carrier space instead of a complete empty
infantry footprint. Older tactical feature checkpoints are verified with their
original mountain connectivity and passages before migration.

The earlier experimental AI cadence and two-second planning policies remain
off by default. This gameplay change does not reduce the physical tick rate.

## Paired dense replay

Pre-change source: `out/responsive-movement-20261013/control/src`.
Input: `out/local-stability-20261012/fixed-browser-seed/final.v8`, Migration 1000,
seed 1272661902, 532 squads and 270 ships at tick 36000 (30 minutes).
200 warmup ticks and 400 measured ticks, alternating control/candidate order.
Simulation, encoding and structured-clone transfer are timed as worker cost;
decode is timed separately. No other match, compiler or correctness suite ran.

| Worker measurement | Before | After |
| --- | ---: | ---: |
| Mean | 62.84 ms | 59.83 ms |
| p95 | 84.63 ms | 82.64 ms |
| p99 | 96.43 ms | 91.39 ms |
| Maximum | 428.16 ms | 351.69 ms |
| Ticks exceeding 50 ms | 302 / 400 | 235 / 400 |

The measured saving is 3.01 ms (4.8 percent). It does not establish sustained
20 Hz or a 20 ms improvement. Delivered trade gold during the measured window
was 99,366 before and 98,626 after; the change intentionally alters gameplay
outcomes, so matching checkpoint hashes is not an acceptance criterion.
Raw results: `out/responsive-movement-20261013/paired/result.json`.

## Validation and remaining limits

Focused regressions cover mountains, shore legality, enemy-occupied drawn
lines, move-to-combat transitions, queued orders, restore, defended landings,
walls and cavalry withdrawal. The final broad run passed 2,233 of 2,234 tests;
its only failure was an obsolete assertion that admission remained pending for
three ticks. The corrected file passed all 17 tests in an isolated rerun.
Both map suites passed their 58 tests. Aggregate result: 2,292 tests across
333 files passed, with the corrected admission file counted once. Current
TypeScript, production build and diff whitespace checks passed.

The saved match advanced from tick 36000 to 48000 without an exception or
stopped clock, ending with 634 squads and 305 ships. All 601 sampled snapshot
publications decoded successfully. This continuation published once per game
second and shared CPU with correctness tests; its timing is not a pace
benchmark. Artifact: `out/responsive-movement-20261013/40-minute.v8`.

A separate headless command check at tick 48000 admitted a movement order in
one game tick, and the unit began moving after nine ticks (0.45 game seconds).
This uses correlated application receipts, including the army owner, and
counts movement only after the command executes. It excludes browser input
and presentation delay. Artifact: `out/responsive-movement-20261013/order-check.json`.

The uncontended production-browser continuation began at 40 minutes, at the
1x speed setting. It advanced 179.35 game seconds in 196.21 wall seconds:
0.914x overall. The initial cold window averaged 66.62 ms per worker advance
and 0.759x pace. The final rolling 512-tick window averaged 46.10 ms, p95
63.50 ms, p99 71.20 ms and maximum 202.80 ms, with 662 squads and 322 ships.
Frame intervals averaged 10.16 ms. No acknowledgements remained pending.
Artifact: `out/responsive-movement-20261013/browser-result.json`.

The update improves gameplay responsiveness and removes natural-terrain
fitting failures, but does not qualify sustained 1x late-game pace. A 30-minute
wall-time soak and Opera repeat remain unqualified. The new replay is paused
at `http://127.0.0.1:9005/skirmish/index.html?diagnostics&replay=/out/40-minute.json&build=responsive-movement`.
No commit, push or deployment has been performed.
