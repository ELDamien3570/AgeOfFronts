import { describe, expect, it } from "vitest";
import { CanonicalStateStream } from "../../src/skirmish/client/CanonicalStateStream";
import { LocalSnapshotStream } from "../../src/skirmish/client/LocalSnapshotStream";
import { formationDoctrine, validateFormation } from "../../src/skirmish/domain/FormationGeometry";
import { frontageLayout } from "../../src/skirmish/domain/FormationProfiles";
import { createManpower } from "../../src/skirmish/domain/Manpower";
import { UNIT } from "../../src/skirmish/content/Units";
import { decodeState, encodeState } from "../../src/skirmish/multiplayer/StateCodec";
import { SNAPSHOT_STATE_LIMITS } from "../../src/skirmish/multiplayer/StateLimits";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";
import type { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import { invalidFormations, stepValidated } from "./fixtures/FormationCheck";
import { transportScene } from "./fixtures/TacticalScenes";

/**
 * B-3 client exposure of R2-M11 (review-notes/00-summary.md, B-3;
 * docs/B3ClientExposureCheck.md).
 *
 * Before the fix, a transport landing of a manual column and a refit could
 * leave `preferredFrontage` sized for a deployed shape while the validator read
 * `deployedShape ?? shape` as a different shape. Every online client's
 * canonical decode (SnapshotDecoder.validate -> validateSnapshotDetails ->
 * validateFormation) threw and the client left the match; the local client
 * failed on its resync baseline too.
 *
 * These tests drive the real landing and refit through the simulation and
 * check that the server publication passes the real client decode paths. The
 * last test keeps the codec guard: the decoder still rejects an invalid detail.
 */
function clientPaths(game: Skirmish, size: number) {
  // The server worker's encoder settings (serverMatchWorker.ts networkEncoding).
  const encoder = new SnapshotEncoder(true, { compactFormationSlots: true, compactTraders: true });
  const stream = new CanonicalStateStream(size * size, 65_536, { width: size, height: size });
  const localEncoder = new SnapshotEncoder(true);
  const localErrors: unknown[] = [];
  const local = new LocalSnapshotStream((error) => localErrors.push(error));
  const publish = async () => {
    const wire = await encodeState(
      encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts()),
      undefined, SNAPSHOT_STATE_LIMITS, true);
    // The client worker: wire decode, then canonical application.
    await stream.apply(await decodeState<SnapshotPacket>(wire, SNAPSHOT_STATE_LIMITS));
    expect(local.decode(localEncoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts()))).toBeDefined();
    expect(localErrors).toEqual([]);
  };
  return { publish, encoder, stream };
}
function manualColumnScene() {
  const f = transportScene();
  const formation = {
    ...f.s.formation!, shape: "column" as const, mode: "travel" as const, automatic: false,
    deployedShape: undefined, preferredFrontage: undefined, frontage: undefined, trail: undefined,
    revision: f.s.formation!.revision + 1,
  };
  validateFormation(formation, f.s.definitionId, f.s.troops);
  f.game.updateSquad(f.s.id, { formation });
  return f;
}
describe("B-3: R2-M11 formation states reach clients valid", () => {
  it("a manual column landing from water passes the validator and both client decode paths", async () => {
    const f = manualColumnScene();
    const { publish } = clientPaths(f.game, f.size);
    await publish();
    expect(f.game.applyCommand({ type: "order", playerId: 1, squadIds: [f.s.id], order: { type: "move", tile: f.map.ref(128, 64) } })).toBeNull();
    let boarded = false, landed = false;
    for (let tick = 0; tick < 1200 && !landed; tick++) {
      expect(stepValidated(f.game, 1)).toEqual([]);
      const s = f.game.squad(f.s.id)!;
      boarded ||= !!s.afloat;
      landed = boarded && !s.afloat;
      if (tick % 10 === 0 || landed) await publish();
    }
    expect(landed).toBe(true);
    const s = f.game.squad(f.s.id)!;
    expect(s.formation?.preferredFrontage).toBeDefined();
    expect(() => validateFormation(s.formation, s.definitionId, s.troops)).not.toThrow();
    await publish();
  }, 60_000);
  it("a refit of a column that remembers a shape the new doctrine lacks passes both client decode paths", async () => {
    const f = transportScene();
    const from = "bronzeage-anticavalry", to = "earlymodern-anticavalry";
    expect(formationDoctrine(from).shapes).toContain("shield-wall");
    expect(formationDoctrine(to).shapes).not.toContain("shield-wall");
    const u = UNIT.get(from)!, troops = u.formationRecipe!.capacity, d = formationDoctrine(from);
    f.game.updateSquad(f.s.id, {
      definitionId: from, kind: u.line, troops, manpower: createManpower(u, "base"),
      formation: {
        ...f.s.formation!, shape: "column", mode: "travel", automatic: false, deployedShape: "shield-wall",
        preferredFrontage: frontageLayout(troops, d, "shield-wall")!.width, frontage: undefined, trail: undefined, layoutTroops: undefined,
      },
    });
    expect(invalidFormations(f.game)).toEqual([]);
    const { publish } = clientPaths(f.game, f.size);
    await publish();
    // The simulation's definition-change branch (refit / enlargement).
    f.game.updateSquad(f.s.id, { definitionId: to, manpower: createManpower(UNIT.get(to)!, "base") });
    expect(invalidFormations(f.game)).toEqual([]);
    await publish();
    expect(stepValidated(f.game, 20)).toEqual([]);
    await publish();
  });
  it("the client decoder still rejects an invalid formation detail (codec guard)", async () => {
    const f = transportScene();
    const { publish } = clientPaths(f.game, f.size);
    await publish();
    const d = formationDoctrine(f.s.definitionId);
    // The pre-fix R2-M11 state: a width for the deployed shape, validated against the column.
    const corrupt = {
      ...f.s.formation!, shape: "column" as const, mode: "travel" as const, automatic: false,
      deployedShape: undefined, preferredFrontage: frontageLayout(f.s.troops, d, d.defaultShape)!.width,
      frontage: undefined, revision: f.s.formation!.revision + 1,
    };
    expect(() => validateFormation(corrupt, f.s.definitionId, f.s.troops)).toThrow("Invalid formation frontage");
    f.game.updateSquad(f.s.id, { formation: corrupt });
    await expect(publish()).rejects.toThrow("Invalid formation frontage");
  });
});
