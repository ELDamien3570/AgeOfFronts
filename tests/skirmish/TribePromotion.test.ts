import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { canPromoteTribe, squadCap } from "../../src/skirmish/FactionRules";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import { Progression } from "../../src/skirmish/domain/Progression";

function match() {
  const terrain = new Uint8Array(240 * 160).fill(133);
  terrain.fill(0, 0, 240 * 40);
  return new Skirmish(new GameMapImpl(240, 160, terrain, 240 * 120), {
    seed: 42,
    aiCount: 2,
    runAi: false,
    tribes: true,
    ruleset: "ages-v1",
  });
}

describe("tribe promotion", () => {
  it("uses the inclusive land-only threshold and excludes eliminated factions", () => {
    const p = { kind: "tribe" as const, land: 99, eliminated: false };
    expect(canPromoteTribe(p, 999)).toBe(false);
    expect(canPromoteTribe({ ...p, land: 100 }, 999)).toBe(true);
    expect(canPromoteTribe({ ...p, land: 100, eliminated: true }, 999)).toBe(
      false,
    );
    expect(canPromoteTribe(p, 0)).toBe(false);
    expect(canPromoteTribe({ ...p, kind: "regular", land: 100 }, 999)).toBe(
      false,
    );
  });

  it("promotes in place permanently, enabling normal age caps and preserving snapshots", () => {
    const game = match(),
      tribe = game.players.find((p) => p.kind === "tribe")!;
    const identity = {
      id: tribe.id,
      name: tribe.name,
      personalityId: tribe.personalityId,
    };
    const squads = game.squads
      .filter((s) => s.playerId === tribe.id)
      .map((s) => s.id);
    const buildings = game.buildings
      .filter((b) => b.playerId === tribe.id)
      .map((b) => b.id);
    const state = game.expansion!.progression.states[tribe.id];
    tribe.land = game.map.numLandTiles() / 10;
    game.step();
    expect(tribe).toMatchObject({ ...identity, kind: "regular" });
    expect(game.expansion!.progression.states[tribe.id]).toBe(state);
    expect(state.age).toBe("StoneAge");
    expect(squadCap(tribe, state.age)).toBe(60);
    expect(
      game.squads.filter((s) => s.playerId === tribe.id).map((s) => s.id),
    ).toEqual(squads);
    expect(
      game.buildings.filter((b) => b.playerId === tribe.id).map((b) => b.id),
    ).toEqual(buildings);
    tribe.land = 1;
    game.step();
    expect(tribe.kind).toBe("regular");
    expect(
      game.expansion!.events.filter((e) => e.kind === "promotion"),
    ).toHaveLength(1);
    const snapshot = new SnapshotDecoder().decode(
      new SnapshotEncoder().encode(game.snapshot()),
    );
    expect(snapshot.players.find((p) => p.id === tribe.id)?.kind).toBe(
      "regular",
    );
    expect(snapshot.expansion!.events.some((e) => e.kind === "promotion")).toBe(
      true,
    );
  });

  it("inherits achievements without sharing arrays or copying unfinished jobs", () => {
    const progression = new Progression();
    progression.add(1);
    progression.add(2);
    const donor = progression.states[2];
    donor.age = "Modern";
    donor.completed.push("bronzeage-armies");
    donor.research.warfare = {
      technologyId: "bronzeage-fortified-settlements",
      remainingTicks: 200,
      totalTicks: 200,
    };
    progression.inheritCompleted(1, 2);
    expect(progression.states[1].age).toBe("Modern");
    expect(progression.states[1].completed).toContain("bronzeage-armies");
    expect(progression.states[1].research).toEqual({});
    expect(progression.states[1].advancement).toBeNull();
    donor.completed.push("later");
    expect(progression.states[1].completed).not.toContain("later");
  });

  it("promotes a conquering tribe immediately below ten percent without refitting its forces", () => {
    const game = match(),
      tribe = game.players.find((p) => p.kind === "tribe")!,
      donor = game.players[1];
    const state = game.expansion!.progression.states[donor.id];
    state.age = "ClassicalAge";
    state.completed.push("bronzeage-armies");
    game.buildings.push({
      id: 99999,
      playerId: donor.id,
      type: "barracks",
      tile: donor.base,
      age: "StoneAge",
      remainingTicks: 0,
    });
    const own = game.squads.filter((s) => s.playerId === tribe.id);
    const tiers = own.map((s) => s.definitionId);
    for (let i = game.squads.length - 1; i >= 0; i--)
      if (game.squads[i].playerId === donor.id) game.squads.splice(i, 1);
    const attacker = own[0];
    attacker.x = (game.map.x(donor.base) + 0.5) * FIXED;
    attacker.y = (game.map.y(donor.base) + 0.5) * FIXED;
    attacker.order = { type: "hold" };
    attacker.path = [];
    for (let i = 0; i < 32; i++) game.step();
    expect(donor.eliminated).toBe(true);
    expect(tribe.land / game.map.numLandTiles()).toBeLessThan(0.1);
    expect(tribe.kind).toBe("regular");
    expect(game.expansion!.progression.states[tribe.id].age).toBe(
      "ClassicalAge",
    );
    expect(game.expansion!.progression.states[tribe.id].completed).toContain(
      "bronzeage-armies",
    );
    expect(own.map((s) => s.definitionId)).toEqual(tiers);
    expect(
      game.expansion!.events.filter(
        (e) => e.kind === "promotion" && e.actorId === tribe.id,
      ),
    ).toHaveLength(1);
  });
});

