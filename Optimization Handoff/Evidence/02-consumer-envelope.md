# P02 local consumer envelope

Source base: `14fafeb`, branch `codex/optimization-consumer-envelopes-local`.
Runtime ID: `0ab1914af298824ea28f450586520247ccb67c9eb6231a41ec0fb4e7165aa705`.
Experimental defaults are unchanged. Domain save values and codec transport
policy retain their existing ownership; diagnostics are not authoritative state.

## Consumer inventory

| Consumer | Simultaneous data and ownership | Existing retained bound |
| --- | --- | --- |
| Normal snapshot capture | Domain snapshot references plus six packed numeric buffers; encoder keeps tile comparison words and live building facts. Worker `postMessage` clones the immutable packet at its captured tick. | Two admitted publications; full queue does not capture or advance the delta cursor. |
| Encoding worker | Cloned packet, packed object tree, JSON string/UTF-8 metadata, RLE buffers, combined wire bytes, gzip input/output, digest and base64 strings can overlap. | Two pending adapter requests; 256 MiB old-generation worker limit, which does not bound external memory or process RSS. |
| Recovery checkpoint | Structured domain clone, arena/free-slot state and codec intermediates overlap. Restore allocates a new world and derived indexes. | Generic transport envelope; recovery baseline caching is P13, still open. |
| Joining client | Shared subscriber delta and independent sparse baseline are captured at one barrier. Encoded responses and transport JSON coexist until sent/applied. | One admission barrier; existing preparation/application deadlines and cancellation release the sync record. |
| Coordinator fan-out | Encoded string, JSON serialization and each WebSocket's outbound bytes overlap. Worker-to-coordinator response is cloned; strings cannot be transferred. | Existing 512,000 buffered-byte cutoff before enqueue; one large message can exceed that cutoff. This is not a total fan-out heap bound. |
| Browser decode | Network JSON/base64 string, compressed bytes, streaming decompression chunks, combined wire, metadata string/tree, typed output and canonical arrays overlap. | Eight admitted states, 16 MiB UTF-16-accounted input queue; one decode at a time. |
| Delayed renderer | Canonical ownership arrays and entity maps remain in the decoder worker. Projection clones them and transfers the three map buffers; other projection records clone. Current displayed state may overlap one latest replacement. | Dirty tile map at 65,536 entries, then conservative full-frame obligation. Presentation coalesces; canonical updates stay ordered. |

`SnapshotEncoder` removes deleted building identities; canonical decoder maps
remove replicated deletions. Existing publication failure drains pending slots,
encoder failure/close rejects all adapter requests and clears their timers, and
executor close clears publication listeners. Online session close now clears
queued projections and bounded receipt history. A delivered renderer callback
captures its sequence rather than the complete update during acknowledgement.
The callback's own retained data remains the consumer's responsibility.

## Coordinated structural profiles

`StateLimits.ts` is shared by producers and decoders. Generic recovery caps stay
64,000,000 wire bytes, 32,000,000 payload characters, 256,000,000 decoded typed
bytes, 64,000,000 metadata bytes, 4,000,000 metadata tokens and 100,000 arrays.
Snapshots use the existing 64,000,000 decoded-byte cap and a payload limit of
8,388,608 characters, derived from the browser's existing 16 MiB queue accounting.
The snapshot producer now rejects an output outside that intended consumer
profile instead of publishing a packet the browser necessarily rejects. Caps
are structural limits, not permitted simultaneous heap allocations or a proven
legitimate largest-map envelope. No limit was raised to fit a test.

Producer preflight charges original typed output before RLE, checks metadata
and aggregate wire size before combined-wire allocation, and checks prospective
base64 length before constructing that string. Decoder preflight checks input
length, streaming wire length, metadata bytes/tokens/nesting, buffer sizes and
aggregate typed allocations including repeated references and empty arrays.
Encoder metadata/tree construction still requires memory before its metadata
cap can be checked. V8 object/string overhead and codec/native buffers require
runtime qualification rather than a sum of typed-array caps.

Active arena checkpoints copy active records plus exact free-slot order:
`32 * used + 4 * freeCount` typed bytes, versus the former `32 * capacity`.
Untouched empty arenas are implicit; reused empty arenas retain only free order.
Sparse restoration validates the complete partition before mutation. The
original full-buffer checkpoint has an explicit reader. Positive `Infinity`
sentinels in legacy pending formations migrate to equivalent explicit unset
values before portable encoding; comparisons and deterministic continuation
are preserved.

## Reproducible local observations

Run `node node_modules/tsx/dist/cli.mjs scripts/skirmish/measure-consumer-memory.ts`.
The JSON records Windows x64 Node 24.18.0, one 128 by 96 land fixture, seed 47,
ages-v1, one AI faction, no tribes, AI disabled, deferred planning opt-in, tick 1
after one human move to (100,70). Six sequential encode/decode cycles per payload
kind run without sockets or capacity traffic. A separate 65,536-slot arena has
two active records.

| Payload | Base64 characters | Wire bytes | Decoded typed bytes | Metadata bytes/tokens |
| --- | ---: | ---: | ---: | ---: |
| Snapshot | 2,668 | 8,842 | 2,288 | 6,546 / 940 |
| Pending checkpoint | 5,488 | 18,239 | 38,400 | 16,255 / 2,578 |
| Active arena | 217,252 | 262,526 | 262,200 | 318 / 62 |

Sampled process maxima across this run were 142,983,168 RSS bytes, 40,927,432
heap-used bytes, 16,811,773 external bytes and 12,651,106 ArrayBuffer bytes.
Synchronous stage-end and five-millisecond asynchronous samples can miss exact
transient maxima. The process includes the fixture world, TypeScript loader and
observers. These measurements do not prove garbage-collection convergence,
mature-world payload viability, real-browser memory, ARM memory or capacity.
Those qualification gates remain open; dependent acceptance must retain them.

## Validation and baseline comparison

New focused codec/arena/session regressions pass, including legacy migration
and continued commands. TypeScript, the evidence-script project, production
build, whitespace and scoped Oxlint/ESLint pass. The full unchanged-timeout suite
ran 1024 tests: 1019 passed, five timed out in four existing files. Rerunning
VallesKairuliaMap/ShoreTransport/Tribes/Movement produced 34/39 passing tests,
five timeout failures, and a passing Movement file. Temporarily setting aside
every P02 source/test/config file and verifying the source equals `14fafeb`
produced 33/39 passing tests and six timeouts in map/tribe/shore files. The
current Art-only commit `59c4eeb` was preserved throughout. Full-suite timing
remains an open environmental acceptance gate, not a clean pass. No timeout
or assertion was weakened and no unrelated map/gameplay implementation changed.
