import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { MIXED_ARMY_SELECTION_MESSAGE } from "../../src/skirmish/domain/CommandPolicy";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { serverText } from "../../src/skirmish/client/ServerText";
import english from "../../resources/lang/en.json";
import { retainSquads } from "./UnitFixtures";

function make() {
  const match = new Skirmish(new GameMapImpl(96, 64, new Uint8Array(96 * 64).fill(133), 96 * 64), {
    seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning: true,
  });
  const own = match.squads.find(s => s.playerId === 1)!;
  retainSquads(match, [
    ...match.squads.filter(s => s.playerId !== 1),
    ...Array.from({ length: 10 }, (_, i) => ({
      ...own, id: 100 + i, x: (12 + (i % 4)) * FIXED, y: (30 + Math.floor(i / 4)) * FIXED,
      order: { type: "hold" } as Squad["order"], path: [], queuedOrders: [],
    })),
  ]);
  const state = match.expansion!.progression.states[1];
  state.age = "BronzeAge";
  state.completed = ["rus-bronzeage-barracks-equipment"];
  expect(match.applyCommand({ type: "create-army", playerId: 1, squadIds: [100, 101, 102, 103, 104, 105] })).toBeNull();
  return match;
}
const digest = (match: Skirmish) => createHash("sha256").update(JSON.stringify(match.checkpoint(), (_key, value) =>
  value instanceof Map ? [...value] : value instanceof Set ? [...value] : ArrayBuffer.isView(value) ? Array.from(value as Uint8Array) : value)).digest("hex");
const move = (match: Skirmish, squadIds: number[]) =>
  match.applyCommand({ type: "order", playerId: 1, squadIds, order: { type: "move", tile: match.map.ref(70, 20) } });

describe("mixed army selections (R2-P2)", () => {
  it("rejects army members mixed with other squads before any write", () => {
    const match = make();
    expect(match.expansion!.armies.armyOf(100)).toBeDefined();
    const before = digest(match), pending = match.movementAdmission.pendingCount;
    expect(move(match, [100, 101, 102, 103, 104, 105, 106, 107])).toBe(MIXED_ARMY_SELECTION_MESSAGE);
    expect(match.movementAdmission.pendingCount).toBe(pending);
    expect(digest(match)).toBe(before);
    expect(match.paths.residency.hierarchy.treeBytes).toBe(0);
  });

  it("rejects part of an army, and keeps whole-army and non-army moves working", () => {
    const match = make();
    const before = digest(match);
    expect(move(match, [100, 101, 102])).toBe(MIXED_ARMY_SELECTION_MESSAGE);
    expect(digest(match)).toBe(before);
    expect(move(match, [106, 107, 108, 109])).toBeNull();
    expect(match.movementAdmission.pendingCount).toBe(1);
    expect(move(match, [100, 101, 102, 103, 104, 105])).toBeNull();
  });

  it("has an English translation", () => {
    expect(english.skirmish_server.mixed_army_selection).toBe(MIXED_ARMY_SELECTION_MESSAGE);
    expect(serverText(MIXED_ARMY_SELECTION_MESSAGE)).toBe(english.skirmish_server.mixed_army_selection);
  });
});
