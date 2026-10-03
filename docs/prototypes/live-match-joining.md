# Live-match joining prototype

## Try it

Build the client and run the existing single-server multiplayer process:

```sh
npm run inst
# Hydrate Git LFS assets in a fresh source checkout before building/testing.
git lfs pull
npm run build:skirmish
MULTIPLAYER_MATCH_CAPACITY=1 npm run start:multiplayer
```

Open `http://127.0.0.1:9011` in independent browser profiles. Create a custom
lobby with **Allow new players to take over unclaimed AI empires**, regular AI
opponents, and spare configured human capacity, then vote to start. A new browser
can choose a named eligible AI from **Live matches**. A departed player using the
same browser can select **Rejoin your empire**.

Public takeover defaults **off**, including existing/default lobbies. Rejoining
an owned seat remains available regardless of that setting. Local skirmishes
are unaffected. The standalone HTML visual preview supplied with the prototype
uses the actual lobby renderer and styles, with clearly labeled demonstration
data and no connection to a live server.

## Identity and admission

- The existing saved guest token authenticates identity; the server stores its
  hash. Display names and flags are labels and never grant ownership.
- Runtime ownership is keyed by stable faction/player ID. Away human factions
  remain claimed, run as AI, and count toward the configured human-seat ceiling.
- Newcomers can choose only unclaimed, living, regular AI factions. Tribes,
  eliminated factions, owned-away factions, and faction hopping are rejected.
- One controlling socket or pending admission per remembered identity is
  enforced across matches. Replacing a lobby socket deletes the old session
  before closing it; stale socket close events cannot disconnect its successor.
- Initial lobby-to-game navigation retains its unloaded seat. A returning owner
  can also resume interrupted spawn selection before the world starts.
- Only runtime-backed matches appear in the live directory. Persisted match
  reservations are cleared at server startup because no crash recovery exists.

## Atomic snapshot boundary

1. `watch-match` announces map/runtime metadata and the selected faction. Assets
   load while existing humans keep playing. Loading attempts expire after 60s
   from that attempt, not from the match's start; at most 16 are retained.
2. `match-ready` validates the version and seat, acquires the single admission
   lock, then lets any in-flight simulation advance finish.
3. The worker revalidates the faction and tentatively transfers control. No
   world data is restored or replaced. It captures one presentation state S.
4. `SnapshotEncoder.encodeJoinBarrier(S)` advances the **shared** comparison
   cursor and creates an independent reset baseline. Existing players receive
   the aligned delta; the newcomer receives the reset, with the same publication
   sequence and tick. Publication sequence allows a same-tick barrier safely.
5. The client decodes and applies the complete baseline to its view before
   sending `match-sync-applied` with the exact sync ID and publication sequence.
   The server commits ownership, sends `match-sync-complete`, and resumes.

Advancing the shared cursor at S is essential. If a tile was 1 at the previous
publication, 2 at a newcomer-only baseline, then 1 again, an unaligned shared
encoder would omit the last change and leave the newcomer permanently wrong.
The regression tests explicitly cover this change-back case for ownership,
claims and construction progress.

Control transfer only changes the faction's controller and its controller
version. Army/unit IDs, resources, land, research, production configuration,
diplomacy, current orders and queued legitimate navigation are preserved.
Deferred AI-move proposals carry a controller generation; stale proposals
cannot issue orders after takeover, even after a later return to AI control.

## Bounded work and lifecycle

- Simulation remains 20 Hz, presentations 5 Hz, maximum four catch-up ticks.
- No host replay, host migration, recurring checkpoints, extra simulation worker
  or new service. One on-demand newcomer baseline is encoded per admission.
- Synchronization has a 5s deadline. Timeout/disconnect restores AI and releases
  the pending claim. If rollback cannot complete within a further 1s, the failed
  match worker is retired rather than leaving an unbounded pause.
- Successful or failed sync resets the tick schedule, preventing pause-time
  catch-up. There is a 2s cooldown and a 15s rolling one-minute pause budget.
- Command/history limits remain 100 / 2048; decoder backlog remains eight,
  executor backlog eight; socket backlog remains 512,000 bytes. The reserved
  worker still has a 384 MiB old-generation heap ceiling.
- Public summaries refresh once a second from cached runtime roster data;
  this does not introduce per-tick SQLite writes.
- When all humans disconnect, the world pauses in memory for two minutes and
  continues occupying one match-capacity slot. Failed attempts never refresh
  that deadline. A successful admission clears it; expiry releases capacity
  exactly once. Configure `MULTIPLAYER_EMPTY_MATCH_GRACE_MS` from 1000 to 300000
  (default 120000).

## Verification

New tests cover actual WebSocket clients, guest rejoin, name impersonation,
concurrent AI claims, same-socket cross-match admission exclusion, original
faction state preservation including research/production, controller-generation
fencing, the shared-cursor change-back regression, exact applied ACK gating,
load-after-60s match age, no pause during asset loading, in-flight advances,
timeouts, disconnect rollback, empty-match grace, interrupted spawn selection,
elimination/tribe/version rejection, duplicate tabs and stale close events,
restart cleanup, and rendered lobby/client interruption flows.

Run the complete skirmish suite on a limited-core machine with:

```sh
npm run test:skirmish -- --maxWorkers=2
npx tsc --noEmit
npm run build:skirmish
```

The high-parallelism default test run can exceed pre-existing five-second map
loading test deadlines on this executor. The two-worker complete run passes
without changing test timeouts. Source archives contain Git LFS pointers rather
than all game-art/map binaries; hydrate them before running locally.

### Prototype performance check

Same seed, real Africa maps, default faction counts plus two humans, 2,400
simulation ticks; final 300 four-tick/presentation batches measured. Linux x64,
Node 24.19.0, one reserved worker. These are local comparisons, **not** a
benchmark on the target 2-ARM-core deployment or a full late-game soak test.

| Map edge | Baseline mean / p95 batch | Prototype mean / p95 batch | Join barrier mean / p95 | Join reset packet |
|---|---|---|---|---|
| 500 | 31.79 / 43.93 ms | 27.20 / 38.58 ms | 37.82 / 45.24 ms | 97,256 bytes |
| 1000 | 88.82 / 139.69 ms | 79.74 / 123.50 ms | 80.44 / 98.31 ms | 153,972 bytes |

Steady-state packet sizes matched the baseline exactly. Maximum pending worker
requests observed was one. Peak whole-process RSS was about 454→451 MiB (500)
and 618→632 MiB (1000); this includes worker/native/map buffers and is not the
worker V8 heap metric. Normal timing/GC variance explains small differences;
these measurements establish no evident steady-state regression, not a speedup
claim. Capacity remains one by default; do not increase it from these results.

Browser screenshot verification was blocked by Chromium socket creation EPERM
and the cloud browser's localhost restriction. DOM rendering/session tests and
the build passed; the supplied HTML is a reviewable actual-renderer preview,
not an asserted browser screenshot or live end-to-end visual pass.
