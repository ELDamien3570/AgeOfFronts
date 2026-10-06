# Order responsiveness: admission and publication

This change removes a planner phase delay and the wait for the next background snapshot after a human command commits. Gameplay movement remains authoritative. Planning remains bounded; no client movement prediction was added.

## Hosted comparison

Fresh 120-second runs produced 138 periodic motion samples each. The earlier reported 333 ms p95 was from a different run; the fresh baseline for this change measured 374 ms. Raw stage measurements and runtime identities are in `comparison.json`.

| Measurement | Before | After |
| --- | ---: | ---: |
| First observed motion, median | 274 ms | 190 ms |
| First observed motion, p95 | 374 ms | 258 ms |
| First observed motion, maximum | 401 ms | 270 ms |
| First receipt, p95 | 67 ms | 65 ms |
| Execution receipt, median | 196 ms | 166 ms |
| Execution receipt, p95 | 245 ms | 244 ms |
| Planning ticks, median | 4 | 3 |
| Planning ticks, p95 | 4 | 4 |
| Execution receipt to observed motion, p95 | 166 ms | 32 ms |
| Total snapshot frames across six clients | 3,899 | 4,025 |
| Total snapshot bytes across six clients | 51,852,104 | 52,967,489 |

Observed end-to-end p95 improved by 31.0%; total snapshot bytes increased by 2.15% and frames by 3.23%. These traffic totals include setup and reconnect, and the two runs have slightly different durations and random seeds. They describe this workload, not a fixed overhead guarantee.

Both runs passed state agreement and reconnect checks (65 and 67 common-state samples). The final sampled simulated/wall progress ratios were 0.9989 and 0.9988. Mean lifetime tick duration at those samples was 10.14 ms before and 9.59 ms after; the short workload provides no evidence of a tick-cost regression, but different seeds preclude claiming a causal CPU improvement. Sampled socket buffered bytes were zero, and the publication skipped counter was zero at the final diagnostic sample.

The full test suite passed: 1,327 tests in 195 files with two workers. TypeScript passed. An initial unrestricted-parallel suite run hit 14 timeouts and two pending-state fixture assertions; the corrected fixtures and bounded-concurrency run passed without increasing test timeouts.

A separate 60-second recovery soak passed with all six clients, five binary and one legacy text. It held the legacy client's credits for two seconds, explicitly resynchronized a binary client, and reconnected a client. All clients finished at tick 1377, with 35 common-state agreement samples and no failures. The held legacy client received a recovery baseline; the explicitly resynchronized/reconnected binary client received two. See `recovery.json`. This exercises application credit starvation rather than WAN packet loss or kernel socket saturation.

Publication waiting is substantially reduced. Remaining tail latency is in admission/planning: the execution receipt p95 is still 244 ms and planning p95 remains four ticks. Large formations and difficult routes need a separate admission workload before further changes; increasing global planner budgets would risk simulation stability.

## Changes

- `Simulation.drainRouteBatch` prepares interactive movement before the exact planner runs, then uses the remainder of the existing 128-unit allowance to consume completed routes. The exact planner still runs once per tick and background work allowances are unchanged.
- `serverMatchWorker` offers a publication when a command reaches `executed`, even when the 200 ms background snapshot deadline has not arrived. Offers still use the existing bounded, ordered publication queue. Deferred and rejected outcomes do not trigger this extra publication. Multiple executed outcomes in one advance produce one offer.
- The hosted smoke diagnostic now records send, first receipt, execution receipt and first observed displacement separately. `scripts/traceOrderAdmission.mjs` reproduces the admission phases with six simultaneous human formations on a fixed seed.

## Fixed-seed admission evidence

On Old World size 1000, seed 42, six humans, ten regular AI and 25 tribes, six simultaneous three-squad moves previously began on tick 4. They now begin on tick 3. AI stepping is disabled for this diagnostic to isolate admission; the hosted comparison enables all normal AI policies.

The regression tests check real displacement within three ticks, the shared interactive allowance, and one exact-planner pass per tick. The worker regression checks that committed movement produces a coherent publication with `publish:false`, and a quiet advance produces no extra publication. Pending-state recovery is tested before the first tick, since a simple move can now finish admission in that tick.

## Reproduction

Run before and after from their respective source revisions, with no concurrent CPU-heavy tests:

```powershell
node scripts/runHostedStabilitySoak.mjs --seconds 120 --clients 6 --binary-clients 5 --order-interval 5 --out out/responsiveness/baseline
node scripts/runHostedStabilitySoak.mjs --seconds 120 --clients 6 --binary-clients 5 --order-interval 5 --out out/responsiveness/after
node scripts/summarizeHostedDiagnostics.mjs out/responsiveness/baseline
node scripts/summarizeHostedDiagnostics.mjs out/responsiveness/after
node scripts/runHostedStabilitySoak.mjs --seconds 60 --clients 6 --binary-clients 5 --order-interval 5 --exercise-backpressure --out out/responsiveness/recovery
node --import tsx scripts/traceOrderAdmission.mjs
node node_modules/vitest/vitest.mjs run --config vite.skirmish.config.ts --maxWorkers 2
node node_modules/typescript/bin/tsc --noEmit
```

Each hosted run uses an isolated localhost coordinator/database, Old World size 1000, six humans, ten regular AI, 25 tribes, all five AI policy flags, five binary clients and one legacy text client. It checks common-state agreement, execution/rejection and reconnect. The coordinator picks a fresh random match seed in each hosted run; these are comparable workload observations, not an identical-seed performance experiment. The separate phase trace supplies fixed-seed evidence for the scheduling change.

Detailed raw local outputs remain under `out/responsiveness/{baseline,after,recovery}`. The fixed-seed before/after phases are preserved in `admission-phases.json`; the passing suite output is in `tests.log`. The current diagnostic scripts reproduce new results but cannot recreate the old behavior without restoring the old source.

## Measurement limits

First motion means displacement greater than eight fixed-point units received and decoded in authoritative snapshots. The headless clients share one process; this includes local decoding and event-loop contention, but excludes browser rendering and WAN latency. Receipt-to-observation measures client receipt times, not server execution-to-wire timing. It can be negative when asynchronous state decoding completes before the receipt handler runs. Quantiles of individual stages do not add up to the end-to-end quantile.

Extra command publications can increase snapshot traffic. The queue and client credit/recovery limits remain in effect. This short hosted workload does not qualify large armies, sustained command floods, late-game mass-entity performance or WAN behavior. Normal snapshots remain at 5 Hz; background movement between command publications retains that cadence.
