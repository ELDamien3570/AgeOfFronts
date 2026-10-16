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
  // R2-M10 remainder: a queued replenish behind a held squad falls through to
  // the late replenish check; the observers must still wait for acceptance.
  it("rejects a queued replenish off friendly land without suppressing skirmish stance", () => {
    const { game, squad, stance, trenches } = scene();
    game.updateSquad(squad.id, { y: 40 * FIXED + FIXED / 2 });
    const before = stance(), trenchesBefore = trenches();
    expect(game.applyCommand({ type: "order", playerId: 2, squadIds: [squad.id], order: { type: "replenish" }, append: true }))
      .toBe("Move every selected squad onto friendly territory before replenishing");
    expect(stance()).toEqual(before);
    expect(trenches()).toBe(trenchesBefore);
    // Accepted on friendly land, the same order still suppresses the stance.
    game.updateSquad(squad.id, { y: 28 * FIXED + FIXED / 2 });
    expect(game.applyCommand({ type: "order", playerId: 2, squadIds: [squad.id], order: { type: "replenish" }, append: true })).toBeNull();
    expect(stance().states.find(([id]) => id === squad.id)?.[1].suppressed).toBe(true);
  });
  // Review 18 Issue 4d: a rejected occupy batch spends no admission budget and
  // keeps the squad's earlier queued occupation.
  it("rejects an occupy without spending trench admission budget", () => {
    const { game, defenders } = trenchLineScene();
    game.updateSquad(defenders[0].id, { manpower: { ...defenders[0].manpower!, capacity: 144 } });
    const before = JSON.stringify(game.expansion!.trenches.checkpoint());
    expect(game.applyCommand({ type: "occupy", playerId: 2, squadIds: [defenders[0].id], tile: game.map.ref(30, 32) }))
      .toBe("Not enough trench space");
    expect(JSON.stringify(game.expansion!.trenches.checkpoint())).toBe(before);
  });
});
