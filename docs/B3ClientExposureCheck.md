# B-3 client-exposure check (R2-M11)

Status: fixed (roadmap Next #10, commit "Keep landed and refitted formations
valid (R2-M11)"). `TransportHandoff.ts` now stores the deployed shape that the
landed column's `preferredFrontage` was sized for, and the definition-change
branch in `Simulation.updateSquad` sizes `preferredFrontage` for the shape the
validator reads (`deployedShape ?? shape`). Tests:
`tests/skirmish/FormationClientExposure.test.ts` (real landing and refit through
both client decode paths, plus a codec guard),
`tests/skirmish/FormationRefitValidity.test.ts` (same-line definition-change
sweep, 0 invalid), `tests/skirmish/TransportHandoff.test.ts` (manual column
landing), and the end-of-tick helper `tests/skirmish/fixtures/FormationCheck.ts`.
The sections below record the check as it was made before the fix.

## Question

R2-M11 (review-notes/08e-round2-ledger.md) leaves a live squad formation with
`preferredFrontage` sized for the doctrine's deployed shape while `shape` is
`"column"` and `deployedShape` is undefined (transport landing of a manual
column, and the refit/enlargement branch). `validateFormation` rejects that
state. Besides restore, the validator runs on every decoded squad detail
(`SnapshotDetails.ts` `validateSnapshotDetails`, `SnapshotCodec.ts`
`SnapshotDecoder.validate`). Does a live client decode hit it, and what does
the client do?

## Outcome

Pinned by `tests/skirmish/FormationClientExposure.test.ts`, which builds the
state and runs it through the real server encode path (`SnapshotEncoder` with
the server worker's network encoding, then `encodeState`) and the real client
decode paths.

- **Server:** does not notice. Encoding succeeds and the simulation keeps
  stepping.
- **Online client: throws and leaves the match.** In `multiplayerStateWorker`,
  `CanonicalStateStream.apply` -> `SnapshotDecoder.validate` ->
  `validateSnapshotDetails` -> `validateFormation` throws
  `Invalid formation frontage`. The worker posts `{error}`, the
  `OnlineMatchSession` decode promise rejects, and the receive chain calls
  `fail(message)`. The client does not request a baseline and does not ignore
  the squad, so it does not feed H1's resync loop.
- **Every online client** receives the same publication, and a rejoin baseline
  carries the same squad detail, so all online clients drop and cannot rejoin
  until that squad's formation changes.
- **Local (single-player) client:** `LocalSnapshotStream` rejects the delta and
  requests one complete baseline (`main.ts` posts `resync`). That baseline
  carries the same detail and throws, so the local match fails as well.

## Consequence

R2-M11 is client-visible and match-ending for players, not only a restore
defect. Raise the priority of the B-3 fix (`TransportHandoff.ts` landing
`deployedShape`, and the refit branch in `Simulation.ts`). Add the end-of-tick
`validateFormation` assertion in tests that the roadmap asks for.
