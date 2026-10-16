# Next batch: gates, measurements and open owner decisions

The verified record of the roadmap "Next" batch (items 1-10) after its
integration and the follow-up fixes. Numbers marked "contended" were taken
while other agents shared the 8-core desktop: their wall times are inflated
(wall/CPU above 1.5), but tick-count metrics (planner pending, admissions,
latency in ticks) and digests do not depend on the host. Commands are run
from the repository root.

## Next #1: routing under 8 active humans

### What changed in the follow-up

- D2, one planner job per cohort (`COHORT_CONNECTORS`, `MovementAdmission.ts`):
  spine members plan entry and exit connectors, and members whose whole move
  is within 32 tiles plan it, by a bounded synchronous exact search
  (1,024 expansions per search, 4,096 per tick). Only the cohort lead files a
  planner job; a failed search falls back to planner jobs.
- Shift legs: members route while their queued intents resolve (the intents
  gate only the commit), and the interactive pass serves human intents.
- Move continuations back off 2/4/8/16 ticks after a planner refusal.
- Planner scheduling v6 (`PLANNER_PARTITION`, `RoutePlanner.ts`): reclaiming
  jobs no longer hold a seat's share (rec 5); 4 of each seat's 16 slots are
  kept for movement admission; background corridors and background exact
  searches have separate active limits.
- Mixed army moves: the client splits them (one move per whole army plus one
  for loose squads), so D4's server rejection no longer reaches players who
  select an army and a few loose squads.

### Load harness results (contended desktop, ticks 1,200-2,800)

`EightHumanLoad` with `PROFILE=1`; "before" is the batch head eadf217f,
"after" this follow-up. Executed-move latency is submit to executed receipt.

| Metric | Med before | Med after | Mig before | Mig after | Gate |
| --- | --- | --- | --- | --- | --- |
| Planner window-mean max | 110 | 85 | 127.6 | 124 | < 100 |
| Admissions window-mean max | 184 | 78 | 706 | 272 | < 150 |
| Executed moves (count) | 38 | 225 | 21 | 200 | |
| Executed-move p95 (ticks) | 56 | 22-23 | 32 | 32 | < 16 |
| All-outcome move p95 (ticks) | 86 | 25-34 | 94 | 43 | |
| Moves that never moved | 107 | 0 | 200 | 3 | |
| Human planner refusals per tick | 12-22 | 4-9 | 20-42 | 7-15 | |

Not met, with the evidence:

- Planner pending on Mig 500 stays at about 120. Its occupancy is committed
  sea trade (85-95 jobs, the oldest 1,600 ticks old), not human or AI
  movement, and the idle-seat control shows the same backlog (Mig idle at the
  batch head: 120 pending and 687 admissions with no human commands).
  Committed trade is protected planner work by design (it carries loaded
  cargo), so capping it is an economy decision; a trade cap was tried and
  had no effect because those jobs are committed. Open: trade water-route
  throughput (the crossing-tree preparation allowance for background
  corridors) needs its own investigation.
- Executed-move p95 is 22 ticks on Med against 16. Human admissions still
  spend most of their time waiting for Shift intents and on planner jobs for
  moves longer than 32 tiles (`humanAdmissionTicksByPhase` in the harness
  output).
- "Tick mean <= 1.15x the idle-seat control" cannot be reached by routing
  alone: at the batch head the extra cost of active humans was movement
  (+10 ms Med, +27 ms Mig) and combat (+11 / +17 ms) more than routing
  (+8 / +6 ms), because armies that move and fight cost more than idle ones.
  The control measures idle armies. The criterion needs an owner decision
  (compare routing phases only, or an idle control whose armies also move).
- Wall/CPU <= 1.5, the quiet-host run and the Oracle A1 run (R2-P31) were not
  possible here (shared host, no ARM host). The gate test now asserts
  wall/CPU <= 1.5 itself, so a contended run cannot pass or fail it.

### R2-P2 cold trees

Mixed selections are rejected (D4) and the client splits them, and army
orders with deferred planning go through the planner. The synthetic B5 probe
(first long amphibious `find` on Mig 1000: 527 ms) has no live caller found
so far; `HPA_PROBE=1` on the load harness lists every synchronous
`HierarchicalPaths.find` slower than 20 ms with its callers. A cold-tree cap
inside `find` was not added: falling back to exact search when a per-call
cap is hit makes a route depend on cache warmth, and a restored or rolled
back world starts cold, so the same tick could route differently after a
restore. Exact search on the same Mig 1000 crossing costs 19-51 ms.

### Commands

    # Gate (quiet host only; about 10 minutes per run, four runs)
    SKIRMISH_EIGHT_HUMAN=1 npx vitest run --config vite.skirmish.config.ts tests/skirmish/perf/EightHumanLoad.perf.test.ts
    # A/B of the measured window without the warm-up
    SAVE_CKPT=med-warm.bin node --import tsx tests/skirmish/perf/EightHumanLoad.ts med humans 1272661902 1200 1600
    PROFILE=1 CKPT=med-warm.bin node --import tsx tests/skirmish/perf/EightHumanLoad.ts med humans 1272661902 1200 1600 _b
    # Oracle A1 (R2-P31): the same gate command on the A1 host, with the
    # thread CPU (tickCpuMeanAll) recorded next to tickAll.

## Next #2: idle tick

- I-0: worker diagnostics time commands, the rollback checkpoint and the
  tick steps apart ("commands", "checkpoint", "simulate"); the wall/CPU
  window covers the tick steps only. Live heap after GC is exported when the
  coordinator runs with `SKIRMISH_LIVE_HEAP=1` (each worker exposes gc to
  itself; every 30 s sample forces a full collection, so it stays opt-in).
- I-1 (bound tribe marching: K concurrent marchers per tribe, or border
  growth without walking) is not implemented and waits for the owner's choice
  of K (4-8) or border growth (notes 22, 00-summary I-1). Next #9's tribe cap
  and campaign gate already cut tribe movers from 282 to 2 after tick 2,400 on
  the Mig 500 gate fixture, so the idle gate passes without it.
- The A1 repeat of the idle gate was not run (no ARM host):
  `CKPT=<ckpt> npm run perf:idle-tick -- mig idle 4800 60 _gate`.

## Next #3: playtest probe

Seats alive (of 8) with this follow-up's code (OD-10's 3 tribe squads, OD-6,
the routing changes):

| Configuration | 424242 | 9001 | 31337 | Gate |
| --- | --- | --- | --- | --- |
| Shipped defaults, minute 10 (batch head, integration report) | 5 | 5 | 5 | 6 |
| Shipped defaults, minute 10 (follow-up) | 6 | 6 | 3 | 6 |
| `--difficulty relaxed`, minute 10 | 6 | 7 | 7 | 8 (13 R4) |
| `--protection 12`, minute 10 / 12 / 14 | 8 / 8 / 5 | 8 / 8 / 6 | 8 / 8 / 5 | 6 at minute 14 |

Two of three seeds now pass at the shipped defaults; seed 31337 loses five
seats in minutes 9-10, as before, right after protection and the tribe
campaign gate end at minute 8. A 12-minute protection moves the same cliff to
minutes 12-14 rather than removing it, and relaxed AI does not keep 8/8. The
fix (OD11: protection length, a staggered tribe gate, or both) stays an owner
decision; no lobby default was changed.

    npm run probe:playtest -- --out tmp/playtest-probe/default
    npm run probe:playtest -- --difficulty relaxed --gate 8 --out tmp/playtest-probe/relaxed
    npm run probe:playtest -- --protection 12 --minutes 14 --out tmp/playtest-probe/p12

## Next #4: publication and client cost

Recorded results (integration run, PublicationDump + PublicationClientBench):

| Map | Publications/s | gzip KB/s per client | clientTotal mean (p95) | Packed main-thread decode | Clone main half | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| Med 500 | 5.00 | 370.3 (gate 330: fail) | 31.21 ms (44.7) (gate 20: fail) | 38.97 ms | 9.01 ms | lazy row view |
| Mig 500 | 5.00 | 112.8 | 17.26 ms (27.1) | 41.76 ms | 4.78 ms | lazy row view |

Med raw publications are 627 KB of which 406 KB is metadata (65%); P13
(metadata revisions for armies, inventories, production, recruitment, trade
sites, aircraft, projectiles and a players change list) is the open lever and
was not implemented. The forwarding probe ran below saturation
(simSecPerWallSec 0.999, AI-only seats): delay mean 7.71 ms, p99 13.86; the
"while saturated" condition still needs an 8-human real-worker run.

The Chrome gates U4 (strategic draw p95 < 12 ms at 1,000 squads) and U5
(soldier zoom p50 < 33 ms) need real Chrome with WebGL2:

    npm run play
    http://127.0.0.1:9000/tests/skirmish/browser/DrawMeasure.html?modes=strategic
    http://127.0.0.1:9000/tests/skirmish/browser/DrawMeasure.html?squads=40&modes=soldier16,soldier12

at 1600x900, device pixel ratio 1, on an idle machine.

## Next #8: map generation on the A1 host

Not run (no ARM host). Desktop genMs at 1000 / seed 1: Black Forest 4,697,
Migration 3,844, Continents 5,337 (timeout 150 s). On A1:

    npx tsx tests/skirmish/perf/MapHashProbe.ts black-forest,migration,continents 1000 1
    npx tsx tests/skirmish/perf/SpawnSelectProbe.ts black-forest 1000 1

## Next #10: rollback checkpoint cadence

`checkpoint()` no longer clones its sub-checkpoints twice (248 -> 121 ms on
the same contended host, Med 500 warm fixture). `CHECKPOINT_INTERVAL_TICKS`
is 80 (10 s) instead of 20; see `MatchJournal.ts` and the measurements in
`tests/skirmish/perf/CheckpointCost.ts`. With 8 humans the integration run
measured checkpoint() at 199 ms mean every 20 ticks; the expected cost is now
about half, four times less often. Re-run on a quiet host:

    npx tsx tests/skirmish/perf/CheckpointCost.ts med
    SKIRMISH_EIGHT_HUMAN=1 DESIGN_B=1 CHECKPOINT_EVERY=80 node --import tsx tests/skirmish/perf/EightHumanLoad.ts med humans

## Owner decisions taken or pending in the follow-up

| ID | Decision | State |
| --- | --- | --- |
| D2 parameters | Synchronous cohort connectors: 1,024 expansions per search, 4,096 per tick, 32-tile direct moves | Taken (performance, not balance; `COHORT_CONNECTORS`) |
| D1 v6 | 4 of a seat's 16 planner slots kept for movement admission | Taken (`PLANNER_PARTITION.admissionReserve`) |
| OD-3 | Rollback checkpoint every 10 s | Taken provisionally from the probe rule; refine on a quiet host |
| I-0 live heap | Opt-in (`SKIRMISH_LIVE_HEAP=1`), not on by default | Taken (smallest reversible) |
| OD-6 | Land income `20 x (age + 1) / 2 + land / 40` | Applied, the notes' default (05 rec 3) |
| OD-10 | Tribes start with 3 squads | Applied, the notes' default (13 R1(2)) |
| 05 rec 5 | Vessel refits need a port of the target's age | Applied, the notes' default |
| G-a migration | A room saved at 2000 restores as 1000 | Taken (smallest reversible) |
| Next #1 tick-ratio criterion | Compare with an idle control or with routing only | Pending |
| Mig trade backlog | Committed sea trade holds ~90 planner jobs | Pending (economy) |
| I-1 | Tribe march cap K or border growth | Pending |
| OD11 | Start protection length or staggered tribe gate | Pending |
| D7 | Radius cap for the raid nearest-squad search | Pending (no value in the notes) |
