import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { CanonicalStateStream } from "../../src/skirmish/client/CanonicalStateStream";
import { LocalSnapshotStream } from "../../src/skirmish/client/LocalSnapshotStream";
import { formationDoctrine, validateFormation } from "../../src/skirmish/domain/FormationGeometry";
import { frontageLayout } from "../../src/skirmish/domain/FormationProfiles";
import { decodeState, encodeState } from "../../src/skirmish/multiplayer/StateCodec";
import { SNAPSHOT_STATE_LIMITS } from "../../src/skirmish/multiplayer/StateLimits";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";

/**
 * B-3 client-exposure check for R2-M11 (review-notes/00-summary.md, B-3).
 *
 * R2-M11: transport landing and refits can leave a live squad formation with
 * `preferredFrontage` sized for the doctrine's deployed shape while
 * `deployedShape` is undefined and `shape` is "column". The same
 * `validateFormation` that rejects it on restore also runs on every decoded
 * squad detail on the client.
 *
 * Outcome recorded here (see docs/B3ClientExposureCheck.md):
 * - The server does not notice: `SnapshotEncoder.encode` and the wire
 *   `encodeState` accept the state, and the simulation keeps running.
 * - The client throws. `CanonicalStateStream.apply` (run inside
 *   multiplayerStateWorker) reaches SnapshotDecoder.validate ->
 *   validateSnapshotDetails -> validateFormation and throws
 *   "Invalid formation frontage". The worker posts `{error}`, the
 *   OnlineMatchSession decode promise rejects, and the receive chain calls
 *   `fail(message)`: the client leaves the match. It does not request a
 *   baseline, and it does not ignore the squad.
 * - Every client gets the same publication, and a rejoin baseline carries the
 *   same detail, so all online clients drop until the formation changes.
 * - The local (single-player) client, LocalSnapshotStream, rejects the delta
 *   and requests one complete baseline (main.ts posts "resync"); that
 *   baseline carries the same detail and throws, so the local match fails too.
 *
 * This test builds that state synthetically through the real server encode
 * path and the real client decode path. The decoder rejecting such a detail is
 * correct; the defect is the simulation producing it, which the B-3 fix
 * (TransportHandoff.ts / Simulation refit branch) addresses.
 */
function landedColumnMatch() {
  const W = 64, H = 48, terrain = new Uint8Array(W * H).fill(133);
  const game = new Skirmish(new GameMapImpl(W, H, terrain, terrain.length), {
    seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1",
  });
  const squad = game.squads.find((s) => s.playerId === 1 && s.formation &&
    formationDoctrine(s.definitionId).shapes.includes("column"))!;
  expect(squad).toBeDefined();
  const doctrine = formationDoctrine(squad.definitionId);
  const width = frontageLayout(squad.troops, doctrine, doctrine.defaultShape)!.width;
  // The landed manual column of R2-M11: frontage for the deployed shape, no deployedShape.
  const landed = {
    ...squad.formation!, shape: "column" as const, mode: "travel" as const, automatic: false,
    deployedShape: undefined, preferredFrontage: width, frontage: undefined,
    revision: squad.formation!.revision + 1,
  };
  expect(() => validateFormation(landed, squad.definitionId, squad.troops)).toThrow("Invalid formation frontage");
  return { game, W, H, cells: W * H, corrupt: () => game.updateSquad(squad.id, { formation: landed }) };
}
describe("B-3: client exposure of the R2-M11 formation state", () => {
  it("a publication carrying the state is accepted by the server encoder and rejected by the client canonical decode", async () => {
    const { game, W, H, corrupt } = landedColumnMatch();
    // The server worker's encoder settings (serverMatchWorker.ts networkEncoding).
    const encoder = new SnapshotEncoder(true, { compactFormationSlots: true, compactTraders: true });
    const stream = new CanonicalStateStream(W * H, 65_536, { width: W, height: H });
    const encode = async () => encodeState(
      encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts()),
      undefined, SNAPSHOT_STATE_LIMITS, true);
    // The client worker: wire decode, then canonical application.
    const receive = async (wire: Awaited<ReturnType<typeof encode>>) =>
      stream.apply(await decodeState<SnapshotPacket>(wire, SNAPSHOT_STATE_LIMITS));

    await receive(await encode());
    expect(() => stream.presentationPacket()).not.toThrow();
    corrupt();

    // Server side: encoding the publication succeeds and the match keeps stepping.
    const wire = await encode();
    expect(() => game.step()).not.toThrow();
    // Client side: the canonical decode rejects the publication.
    await expect(receive(wire)).rejects.toThrow("Invalid formation frontage");
  });
  it("the local client requests one baseline, and that baseline throws too", () => {
    const { game, corrupt } = landedColumnMatch();
    const encoder = new SnapshotEncoder(true);
    const requests: unknown[] = [];
    const local = new LocalSnapshotStream((error) => requests.push(error));
    expect(local.decode(encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts()))).toBeDefined();
    corrupt();
    const delta = encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
    expect(delta.reset).toBeFalsy();
    expect(local.decode(delta)).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect((requests[0] as Error).message).toBe("Invalid formation frontage");
    const baseline = new SnapshotEncoder(true).encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
    expect(baseline.reset).toBe(true);
    expect(() => local.decode(baseline)).toThrow("Invalid formation frontage");
  });
});
