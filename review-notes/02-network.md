# 02 — Multiplayer replication pipeline, wire efficiency and latency

Reviewer scope: command → tick → publication → encoder → socket → client worker → main thread. Read-only review of the working tree on branch `1.5.7-10hz-prototype` (8 Hz, uncommitted). Everything marked CONFIRMED was traced end to end in the code or reproduced with a scratch script; SUSPECT items are reasoned but not executed.

Efficiency grade: **C+ for the current 3-human qualification load, D for the 8-human / 52-faction target.** The architecture is sound (authoritative worker, shared delta cursor, off-thread gzip, bounded queues, binary frames) and the measured compressed bandwidth (~270 KB/s per client at ~900 squads) is within reach of a WAN, but the pipeline resends large unchanged metadata every publication, pushes a full-state view to the browser main thread five times a second, pauses the whole match for every reconnect, and has a recovery feedback loop that turns one hiccup into a stream of full baselines.

## Scope read

Fully read (line ranges are the whole file unless noted):

- `src/skirmish/multiplayer/application/LiveMatch.ts` 1–917
- `src/skirmish/multiplayer/application/PublicationQueue.ts`, `MatchExecutor.ts`, `ClientStateFlow.ts`, `RecoveryBaselineCache.ts` (whole)
- `src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts` 1–318, `ReservedMatchWorker.ts`, `SnapshotEncodingWorker.ts`, `snapshotEncoderThread.ts` (whole), `CoordinatorServer.ts` 1–539
- `src/skirmish/multiplayer/StateCodec.ts` 1–472, `StateDelta.ts` (whole; not on the live path), `SnapshotWireCodec.ts`, `StateLimits.ts`, `Protocol.ts`, `CommandSchema.ts` (whole)
- `src/skirmish/SnapshotCodec.ts` 30–638, `SnapshotDetails.ts` 27–779, `EntityChangeJournal.ts`, `TileChangeJournal.ts`, `LatestChangeIndex.ts`, `ReplicatedEntities.ts`, `StateTransfer.ts`, `EntityCollection.ts`, `TraderStream.ts`, `CommandApplications.ts`, `FormationSlotStream.ts` 1–110 (whole files unless a range is given)
- `src/skirmish/Simulation.ts` 355–405 (entity collections / journals), 1246–1275 (`applyCommand` ownership), 5561–5617 (`replicationFacts` / `replicationSource` / `snapshot`)
- `src/skirmish/domain/Expansion.ts` 1860–1925 (`replicationMetadata`, `snapshot`), `domain/Progression.ts` 119–198, `domain/Armies.ts` 1213–1220, `domain/Roads.ts` 55–60, `domain/CommandPolicy.ts` 7–32
- `src/skirmish/Protocol.ts` 1–40, 218–621 (entity, Snapshot, SnapshotPacket types)
- Client: `src/skirmish/client/OnlineMatchSession.ts` 1–522, `multiplayerStateWorker.ts`, `CanonicalStateStream.ts`, `LocalSnapshotStream.ts`, `PresentationState.ts`, `RenderSamples.ts` (whole), `lobby/OnlineLobbyConnection.ts` (whole), `Renderer.ts` 398–420
- Docs/evidence: `docs/ServerAuthoritativeMultiplayer.md`, `src/skirmish/multiplayer/LiveMatchJoining.md`, `Optimization Handoff/Evidence/8hz-arm-qualification-20261014.md`, `multiplayer-pipeline-profile-20261014.md`, `live-match-freeze-20261015.md` 1–30
- Tests consulted: `tests/skirmish/ClientStateFlow.test.ts`, `LiveMatch.test.ts` 245–315, `PublicationQueue.test.ts` (names), `OnlineMatchTransport.test.ts` 1–60

Scratch measurements (scratchpad, not in repo): `measure-wire2.mts` grew a Mediterranean 500×250 match with 3 seats + 14 AI + 30 tribes (47 factions, Napoleonic, tech speed 3) for 3000 ticks under the working tree, then measured 39 publications; `probe-sections.mts` attributes compressed bytes per packet section; `cadence.mjs` replays the `advanceWorld` publish gate; `flow-loop.mts` reproduces the recovery loop. The 8 Hz qualification checkpoint `out/8hz-20261014/dense-scenario.v8` no longer restores under the working tree (`Manpower.ts:153` recipe validation), so the reference-load numbers below are extrapolated from the 900-squad run plus the ARM qualification evidence.

## How it works today

**Threads per match.** The coordinator process (one Node main thread for all matches and sockets) owns a `LiveMatch` per match. Each `LiveMatch` owns a `ReservedMatchWorker` (`worker_threads`, 384 MB old-gen cap, `ReservedMatchWorker.ts:18-24`), which runs `serverMatchWorker.ts` with the single `Skirmish` instance. That worker spawns its own `SnapshotEncodingWorker` (256 MB cap, `SnapshotEncodingWorker.ts:9-11`) running `snapshotEncoderThread.ts`. So one match = 3 threads: coordinator (shared), simulation, encoder. Three matches on the 2-CPU host = 7 threads.

**Tick loop.** `LiveMatch.scheduleTick` (`LiveMatch.ts:657-677`) wakes at `nextTickAt` (setTimeout, or setImmediate when overdue); a 50 ms coordinator interval (`CoordinatorServer.ts:453-492`) is a backstop. `advanceWorld` (`LiveMatch.ts:678-774`) always requests `ticks: 1`; when more than `MAX_ADVANCE_TICKS` (4) ticks of clock debt accumulate, `nextTickAt` is reset to `now − 2 ticks` (`LiveMatch.ts:723-726`), i.e. game time is dropped rather than caught up. Commands are spliced out of a shared 100-entry queue per advance (`LiveMatch.ts:738-740`; cap at `LiveMatch.ts:560`).

**Publish decision.** A background publication is requested when both wall clock and simulation clock have passed their next 200 ms boundary (`LiveMatch.ts:731-737`). Replaying that gate (`cadence.mjs`) gives a strict 125/250 ms alternation (40 %/60 %) at nominal pace, mean 200 ms; under 1.5× overload the gaps become 187/374 ms (3.3 Hz), under 2× 250/500 ms (2.5 Hz). Inside the worker, `publish` is also forced when any command executed or a deferred command's lead cohort committed in that tick (`serverMatchWorker.ts:282`).

**Capture (simulation thread, synchronous).** `capture()` (`serverMatchWorker.ts:67-73`) calls `match.replicationSource()` (`Simulation.ts:5575-5582`: borrows live arrays, no copies, but `expansion.snapshot()` at `Expansion.ts:1886-1925` builds the entire metadata object every time) and `SnapshotEncoder.encode` (`SnapshotCodec.ts:208-407`). The encoder keeps **one shared cursor** per journal (tiles `TileChangeJournal`, squads/ships/buildings `EntityChangeJournal`, resources, barriers, metadata revisions) and emits: changed tile `(index, owner|claims<<8|progress<<16)` pairs; changed squad rows as `Int32Array` stride 14 + order rows stride 8; building changes stride 5; removed-id arrays; `players` (all, every time, `SnapshotCodec.ts:390`); `expansion` metadata keys whose revision changed or which have no revision (`SnapshotCodec.ts:166-177`); trader motion (Float64 stride 4, every trader) + upserts for changed trader details (`TraderStream.ts:51-67`); and `details` (`SnapshotDetails.ts:191-331`): a `Float64Array` stride 30 per changed squad, stride 22 per changed ship, stride 7 per changed building, 15 per volley, an interned `strings` table, and — for every squad that has manpower/formation/weapon state, i.e. every squad in `ages-v1` — one **JSON string** of its nested detail objects produced by `SquadDetailCache.encode` (`SnapshotDetails.ts:123-176`), cached by `Object.is` identity of 14 inputs. Formation slot geometry goes through a reference table (`FormationSlotStream.ts`). Entities change-tracking is driven by `EntityCollection` hooks (`Simulation.ts:370-398`), so any `update/setOwned` marks the row changed; a moving squad changes every tick.

**Encode (encoder thread).** `SnapshotEncodingWorker.encode` posts the packet with all typed arrays transferred (`snapshotTransfers`, `SnapshotCodec.ts:409-427`) and the object parts structured-cloned (`SnapshotEncodingWorker.ts:44`). `encodeState` (`StateCodec.ts:340-380`) walks the object (`pack`), JSON-stringifies the metadata, RLE-codes large u8/u16 arrays, concatenates everything into one buffer (one copy), gzips it through `CompressionStream` and SHA-256s the uncompressed bytes. The result (`{hash, binary}`) is posted back; the sim thread's `PublicationQueue` (capacity 2, `PublicationQueue.ts:12`) then forwards `{tick, packet}` to the coordinator (`serverMatchWorker.ts:82-84`) — a structured-clone copy, no transfer.

**Fan-out (coordinator).** `LiveMatch.broadcast` → `sendState` (`LiveMatch.ts:871-886`) consults each client's `ClientStateFlow` (window 4 unacknowledged frames, `ClientStateFlow.ts:8`); accepted frames get `flowEpoch` and go to `CoordinatorServer.send` (`CoordinatorServer.ts:194-212`), which builds a per-client binary frame (`encodeSnapshotFrame`: 8-byte header + JSON metadata + the shared gzip payload copied once per client, `SnapshotWireCodec.ts:20-30`) and `ws.send`s it with `perMessageDeflate: false` (`CoordinatorServer.ts:183`). Compression is therefore **shared across subscribers**; only the ~60 KB copy and the socket write are per client.

**Client.** `OnlineLobbyConnection` decodes binary frames on the main thread (`OnlineLobbyConnection.ts:66`), `OnlineMatchSession` bounds pending states (8 / 16 MB, `OnlineMatchSession.ts:136-139`) and serializes them through `incoming`; `multiplayerStateWorker.ts` gunzips, hashes, parses, validates and applies the packet to `CanonicalStateStream` (which wraps `SnapshotDecoder` and retains the full canonical state), then builds a `PresentationState` that contains **the complete entity set** (`CanonicalStateStream.ts:143-151`) and posts it to the main thread, where `PresentationStateDecoder.apply` merges tiles and `Renderer.update` re-samples every squad (`Renderer.ts:410-414`). Each state is acknowledged with `match-state-applied` after decode (`OnlineMatchSession.ts:464-466`); a server-side `applied()` returning `"baseline"` or a client overflow triggers a `client-baseline` recovery (`LiveMatch.ts:887-916`). The renderer glides each unit from its currently drawn position to the new authoritative one over `spanTicks × 125 ms` (clamped 50–600 ms).

**Joining / rejoining.** `qualify` (`LiveMatch.ts:308-415`) takes a match-wide `sync` lock; `advance()` returns early while it is held (`LiveMatch.ts:639-645`), so the whole match pauses; the worker's `join-barrier` captures an aligned shared delta plus a reset baseline at the same tick (`serverMatchWorker.ts:202-227`), the newcomer decodes, acknowledges (`acknowledge`, `LiveMatch.ts:416-448`) and the match resumes. Budget: 2 s cooldown and 15 s of pause per rolling minute (`LiveMatch.ts:369-377`), phase timeouts 30 s / 15 s (`LiveMatch.ts:476`).

### Command-to-pixels latency chain (8 Hz, nominal load)

| Stage | Where | Best | Typical | Worst (overloaded tick) |
|---|---|---:|---:|---:|
| Browser → coordinator (JSON over WS) | `OnlineMatchSession.ts:190-196` | RTT/2 ≈ 10 ms | 30 ms | 80 ms |
| Zod parse + `admitCommand` queue | `CoordinatorServer.ts:247`, `LiveMatch.ts:551-575` | 0.2 ms | 0.5 ms | 2 ms (big `buildingIds`) |
| Wait for next advance dispatch | `LiveMatch.ts:657-677, 738` | 0 | 62 ms (uniform 0–125) | 125 ms + remaining tick |
| Worker queue + command apply | `serverMatchWorker.ts:124, 251-265` | 1 ms | 2 ms | 10 ms |
| Deferred planning (move/army/sail orders) | `CommandApplications.ts:70-74` | 0 (executed in tick) | +1 tick (125 ms) | +N ticks |
| `match.step()` for the tick | ARM evidence | 60 ms | 96 ms | 255 ms (p99) |
| Capture on sim thread | measured 4 ms PC @ 900 squads | 4 ms | ~12 ms ARM | 40 ms (baseline) |
| Encoder thread (pack/JSON/gzip/hash) | measured 13 ms PC; ARM evidence 28 ms | 13 ms | 28 ms | 100 ms (baseline) |
| Encoder result waits for sim thread to be idle | `serverMatchWorker.ts:82-84` | 0 | ~50 ms | 125 ms (whole next tick) |
| Worker → coordinator clone, fan-out frame copy, `ws.send` | `CoordinatorServer.ts:200-205` | 1 ms | 2 ms | 5 ms |
| Coordinator → browser | | RTT/2 ≈ 10 ms | 30 ms | 80 ms |
| `incoming` chain wait (previous decode) | `OnlineMatchSession.ts:144-153` | 0 | 5 ms | 25 ms |
| Worker decode + apply + project | measured 6.5 + 8.6 + 3.6 ms PC | 19 ms | 25 ms | 60 ms (laptop) |
| Worker → main structured clone of full view | measured 20 ms PC @ 900 squads | 10 ms | 20 ms | 40 ms |
| `present()` / renderer update + next rAF | `OnlineMatchSession.ts:260-282`, `Renderer.ts:400-420` | 8 ms | 15 ms | 30 ms |
| Visual glide to the new position | `RenderSamples.ts:43-47`, `Renderer.ts:413-414` | 125 ms | 200 ms | 250 ms |
| **Receipt visible (ack only)** | | ~100 ms | ~225 ms | ~450 ms |
| **First pixel of the new state** | | ~250 ms | ~400 ms | ~800 ms |
| **Unit visibly at the published position** | | ~375 ms | ~600 ms | ~1050 ms |

This explains the qualification's 225 ms mean / 338 ms p95 order receipt: ~30 ms transit + ~62 ms dispatch wait + ~96 ms tick + occasional one-tick deferral. The receipt is carried in the advance result, not the publication, so it does not include the encoder hop; the *state* arrives one encoder round trip (28 ms) plus up to one tick (because the encoder's result is only forwarded when the sim thread yields) later, and the renderer then takes another publication interval to glide there.

## Strengths

- Clear authority boundary: the browser only sends commands and decodes; `playerId` is overwritten with the authenticated seat (`LiveMatch.ts:567-570`) and every mutating command re-checks ownership in the domain (`Simulation.ts:1258, 1266, 1307, 1390, 1420`).
- Delta replication is journal-driven, not diff-driven: `LatestChangeIndex` keeps only the latest change per id in revision order, so a 5 Hz delta costs O(changed) and never O(entities); overflow falls back to an exact full scan rather than a wrong delta (`SnapshotCodec.ts:128-133, 221`).
- Compression and hashing run once per publication on a separate thread and are shared across all subscribers; per-subscriber cost is a memcpy (`SnapshotWireCodec.ts:26-29`). Typed arrays are transferred, not copied, into the encoder.
- Bounded everything: command queue 100, dedupe set 2048, worker request backlog 8, encoder backlog 2, publication queue 2, client window 4, client pending states 8 / 16 MB, socket buffer 8 MB, heartbeat, rate limit 50/s, payload 512 KB. Baseline tiles are sparse (`SnapshotCodec.ts:229-235`), so a 1000×1000 map does not produce a multi-MB first packet.
- The decoder validates every untrusted packet before committing (`SnapshotDecoder.validate`, `SnapshotCodec.ts:447-474`; `validateSnapshotDetails`), and the canonical stream rejects out-of-order ticks and dimension changes.
- `PublicationQueue` keeps the cursor honest: a skipped capture does not advance the delta cursor, so the next publication includes the skipped changes (`PublicationQueue.ts:16-19`).
- Diagnostics are first class (per-phase timings, retained bytes, encoder memory, cache hit rates) and the handoff evidence is reproducible.

## Issues

Severity: critical / high / medium / low. Confidence: high = traced end to end or reproduced; medium = traced, magnitude estimated.

### N1 — Recovery feedback loop: one skipped frame becomes a stream of full baselines (high, high)
`ClientStateFlow.offer` sets `dirty = true` whenever it refuses a frame *because the client is recovering* (`ClientStateFlow.ts:17-27`), and `baseline()` only ORs `dirty` (`ClientStateFlow.ts:45-50`). The first `applied()` for the baseline then returns `"baseline"` (`ClientStateFlow.ts:35`), and `LiveMatch.stateApplied` calls `resync()` again (`LiveMatch.ts:887-890`). The server does not pause publications during a recovery, and the worker serializes `client-baseline` behind in-flight publications and `publications.flush()` (`serverMatchWorker.ts:195, 228-231`), so every publication refused during the window is already contained in the baseline; the extra recovery is pure waste. Reproduced with `flow-loop.mts`: `beginBaseline(); offer(4)→false; baseline(5,false); applied(5)→"baseline"` and it repeats for as long as one publication lands per recovery window. The recovery window (worker queue wait up to a tick + flush + 38 ms capture + ~100 ms encode at 900 squads, more on ARM) is longer than the 125/250 ms publication gap, so the loop is the expected outcome, not a corner case. Each iteration costs the simulation thread a full capture (38 ms PC, ~100 ms ARM), the encoder a ~290 KB gzip, and the client a full decode/reset. Triggers: any client whose decode+present stalls > 4 frames (~0.5–0.8 s: GC, tab switch, slow laptop decoding the *initial* baseline while the server already publishes), or any client-side overflow (`OnlineMatchSession.ts:136-139`). `tests/skirmish/ClientStateFlow.test.ts:40-51` asserts this behaviour as intended ("retains missed publications during capture"), so it is a design error rather than a typo. The qualification saw "0 resyncs" only because its clients were fast PCs.

### N2 — Every rejoin pauses the whole match for every player (high, high)
`advance()` returns while `this.sync` is set (`LiveMatch.ts:639-645`); `qualify` acquires it for returning seats as well as newcomers (`LiveMatch.ts:348-386`). A reconnect is common: the heartbeat terminates a socket after one missed 5 s pong (`CoordinatorServer.ts:495-505`), the client then reconnects within 15 s and re-qualifies with a join barrier. Each barrier costs capture + encode + client decode + ack (≥ 0.5 s, several seconds on a laptop with a large map) during which 51 other factions freeze and commands are rejected (`LiveMatch.ts:557-558`). The pause budget (15 s per rolling minute, `LiveMatch.ts:369-377`) then refuses further syncs, and the client gives up after 15 s of retries (`OnlineMatchSession.ts:326-332`), kicking a legitimate player. At 8 humans this will happen several times per match. The pause is not required for correctness: the worker already serializes `join-barrier` between ticks, and the recovery path (`drainRecovery`) shows a baseline can be issued without pausing using flow epochs; only command admission for the newcomer needs to wait for its ack.

### N3 — `progression` (≈110 KB JSON) is resent on every publication (medium, high)
`Progression.step` bumps `revision` whenever any faction is researching or advancing (`Progression.ts:196`), i.e. every tick with 47 factions. `selectMetadata` therefore includes the whole `progression` record of all players on every publication (`SnapshotCodec.ts:166-177`). Measured mean 109,869 raw bytes per publication, the single largest metadata item. It compresses well (the `completed` id lists are repetitive), but it still costs structured-clone + JSON.stringify on the server and JSON.parse + structured-clone to the main thread on every client five times per second.

### N4 — Metadata without revisions and `players` are sent in full every publication (medium, high)
`replicationMetadata` (`Expansion.ts:1876-1885`) has no revision for `armies`, `inventories`, `production`, `recruitment`, `projectiles`, `aircraft`, `winners`, `deliveredGold`, `tradeSites`, `tradeCapturedValue`, `tradeLostValue`, `tradeEnemies`, `activeOffensives`, so `SnapshotCodec.ts:173` always includes them; `players` is copied unconditionally (`SnapshotCodec.ts:390`). Measured per publication at 47 factions: recruitment 35–37 KB, players 12.5 KB, inventories 8.5 KB, tradeSites 8.5 KB raw. Together with N3 the "idle floor" of a publication is ~75 KB raw / ~9 KB gzip even when no entity changed, i.e. ~45 KB/s per client at idle. At 52 factions and ~430 buildings these grow linearly.

### N5 — The browser main thread receives the complete entity set on every publication (high, high)
`CanonicalStateStream.presentationState` spreads `this.latest` (all squads, ships, buildings, players, volleys, expansion metadata) into the view (`CanonicalStateStream.ts:143-151`); `multiplayerStateWorker.ts:99-104` posts it (structured clone, only the sparse tile buffer is transferred). Measured: 1.2 MB JSON-equivalent and 20 ms of clone per publication at 900 squads on a desktop PC, before `PresentationStateDecoder.apply` and `Renderer.update` re-walk every squad (`Renderer.ts:410-420`). At 5 Hz that is a 20–35 ms main-thread stall every 200 ms — guaranteed dropped frames at 60 fps regardless of renderer speed, matching the handoff's "presentation snapshot decoding ~13 ms p95 17 ms". It scales with total entities, not with what changed or what is on screen.

### N6 — Encoder results are forwarded only when the simulation thread yields (medium, high mechanism / medium magnitude)
The encoder posts to the sim worker, whose `PublicationQueue` then posts to the coordinator (`serverMatchWorker.ts:82-84`, `PublicationQueue.ts:26-35`). If the encode (13–28 ms) completes while the next `match.step()` is running (60–255 ms), the publication waits for that step. With the earlier 4-tick batches the handoff measured 294 ms mean "encoding" elapsed; with `ticks: 1` the added delay is 0–125 ms (mean ≈ 50 ms at 96 ms ticks). A `MessageChannel` from the encoder thread directly to the coordinator removes this hop entirely.

### N7 — Publish-on-order degenerates to publish-every-tick with 8 humans (medium, high)
`serverMatchWorker.ts:282` publishes whenever any human command executed or any deferred cohort committed. With 8 active players nearly every tick qualifies, so publication becomes 8 Hz: the sim thread pays capture every tick (4 ms PC / ~12 ms ARM = ~10 % of the 125 ms budget), the encoder ~30 ms × 8 = 24 % of a core per match, and each client receives ~50 KB × 8 = 400 KB/s. The per-publication size barely shrinks when publishing every tick (measured 50 KB vs 54 KB) because ~40 % of squads change every tick anyway. The 5 Hz "background" cap is therefore not a cap under the target load.

### N8 — Rate limit is applied after `JSON.parse` + Zod, and receipts are exempt (medium, high)
`CoordinatorServer.ts:247` parses every frame (up to 512 KB, `:182`) before the per-session 50/s limit (`:297-308`), and `match-state-applied` / `match-sync-applied` bypass the limit entirely (`:303-305`). A guest token is free (`/guest`, 20 per IP per minute). One malicious socket sending 512 KB JSON frames at line rate makes the shared coordinator thread (which also runs every match's scheduler and fan-out) spend all its time parsing; three matches would stall together. Limit violations only send an error and never close the socket.

### N9 — `match-state-resync` has no cooldown: cheap full-baseline DoS (medium, high)
`CoordinatorServer.ts:337-338` → `LiveMatch.resync` (`:891-896`) accepts a new recovery as soon as the previous one completed. Each costs the simulation thread a full capture (38 ms PC, ~100 ms ARM at 900 squads — `encodeBaseline` creates a fresh encoder and packs details twice, see N12), the encoder ~100 ms, and 290 KB of egress per request. `RecoveryBaselineCache` does not help because `canonicalVersion` is bumped on every advance (`serverMatchWorker.ts:236`). One client looping resyncs can take ~30–50 % of the sim thread of its match.

### N10 — Join/rejoin baseline traffic and the heartbeat make N1/N2 frequent (medium, high)
Heartbeat `terminate()` after one missed pong in a 5 s cycle (`CoordinatorServer.ts:495-505`) means a 5–10 s laptop stall/sleep/radio hand-over drops the socket; the client's `reconnectWindowMs` is 15 s (`OnlineMatchSession.ts:155`). Each reconnect runs the full barrier of N2. Tolerating 2–3 missed pongs (15 s) would remove most of these.

### N11 — Float64 detail rows and JSON detail strings dominate raw size (medium, medium)
Per changed squad the packet carries 56 B (`Int32` core) + 32 B per order + 240 B (`Float64` stride 30, `SnapshotDetails.ts:31-52`) + 32 B motion + a JSON detail string (mean ~460 B; 188 KB per publication for 406 squads in the 5 Hz run) + formation slot coordinates. Nearly every Float64 field is a small integer, tick, id or NaN; the JSON string repeats key names (`"manpower":{"model":"soldiers","capacity":...`) per squad. `SquadDetailCache` misses ~31 % of rows per publication (6144 hits / 2741 misses) because `formation` and `weaponState` are replaced for every moving/fighting squad. Compressed, the picture is different from raw: the Float64 detail rows gzip to 3 KB (Int32 would be 2.9 KB), whereas the unquantised floats in `squadMotion` (`SnapshotDetails.ts:336-345`: heading/targetHeading in radians, speed), formation slot coordinates (`FormationSlotStream.ts:64-72`) and trader x/y (`TraderStream.ts:58`) are ~16 KB of a 53 KB frame (30 %) because arbitrary doubles do not compress. Quantising heading to 1/10,000 rad (Int16), speed and coordinates to fixed-point Int16/Int32 is the cheapest bandwidth win in the format.

### N12 — `encodeBaseline` packs details twice (low, high)
`SnapshotCodec.ts:200-205`: a throw-away `SnapshotEncoder` encodes the full packet including `packSnapshotDetails` with a fresh cache (version 4, inline slots), then `packet.details` is replaced by a second `packSnapshotDetails` with the live cache. Baseline capture (38 ms at 900 squads) could be roughly halved.

### N13 — SHA-256 over the uncompressed payload on both ends is redundant (low, high)
`StateCodec.ts:377` hashes ~500 KB–1.2 MB per publication on the server and the client re-hashes it (`StateCodec.ts:416-417`). TLS/TCP already guarantee integrity; the hash is a leftover of the checkpoint format. ~1 ms per side per publication, more on phones.

### N14 — `CompressionStream` gzip is the slowest available codec (low, high)
`StateCodec.ts:370-374` uses the WHATWG stream API (chunked, Promise-based). On the probe packet `zlib.gzipSync` level 6 took 1.2 ms and `deflateRawSync` level 1–3 0.3–0.4 ms for 75 KB; the ARM evidence lists 19 ms compression per publication. `deflateRawSync({level: 3})` plus `DecompressionStream("deflate-raw")` on the client would cut server CPU with ~10 % size cost.

### N15 — `Expansion.snapshot()` rebuilds every metadata section before `selectMetadata` discards most of it (low, high)
`Expansion.ts:1886-1925` copies armies (`Armies.ts:1213-1220`), computes `tradeSites`, `tradeEnemies` (O(players²)), spreads receipts etc. on every capture; `selectMetadata` then keeps only revised keys (`SnapshotCodec.ts:166-177`). Capture was 4 ms at 900 squads on a PC; on ARM at 52 factions this is ~10–15 ms of sim-thread time per publication.

### N16 — Any encoder rejection kills the match (low, medium)
`PublicationQueue` turns any `encode` rejection into `failed()` (`PublicationQueue.ts:31-34`) which posts `fatal` (`serverMatchWorker.ts:84`) and `ReservedMatchWorker` terminates the worker (`:44`). Today the only sources are encoder death/timeout and `Snapshot encoder backlog exceeded` (`SnapshotEncodingWorker.ts:36`), which is excluded only because every non-queue caller flushes first; a future caller that forgets `publications.flush()` will end live matches under load. A size-limit error ("Checkpoint exceeds …") is also fatal rather than degrading to a baseline.

### N17 — Documentation drift (low, high)
`docs/ServerAuthoritativeMultiplayer.md:11-13` says 20 ticks/s and "catches up at most four ticks"; `LiveMatchJoining.md:35-37` says a five-second sync deadline and 20 Hz. Code: `TICKS_PER_SECOND = 8` (`Protocol.ts:18`), single-tick advances with a clock-debt clamp (`LiveMatch.ts:717-726`), 30 s/15 s phase timeouts (`LiveMatch.ts:476`).

### N18 — Coordinator stringifies the whole lobby state 20×/s and broadcasts the directory to in-match players every second (low, high)
`CoordinatorServer.ts:454, 488` compare `JSON.stringify(rooms.snapshot())` before/after every 50 ms clock tick; `publish()` (`:213-226`, interval `:494`) sends the complete directory plus per-guest match summaries to every socket, including players inside matches, once per second.

### N19 — No interest management (design, see Recommendations)
Every client receives every changed squad, ship, trader and building on the map irrespective of viewport or fog (`SnapshotCodec.ts:125-160` selects by journal only). With one shared cursor this is structurally required; per-viewer culling needs per-client cursors or a tiered scheme.

## Bandwidth and latency table

Measured on the 47-faction Mediterranean run at tick 3000 (896 squads, 93 traders, 260 buildings, 12 ships; desktop PC). Reference-load column extrapolates linearly in entities to the ARM qualification population (1100 squads, 300 warships, 630 traders, 430 buildings, 52 factions) and matches the handoff's observed 236–322 KiB/s per client.

| Quantity | Measured (900 squads) | Reference load (est.) | Idle (no entity change) |
|---|---:|---:|---:|
| Delta publication, raw | 522 KB | ~700 KB | 75 KB |
| Delta publication, gzip | 54 KB | ~65–75 KB | ~9 KB |
| Per client at 5 Hz | 270 KB/s (2.2 Mbit/s) | 330–375 KB/s (~3 Mbit/s) | 45 KB/s |
| Per client at 8 Hz (publish-on-order, N7) | 400 KB/s | 520–600 KB/s | — |
| Server egress, 8 clients, 5 Hz | 2.2 MB/s (17 Mbit/s) | 2.6–3 MB/s (21–24 Mbit/s) | 0.36 MB/s |
| Baseline (join / recovery), gzip | 290 KB | ~450 KB | — |
| Baseline capture on sim thread | 38 ms | ~100 ms (ARM) | — |
| Baseline encode | 99 ms | ~250 ms (ARM) | — |
| Delta capture on sim thread | 4 ms | ~12 ms (ARM) | ~3 ms |
| Delta encode (encoder thread) | 13 ms | ~28 ms (ARM, evidence) | ~3 ms |
| Client worker decode + apply + project | 6.5 + 8.6 + 3.6 ms | ~25 ms | ~8 ms |
| Worker → main clone of full view | 20 ms (1.2 MB equiv.) | ~30 ms | ~15 ms |
| Changed squads per 200 ms publication | 413 of 896 (46 %) | ~500 of 1100 | 0 |

Raw composition of a 5 Hz delta (means over 15 publications): squad detail JSON strings 188 KB, `expansion` metadata 169 KB (progression 110, recruitment 37, inventories 8.5, tradeSites 8.5), squad detail Float64 99 KB, squad core Int32 23 KB, orders 13 KB, players 12.5 KB, formation slots 11.5 KB, trader motion+upserts 4.6 KB, tiles 1.1 KB.

Compressed attribution (each section gzipped alone; second run, 609 squads / 468 changed rows, total frame 53,067 B — the per-section sum matches within 2 %):

| Section | Raw B | Gzip B | Share of frame | Note |
|---|---:|---:|---:|---|
| `details.squadMotion` Float64 (heading, targetHeading, speed) | 14,976 | 9,437 | 18 % | non-integral floats do not compress |
| squad detail JSON strings (459, mean 340 chars) | 180,700 | 8,542 | 16 % | key names repeated per squad |
| `expansion` metadata JSON | 221,386 | 7,554 | 14 % | recruitment 3,003; progression 1,657; tradeSites 706; inventories 628 |
| squads core Int32 (stride 14) | 26,208 | 6,185 | 12 % | x/y/ids/ticks |
| formation slot coordinates Float64 | 20,952 | 5,325 | 10 % | 48 upserts |
| `details.squads` Float64 (stride 30) | 112,320 | 3,088 | 6 % | as Int32: 56,160 raw / 2,892 gzip — Float64 is a raw/CPU cost, not a bandwidth cost |
| tiles U32 pairs | 8,104 | 2,605 | 5 % | |
| orders Int32 (stride 8) | 14,976 | 2,165 | 4 % | |
| players JSON | 12,381 | 1,885 | 4 % | all 47 players every publication |
| trader motion Float64 + upserts | 4,853 | 1,444 | 3 % | |

Roughly 30 % of every compressed frame is unquantised floating-point geometry (motion headings/speeds, slot coordinates, trader x/y) and another 30 % is JSON (detail strings + metadata + players).

Latency summary (see chain above): receipt ≈ 225 ms mean; first visible state change ≈ 400 ms typical, 800 ms under p99 ticks; unit at published position ≈ 600 ms typical because of the one-interval glide.

## Recommendations

Prioritised by (impact ÷ effort) for the 8-human / 52-faction target. Effort: S ≤ 1 day, M 2–4 days, L ≥ 1 week.

1. **Fix the recovery loop (N1) — S.** In `ClientStateFlow.offer`, when `this.recovering` is true return `false` *without* setting `dirty` (a baseline is already pending and will cover the frame); keep `dirty` only for the window-exhausted case. Update `ClientStateFlow.test.ts:40-51` to expect `"credit"`. Optionally pause offers to a recovering client at the `LiveMatch` level so `applied` can never see a stale credit. Expected gain: removes repeated 290–450 KB baselines and 40–100 ms sim-thread captures per hiccup; prevents the death spiral under overload.

2. **Rate-limit before parsing; cap and count receipts; cool down resyncs (N8, N9) — S.** Check `session.count` and `data.length` (e.g. 8 KB for anything but `match-command`, 128 KB for commands) before `JSON.parse`; close the socket after N violations; give `match-state-applied` its own budget (e.g. 20/s); enforce a per-client resync cooldown (≥ 2 s) and a per-minute cap, serving a cached baseline when two clients recover within the same tick (make `RecoveryBaselineCache` invalidate per *publication* rather than per advance).

3. **Stop pausing the match for rejoins (N2, N10) — M.** Treat a returning or joining seat like a recovering client: the worker's `join-barrier` already captures aligned packets atomically between ticks; send them with a new flow epoch and keep advancing. Hold only the newcomer's command admission until its `match-sync-applied`, and on timeout revert the controller to AI without touching other players. Relax the heartbeat to 3 missed pongs. Expected gain: no global freezes; the 15 s/min pause budget becomes unnecessary.

4. **Incremental main-thread presentation (N5) — M/L.** Have `presentationState` post only rows that changed since the last *presented* sequence (the worker already knows: `SnapshotDecoder` applies deltas; keep a per-id "changed at sequence" map like `dirty` for tiles) plus removals, and keep a persistent entity store on the main thread that `Renderer.update` mutates in place. Expected gain: main-thread cost per publication from ~20–35 ms to ~2–5 ms at 900 squads; removes the 5 Hz frame hitch. This is the single biggest perceived-smoothness win and is independent of the server.

5. **Give metadata proper revisions and send player deltas (N3, N4) — M.** (a) Bump `Progression.revision` only on state transitions (research start/complete, age change), and expose per-player revisions so `selectMetadata` can send `progression[playerId]` patches; research progress ticks can be derived client-side from `remainingTicks`/tick. (b) Add revisions for `recruitment`, `inventories`, `tradeSites`, `armies`, `deliveredGold` etc., or move the hot per-tick scalars (inventory totals, job remainingTicks) into a small typed array keyed by owner/job id. (c) Send `players` as a change-list (`revision` per player). Expected gain: idle floor from ~75 KB raw / 9 KB gzip to < 10 KB raw / ~2 KB gzip; 20–30 % off a busy delta; a third less server-side cloning and client-side parsing.

6. **Route encoder results straight to the coordinator (N6) — S/M.** Create a `MessageChannel` in `serverMatchWorker` at `prepare`, transfer one port to the encoder thread and one to the coordinator (`ReservedMatchWorker`) in the `prepare` reply; the encoder posts `{tick, sequence, packet}` directly and transfers `binary`. The sim thread only assigns `captureSequence`. Keep the `PublicationQueue` accounting via a tiny "done" message. Expected gain: 0–125 ms (mean ~50 ms) off every state's latency, no sim-thread involvement in result forwarding.

7. **Cap command-triggered publications (N7) — S.** Allow at most one extra publication per 125 ms *and* only when the previous encode has completed (encoder idle), e.g. `publish = request.publish || (commandTriggered && publications.pending === 0 && tick − lastPublishedTick ≥ 1)`. With 8 humans this bounds the rate at ~6–8 Hz only while the encoder keeps up and never stacks. Alternative with better latency: publish every tick but make deltas cheap (items 5, 8).

8. **Compact the squad detail encoding (N11) — M.** Two independent steps, in order of payoff per effort: (a) **quantise the floats** — `squadMotion` heading/targetHeading as Int16 in 1/10,000 rad, speed as Int16 fixed-point, formation slot coordinates and trader x/y as Int32 (or Int16 relative to the carrier); measured share ≈ 30 % of the compressed frame, expected ≈ 20 % smaller frames for ~1 day of work (encoder, validator, decoder, tests). (b) Replace the per-squad JSON string with typed columns: `manpower` (7 numbers), `weaponState` (2 channels × 4 numbers + shared tick), `formation` scalars (≈12 numbers, shape as enum) and keep only genuinely sparse objects (`meleeStrike`, `chargeImpact`, `cavalry*`, `aiWithdrawal`, `occupancy`) as interned JSON; convert `details.squads`/`ships`/`buildings` from Float64 to Int32 (all values are ints, ticks, ids or NaN/Infinity sentinels — the probe found 0 of 14,040 values outside Int16 range and 16 non-integral). (b) mostly buys raw size (−45 %), clone time and JSON.parse CPU rather than bandwidth (~10–15 % compressed). Together with step 5 the frame should drop from ~54 KB to ~30–35 KB and client decode+clone by roughly half.

9. **Switch to `deflateRawSync` level 3 and drop the hash on the live path (N13, N14) — S.** Keep the hash only for durable checkpoints (`binary === false`). Expected gain: ~10–15 ms of encoder time per publication on ARM; ~1–2 ms per client decode.

10. **Interest management (N19) — L, do after 4/5/8.** Feasible without touching the sim: keep the shared cursor for *authoritative facts* (ownership tiles, buildings, players, metadata) and split the per-tick *entity* rows into two tiers: (a) the client's own faction plus anything inside a client-reported viewport/fog mask at full rate, (b) everything else at 1 Hz with only `x, y, troops, playerId` (the minimap tier). Implementation: `SnapshotEncoder.selectEntities` already yields the changed-row set; add a per-client `Uint8Array` visibility mask (map tiles ÷ 32, updated by a `viewport` client message ≤ 2/s) and encode tier (a) per *mask bucket* (clients with identical masks share an encode) with the remaining rows deferred into a per-client "owed" set that is flushed when the entity enters the mask (full row) or at the 1 Hz tier. Trade-offs: per-client encoder state (owed sets) and up to 8 gzip runs per publication instead of one; cheating is unaffected because the server decides visibility; spectator-style "see everything" clients still get the full feed. Expected gain at 52 factions: 60–80 % less entity payload per client when the camera covers < 20 % of the map, and client decode cost proportional to the view.

11. **Dedupe `Expansion.snapshot()` work (N15, N12) — S.** Build only the keys `selectMetadata` will emit (pass the revision map into `snapshot()`), and make `encodeBaseline` reuse the live `detailCache` once. Expected gain: 30–50 % of capture time; halves baseline capture.

12. **Tick-aligned cadence (design) — S.** Replace the dual wall/sim gate with "publish on every second tick" (exact 250 ms) or the 2-1-2 pattern explicitly; the renderer's `spanTicks` glide already handles variable spans. Removes cadence jitter without changing rate.

13. **Docs (N17) — S.** Update the two docs to the 8 Hz contract, the clock-debt policy and the real sync timeouts.

## Open questions

- Was a server-initiated baseline loop ever observed in production? `match-runtime-diagnostics.replication.baselineCache.misses` climbing while no client reports a `recoveries` increment would confirm N1 in the field.
- How long did real join barriers pause matches in the public b1.5.7 games (the `pauses` array is not logged)? That number decides how urgent N2 is versus the 8-human target.
- Is the ~460 B JSON detail string per squad still needed by the renderer at full fidelity for *other* factions' squads, or could enemy squads carry a reduced detail set (manpower + formation shape only)? That decides how much item 8 vs item 10 should carry.
- The qualification fixture cannot be restored under the working tree (`Manpower.ts:153`); is there a plan to keep a restorable dense fixture per balance revision so bandwidth/latency numbers remain comparable?
- Does the Oracle egress plan tolerate ~25 Mbit/s sustained for one 8-human match (three matches ≈ 75 Mbit/s)? If not, item 10 moves ahead of item 8.
