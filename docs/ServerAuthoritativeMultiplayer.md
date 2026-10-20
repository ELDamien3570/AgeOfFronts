# Minimal server-authoritative multiplayer

Each admitted match owns one `ReservedMatchWorker`. That worker owns the only
`Skirmish` instance and applies validated player commands directly to it.
Browsers load map/rendering assets, send commands and decode presentation
packets in a small worker. They do not benchmark themselves for host election
or simulate an online world.

## Tick and publication path

- Target simulation rate: 20 ticks/sec
- Target presentation rate: 5 updates/sec, independent of tick dispatch
- One worker advance may be in flight; delayed dispatch catches up at most four
  ticks, so it cannot create an unbounded catch-up loop
- The command queue is capped at 100; recent duplicate command IDs are capped
  at 2,048. Commands always use the authenticated socket's player ID and still
  pass the command schema and domain rules
- Initial subscribers receive a reset presentation baseline. Neutral zero-value
  tiles are implicit, preventing a large empty map from producing a multi-MB
  initial packet. Subsequent ordered tile/building deltas and unit state retain
  the existing wire codec
- Network decompression/hash/parsing runs in `multiplayerStateWorker`; only
  presentation data reaches the rendering thread. Pending state packets are
  bounded. A client that cannot keep up leaves rather than accumulating an
  unlimited backlog or dropping dependent deltas

The active path does not create full simulation checkpoints, restore a second
world, generate/verify browser host proposals, run an economy event ledger or
transfer that history between worker and coordinator. Legacy serialization
helpers may still be exercised by their existing tests; the online runtime
neither imports nor calls them.

## Hosted custom matches

The public lobby runs on server workers. A custom room's match runs in its
owner's browser instead, so the server only coordinates and relays it:

- When a custom room starts, the coordinator reserves the match with
  `hostId` set to the owner and sends that browser `host-match`. The owner's
  lobby opens `/skirmish/index.html?match=…&host=1`.
- That page starts `hostMatchWorker` (the same `createMatchRuntime` that
  `serverMatchWorker` wraps, with an inline encoder and the browser map
  loader) and opens `/host`. The first frame is a JSON `host-authenticate`
  (guest token, match id, runtime id); later frames are `HostWire` binary,
  carrying the worker protocol's requests, results, publications and fatal
  notices with raw `Uint8Array` sections.
- On the server, `HostExecutor` implements `MatchExecutor` over that socket.
  `LiveMatch` is unchanged apart from advancing a remote executor's clock debt
  in one request (up to four ticks), so a round trip longer than a tick does
  not slow the match. Fan-out, flow control, joins and command validation stay
  on the server; the host's own view arrives through its ordinary match socket.
- Hosted matches use no `MULTIPLAYER_MATCH_CAPACITY`. If the host's browser
  does not attach within 60 s, the members return to their room. When its
  socket closes, the match ends for everyone ("The host left the match").
  There is no host migration and the host is trusted with the simulation.
- A started custom match is not listed on the home page except to its own
  players (to rejoin). `MULTIPLAYER_HOSTED_CUSTOM=0` puts custom matches back
  on server workers under the shared capacity.

The public side shows one lobby. While server capacity is full of public
matches, the running match is listed for joining as an AI nation and the lobby
becomes a vote between three other battlefields; when capacity frees, the most
voted map (ties to the earlier offer) becomes the next public lobby.

## Deliberate limits

There is no player reconnect, host migration, replay history, durable match
checkpointing or server-failure recovery. A disconnected player becomes AI
while any remaining players continue. The worker closes when the match ends or
all players leave. A server restart loses active matches. The lobby's ordinary
connection retry remains separate from the running-match connection, which
never silently reconnects.

Authentication, ownership checks, input limits, bounded queues, socket heartbeat
and slow-connection limits remain necessary during normal play. Removing
recovery does not remove those protections.

The Oracle configuration still admits one match at a time and retains the
existing worker memory limit. A two-core cloud benchmark is useful evidence,
but x86 performance is not an Oracle ARM capacity guarantee. Test the selected
map, AI/tribe settings and normal player actions on the actual VM before
increasing admission capacity. No infrastructure upgrade is required by this
change.

## Validation

Run `npm run test:skirmish`, `npm run build:skirmish` and `npx tsc --noEmit`.
The focused online tests cover real two-WebSocket startup, authenticated command
ownership, shared state, continued server progress after a departure, all-left
cleanup, bounded commands/catch-up, thin-client decoding and disconnect handling.
