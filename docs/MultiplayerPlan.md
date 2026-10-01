# Multiplayer plan for Age of Fronts

The first multiplayer release should use the existing skirmish domain on an
authoritative server, with the browser projecting its snapshots through MVVM.
The homepage and game client stay on the Render Static Site. A separate Web
Service owns lobbies, player sessions, match execution, and network synchronization.

This is an implementation plan based on the current repository, not a claim that
multiplayer exists or has passed runtime validation. The current static build still
starts a local AI match directly.

## Confirmed first release requirements

| Requirement    | Confirmed behavior                                     |
| -------------- | ------------------------------------------------------ |
| Map selection  | World, Four Islands, Heightmap · Test 1                |
| Mode           | Free for all                                           |
| Match capacity | 20 total faction slots                                 |
| Human minimum  | 2 humans                                               |
| Countdown      | 60 seconds                                             |
| Start trigger  | Lobby fills with humans or the countdown expires       |
| Empty seats    | AI fills the remaining seats when the roster is frozen |

Two humans produce a match with 18 AI factions; 20 humans produce a match with
no AI replacements. AI does not occupy the public human queue while players are
still joining. The first release must honor the total faction budget; the current
optional tribes cannot silently add extra factions beyond those 20 slots.

The user flow is map selection, joining a suitable lobby for that map, seeing its
human roster and authoritative countdown, loading the same battlefield, and playing
the match. Training Square remains available for local development; it is outside
the requested public multiplayer map selection.

## Existing code that can be retained

`src/skirmish/Simulation.ts` owns domain rules through `Skirmish.applyCommand` and
`Skirmish.step`. The domain already has seeded randomness and separates gameplay
from canvas rendering. `worker.ts` currently runs it at 20 ticks per second in each
player's browser. This simulation should remain the gameplay authority, moved behind
a server application adapter rather than rewritten inside WebSocket handlers.

`SnapshotCodec.ts` already projects presentation data into typed buffers and
tile/building deltas. Its worker messages are useful inputs to a network design;
they are not a complete WebSocket protocol or a saved game format.

The inherited OpenFront server has lobby, roster, ingress, authorization, and
reconnection concepts worth inspecting. Its `GameServer.endTurn` broadcasts
OpenFront intents and turn history, with client synchronization and consensus
machinery. It does not run `Skirmish`. Running `start:server` therefore does not
make this game multiplayer. Do not force skirmish commands into OpenFront schemas
or inherit its external authentication, worker-port routing, or matchmaker dependencies
without a deliberate adapter and deployment design.

The current `MatchOptions.aiCount` and player creation assume one human faction.
The client also assumes `playerId === 1` and `players[0]` across `main.ts`, the
renderer, control groups, and several view models. All local-player assumptions
must become session-bound identity before more than one browser can control
different factions correctly.

## Ownership through DDD and MVVM

| Layer          | Responsibility                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Lobby domain   | Admission, seats, phase transitions, frozen roster, start eligibility                                  |
| Match domain   | Existing skirmish rules, ownership, command rejection, AI, combat, victory                             |
| Application    | Join or create a lobby, schedule countdown and ticks, bind identities, start matches, recover sessions |
| Infrastructure | HTTPS/WSS, clock, map files, worker threads, persistence, hosting, metrics                             |
| View models    | Project map cards, roster, countdown, connection state, own faction, HUD, and match results            |
| Views          | Render those projections and dispatch user actions                                                     |

Introduce a transport/application port consumed by the gameplay presentation.
Local play uses a worker adapter; multiplayer uses a socket adapter. Both deliver
read-only snapshots and command outcomes. Views must not decide who owns units,
when a lobby starts, whether a command is legal, or who won.

An explicit `localPlayerId` must flow through view models, selection, control
groups, cameras, friendly/enemy styling, recruitment, technology, and victory UI.
Recursive view-model construction must preserve that identity too. A global
replacement of the literal `1` would confuse faction IDs with unrelated constants.

## Build the lobby and session foundation

Create a server-owned lobby aggregate with explicit states such as waiting,
countdown, loading, active, finished, and cancelled. Joining and leaving must be
idempotent. Admission and the transition to a frozen roster must be serialized so
simultaneous joins cannot oversubscribe the twentieth seat or start two matches.

Recommended countdown semantics, to confirm before implementing: start the
60-second deadline when the second human joins. If the connected human count drops
below two before roster freeze, return to waiting and reset the countdown. A full
human lobby freezes immediately. Other connected humans continue joining until
freeze. Clients display a server timestamp adjusted for clock offset; their local
timer never authorizes a match start.

When the roster freezes, fill vacant seats with AI and publish one match manifest:
match ID, protocol version, build/ruleset version, map and size, terrain/content
hashes, seed, roster, player assignment, and mode. Load and validate map data on
the server. Browsers cannot substitute their own terrain, forest cover, seed, costs,
or faction assignment.

Use a bounded map-loading readiness barrier before the first playable tick. A
player with slow loading must not silently miss the start. Define a load timeout,
replacement/cancellation policy, and whether a frozen human seat can become AI;
these choices remain open. A minimum of two humans must still be enforced according
to the agreed start policy.

A server-issued guest session is sufficient for the initial casual release if
chosen. Bind its unpredictable resume credential to a stable participant and one
faction. Validate socket origin and ticket expiry; handle duplicate tabs without
creating a second seat. Keep raw session credentials out of logs and public roster
messages. Accounts, bans, progression, and ranking can be added behind an identity
port without changing faction ownership.

For each map, join an existing eligible lobby before creating another. Use an
idempotent join request and a stable lobby ID so retries do not split the population.
Treat leaving, an abrupt disconnect, and a duplicate connection as distinct events.
Keep all lobby membership and countdown rules on the server.

## Run one authoritative simulation per match

Replace the implicit one-human-plus-AI constructor input with an explicit frozen
roster of human and AI participants. Preserve existing domain validation, roster
limits, and map spawn constraints. Verify valid separation and reachable spawn
locations for all 20 factions on each approved map.

Run the simulation in Node worker threads or isolated match processes so pathfinding
and AI cannot block lobby HTTP traffic or WebSocket heartbeats. Start with a bounded
number of matches per host. Worker allocation and admission must follow measured
CPU and memory budgets; one worker per match is an ownership boundary, not a promise
of unlimited concurrency.

The server assigns command order and application tick. A wire command carries a
sequence/request ID and payload; the session supplies the acting faction. Validate
message shape, lengths, numeric bounds, entity ownership, phase, rates, and domain
rules before acceptance. Never authorize a player using the payload's `playerId`.
Deduplicate retries and acknowledge accepted or rejected commands consistently.
Keep the accepted command log suitable for diagnostics and deterministic replay.

The server owns AI, resources, movement, research, combat, elimination, and victory.
Remove unilateral restart, pause, and speed controls from public matches. Local AI
mode can retain them through its separate adapter. Free-for-all victory must be
consistent for every participant; clarify whether temporary diplomacy is allowed
and how it interacts with the existing allied-conquest feature before implementation.

Use a fixed 20-tick simulation schedule with explicit overload handling. Rendering
FPS and network snapshot frequency remain independent. Do not skip gameplay steps,
let clients advance time, or claim capacity by slowing the simulation invisibly.

## Define the network and recovery contracts

Use versioned HTTPS endpoints for map/lobby discovery and session admission, plus
WSS for lobby changes, commands, acknowledgements, and match snapshots. Separate
wire schemas from browser worker messages and domain types. Keep protocol-version
and content-version mismatches visible and actionable.

The current codec relies on in-process typed arrays and prior decoder state. Add
binary framing or an explicit tested serialization format, snapshot sequence,
server tick, and baseline identifiers. A late join or reconnect requires a complete
reset snapshot before subsequent deltas. Do not share one stateful encoder across
unrelated client baselines.

Implement bounded queues and backpressure. A slow connection must not retain an
unbounded history or stall the simulation. Dropping a delta requires rebuilding a
valid baseline rather than continuing an invalid chain. Limit queued command bytes,
snapshot bytes, retained replay history, and catch-up work. Measure bandwidth at the
actual map, faction, squad, ship, and building limits before selecting snapshot rates.

Reuse the current visual interpolation on authoritative snapshots. Immediate
selection and order markers can respond locally while gameplay waits for server
acceptance. Add prediction only if latency measurements justify it and reconciliation
is specified; clients cannot become a second gameplay authority.

Add heartbeats, disconnect detection, exponential reconnect backoff with jitter,
and a resume handshake carrying the last acknowledged sequence. A returning player
must regain the same faction and receive valid state. Specify reconnect grace,
orders during absence, AI takeover, and when a disconnected faction is forfeited.
Those policies remain open; do not silently turn a network interruption into a loss.

Ordinary socket reconnection and recovery after a host restart are separate problems.
`SnapshotPacket` omits pathfinding state and other domain internals and cannot restore
an authoritative match. For restart recovery, design a versioned complete checkpoint
including RNG state, orders, AI state, scheduled work, timers, and all gameplay data,
plus a command log or an equivalent recovery contract. Prove resumed execution
matches uninterrupted execution. If an early prototype cancels matches on host
failure, state that limitation explicitly; it is not a completed recovery feature.

## Hosting and operations

Keep `www.ageoffronts.com` on the static frontend. The backend can use an approved
subdomain such as `play.ageoffronts.com`, with the client configured to connect to
its public HTTPS/WSS endpoint. Render routes public HTTP and WebSocket upgrades to
one port; bind `0.0.0.0` and honor `PORT`. Avoid inheriting fixed localhost ports or
assuming Render exposes the old OpenFront nginx worker routing.

A paid, continuously available backend is the recommended public-release baseline.
Render's free web services sleep after 15 minutes without inbound traffic and take
about a minute to wake. Free hosting is suitable for a disposable prototype, not
the intended reliable lobby service. Choose compute size from benchmarks rather
than the nominal 20-seat count.

Start with one backend host and explicit capacity admission. Do not enable multiple
instances until there is a shared lobby directory and a single authoritative owner
for each match. Render assigns new WebSocket connections randomly across instances,
including reconnects; automatic scaling does not keep a player attached to one
match process. Design routing, ownership leases/fencing, and shared recovery data
before adding hosts.

Keep tick state in the match process. Use durable storage for the persistence
features actually selected: sessions/accounts as needed, results, checkpoints,
and recovery logs. Redis or another coordinator can hold transient directory/lease
data when scaling needs it; do not write the full simulation into a database every
tick or adopt a database only to make the lobby page work.

Handle deploys and shutdowns deliberately: stop admitting new matches, preserve or
drain running matches, close sockets with a resumable reason, and validate content
versions on reconnect. Render's shutdown window is finite, so draining alone cannot
preserve arbitrarily long games. Retain compatible client assets and provide a
recovery or cancellation policy for forced replacement and maintenance.

Record tick duration, tick lag, active matches, command rejection rates, heartbeat
latency, reconnects, snapshot bytes, queue pressure, memory, and errors. Add health
and readiness endpoints, structured logs without credentials, and alerts that
distinguish a healthy HTTP listener from an overloaded match worker.

## Capacity must be proven before public release

`docs/AgeOfFrontsSkirmish.md` records full-population trials with 4,000 squads,
1,280 ships, and 2,000 buildings that miss the 20-tick target, especially at
1000 × 500. This is prior repository evidence, not a new benchmark performed for
this plan. Buildings also have no gameplay count limit, so maximum population is
not a complete resource budget.

Benchmark the authoritative server on the selected Render compute plan with
2 humans plus 18 AI, a mixed roster, and 20 humans. AI replacement makes the
nearly empty human lobby a potentially expensive case. Exercise dense movement,
pathing, shipping, crowded combat, research, late-game structures, and sustained
match duration on all three maps. Establish tick, memory, bandwidth, and concurrency
limits from those measurements.

Keep 500 × 250 as the proposed first-release map size until measured results justify
another size. Optimize the identified bottlenecks without changing domain movement
or combat semantics. If a lower unit/building cap is necessary, request an explicit
gameplay decision; do not hide it in networking or renderer budgets.

## Implementation sequence and acceptance evidence

1. **Publish the static game.** Upload the repository, deploy the Static Site, test
   the service URL and source link, then move the custom domain and verify HTTPS.
2. **Introduce session identity and transport ports.** Preserve local play and its
   tests while removing the implicit first-player identity from multiplayer paths.
3. **Run a two-human authoritative match.** Validate command ownership, server
   map loading, binary/reset snapshots, local-player presentation, and consistent
   outcomes before building the public queue UI.
4. **Add the lobby domain and map selection views.** Implement the three requested
   map cards, serialized admission, countdown, loading barrier, frozen roster, and
   AI vacancies. Project them through lobby view models.
5. **Add reconnect and host recovery.** Exercise duplicate tabs, sequence gaps,
   delta resets, reconnect grace, process termination, and deploy/content mismatch.
6. **Prove 20-faction capacity.** Test all-human, mixed, and bot-heavy rosters,
   realistic latency, slow clients, long matches, all three maps, and concurrent
   lobbies on the chosen hosting resources.
7. **Complete public-release operations.** Verify deployment recovery, results,
   moderation needs, metrics, admission limits, cleanup, and secure guest/account
   policy. Then run a limited public playtest before increasing concurrency.

Meaningful automated coverage includes concurrent twentieth-seat joins, duplicate
join/leave requests, deadline versus final-seat races, minimum-player changes,
exactly-once start, bot roster counts, loading failure, spoofed player IDs,
foreign-unit commands, malformed packets, replayed command IDs, disconnect/resume,
slow consumers, and matching results across independent browser clients. Existing
OpenFront matchmaking tests do not prove the skirmish flow.

Decisions still needed before their implementation: countdown reset semantics,
world size, loading timeout, disconnect/AI-takeover policy, mid-match admission,
guest versus account identity, temporary alliances, result persistence, and host
restart recovery guarantees. The proposed choices above are recommendations,
not silently approved requirements.

## References

- [Current skirmish architecture and recorded limits](AgeOfFrontsSkirmish.md)
- [Static deployment instructions](RenderDeployment.md)
- [Render WebSockets and connection routing](https://render.com/docs/websocket)
- [Render free service limitations](https://render.com/docs/free)
- [Render Web Service port binding](https://render.com/docs/web-services#port-binding)
