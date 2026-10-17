# Roadmap Now + Next: implementation results

Branch `claude/silly-euclid-2e33a4`, based on `1b076a49` (1.5.7-10hz-prototype). HEAD `e93a9d97`, about 200 commits, not pushed.
Per-gate commands and the raw numbers are in `docs/perf/NextBatchGates.md`.

## Final test and profile run (at 04d06f03)

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| oxlint | 157 (equal to the limit; 10 in `src`) |
| Skirmish suite, run twice | 439 files pass, 2 skipped; 3,076 tests pass, 0 fail, 2 admitted `it.fails`, 0 timeouts; identical across both runs |
| Root suite (`npm test`) | 9 failures, all of which also fail on the base commit. `EnJsonSorted` got worse: 22 → 31 unsorted pairs |
| CommandFuzz | Seeds 1–5 × 1,500 commands: 0 throws, every oracle passes. Restore-every-tick passes on seeds 1–3 |
| Production build | Passes |
| Live smoke (coordinator + 2 clients, 90 s) | Passes. Moves executed, peer ticks agree, 0 faults, match closed cleanly |

The host was busy (Unity, VS Code, other agents), so the harness's wall/CPU ratio read 1.9–3.2 and every wall-time gate counts as contended. Trust CPU per tick and the tick-count metrics more than wall time.

| Bench | Review baseline | After Now | Final |
|---|---|---|---|
| 8 humans, Med 500, mean / p99 | 198 / 464 ms | 107.8 / 200 | 112.7 / 264 (CPU 59 ms) |
| 8 humans, Mig 500, mean / p99 | 206 / 497 | 117.8 / 212 | 134.9 / 256 (CPU 43 ms, wall/CPU 3.2) |
| Idle tick, Mig 500, mean / p99 (target ≤ 58 / ≤ 125) | 82.9 / 147 | – | 76.3 / 128.5 (still misses) |
| Publication KB/s per client, Med / Mig (target ≤ 330) | – | 370 / 113 at integration | 455 / 323 |
| Client cost per publication, Med (target ≤ 20 ms) | – | 31 | 46 |

The publication and client-cost increases come from the last 34 commits, and they match human moves now actually executing in the harness: 647 executed moves against 38 before. This has not been bisected.

## Exit criteria

| Item | Status |
|---|---|
| Now 1–6 | All met. Two exceptions: the end-to-end fault test does not go through the real worker, and lint is not gated |
| Next 6 Naval, 7 Combat | All met. The FormationPerformance C3 test is now a normal passing test |
| Next 8 Map gen | Met. The A1 timing was not run |
| Next 10 Restore / rollback | Met. R2-M11 (the bug that disconnected every online client) is fixed. Rollback containment exists. The checkpoint costs about 121 ms every 80 ticks (see the owner decisions) |
| Next 2 Idle tick | I-0, I-2, I-3 done. I-1: no cap (owner decision). The old 58 ms target is superseded by the 8 Hz budget |
| Next 5 AI | 15/21. AiBattleCompetence is green. Coast goals still complete 0 times (pre-existing). Parts of T-a and T-c are left |
| Next 9 Balance | Rows, BalanceMatrix and BalanceContract are done. Pacing seeds 9001/47 and the 60-minute run are not done |
| Next 3 Playtest | 2 of 3 seeds pass ≥ 6/8 (6/6/3). Depends on OD11 |
| Next 1 Routing | Admissions and executed-move p95 now pass on Med. Planner window-mean (111/122), routing max (321/459 ms) and the humans/idle ratio (1.30/1.68) fail |
| Next 4 Net / client CPU | Cadence (5 pubs/s), forwarding and the N4 decision pass. Med bandwidth and client cost fail. The Chrome gates were not run |

Not run because the hardware isn't here: the Oracle A1 runs (routing, idle tick, prepare at 1000) and the Chrome U4/U5 gates (`tests/skirmish/browser/DrawMeasure.html`).

## Owner decisions taken by default (each is a named constant)

**Decided by the owner**
- **Rollback checkpoint cost: rollback is off by default.** An operator turns it on with `SKIRMISH_ROLLBACK=1` in the coordinator's environment. With it off, a tick fault ends the match cleanly (the Now #1 path) and no checkpoint is taken. Turn it back on once the checkpoint is incremental or runs off-thread. When on, `CHECKPOINT_INTERVAL_TICKS = 80`, and one tick in 80 pays about 121 ms extra on Med 500 with 8 humans.
- **I-1 tribe march: no cap.** The 58 ms idle target came from a desktop-to-ARM factor of 2.4, which was estimated, not measured (notes 22:327). It is superseded: the CPU per tick measured here (about 28 ms idle; 43–59 ms with 8 humans) fits the 125 ms budget of an 8 Hz tick on the desktop. The Oracle A1 run is still what settles the real ARM factor.

**Needs you soon**
- **OD11 start protection**: 8 minutes. Seats die at minutes 9–10. 12 minutes gives 8/8 at minute 12 but 5/6/5 at minute 14.
- **Mixed army moves**: the server rejects them; the client splits them.

**Balance and content** (recorded in BalanceContract.md)
- Napoleonic volley 150 → 55 HP (the notes said 70).
- ATGM +400.
- Modern MG crew HP 200 → 1000.
- Age-up rule: 3 trees, or 2 trees plus warfare.
- Advance times 90–180 s.
- Receiver tariff 25 %.
- Commerce cap 3 + age.
- Stack limits: mine 1, city 3, factory 5, port 5.
- Refit floor 60 %.
- Tribe opening: cap 6 + 4 per age, 3 starting squads, campaign gate at minute 8 / Bronze.
- Land income `20×(age+1)/2 + land/40`.
- Naval damage floor 60 %; warships retreat below 60 %; only carriers start entry wars.
- `mountedWidthRatioMax` 2.05.
- Lobby default AI difficulty `standard`.
- Time limits 60 / 90 / 120 min.

Pacing after integration: 164 regular squads at minute 30, against about 290 at base. The trade rows may be too strong.

**Network**
- 128 KB frame cap and the rate limits.
- The 2 s resync cooldown delays the resync instead of refusing it.
- Publication gate 200 ms (Design B).
- Detail budget of 2,500 soldiers.
- Behind Caddy, `trustProxy` must be set for per-IP limits.

**Other**
- PATH_WARM_TREES 15 (the water gate opens about 3.75× sooner).
- Orphaned armies disband after 10 s.
- Soldiers lost while zoomed out leave no remains.
- The PreModernBalance spearmen case stays an admitted gap.

## Known open issues
- `SquadGeometry.traversable` DDA boundary bug.
- `AiCombatPower` ignores the C3 hit cap.
- `serverMatchWorker.ts:327` reads `commands.length` before validating it (the throw is contained).
- Other players' reserves are sent to every client (no players change list).
- The `docs/perf/NextBatchGates.md` Next #4 table is stale (it holds integration-time numbers).
- `node_modules/.bin` is missing from the shared install, so `npx tsc` and bin-based `npm run` scripts fail there.
- Lane worktrees (`.claude/worktrees/wf_*`) and the `aof/now-*` / `aof/next-*` branches are still on disk.
