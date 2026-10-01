import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";

const map = () => { const data = new Uint8Array(250 * 125).fill(133); return new GameMapImpl(250, 125, data, data.length); };
describe("multiplayer faction roster", () => {
  it("reserves all human factions and fills the remaining twenty slots with AI", () => {
    const match = new Skirmish(map(), { seed: 42, aiCount: 18, humanNames: ["First", "Second"], ruleset: "ages-v1", tribes: false });
    expect(match.players).toHaveLength(20);
    expect(match.players.filter(player => !player.ai).map(player => player.name)).toEqual(["First", "Second"]);
    expect(match.players.filter(player => player.ai)).toHaveLength(18);
    const initialResearch = [...match.expansion!.progression.states[2].completed];
    for (let i = 0; i < 61; i++) match.step();
    expect(match.players[1].ai).toBe(false);
    expect(match.expansion!.progression.states[2].completed).toEqual(initialResearch);
  });
  it("allows a full human match with no AI, and rejects an oversized roster", () => {
    const humanNames = Array.from({ length: 20 }, (_, index) => `Friend ${index + 1}`);
    expect(new Skirmish(map(), { seed: 42, aiCount: 0, humanNames }).players.every(player => !player.ai)).toBe(true);
    // AI opponents are added on top of humans, up to the large-map maximum.
    expect(new Skirmish(map(), { seed: 42, aiCount: 21, humanNames }).players).toHaveLength(41);
    expect(() => new Skirmish(map(), { seed: 42, aiCount: 22, humanNames })).toThrow("AI opponents");
    expect(() => new Skirmish(map(), { seed: 42, aiCount: 0, humanNames: [...humanNames, "One too many"] })).toThrow("human faction roster");
  });
  it("deploys an explicit tribe count and rejects one above the maximum", () => {
    const options = { seed: 42, aiCount: 3, humanNames: ["A", "B"], ruleset: "ages-v1" as const, tribes: true };
    const tribes = (count: number) => new Skirmish(map(), { ...options, tribeCount: count }).players.filter(player => player.kind === "tribe").length;
    expect(tribes(15)).toBe(15);
    expect(tribes(25)).toBe(25);
    expect(new Skirmish(map(), options).players.filter(player => player.kind === "tribe")).toHaveLength(20);
    expect(() => new Skirmish(map(), { ...options, tribeCount: 46 })).toThrow("tribes");
  });
});
