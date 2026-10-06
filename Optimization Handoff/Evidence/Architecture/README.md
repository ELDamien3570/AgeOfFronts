# Architecture optimization results

All eight planned work areas are implemented. Existing gameplay features,
authoritative commands, routing work order, checkpoint outcomes and recovery
acknowledgements were preserved in the tested scenarios. No deployment or push.

Baseline: clean commit `234d62a74ac32275c1d99cb693bec97110347a05`, which already
contains the previous debloat pass. These gains are additional to that pass.
The execution plan is saved alongside the audit at
`.antigravity/architecture-optimization-plan.md`; a copy is included here.

## Measured changes

Three sequential 400-tick runs per version and scenario, with no concurrent heavy
tests or rendering during simulation timing. Table tails pool all 1200 tick
samples per version; they are not averages of per-run percentiles. Local Windows
x64, Node v24.18.0. Timings include fixture startup/cold-cache effects.

| Measurement | Baseline | Candidate | Reduction |
|---|---:|---:|---:|
| Late-game mean simulation tick | 24.248 ms | 19.298 ms | 20.4% |
| Late-game p95 tick | 33.270 ms | 26.722 ms | 19.7% |
| Late-game p99 tick | 46.630 ms | 39.275 ms | 15.8% |
| 1500-squad marching mean tick | 11.890 ms | 9.432 ms | 20.7% |
| 1500-squad marching p95 tick | 18.663 ms | 16.164 ms | 13.4% |
| Presentation pipeline microbenchmark mean | 16.544 ms | 2.215 ms | 86.6% |
| Compressed snapshot frame bytes | 56,860 | 42,704 | 24.9% |

Late-game fixture: continuation from the same tick-60000 diagnostic checkpoint,
492 squads, 5 ships, 619 buildings and 25 traders initially, 488 squads finally.
The checkpoint input SHA-256 is
`fc910c746e756c2c28ad76ddfd20b0fdc95c4f57313ceef8ec94009dc731c15f`.
Every baseline and candidate run produced identical final snapshot and checkpoint
hashes. The marching fixture also matched both hashes on all six runs.

Mean late-game phase costs fell from 3.686 to 2.455 ms for movement, 2.679 to
1.691 ms for combat, 4.556 to 3.755 ms for capture and 7.222 to 6.478 ms for
routing. These are combined-change measurements, not isolated causal attribution
to individual patches. Some small phases and tails regressed in the synthetic
fixture; see the raw phase tables in `comparison.json`.

Pipeline fixture: 1024x768 map, 1500 stationary squads and 300 buildings. Sixty
paired projection samples alternate execution order after five warm-up pairs.
The measured pipeline includes worker projection, structured-clone/transfer and
main-thread decoding. Full map copies previously cost 2,359,296 bytes per view;
the one-dirty-tile packed view sends 8 map bytes plus packed entities/metadata
(430,808 transferred buffer bytes total). Reset/recovery views still send the
required full sparse baseline. This is not a rendered FPS measurement.

Twenty paired codec samples after five warm-up pairs: encode mean 12.052 to
10.781 ms, decode mean 8.968 to 7.959 ms. Binary framing removes base64 expansion
and conversion while retaining compression, SHA-256 and the existing bounded
packer/unpacker. It does **not** eliminate all metadata traversal or serialization.

## Implementation disposition

1. **Entity writes:** an owned scalar path avoids temporary patches in hot loops;
   generic external updates still isolate containers. Index fact records are
   reused when membership is unchanged. Journals and spatial revisions remain live.
2. **Wall clearance:** conservative swept-body area proof bypasses empty regions;
   occupied regions use early-exit exact contact checks. Collecting queries remain
   for callers needing candidates. Six hundred deterministic differential cases
   cover radii and owner passage; existing corner and fortification tests pass.
3. **Definitions:** player/definition nested caches remove per-read compound key
   serialization. Research, ownership, refit and restore invalidation are tested.
4. **Capture:** a bounded 1024-position cache stores only immutable terrain/component
   footprints. Eligibility, walls, resistance, pressure, event order and timers are
   still evaluated from live authoritative facts. It does not cache live pressure.
5. **Routing:** cached exact navigation/alliance keys and immutable passability
   bytes reduce repeated serialization and map calls. Forest cost invalidation
   remains live. Search order, budgets, fairness and completion timing were retained;
   no hierarchical path replacement was introduced.
6. **Presentation:** packet-owned packed entities and ACK-fenced accumulated tile
   dirt replace complete snapshot cloning. Latest views contain complete entities
   so coalescing cannot lose removals. Canonical updates continue while views are
   held; unchanged road/deposit data is omitted only after presentation ACK.
7. **Network:** negotiated `binary-v1` frames, bounded/versioned headers and owned
   buffer transfers. Legacy clients get a cached text conversion. Durable checkpoint
   output remains the original text format; recovery snapshot baselines use the
   same negotiation, integrity and allocation limits.
8. **UI/rendering:** building occupancy/stacks/ground updates are cached by copied
   exact facts, avoiding decoder alias invalidation. HUD refreshes coalesce once
   per visible frame; selection/input-triggered refresh remains immediate. Simulation
   and canonical application continue independently of that HUD scheduling.

## Validation

- 1318 tests passed across 195 skirmish test files, with two workers.
- TypeScript `--noEmit`, production Vite build and `git diff --check` passed.
  The build still reports the existing large-chunk class of warning.
- Real coordinator WebSockets exercised simultaneous binary/text clients, matching
  publication/hash, application credit and binary replacement recovery baseline.
- Real browser worker exercised binary framing/decode, held presentation, two hidden
  canonical updates, changed-back dirt, removal, older ACK and recovery reset.
  Evidence: `browser-projection.json` and `browser-projection.png`.
- Browser gameplay smoke: Africa 500x500, seed 42, 3 AI opponents, match advanced
  beyond 40 seconds. Select-all/Hold kept selection HUD current; terrain and units
  rendered, with no captured browser errors/warnings. Evidence: `browser-gameplay.json`
  and `browser-gameplay.png`.

## Remaining limits and next priorities

Worst late-game tick remained approximately **123 ms** (baseline 122 ms).
These changes improve mean and p95/p99 but do not prove hitch elimination.
Memory snapshots varied with GC timing; no retained-heap or allocation-rate win is
claimed. The headless marching fixture excludes AI, combat, network and renderer
load. No remote ARM host, long multiplayer soak, active-human maximum-capacity
match or production release qualification was performed.

Routing remains the largest measured late-game phase. A further algorithm change
should be an explicit determinism/version migration, backed by route correctness,
fairness and workload evidence, rather than silently changing path/completion
semantics. Other useful next measurements are allocation profiles around >50 ms
ticks and full multiplayer rendering/network profiling under sustained combat.
The live codec still shares bounded packing primitives with checkpoint transport;
schema-specific metadata encoding remains a possible further optimization.

## Reproduce

Freeze the baseline `src` tree with `git archive` at the commit above and extract
it into `out/architecture-baseline`. Run the commands sequentially, with no heavy
tests or rendered matches running at the same time:

```powershell
node --import tsx tests/skirmish/debloatBenchmark.ts out/architecture-baseline out/architecture-baseline/late-0.json 400
node --import tsx tests/skirmish/debloatBenchmark.ts . out/architecture-baseline/candidate-late-0.json 400
node --import tsx tests/skirmish/debloatBenchmark.ts out/architecture-baseline out/architecture-baseline/mass-0.json 400 mass
node --import tsx tests/skirmish/debloatBenchmark.ts . out/architecture-baseline/candidate-mass-0.json 400 mass
node --import tsx tests/skirmish/architecturePipelineBenchmark.ts out/architecture-baseline/pipeline.json
node node_modules/vitest/vitest.mjs run --config vite.skirmish.config.ts --maxWorkers=2
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build --config vite.skirmish.config.ts
```

Repeat simulation commands for suffixes 1 and 2. The late-game input checkpoint
must be present at `out/overnight-1000/seed42-filtered/checkpoint-60000.v8` and match
the SHA-256 above. The new pipeline harness requires the frozen baseline source.
For the browser worker test, serve Vite locally and open
`/tests/skirmish/browser/P14Projection.html?packed=1`; run and release the held view.
