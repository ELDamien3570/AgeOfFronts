# P30: Qualify the requested capacity and release boundary

Status: **remaining work, not implemented by this handoff**. Read
[`../agent-workflow.md`](../agent-workflow.md) and [`../handoff.md`](../handoff.md).

## Dependencies and ownership

Depends on: P28, P29, P01, P02. Complete prerequisite gates before integrating dependent
implementation. A read-only design pass may run earlier.

One task agent owns this policy/module slice. Shared integration files listed
below require a serialized integrator patch rather than concurrent whole-file
edits. Use a separate branch/worktree, not another agent's live checkout.

- `src/skirmish/multiplayer/application/LiveMatch.ts`
- `src/skirmish/multiplayer/infrastructure/ReservedMatchWorker.ts`
- `src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts`
- `docs/V1ImplementationProgress.md`
- `Optimization Handoff/handoff.md`

## Current boundary

Largest supported map, 14 AI nations, 30 tribes and at least 10 humans remains an unverified qualification target. Local x64 correctness/builds and ten reserved seats cannot certify the actual ARM hardware or ten real browsers. No deploy-ready claim is made.

## Implementation slices

1. Obtain explicit authority and access for any external hardware test or deployment before it happens. The current instruction excludes Oracle pushing/deployment. Do not reconstruct stopped stress scripts, generate live overload traffic or route around a refusal. Prefer ordinary play sessions with agreed observation/stop conditions.
2. Measure the actual target hardware and browser class at opening and representative mature-world density across several maps/seeds/ages, with combat/navy/walls/trade, actual clients and joins/leaves. Record feature combination, concurrency, CPU topology, runtime, RSS/heap/GC, tick/command/publication/frame percentiles, oldest planner age and simulated/wall-clock ratio.
3. Treat proposed 20 Hz targets (p95 serial path roughly 30–35 ms, p99 below 50 ms, ordinary simulated/wall-clock ratio >=0.98, cheap feedback 100–200 ms and ordinary short admission p95 below 0.5 s) as hypotheses to agree/measure, not achieved results. Include command/capture/GC work in the serial budget.
4. Keep one proven match admission tier until CPU/memory/network headroom supports another. If a single world misses the contract, reduce work, explicitly lower the supported envelope or choose stronger hardware; do not assume extra workers multiply a single core.
5. Validate the exact final remote tree, preserve concurrent Art additions without wiring them up, record the source SHA and flag matrix, produce rollback notes and only then seek separate release/deployment authority.

Commit a passing coherent slice before beginning the next dependent slice.
Keep new persisted fields backward compatible or supply an explicit checkpoint
migration; old checkpoints must not silently change gameplay.

## Acceptance tests and evidence

- The complete requested configuration is exercised at a representative mature stage with actual authorized clients; report any component not tested.
- No persistent queue-age growth, memory leak/backlog, silent worker stall or browser baseline loop; save/rejoin/control transitions retain correctness.
- Feature flags are enabled individually and then together only after their acceptance evidence. Failed or unavailable ARM/browser gates remain explicitly open.
- Add focused tests under `tests/skirmish/` with a new task-specific fixture or
  extend the closest existing fixture. Run the common full suite, TypeScript,
  production build, whitespace and scoped lint after focused tests pass
- Report exact commit, flags, map/seed/age, inputs, deterministic work counters,
  retained-state limits and observed versus unverified performance. Tests on a
  small map do not certify the largest-map target or ARM hardware

## Rollback and stop conditions

Keep all experimental switches off and the last proven admission tier. Rollback must preserve paid jobs/cargo and supported checkpoint migration; deployment is a separate user-authorized action.

If a required dependency, hardware test, source asset or authorization is
unavailable, record the exact blocker and stop only that dependent work. Do not
turn a refused or unverified test into a pass, broaden authority, or enable a
production feature merely to demonstrate that code exists.
