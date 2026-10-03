# V1.1 movement benchmark reproduction

Use the project-local executables because the global npm shim may be broken on this Windows machine.

## Deterministic fixtures

```powershell
node --import tsx scripts/profileV11Movement.mjs --out out/v11/movement.json
node --import tsx scripts/profileV11Retargeting.mjs --out out/v11/retargeting.json
```

The movement runner covers open land, held friendly/enemy one-tile gaps, 20/100-squad river crossings and a 50-squad four-tile island landing. It records first motion, cumulative admission, peak/total boats, arrival, survivors, breach detection and phase timings. Held enemies are prevented from attacking so collision blocking is exercised independently of winning combat.

The attack runner removes the ordered target from 100 attackers and compares attack continuation with explicit Hold. Diagnostic scans are not checkpoint authority.

## Saved late-game world

Supply a V8 checkpoint created by `profileSkirmishStability.mjs` on Valles Kairulia, size 500. The retained checkpoint is in the ignored local evidence directory; it is not distributed in Git.

```powershell
node --import tsx scripts/profileV11LateLatency.mjs --restore PATH_TO_CHECKPOINT.v8 --out out/v11/late-land.json
node --import tsx scripts/profileV11LateLatency.mjs --restore PATH_TO_CHECKPOINT.v8 --follow-through --out out/v11/late-land-full.json
node --import tsx scripts/profileV11LateLatency.mjs --restore PATH_TO_CHECKPOINT.v8 --transport --follow-through --out out/v11/late-sea-full.json
node --trace-gc-nvp --import tsx scripts/profileSkirmishStability.mjs --restore PATH_TO_CHECKPOINT.v8 --map valles-kairulia --size 500 --all-ai --ticks 50400 --profile-at 48000 --out out/v11/replay > out/v11/replay-trace.log
```

The latency runner restores the world for each of four orders, takes over the strongest surviving regular AI faction through the domain control method, and adds 100 squads at valid terrain positions. Other factions retain their AI. This intentionally stresses a large command under existing late-game load. It is a synthetic fixture, not a recording of four real player clicks.

`--follow-through` checks the whole parent receipt, up to 1,200 ticks. Without it the run stops at first motion, up to 240 ticks. First-motion wall time is CPU elapsed time after submitting the command; game time is ticks divided by 20. Include both, and retain the admission count and final receipt.

Run CPU comparisons sequentially, without concurrent local suites or builds. Inspect raw populations and timing windows as well as totals; gameplay changes can diverge from the same checkpoint. CPU profile inclusive percentages overlap and must not be summed.

To compare stable source without switching a dirty branch, extract its `src` into an ignored directory with `git archive`, copy these scripts into that directory's `scripts`, and copy `package.json` and `tsconfig.json`. Dependencies can resolve from the parent checkout. Use the same checkpoint and fixture script on each variant.

## Oracle ARM

`scripts/profileV11Oracle.sh VARIANT LABEL CORES MODE` expects an explicitly prepared `/home/ubuntu/perf-v11` directory. `VARIANT` is `stable` or `current`; `MODE` is `replay`, `latency`, `transport`, `movement` or `retarget`. Stable uses the deployed image's source; current mounts `current/src`. Both use `current/scripts` so instrumentation is identical.

Required layout:

- `input/checkpoint-final.v8`
- `current/src` and `current/scripts`
- writable `results` for UID 1001

The runner checks idle health, uses a separate container with no network, a read-only root, temporary `/tmp`, two GiB memory and an explicit CPU limit, and stops when a live match appears. It never publishes the mounted source or changes the production image. Labels must be unique so a failed run cannot be mistaken for earlier output. Keep an archive/file-hash manifest of the mounted candidate.

For capacity, run two separate `replay` containers concurrently with one CPU each only while production is idle. This measures simulation contention; encoding, rendered clients and real network traffic need their own qualification. Never infer three-match safety from one isolated replay.

## Checks

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --config vite.skirmish.config.ts --maxWorkers 2 --testTimeout 20000
node node_modules/vite/bin/vite.js build --config vite.skirmish.config.ts --logLevel error
```

The measurements and rejected experiments are documented in `Optimization Handoff/2026-10-03-v1.1-movement-performance.md`.
