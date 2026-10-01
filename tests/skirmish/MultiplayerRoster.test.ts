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
    expect(() => new Skirmish(map(), { seed: 42, aiCount: 1, humanNames })).toThrow("AI opponents");
  });
});
