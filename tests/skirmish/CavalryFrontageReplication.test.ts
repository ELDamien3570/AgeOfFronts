import { describe, expect, it } from "vitest";
import { cavalryImpactScene } from "./fixtures/CavalryImpact";
import { formationDoctrine, validateFormation } from "../../src/skirmish/domain/FormationGeometry";
import { frontageLayout } from "../../src/skirmish/domain/FormationProfiles";
import { formationApproach } from "../../src/skirmish/domain/FormationContact";
import { SnapshotEncoder, SnapshotDecoder } from "../../src/skirmish/SnapshotCodec";

describe("mounted impact formation replication", () => {
  it("commits a legal wedge frontage when impact retains the charge body", () => {
    const { game, rider, defender } = cavalryImpactScene();
    const d = formationDoctrine(rider.definitionId);
    const width = frontageLayout(rider.troops, d, "mass", 32768)!.width;
    expect(frontageLayout(rider.troops, d, "wedge", width)).toBeUndefined();
    game.updateSquad(rider.id, { formation: { ...rider.formation!, shape: "mass",
      frontage: width, preferredFrontage: width, deployedShape: "mass", transition: undefined } });
    game.updateSquad(rider.id, formationApproach(rider, defender, 0, 0, -Math.PI / 2));
    const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
    decoder.decodeLatest(encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts()));
    game.expansion!.battle.fight([]);
    expect(rider.charge!.phase).toBe("recovery");
    expect(rider.formation!.shape).toBe("wedge");
    expect(() => validateFormation(rider.formation, rider.definitionId, rider.troops)).not.toThrow();
    expect(() => decoder.decodeLatest(encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts()))).not.toThrow();
  });
});
