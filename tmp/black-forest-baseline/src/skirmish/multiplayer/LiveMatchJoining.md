# Live match joining

Custom lobbies enable **Allow new players to take over unclaimed AI empires**
before starting. This is on by default. The home page lists running matches,
eligible AI empires, and a **Rejoin your empire** action for a returning owner.

An empire remains reserved to its original saved browser guest identity. Names
and flags do not authenticate ownership. Away human empires are AI controlled;
they stay reserved for their original players. Any new player can join a running
match to take over an unclaimed AI empire. Only living, regular, unclaimed AI
factions can be taken over. Tribes cannot be taken over.

## Synchronization

The server remains the sole simulation authority. Assets load while the match
continues. When the client is ready, one admission lock waits for the current
worker advance, transfers the controller, and captures a presentation snapshot.
The existing clients receive an aligned delta and the newcomer receives a reset
baseline from the same tick and publication sequence. Both advance the shared
encoder cursor, so subsequent changes back to an older value reach every client.

The newcomer acknowledges the exact synchronization ID and publication sequence
after decoding and applying the baseline. Commands unlock only after the server
commits admission. Control transfer preserves armies, orders, economy, research,
production, territory, and starting-age state. Controller generations invalidate
deferred AI proposals without deleting legitimate navigation orders.

Loading is limited to 60 seconds per attempt and 16 pending attempts. Sync has a
five-second deadline; timeout restores AI control. A failed rollback retires the
worker after a further second. Syncs have a two-second cooldown and a rolling
15-second pause budget per minute. Simulation remains 20 Hz and presentation 5 Hz.

## Empty matches and deployment

When everyone leaves, the match pauses in memory for two minutes and retains its
capacity slot. Failed attempts do not extend that deadline. A successful admission
resumes it; expiry releases capacity. `MULTIPLAYER_EMPTY_MATCH_GRACE_MS` accepts
1000–300000 milliseconds and defaults to 120000.

There is no recovery after server restart. Restart clears persisted reservations
because their workers and worlds no longer exist. Deploy the matching client and
server together, preferably when no match is active. `MULTIPLAYER_MATCH_CAPACITY=3` supports up to 3 concurrent matches on
the Oracle host setup (each match runs inside an isolated 384MB worker thread).

## Verification

The `LiveJoin*`, `LiveMatchCards`, and `OnlineMatchSession` tests exercise real
WebSocket joins/rejoins, identity and seat exclusivity, admission races, state
preservation, shared snapshot cursor alignment, applied acknowledgments,
timeouts, duplicate tabs, controller fencing, and rendered lobby states.

```sh
npm run test:skirmish -- --maxWorkers=2 --testTimeout=15000
npx tsc --noEmit
npm run build:skirmish
```
