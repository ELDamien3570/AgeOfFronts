# 8 Hz ARM qualification — 2026-10-14

The final candidate sustained **0.9965x** over 300.31 seconds on the existing two-CPU Oracle ARM host. The slowest measured 30-second window was **0.9708x**. This exceeds the requested 0.85x threshold in this controlled workload.

This is a qualification of the fixed 125 ms simulation step and the multiplayer pipeline. It is not a browser frame-rate measurement or a guarantee for every possible battle concentration.

## Implemented clock contract

- One authoritative simulation clock: 8 ticks per second, 125 ms per step. There is no separate 20 Hz player-action simulation.
- Movement, ships, aircraft, projectiles, damage rates, reloads, construction, recruitment, production, research, diplomatic durations and AI schedules now use the new clock. Tick deadlines round upward to the next 125 ms boundary; rates and visual clocks use fractional timing where applicable.
- Per-soldier weapon cadence retains its rational remainder. Multiple due weapon events can resolve inside one step; idle time cannot accumulate a catch-up burst. The combat acquisition query is shared across those events.
- Corrected an AI progression phase-alignment bug caused by nested schedules. Every faction can reach its progression decision slot.
- Main navigation admission/search budgets retain their intended work rate per simulation second. Small generic planner budgets retain a minimum preparation quantum. Path-cost normalization is independent of the movement distance per step, preserving the route heuristic scale.
- AI economic delay/production valuations use physical-time horizons. The change does not make research or construction appear artificially cheaper merely because their tick counts are smaller.
- Background snapshots retain a separate 200 ms wall/simulation cadence. Executed orders still trigger immediate publication. Presentation, animation and player-facing seconds use the shared clock conversion.
- No old-save migration layer was added. Deployment requires matching client/server builds and fresh 8 Hz match state; open clients must refresh for the new build.

## Workload and measurement

Migration 1000 x 1000, seed 1272661902, 10 regular AI factions, 25 tribes, three human seats, Napoleonic starting age and ceiling. All normal AI policies, formation locomotion, raid diplomacy and shared army corridors were enabled.

The controlled checkpoint was built from natural growth, legal placement to approximately 700 squads / 300 warships, then a further five minutes of simulated growth. At checkpoint tick 3600 it contained nine declared wars. This is population stress based on the requested settings, not an export of the latest public human match. Unit placement and human orders do not reproduce a particular concentrated battle.

Three actual network clients connected through the coordinator, reserved simulation worker and asynchronous encoding pipeline. Each client decoded/applied state, acknowledged it and issued one-unit movement orders every five seconds. Camera rendering was not exercised. Network latency includes the SSH tunnel and local client processing; no fixed artificial WAN delay was added.

After a 15-second warm-up, the final candidate ran for five measured minutes on the ARM server, with a two-CPU / 8 GiB container limit. Pace is delta ticks * 125 ms / elapsed wall time. Thirty-second windows were sampled every ten seconds (28 complete windows).

| Metric | Final candidate |
|---|---:|
| Measured steps | 2394 |
| Overall speed | 0.9965x |
| Slowest 30-second window | 0.9708x |
| Initial squads / warships / traders | 759 / 303 / 527 |
| Final squads / warships / traders | 1104 / 308 / 633 |
| Final buildings | 428 |
| Lifetime mean tick, including warm-up | 95.98 ms |
| Lifetime worst tick, including warm-up | 354.67 ms |
| Final rolling 256 ticks: mean / p95 / p99 | 104.37 / 125.15 / 254.66 ms |
| Executed test orders | 177 |
| Order execution receipt: mean / p95 / p99 | 225.36 / 337.83 / 351.61 ms |
| Worst order execution receipt | 400.13 ms |
| Client errors / resyncs | 0 / 0 |
| State delivery rate per client | approximately 4.95 Hz |

Earlier five-minute candidates sustained 0.9994x, 0.9993x and 0.9990x. Those runs contain intermediate source changes and are not paired measurements of one optimization. The final result above is the qualification result.

## Validation and limits

2,419 tests verified: the final full sweep with two Vitest workers passed 2,418 of 2,419. Its single remaining failure was an old nuclear-casualty test fixture with a literal 200-tick formation transition. The fixture now uses ten simulation seconds, and the complete affected file passed its focused rerun. Authoritative source was unchanged after the full sweep. TypeScript, the skirmish production build and git diff whitespace validation passed. The full test command used a 30-second default timeout; existing explicitly timed map tests retain their own limits. Earlier concurrent runs exposed map-generation timeouts; serial map reruns and the corresponding tests in the reduced-concurrency sweep passed. The network test now advances its injected clock while awaiting later state rather than freezing a publication deadline.

Two independently restored dense checkpoints continued for 80 final-source steps. Complete authoritative checkpoints were identical at each of ten one-second boundaries. This proves deterministic continuation for this 8 Hz state; it does not claim identical combat outcomes between 20 Hz and 8 Hz.

The target is met here, but the 125 ms budget is still exceeded by some individual ticks. The final p99 is about 255 ms and order receipts can take about 400 ms. Sustained pace is not a hard tick-latency guarantee, an hour-long soak or rendered multiplayer acceptance. AI and combat hotspots remain worth improving.

Production was never stopped, restarted or upgraded for these tests. Profiling used a separate localhost-only process on the existing ARM host, refused to start while a public match was active, and automatically stopped if a public match began. The profiler and local tunnel were stopped after qualification. No paid instance or new billable resource was provisioned. The production image remained a0d27b15eb36d2dc6f5848c0e71caa39a8ea0735 and its final health was healthy, with zero active matches.

## Evidence identity and reproduction

Branch: 1.5.7-10hz-prototype. Base commit: e372a87e878298c9b81babf392244d02a208efc8. The 8 Hz implementation is local and has not been committed, pushed or deployed.

Final tested source archive SHA-256: B147258CA236112C88E708F56E6B11A52AB988F2C84302AE7216C2BD8A78B4A8.

Dense checkpoint SHA-256: DED0509A8C80F59CCC2107742CFC98928150FAAD3EC33BE6276BEC9688BADAE4.

Raw local artifacts are retained in out/8hz-20261014: arm-8hz-release-candidate.json, its summary JSON, dense-scenario.v8, arm-source.tar.gz, final-suite.json, final-nuclear.json, validation-summary.json, continuation.json, type/build logs, and the diagnostic harness under pipeline. These generated artifacts are ignored by Git; preserve that directory to repeat this exact workload. The isolated server copy is retained under /home/ubuntu/aof-8hz-20261014.

Validation commands:

~~~powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build --config vite.skirmish.config.ts
node node_modules/vitest/vitest.mjs run --config vite.skirmish.config.ts --maxWorkers 2 --testTimeout 30000
node node_modules/tsx/dist/cli.mjs out/8hz-20261014/verify-continuation.ts
~~~
