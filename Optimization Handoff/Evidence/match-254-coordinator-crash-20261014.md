# Match-254 reconnect failure: coordinator process crash

The observed failure was a process crash, not late-game overload or a client
state-decoder mismatch. The browser remained in a joining overlay at game time
1:45. Oracle's container restart count was four after the b1.5.6 deployment.
The latest crash occurred at 2026-10-14 16:47:31 UTC (12:47:31 EDT), followed by
container restart at 16:47:32 UTC. Health then reported zero active matches.

The uncaught error was `URIError: URI malformed` from `decodeURIComponent(rawUrl)`
in `CoordinatorServer.ts:serveStatic`. URL decoding happened outside the existing
filesystem error handler. A malformed percent escape or invalid escaped UTF-8
path could therefore escape the HTTP callback, terminate Node, disconnect every
socket, and lose all memory-only match workers. The request path/source was not
logged; attribution to a user action, asset or external scanner is unproven.

An isolated local reproduction against the unchanged coordinator requested an
invalid escaped UTF-8 path and exited with the same URIError and stack. No such
request was sent to vulnerable production as a test.

The fix rejects decoding failures at the request boundary with HTTP 400 and
`Cache-Control: no-store`, without a global exception-swallowing handler or any
simulation changes. A real HTTP/WebSocket regression test covers malformed
escapes, truncated UTF-8, invalid UTF-8, GET and HEAD. Afterwards it verifies
health, valid encoded filenames, the home page and a still-authenticated socket.

The after-fix isolated reproduction returns 400 and remains healthy. All six
focused coordinator/transport tests, TypeScript and the skirmish build pass.

Raw timestamped server evidence, before/after reproduction logs, checks and the
post-crash browser screenshot are under `out/match-254-crash-20261014/`.
Production deployment of this new hotfix requires user approval and exact-SHA
publication. The already lost match cannot be restored from replication state:
that state is not a full authoritative checkpoint. The joining overlay remaining
visible after loss is also not evidence that the old match is recoverable.
