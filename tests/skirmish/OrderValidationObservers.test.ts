import { describe, expect, it } from "vitest";
import { FIXED } from "../../src/skirmish/Protocol";
import { trenchLineScene } from "./fixtures/TrenchLine";

// R2-M10 (containment subset): read-only order rejections must not first run
// the skirmish-stance and trench observers.
describe("order rejections before stance and trench observers", () => {
  const scene = () => {
    const { game, defenders } = trenchLineScene(true);
    const squad = defenders[0];
    expect(game.applyCommand({ type: "stance", playerId: 2, squadIds: [squad.id], stance: "skirmish" })).toBeNull();
    const stance = () => structuredClone(game.expansion!.skirmish.checkpoint());
    const trenches = () => JSON.stringify(game.expansion!.trenches.checkpoint());
    return { game, squad, stance, trenches };
  };
  it("rejects a replenish order off friendly land without suppressing skirmish stance", () => {
    const { game, squad, stance, trenches } = scene();
    // Player 1 owns every row below 32.
    game.updateSquad(squad.id, { y: 40 * FIXED + FIXED / 2 });
    const before = stance(), trenchesBefore = trenches();
    expect(game.applyCommand({ type: "order", playerId: 2, squadIds: [squad.id], order: { type: "replenish" } }))
      .toBe("Move every selected squad onto friendly territory before replenishing");
    expect(stance()).toEqual(before);
    expect(trenches()).toBe(trenchesBefore);
  });
});
