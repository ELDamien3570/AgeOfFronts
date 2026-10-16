import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { DEFAULT_AI_POLICIES } from "../../src/skirmish/content/AiPolicies";
import { FORMATION_MOVEMENT } from "../../src/skirmish/content/FormationMovement";
import { commandRejection } from "../../src/skirmish/domain/CommandPolicy";
import { FIXED, type Command, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

const W = 160, H = 100;
function game(): Skirmish {
  const terrain = new Uint8Array(W * H).fill(133);
  return new Skirmish(new GameMapImpl(W, H, terrain, terrain.length), {
    ...DEFAULT_AI_POLICIES, diplomacyRules: "raids-v1", armyTravel: "corridors-v1", ...FORMATION_MOVEMENT,
    seed: 7, humanNames: ["H"], aiCount: 1, tribes: false, ruleset: "ages-v1", startingAge: "Napoleonic", runAi: false,
  } as ConstructorParameters<typeof Skirmish>[1]);
}
/** A marching (column) non-cavalry squad of the given player. */
function marching(match: Skirmish, playerId: number): Squad {
  const squad = match.squads.find(s => s.playerId === playerId && s.kind !== "cavalry" && s.formation)!;
  expect(squad).toBeDefined();
  return match.updateSquad(squad.id, { formation: { ...squad.formation!, shape: "column", transition: undefined } })!;
}
const charge = (playerId: number, squadIds: number[], x: number, y: number,
  fallbackOrder?: Extract<Command, { type: "charge" }>["fallbackOrder"]): Command =>
  ({ type: "charge", playerId, squadIds, x, y, ...(fallbackOrder ? { fallbackOrder } : {}) });

describe("map-bounded command positions (R2-H2)", () => {
  it.each([
    ["far off-map", 1_000_000, 1_000_000],
    ["one row below the map", 10 * FIXED, H * FIXED],
    ["one column right of the map", W * FIXED, 10 * FIXED],
  ])("rejects a %s charge fallback instead of throwing", (_label, x, y) => {
    const match = game(), own = marching(match, 1);
    const command = charge(1, [own.id], x, y, { type: "attack", targetId: 9_999_999 });
    let outcome: string | null = null;
    expect(() => { outcome = match.applyCommand(command); }).not.toThrow();
    expect(typeof outcome).toBe("string");
    // The receipt path reports the same rejection rather than ending the match.
    expect(match.commandApplications.apply("c", command)).toMatchObject({ status: "rejected" });
    match.step();
  });
  it("only blocks a charge on the issuer's own marching squads", () => {
    const match = game(), enemy = marching(match, 2);
    const rejection = match.applyCommand(charge(1, [enemy.id], enemy.x, enemy.y));
    expect(rejection).toBeTypeOf("string");
    expect(rejection).not.toBe("Deploy before charging");
  });
  it("still falls back to a move on the charge point for an own marching squad", () => {
    const match = game(), own = marching(match, 1);
    const x = Math.min(own.x + 5 * FIXED, W * FIXED - 1), y = own.y;
    expect(match.applyCommand(charge(1, [own.id], x, y, { type: "attack", targetId: 9_999_999 }))).toBeNull();
  });
  it("rejects top-level and nested tiles outside the map", () => {
    const match = game(), own = match.squads.find(s => s.playerId === 1)!;
    const reject = (command: Command) => {
      let result: string | null = null;
      expect(() => { result = match.applyCommand(command); }).not.toThrow();
      expect(result).toBeTypeOf("string");
    };
    reject({ type: "order", playerId: 1, squadIds: [own.id], order: { type: "move", tile: W * H } });
    reject({ type: "build", playerId: 1, buildingType: "barracks", tile: W * H });
    reject({ type: "occupy", playerId: 1, squadIds: [own.id], tile: W * H });
    reject({ type: "occupy", playerId: 1, squadIds: [own.id], tile: 5, frontageTiles: [W * H] });
    reject({ type: "sail", playerId: 1, shipIds: [1], tile: W * H });
    reject(charge(1, [own.id], 10 * FIXED, 10 * FIXED, { type: "move", tile: W * H }));
    reject({ type: "sortie", playerId: 1, aircraftIds: [1], x: W * FIXED, y: 0 });
    reject({ type: "launch", playerId: 1, launcherId: 1, payload: "icbm", x: 0, y: H * FIXED });
    expect(commandRejection({ type: "army-order", playerId: 1, armyId: 1, order: { type: "move", tile: W * H } }, { width: W, height: H }))
      .toBe("Invalid army destination");
  });
  it("keeps the unbounded policy for callers without a map", () => {
    expect(commandRejection({ type: "order", playerId: 1, squadIds: [1], order: { type: "move", tile: W * H } })).toBeNull();
    expect(commandRejection({ type: "order", playerId: 1, squadIds: [1], order: { type: "move", tile: W * H - 1 } }, { width: W, height: H })).toBeNull();
  });
});
