import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { UNIT } from "../../src/skirmish/content/Units";
import { createManpower, remainingHealth } from "../../src/skirmish/domain/Manpower";
import { createFormation, validateFormation } from "../../src/skirmish/domain/FormationGeometry";
import { DamageLedger } from "../../src/skirmish/Conquest";
import { SnapshotDecoder, SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";

describe("passenger casualty formation state", () => {
  it.each(["mass", "column"] as const)("replicates and restores %s passengers before disembarkation", shape => {
    const terrain = new Uint8Array(100 * 80).fill(133);
    const game = new Skirmish(new GameMapImpl(100, 80, terrain, terrain.length), {
      seed: 47, aiCount: 1, tribes: false, runAi: false,
      ruleset: "ages-v1", startingAge: "ClassicalAge",
    });
    const squad = game.squads[0], unit = UNIT.get("classicalage-infantry")!;
    game.updateSquad(squad.id, {
      troops: 24, manpower: createManpower(unit),
      formation: { ...createFormation(unit.id), shape,
        mode: shape === "column" ? "travel" : "deployed", deployedShape: "mass",
        layoutTroops: 24, frontage: shape === "mass" ? 384 : undefined, preferredFrontage: 384 },
      afloat: { hull: 1200, maxHull: 1200, vesselId: "classicalage-transport" },
    });
    const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
    decoder.decodeLatest(encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts()));
    const damage = new DamageLedger(); damage.add(squad.id, 2, 400);
    game.resolveLandDamage(damage);
    expect(squad.troops).toBe(20);
    expect(remainingHealth(squad)).toBe(2000000);
    expect(squad.afloat!.hull).toBe(800);
    expect(squad.formation!.shape).toBe(shape);
    expect(squad.formation!.layoutTroops).toBe(20);
    expect(squad.formation!.preferredFrontage).toBe(368);
    if (shape === "mass") expect(squad.formation!.frontage).toBe(368);
    expect(squad.formation!.transition).toBeUndefined();
    expect(() => validateFormation(squad.formation, squad.definitionId, squad.troops)).not.toThrow();
    expect(() => decoder.decodeLatest(encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts()))).not.toThrow();
    expect(() => new SnapshotDecoder().decode(new SnapshotEncoder().encode(game.snapshot()))).not.toThrow();
    const cold = new Skirmish(game.map, game.options);
    expect(() => cold.restore(game.checkpoint())).not.toThrow();
    expect(cold.squad(squad.id)!.formation).toEqual(squad.formation);
    expect(cold.squad(squad.id)!.afloat).toEqual(squad.afloat);
  });
});
