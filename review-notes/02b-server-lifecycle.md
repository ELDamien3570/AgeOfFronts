# 02b — Coordinator, lobby, match lifecycle, admission and failure handling

Reviewer scope: server-side lifecycle of an online match (coordinator process, lobby rooms, reservation/capacity, worker admission, join/rejoin barrier, pause/resume, termination) plus the client side of the lobby/match protocol. Working tree of branch `1.5.7-10hz-prototype` as of 2026-10-15; read-only.

## Scope read

Read in full (line numbers below are from `cat -n` on the working tree):

- `src/skirmish/multiplayer/server.ts` 1–44
- `src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts` 1–539
- `src/skirmish/multiplayer/infrastructure/CoordinatorStore.ts` 1–110
- `src/skirmish/multiplayer/infrastructure/ReservedMatchWorker.ts` 1–96
- `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts` 1–318
- `src/skirmish/multiplayer/infrastructure/SnapshotEncodingWorker.ts` 1–55, `snapshotEncoderThread.ts` 1–24
- `src/skirmish/multiplayer/infrastructure/RuntimeBuild.ts` 1–38, `ServerMap.ts` 1–67, `WorkerRuntimeDiagnostics.ts` 1–14
- `src/skirmish/multiplayer/domain/RoomCoordinator.ts` 1–387, `MatchAuthority.ts` 1–171, `EconomyLedger.ts` 1–145
- `src/skirmish/multiplayer/application/LiveMatch.ts` 1–917, `HostedRuntime.ts` 1–142, `CommitVerifier.ts` 1–308, `MapIdentity.ts` 1–49, `MatchExecutor.ts` 1–100, `PublicationQueue.ts` 1–42, `RecoveryBaselineCache.ts` 1–70, `ClientStateFlow.ts` 1–51
- `src/skirmish/multiplayer/Protocol.ts` 1–181, `StateLimits.ts` 1–31, `SnapshotWireCodec.ts` 1–49
- `src/skirmish/client/lobby/OnlineLobbyConnection.ts` 1–198, `LiveMatchCards.ts` 1–52, `LobbyViewModel.ts` 1–606, `main.ts` 1–311; `LobbyView.ts` (grep only, escaping)
- `src/skirmish/client/OnlineMatchSession.ts` 60–160, 240–270, 300–400, 480–522
- `src/skirmish/FactionRules.ts` 1–102; `src/skirmish/lobby/LobbyRules.ts` 1–41; `src/skirmish/lobby/LobbyDirectory.ts` 1–170; `src/skirmish/lobby/EmpireProfile.ts` 1–36
- `src/skirmish/Protocol.ts` 15–35; `src/skirmish/Simulation.ts` 200–215, 740–800, 1020–1075, 3368–3380; `src/skirmish/domain/SpawnSelection.ts` (grep for throws)
- `src/skirmish/multiplayer/LiveMatchJoining.md`, `docs/MultiplayerLaunch.md` 1–80, `deploy/oracle/{compose.yml,Dockerfile,Caddyfile,backup.sh}`
- Evidence: `Optimization Handoff/Evidence/live-match-freeze-20261015.md`, `match-254-coordinator-crash-20261014.md`, `8hz-arm-qualification-20261014.md` (grep), `multiplayer-pipeline-profile-20261014.md` (grep: compressed packet 46–60 KB)
- Tests: `tests/skirmish/CoordinatorServer.test.ts`, `LiveJoinExclusivity.test.ts`, `LiveJoinLifecycle.test.ts` (harness 1–120 + scenario names), `LiveJoinRuntime.test.ts`, `LiveJoinTransport.test.ts` 350–392, `OnlineMatchSession.test.ts` (scenario names). Ran `npx vitest CoordinatorServer LiveJoinLifecycle LiveJoinExclusivity --run`: 6 files / 34 tests pass on the working tree.
- Probe: a throwaway script under the scratchpad (`cancelsync-race.mts`) driving `LiveMatch` with a fake executor; its output is quoted under Issue 2.

## How it works today

### Process shape

One Node 24 process (`server.ts`) owns: an HTTP server (static files from `STATIC_DIR`, `/guest`, `/healthz`), one `ws` WebSocketServer on `/socket`, one `RoomCoordinator` aggregate (lobby rooms + match reservations), a `CoordinatorStore` (SQLite, WAL, `synchronous=FULL`), and a `Map<matchId, LiveMatch>`. Each `LiveMatch` owns a `ReservedMatchWorker` (a `worker_threads` Worker started with `--import tsx`, 384 MB old-gen cap, `serverMatchWorker.ts`), which in turn owns a `SnapshotEncodingWorker` (second thread, 256 MB). So one match = 2 threads + the shared main thread. Production (`deploy/oracle/compose.yml:14`) runs `MULTIPLAYER_MATCH_CAPACITY=1`, not 3; the docker container has no memory limit; Caddy in front has no rate limiting.

### Persistence (`CoordinatorStore`)

Persisted: `guests(id, token_hash)`, `guest_profiles`, `requests(guest_id, request_id, reply)` (last 256 per guest, used to make lobby requests idempotent across reconnects), and one row `coordinator.state` = the whole `CoordinatorState` (rooms, reservations, nextSequence), rewritten on every lobby mutation, every 50 ms clock tick that changed state, on socket close, and on match release. Not persisted: anything inside `LiveMatch` or the worker (seats, admissions, command queue, simulation). On restart (`CoordinatorServer.ts:91–98`) every room member is marked disconnected (60 s grace to rejoin the room) and every reservation is dropped, so capacity never leaks across restarts, and no match survives a restart/crash/redeploy.

### Socket session lifecycle

1. Upgrade only on `/socket` with a trusted `Origin` (or none). An unauthenticated socket has 5 s to send `authenticate` (`:234`).
2. `authenticate` looks the token hash up in SQLite. If the guest is already connected/admitting in a match: without `matchId` or with a different `matchId` the new socket is closed `4001 "Match already open"`; with the same `matchId` the old socket is closed `4001 "Opened in another tab"` and `match.disconnect(guest)` is awaited (`:257–270`), so the new tab must re-admit through the join barrier. `authenticationClaims` serialises concurrent authenticates for one guest (`:260`). `rooms.disconnect(guest)` always runs (`:271`): presence in a lobby room is only restored by an explicit `join`, which the lobby page sends on its first directory message (`main.ts:280–283`).
3. After authentication: per-session window of 50 non-receipt messages per second (`:305`); `match-*` messages go to the `LiveMatch` named by `matchId`; lobby messages (`create/join/leave/voteStart/close/profile`) mutate `RoomCoordinator`, are persisted together with their `ack` (`:419`), and on any throw the whole aggregate is rebuilt from the snapshot taken when the message arrived (`:245`, `:429`).
4. `close` → `rooms.disconnect`, `match.disconnect` for every match, persist + publish directory.
5. Heartbeat ping every 5 s, terminate if no pong (`:495`). `send()` closes a client with `bufferedAmount > 8 MB` (`:195`).
6. The directory (`rooms.snapshot()` + per-guest `LiveMatchSummary` list) is pushed to every session on every state change and every second (`:494`).

### Room lifecycle (`RoomCoordinator`)

Default rooms (`default-<mapId>`, slots 20, min 2 humans, 60 s countdown) always exist. Custom rooms: one per owner guest, ≤3 "visible", unlimited "queued" if `willingToWait`. `join` enforces slots (counting disconnected-but-in-grace members) and colour uniqueness; `leave`/`disconnect` prune; a custom room with no connected member is deleted immediately (`:358`). `advance(now)` (called every 50 ms) prunes members disconnected >60 s, transfers ownership, and starts a room when either all connected members voted (so one human can vote-start alone) or connected ≥ `minimumHumans` and (full or deadline passed) (`:300–308`). If `reservations.length >= matchCapacity` the room waits with `capacityWaiting=true` (`:310`); otherwise a `MatchReservation` is created from the connected members and the room's member list is emptied (`:324`). A reservation is released only by `releaseMatch` from the `LiveMatch.end()` callback.

### LiveMatch lifecycle (state diagram in prose)

- **reserved → initializing**: the coordinator clock constructs `LiveMatch` + `ReservedMatchWorker` and calls `initialize()` → executor `prepare` (worker boot via tsx, `loadServerMap`, `SpawnSelection.resolve()`, `mapIdentity`). 30 s request timeout (`ReservedMatchWorker.ts:72`). On rejection: `error` sent to each member and `end("Unable to initialize match")` (`CoordinatorServer.ts:475–482`).
- **initialized / loading**: manifests (`type:"match"`) sent to connected seats; the lobby page navigates to `/skirmish/index.html?match=…`; each seat has a 60 s `loadingDeadline`. The match page authenticates a new socket with `matchId`, sends `watch-match` (optionally `playerId` for takeover/rejoin), receives the manifest again, loads the map, verifies `runtimeId` and `mapHash`, and sends `match-ready` (= `qualify`).
- **spawn selection**: `advanceWorld` opens the spawn window when at least one guest is loaded and either every connected seat is loaded or 10 s passed since initialize (`LiveMatch.ts:680–690`); `SPAWN_SECONDS`=10; spawn state is published at 4 Hz; `select-spawn` requests go to the worker's `SpawnSelection`. Late loaders during this phase join via the "not running" path of `qualify` (`:317–347`), returning owners get an admission and the spawn window is extended.
- **running**: `start` creates the `Skirmish` in the worker. Then `advance()` (self-scheduled via `scheduleTick` at `nextTickAt`, plus the 50 ms coordinator poll as backstop) issues one `advance` request per tick with the drained command batch (≤100), the disconnected player set (AI takeover inside the worker, `serverMatchWorker.ts:245`), and `publish` when 200 ms of wall and sim time passed. Publications are streamed from the worker (`PublicationQueue`, capacity 2, encoder thread) and fanned out through per-client `ClientStateFlow` windows (4 outstanding frames; a client that falls behind gets a `rebase` baseline via `client-baseline`, which does not pause the match).
- **sync pause (join barrier)**: any newcomer/rejoiner in the running state goes `watch` (admission, ≤16 concurrent, 60 s) → `qualify` → takes the single `sync` lock, broadcasts "Synchronizing…", waits for the in-flight advance, requests `join-barrier` (flush publications, `setAiController(false)`, aligned delta for everyone + baseline for the newcomer at the same tick/sequence), then waits ≤15 s for `match-sync-applied`; `acknowledge` claims the seat, clears `emptyDeadline`, `finishSync` resets tick/snapshot clocks. Cancellation (timeout, disconnect, error) rolls the faction back to AI with `set-controller`. Budget: 2 s cooldown and 15 s of cumulative pause per rolling 60 s (`:369–377`). `advance()` is a no-op while `sync` is set (`:639–645`), so the whole match is frozen for every join/rejoin.
- **empty pause**: when the last connected seat disconnects, `emptyDeadline = now + graceMs` (120 s) and `advance()` stops stepping (`:591–596`, `:642`). A returning owner's admission or sync extends survival only for its own bounded window (`emptyExpired`, `:603–609`). Expiry → `end("No players returned…")`.
- **ended/stopped**: `end()` sets `stopped`, cancels timers, broadcasts `match-ended` (to loaded seats and pending admissions), closes the executor (terminates the worker), then `release()` → map delete, `releaseMatch`, persist, publish. Entered from: winner, init failure, advance rejection (worker error/exit/timeout/backlog), executor failure during sync rollback, empty grace expiry, shutdown.

### Worker failure path (match-269 class)

A TypeError inside `step()`/`replicationSource()` during `advance` is caught in `serverMatchWorker.ts:305–315`, logged with the stack on the server, and returned as `{error: message}`; `ReservedMatchWorker` rejects the pending promise; `advanceWorld` rejects; both the self-scheduled dispatcher (`LiveMatch.ts:661–662`) and the coordinator clock (`CoordinatorServer.ts:485–487`) call `end("Match stopped: <message>")`. Clients receive `match-ended {completed:false}`; the working-tree client now routes that to `fail()` (`OnlineMatchSession.ts:121–130`), disabling commands and showing the message — the "both clients looked frozen" symptom from the evidence doc is fixed in the tree. Worker `exit`/OOM/`fatal` messages reject any in-flight request the same way; if nothing is in flight (empty pause) the dead worker is noticed only at the next request, which for a paused match is the grace expiry.

### Legacy status

`HostedRuntime`, `CommitVerifier`, `EconomyLedger`, `MatchAuthority` and `StateDelta` are imported only by each other and by their tests (grep over `src`/`tests`); `LiveMatch` imports none of them. They are the client-hosted-executor design (leases, hash-chained deltas, spend ledger) and are dead in production, although still compiled, hashed into `runtimeId` (`RuntimeBuild.ts:18`), and described as live in `docs/MultiplayerLaunch.md` ("Host loss recovers from the last server-accepted checkpoint", "lightweight server ledger"). `ExecutorRequest "seat-status"` (`MatchExecutor.ts:80`, handled at `serverMatchWorker.ts:196`) and `RoomCoordinator.reconnect` (`RoomCoordinator.ts:249`) are never called.

### Faction caps

`MAX_HUMAN_PLAYERS=20`, `MAX_AI_OPPONENTS=14`, `MAX_TRIBES=30`, `MAX_PLAYER_ID=64` (`FactionRules.ts:27–38`); `MAX_FACTIONS=41` regular (`Protocol.ts:25`). Enforced consistently at the wire (`multiplayer/Protocol.ts:50–56`), `validateLobbySettings` (`LobbyDirectory.ts:66–71`, plus map-size camp budgets only for amazon-river/migration at 250, `LobbyRules.ts:31–33`), and `Simulation` constructor (`Simulation.ts:758–775`). The "20-faction cap" is the human-seat cap; the 8 + 14 + 30 = 52 target already fits (22 ≤ 41 regular, 52 ≤ 64 ids). Raising beyond that touches `MAX_PLAYER_ID` (FactionAdjacency arrays, FactionColors), the byte-sized owner/claim planes with 255 as contested marker (`SnapshotCodec.ts:62`, `SnapshotWireCodec.ts:16`), `watch-match.playerId ≤ 255`, and the lobby form limits. Pop-up factions (nomads/pirates) additionally need runtime `deployPlayer` (today only in `createPlayers` at construction, `Simulation.ts:1026–1055`) and id headroom.

## Strengths

- Clear single authority: no client simulation, one serial request queue per worker, publications ordered through `PublicationQueue`, and the recovery baseline cache keyed by a canonical version that every advance invalidates (`serverMatchWorker.ts:30`, `:236`).
- Lobby requests are idempotent across reconnects (persisted replies) and the lobby client replays only pre-authentication requests (`OnlineLobbyConnection.ts:70–75`).
- Capacity accounting is centralised in `RoomCoordinator.advance` and released from one callback; restart drops stale reservations (tested in `LiveJoinTransport.test.ts:355`).
- Duplicate-tab fencing, admission exclusivity, bounded admissions (16/60 s), bounded sync (15 s) with AI rollback, pause budget, flow-controlled fan-out with non-pausing per-client recovery, 8 MB slow-consumer cut-off, and the match-254 hotfix (400 on undecodable URLs) are all present and covered by real-socket tests.
- Worker isolation: a simulation exception ends only that match and the server log keeps the stack while clients get a readable message; the fatal path is now correct end-to-end (see above).

## Issues

Severity/confidence legend: severity = player-visible impact at the 8-human/52-faction target; confidence = CONFIRMED (traced end to end or probed) or SUSPECT.

### 1. A failed match initialization is silent on the lobby page and leaves players stranded (medium, CONFIRMED)

- `CoordinatorServer.ts:475–482`: on `initialize()` rejection each member gets `{type:"error", message}` with no `requestId`, then `end("Unable to initialize match")`.
- `OnlineLobbyConnection.ts:79–89`: an `error` without a pending `requestId` is handed to `onMatch`; `main.ts:296–299` only handles `type === "match"`. The `match-ended` broadcast reaches nobody (no loaded seats, no admissions).
- `RoomCoordinator.ts:324` already emptied the room when the reservation was taken.
- Consequence: players sit in a room that is now empty with no message; they must notice and re-join. Triggers that exist today: `SpawnSelection.ts:47` "No viable land for starting camps" (only two map/size combinations have camp budgets, `LobbyRules.ts:31–33`; a 52-faction roster on a small heightmap goes undetected until `prepare`), map asset read errors, the 30 s executor timeout covering worker boot + 1000×1000 map decode (`ReservedMatchWorker.ts:72`), worker OOM during preparation.

### 2. `cancelSync` deletes a newer admission of the same guest and sends it a stale error (medium, CONFIRMED by probe)

- `LiveMatch.ts:449–473`: cancellation awaits the in-flight advance and a `set-controller` round trip, then in `finally` does `admissions.delete(sync.admission.guest)` and `send(guest, {type:"error", message})` (`:467–468`).
- A reconnecting tab (the common case after a socket drop mid-sync, since `disconnect()` at `:597–601` triggers this very cancellation) authenticates, `watch`es and gets a fresh admission (`:263`) while the rollback is still awaiting the worker; that admission is then deleted and the new socket receives "Join canceled because the connection closed", which the match client treats as fatal while `pendingSync || lastTick < 0` (`OnlineMatchSession.ts:121–124`).
- Probe output (fake executor with a slow `set-controller`): `after drop, admitting a: false` → `new admission present: true` → `after cancelSync finished, new admission still present (expected true): false` → `errors sent to a: ['Join canceled because the connection closed']`.
- Consequence: a player who reconnects quickly after a drop during their own sync is bounced to the lobby and must try again; under worker load (`set-controller` queued behind a 255 ms advance) the window is hundreds of ms, which the 500 ms–10 s client backoff hits.

### 3. No process-level failure guard; SQLite writes sit on timer, close and release paths (high consequence, SUSPECT on trigger probability)

- `CoordinatorStore.write` runs `BEGIN IMMEDIATE` (`CoordinatorStore.ts:69`) on a `DatabaseSync` opened without a busy timeout (`:16`). It is called from the 50 ms `setInterval` (`CoordinatorServer.ts:489`), from the async `close` handler (`:448`, → unhandled rejection), and from `release()` (`:465`) which `LiveMatch.end()` calls in a `finally` (`LiveMatch.ts:852`) — including from the `.catch` chains at `CoordinatorServer.ts:485–487` and `LiveMatch.ts:661–662`, whose own rejections are unhandled.
- There is no `uncaughtException`/`unhandledRejection` handler anywhere in `src/skirmish/multiplayer` (grep), and Node 24 exits on both. Disk-full on `/data`, `SQLITE_BUSY` from any concurrent writer, or a corrupt DB therefore ends the process and every live match — the same blast radius as match-254, from a different trigger.
- Same class: `send()` can throw from `encodeSnapshotFrame` (`SnapshotWireCodec.ts:24–25`, metadata >16 KB or body >6 MB) and is invoked synchronously inside the worker `message` listener (`ReservedMatchWorker.ts:46` → `LiveMatch.ts:131–135` → `broadcast`); a throw there is an uncaught exception on the main thread.

### 4. Rate limiting is applied after parsing; the coordinator main thread is exposed to cheap CPU abuse (medium, CONFIRMED)

- `CoordinatorServer.ts:182` accepts 512 KB frames; `:247` does `JSON.parse` + `clientMessageSchema.parse` on every frame; the 50/s window is only checked at `:305`, after parsing, and only for authenticated sessions. Guests are free (`/guest` is 20/min/IP, `:162`), sockets per IP are unlimited, and an unauthenticated socket is kept 5 s (`:234`).
- The main thread also hosts every `LiveMatch` scheduler, publication fan-out and command validation (`LiveMatch.ts:567` zod parse of up to 100 KB per command). Sustained parsing of large junk frames delays ticks and publications for all matches.

### 5. Client-requested full baselines have no per-guest cooldown and run inside the simulation worker (medium, CONFIRMED)

- `match-state-resync` (`CoordinatorServer.ts:337`) → `LiveMatch.resync` (`:891–896`) → `client-baseline` (`:904`) → `recoveryBaseline()` (`serverMatchWorker.ts:76`), whose cache is invalidated by every advance (`:236`), so each request is a full `replicationSource()` + `encodeBaseline` in the worker's serial queue, ahead of the next `advance`.
- `ClientStateFlow.recovering` is cleared when the baseline is sent (`LiveMatch.ts:907`), so one client can request another immediately; the only brake is the 50 msg/s window. The old `CommitVerifier` comment put a full baseline at "about a second" on the largest maps.
- Consequence: one broken or hostile client in an 8-human match can keep the simulation worker busy encoding baselines; honest slow clients on 1000×500 will do this organically whenever their window overflows.

### 6. The command admission queue (100) is shared by all players of a match (medium-low, CONFIRMED)

- `LiveMatch.ts:32,560`: `MAX_QUEUED_COMMANDS = MAX_COMMAND_BATCH = 100`, drained once per `advance` (`:738`). Per-socket allowance is 50/s (`CoordinatorServer.ts:305`), so with 8 humans and p99 ticks of 255 ms a burst from one player can fill the queue and other players get "Command queue is full" for their legitimate orders.

### 7. Every join/rejoin pauses the whole match; the pause budget then locks players out (high at the 8-human target, CONFIRMED design)

- `LiveMatch.ts:378–386,639–645`: the single `sync` lock freezes `advance()` for the duration of waiting-for-advance + `join-barrier` (publication flush + full aligned encode + baseline encode) + client decode/apply (≤15 s).
- `:369–377`: 2 s cooldown and 15 s cumulative pause per 60 s; a rejected `qualify` is retried by the client every 500 ms for 15 s (`OnlineMatchSession.ts:326–331`) and then fails with "Return to the lobby".
- With 8 humans the frequency of socket drops/reloads scales with player count while the budget does not: two flaky players can exhaust it, every reconnect freezes six other people, and the `LiveMatchCards` "Synchronizing a player" state blocks new takeovers meanwhile. The reference load already shows `join-barrier` is the most expensive request the worker serves.

### 8. Fan-out re-encodes the binary frame per client (low, CONFIRMED)

- `CoordinatorServer.ts:203`: `encodeSnapshotFrame(state)` runs inside `send()` for every recipient, allocating header + metadata JSON + a copy of the 46–60 KB compressed body per client per publication. At 8 humans × 5 Hz that is ~40 allocations/s and ~2.4 MB/s of copies on the main thread per match; harmless at 2 players, measurable at 8 × 3 matches. `textSnapshotPacket` already caches per packet (`SnapshotWireCodec.ts:40–49`); the binary path does not.

### 9. Dead client-hosted-executor code still ships and is documented as live (low, CONFIRMED)

- `HostedRuntime.ts`, `CommitVerifier.ts`, `EconomyLedger.ts`, `MatchAuthority.ts`, `StateDelta.ts` (plus `seat-status`, `RoomCoordinator.reconnect`) have no production importer. They are hashed into `runtimeId` (`RuntimeBuild.ts:18`), so editing them forces every open tab to reload after deploy; `docs/MultiplayerLaunch.md` ("Host loss recovers…", "lightweight server ledger") and `LiveMatchJoining.md` ("Simulation remains 20 Hz", "five-second [sync] deadline") describe behaviour that no longer exists (TICKS_PER_SECOND=8, `syncTimeoutMs` 15 s).

### 10. `runtimeId` misses the wire codec and lobby validation (low, CONFIRMED)

- `RuntimeBuild.ts:15–25` hashes top-level `src/skirmish/*.ts`, `domain`, `content`, `multiplayer/application`, `multiplayer/infrastructure`, `client`, and four named files; it excludes `multiplayer/SnapshotWireCodec.ts`, `StateDelta.ts`, `multiplayer/domain/*` and `lobby/*`. A frame-format change would not trip "Game versions differ" for a tab opened before the deploy. Mitigated by same-origin deploys and `no-cache` index.html.

### 11. Reconnect/duplicate-tab edge messaging (low, CONFIRMED)

- After the server closes a tab with `4001 "Opened in another tab"` the match page first shows the correct status and then overwrites it with "Reconnection timed out. Return to the lobby…" because the 4001 branch also calls `onExhausted` (`OnlineLobbyConnection.ts:103–113` → `OnlineMatchSession.ts:155`).
- A second quick reload while `authenticate` is still awaiting `match.disconnect` (which can block on a `set-controller` round trip) is answered with `4001 "Connection handoff in progress"` (`CoordinatorServer.ts:260`), which the client treats as permanent ("Close that tab and reload").

### 12. Internal exception text reaches all clients (low, CONFIRMED)

- `serverMatchWorker.ts:308–314` forwards `error.message` verbatim; `LiveMatch.end(\`Match stopped: ${message}\`)` broadcasts it (`CoordinatorServer.ts:486`, `LiveMatch.ts:661`). Match-269 would have shown "Match stopped: Cannot read properties of undefined (reading 'completed')" to every player. The comment at `:306–307` promises a safe message but only strips the stack.

### 13. Lobby spam and unbounded directory fan-out (low-medium, CONFIRMED)

- One custom room per guest, but guests are unlimited; queued rooms are unbounded (`RoomCoordinator.ts:111`); the full `CoordinatorState` is re-serialised per session per second (`CoordinatorServer.ts:213–226`), so N spam rooms × M viewers of JSON per second. `guests` and `requests` tables only grow (`CoordinatorStore.ts:30,78`).

### 14. Authenticate-path rollback can discard concurrent coordinator mutations (low, SUSPECT)

- `CoordinatorServer.ts:245` snapshots `rooms` before `await Promise.all(active.map(match.disconnect))` (`:269`); if a later synchronous step throws (e.g. `store.write` at `:287`) and `active.length === 0` (so `matchRequest` stays false), `:429` restores the pre-await state, deleting any reservation the 50 ms clock created meanwhile while its `LiveMatch` keeps running — a capacity/room double-start hazard. Needs a throw after the await, which today is only the SQLite path.

### 15. Worker death during an empty pause is undetected until grace expiry (low, CONFIRMED)

- `ReservedMatchWorker.ts:58` marks the executor stopped on `exit`, but `LiveMatch` only learns via a rejected request; during `emptyDeadline` or spawn selection with no loaded guest no request is issued, so `/healthz` reports "paused" and a returning owner's rejoin fails with "Match executor unavailable during synchronization" after a full barrier attempt.

### 16. Socket drop mid-command (informational, CONFIRMED)

- Queued commands of a disconnecting seat are discarded (`LiveMatch.ts:584`) but their ids stay in `seen` (`:571`), so a replay of the same `requestId` after rejoin is acked without executing (`:559`). The match client uses `replayPending:false` (`OnlineMatchSession.ts:155`) so this is not reachable today; it becomes a trap if replay is ever enabled.

## Recommendations

Ordered by player-visible impact; effort is rough engineering time.

1. **Make rejoin of an existing seat non-pausing (addresses 7, partially 2).** For a guest that already owns the seat: skip the `sync` lock; send `set-controller` as a normal serialized worker request (it already invalidates baselines), then serve the baseline through the existing non-pausing `client-baseline`/`ClientStateFlow` path (`LiveMatch.ts:897–916`), keeping the seat AI-controlled until `match-state-applied` for that baseline arrives, then flip the controller. Keep the barrier only for first-time AI takeovers if the "atomic aligned delta" property is wanted there. Trade-off: the newcomer's first frames are deltas against a baseline captured one or two ticks before the controller flip, so the client must tolerate `ai` toggling in-stream (it already handles `disconnectedPlayerIds`); the "exactly one tick S" guarantee of `encodeJoinBarrier` is lost for rejoins. Effort: 2–3 days including tests in `LiveJoinLifecycle`.
2. **Harden the process against single-point throws (3).** Wrap `store.write` call sites so a persistence failure logs and degrades (write-behind queue with retry) instead of throwing on timers/close/release; open `DatabaseSync` with a busy timeout; add `process.on("unhandledRejection"/"uncaughtException")` that logs, ends matches cleanly with a readable message, and exits only if the error is not a persistence/transport error; make `send()` never throw (catch `encodeSnapshotFrame` and close that client). Effort: 1 day.
3. **Surface initialization failures and start progress in the lobby (1).** Have the lobby page render requestId-less `error` and `match-ended` messages as a toast and re-join the previous room; send a `match-status`-like "Preparing match…" to room members when the reservation starts. Also run `SpawnSelection.resolve()` (or a cheap capacity estimate) at `create`/`join` time for every map/size, not just the two budgeted ones, so impossible rosters fail at the room. Effort: 1 day.
4. **Scope admission bookkeeping to the sync (2).** In `cancelSync`'s `finally`, delete the admission only if `this.admissions.get(guest) === sync.admission`, and send the error only when no newer admission exists; add the probe as a regression test. Effort: 1 hour.
5. **Rate-limit before parsing and bound abuse (4, 5, 13).** Check the per-session window and a per-IP socket count before `JSON.parse`; close sockets that exceed it repeatedly; cap frame size per message type (orders need ~1–2 KB, not 512 KB); add a per-guest cooldown (≥2 s) and a per-match budget for `match-state-resync`, and serve baselines from a tick-aligned cached capture when several clients request within one tick; cap total rooms and sockets; prune `guests`/`requests` older than N days. Effort: 1 day.
6. **Per-player command quota (6).** Replace the shared 100 with per-seat quotas (e.g. 16 per tick, overflow coalesced per player) and raise `MAX_COMMAND_BATCH` accordingly for 8 humans. Effort: half a day.
7. **Encode the frame once per publication (8).** Cache the body (header+body for the no-flow case) per packet identity as `textSnapshotPacket` does; per-client `flowEpoch/rebase` only changes the ≤16 KB metadata. Effort: 2 hours.
8. **Delete the dead executor stack and refresh the docs (9).** Remove `HostedRuntime`, `CommitVerifier`, `EconomyLedger`, `MatchAuthority`, `StateDelta`, `seat-status`, `RoomCoordinator.reconnect` and their tests; rewrite `MultiplayerLaunch.md` and `LiveMatchJoining.md` for the server-only design, 8 Hz and current timeouts/capacity. Effort: half a day.
9. **Include the wire codec and lobby validation in `runtimeId` (10)** or hash the whole `src/skirmish` tree minus tests. Effort: 15 minutes.
10. **Sanitise terminal messages (12)** by mapping worker errors to a fixed player-facing string and keeping the raw message in the server log/diagnostics. Effort: 30 minutes.
11. **Detect a dead worker while paused (15)** by having `LiveMatch.advance()` check `executor.lifecycle.state` (already tracked) and end immediately. Effort: 30 minutes.
12. **Capacity realism for the target.** Keep `MULTIPLAYER_MATCH_CAPACITY=1` on the 2-CPU host until the 52-faction profile is measured; one match already needs ~0.8 core for the sim thread at mean 96 ms ticks plus the encoder thread and the main thread. If 3 matches are wanted, that is a bigger host or a per-match process on separate cores, not a config change. Also add a container memory limit sized for capacity × (384 + 256) MB + coordinator.

## Open questions

- Is the 30 s `prepare` budget ever approached on the ARM host for Migration 1000×1000 with 52 camps (tsx worker boot + heightmap decode + forest + resource terrain + spawn resolution)? No timing for `prepare` appears in the evidence docs.
- How large is a 1000×1000 compressed baseline in practice? It bounds both the per-client resync cost (Issue 5) and the `encodeSnapshotFrame` budget (Issue 3).
- Should a solo vote-start (`RoomCoordinator.ts:304–305`) in a *default* room be allowed, or is that an unintended way for one human to consume the only capacity slot with a 52-faction match?
- The `requests` idempotency table returns a pre-restart `ack` for a replayed `join`; the lobby self-heals through `route()`, but is that behaviour intended for `create` (which would return the old `roomId` for a room that no longer exists)?
