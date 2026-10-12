# Late-game local pace investigation — 2026-10-12

## Finding

The local simulation cannot sustain 1× on the measured late-game workload. The browser worker spent 81.92 ms per tick on simulation and encoding, before rendering or HUD work. Running the actual 50 ms interval produced 30 game seconds in 51.35 real seconds (0.584×).

This reproduces the class of slowdown observed in the user's Mediterranean, Napoleonic-start match, but is not a capture of that exact live match. The live build has no checkpoint export. Its match was temporarily paused to avoid contention and resumed afterward without a restart.

## Workload and method

- Saved Migration 1000 match, seed 1272661902, restored at tick 36000 (30:00).
- 14 AI, tribes, Stone Age start; earlier soak reached about 550 squads.
- 40 warmup ticks, 600 measured browser ticks, ending at tick 36640.
- Final population: 537 squads. The 400-tick Node replay ended with 536 squads and 273 ships.
- Actual browser worker / postMessage / client decoder; 50 ms scheduling interval.
- Browser: Chrome 155 on Windows, in-app browser, Vite development module loading.
- Renderer and HUD excluded. This is not a full production game acceptance test.
- Original user match paused during measurement. No other benchmark process ran during the first browser run or clean repeat. Unrelated system activity was not controlled.

## Initial browser result

| Work | Mean ms/tick |
| --- | ---: |
| Movement | 32.28 |
| Combat phase | 19.04 |
| Routing phase | 12.38 |
| AI | 4.75 |
| Capture | 2.45 |
| Other simulation | 5.44 |
| All simulation | 76.35 |
| Snapshot encoding | 5.57 |
| Worker total, excluding postMessage cost | 81.92 |
| Client decoding / projection, separate thread | 11.41 |

Worker p95: 109.8 ms; p99: 128.1 ms; maximum: 174.4 ms. 598/600 measured worker ticks exceeded 50 ms. Actual pace: 0.584×. Phase labels are inclusive aggregates: combat also includes expansion work such as trade and spatial views; routing includes formation-state advancement and admissions, not only path search.

## CPU samples

The separate Node replay recorded 400 ticks with 1 ms CPU sampling. Inclusive CPU samples per tick identify:
- Local avoidance: about 28.8 ms, including transport / formation movement clearance at about 22 ms.
- Formation-envelope work: about 8.9 ms across callers.
- Spatial rebuilding: about 7.0 ms across callers.
- Formation-state advancement: about 7.8 ms.
- Domain battle fight: about 9.5 ms.
- Trade step: about 5.9 ms.
- Client decode: about 22.6 ms in Node.
- Repeated detail validation, unpacking and allocation contribute materially to client cost.

These are inclusive samples, overlap one another, and must not be summed. Node timings are not browser timings.

Files: out/late-game-pace-20261012/profile/cpu.cpuprofile, profile/result.json, baseline/result.json and baseline/rows.json.

## Optimization trial and rejection

A trial reused frontage summaries and owner research effects, skipped a discarded mass frontage calculation, and generated formation hulls from exterior slots. An initial singleton-hull error was caught by the contact tests and corrected before measurement.

The 400-tick Node trial reduced simulation mean from 106.57 to 86.06 ms and combined simulation/encoding/clone mean from 122.46 to 98.97 ms. Both runs produced the identical serialized final checkpoint SHA-256:
d4a3abcbe0b735e6c759e73891e41076507b1be10644db62723eecbdfe221db5

However, the browser did not confirm an improvement:
- First candidate overlapped tests/compiler work: 96.42 ms worker mean, 0.498×. Excluded as a clean comparison.
- Repeat without those processes: 85.52 ms worker mean, p95 111.3 ms, p99 124.7 ms, 599/600 above 50 ms; 0.561×.
- Clean repeat client projection: 12.39 ms.

Host variation and cold/warm JIT effects remain possible; the Node result alone does not establish a browser gain. All four gameplay-code trial changes were reverted. Profiling harness changes and the exact-hull regression contract remain.

## Required performance work

To reach 50 ms from the initial browser mean requires about 39% less worker time. Reaching a 40 ms mean for headroom requires about 51% less. This does not justify skipping canonical simulation or moving its clock independently of executed ticks.

Implement in this order, with before/after browser replay evidence:

1. Trace movement clearance by settled translation, column travel, reform and transport transition, including candidate counts and repeated exact checks. Refactor repeated exact prepared geometry and terrain/hostile occupancy checks around those explicit inputs. Preserve column bends, transition sweeps, shoreline legality and cavalry penetration. This is the largest measured cost.
2. Make spatial views track their actual phase consumers and mutation dependencies. Measure rebuild counts and rows processed before implementing incremental updates. Preserve visibility of movement, boarding, casualties and ownership changes at each boundary.
3. Split nested replication details from motion using encoder-owned revision tracking and explicit baseline/reset/removal rules. Parse each received nested payload once while retaining all validation. The current packet path repeatedly parses and validates details.
4. Separate formation/admission cost from path search within the routing label, then optimize the measured cause. Existing planner budgets do not bound every caller's surrounding geometry work.
5. Optimize battle and trade reuse after the above, with invalidation for research completion/inheritance, diplomacy, casualties and structure changes.

A bounded wall-time scheduler may recover from occasional spikes once average work fits the budget; it cannot turn sustained 80 ms ticks into real-time 50 ms ticks.

## Verification and status

- Trial: 97 focused tests passed across six files after the singleton correction.
- After revert: 25 contact/performance-contract tests passed, including the new exact soldier-corner hull contract.
- TypeScript still reports the same three unrelated existing errors: main.ts target tags cavalry/archer; Recruitment.test.ts unknown inside.
- Source comparison verifies the four trial files match the pre-trial copies byte-for-byte.
- No deployment, commit, game restart, or change to speed/canonical timing.
- The 1× late-game acceptance target remains unmet.

