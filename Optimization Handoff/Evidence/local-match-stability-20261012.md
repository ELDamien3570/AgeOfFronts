# Local clock/order freeze investigation — 2026-10-12

## Reproduced failure

The user reported a responsive UI with a stopped game clock and orders that never appear, including an Opera match stopping around 25 simulated minutes at 4× speed.

The Codex browser reproduced snapshot rejection on Migration 1000, 14 AI, tribes enabled, Stone Age, seed 1272661902. The earliest captured error was `Invalid formation frontage band`. Later packets also failed with `Barrier state has no geometry baseline`: the encoder advanced its journals after emitting a packet the client rejected, so missing wall additions left later state-only updates without their geometry.

After adding diagnostic context and bounded recovery, the built-in development test exposed the exact malformed state at tick 5857 (4:52):

```
Invalid formation frontage band: stoneage-infantry, mass, 11 troops,
width 238, expected 240
```

Both the rejected delta and the recovery baseline contained that state. Recovery correctly surfaced the underlying canonical failure instead of retrying indefinitely. This is a reproduced cause of the reported symptoms; logs from the original Opera match were not available, so its precise exception is unconfirmed.

## Corrections

- `FormationProfiles.frontageLayout`: a ceiling that truncates an otherwise quantized band must not create an unquantized exception. Such a result changed width when projected again without the ceiling. The solver now tries another legal band and preserves the no-growth ceiling. Genuine sub-quantum authored intervals remain supported. Validation remains strict.
- `Battle`: when mounted impact retains the wedge charge body, recompute the current frontage for that shape. A mass frontage carried into a wedge produced a separate, deterministically reproduced validation failure. Remembered deployed-shape frontage remains intact.
- `LocalSnapshotStream`: a rejected delta invalidates continuity. Request one complete baseline and ignore queued deltas until it arrives. An invalid initial/recovery baseline is fatal; never silently continue from a stale journal.
- Local worker: `resync` replaces the encoder and publishes a full reset at the current tick. Match state, speed, and pause state are preserved. Worker failures log their stack and include the simulation tick in the displayed error.
- Local client: bound baseline recovery to five seconds, display decode/presentation failures, and ignore queued messages after terminal failure.

## Verification

Focused regressions cover the exact 238-unit casualty/reform sequence, snapshot decode and checkpoint restore, ceiling projection idempotence across all authored soldier profiles at counts 1–144, mounted impact, lost wall geometry, invalid baseline rejection, preserved pause/speed, and successful player orders after worker resynchronization.

151 focused tests passed across frontage, cavalry, manpower, formation travel/repair, transport, replication, local worker recovery, and prior performance contracts. Production build passed. TypeScript checking still reports three pre-existing errors from concurrent recruitment/structure-target work: invalid `cavalry`/`archer` target tags in `client/main.ts` and undefined `inside` in `Recruitment.test.ts`. Those unrelated edits were preserved.

## Runtime evidence

`scripts/soakLocalStability.ts` runs the real simulation, encoder, structured-clone/transfer boundary, and a separate client decoder. It stores checkpoints, phase timings, packet counts, memory, and failure state under `out/local-stability-20261012`.

The corrected runs validate every tick rather than only each four-tick publication. They are continuations from independently generated checkpoints, not recordings of the original Opera match. Timing from simultaneous soak processes is not a performance benchmark.

Corrected continuation results:

| Seed | Restored tick | Final tick | Final game time | Validated packets | Final squads / ships | Result |
| --- | ---: | ---: | --- | ---: | --- | --- |
| 504565698 | 25000 | 42000 | 35:00 | 17001 | 429 / 254 | Passed; no simulation or snapshot failures |
| 1272661902 | 11000 | 36000 | 30:00 | 25001 | 532 / 270 | Passed; no simulation or snapshot failures |

Both continuations completed with exit code 0 and no winner declared. They validated **42,002 packets** in total; the second run reached **550 squads** at its sampled peak. The completed 35-minute checkpoint also restored successfully with the current code and emitted a valid full baseline (`out/local-stability-20261012/final-restore/result.json`). Detailed results are in `out/local-stability-20261012/fixed-continuation/result.json` and `fixed-browser-seed/result.json`.

The final browser run uses the production build at `http://127.0.0.1:9001/skirmish/index.html?seed=1272661902`, with Migration 1000, 14 AI, tribes, Stone Age, 1× technology and 4× game speed. It reached **27:35** with no browser errors and was deliberately paused there after verification. This crosses both the reproduced 4:52 frontage failure and the user's reported 25-minute failure window. A Stone Age Stables research command sent at 5:37 completed; a Stone Age Ranged research command sent at 26:03 also completed, enabling the Archery range command by 27:24. The recovery integration test separately verifies a squad hold/facing order round trip after resynchronization.

## Scope

No match restart, validation bypass, dropped simulation work, deployment, or unrelated recruitment/structure-target changes were introduced. This establishes correction of two concrete malformed-formation paths and recovery from a lost delta; it does not guarantee every possible future match failure or the 50 ms performance target.
