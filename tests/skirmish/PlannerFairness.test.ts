import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { RoutePlanner } from "../../src/skirmish/RoutePlanner";
import type { PlannerCaller } from "../../src/skirmish/RuntimeDiagnostics";

function fixture() {
  const map = new GameMapImpl(80, 80, new Uint8Array(6400).fill(133), 6400);
  const turns: string[] = [];
  const planner = new RoutePlanner<{ playerId: number; caller: PlannerCaller }>(
    new LandPaths(map, false), new WaterPaths(map, false), {
      identity: r => r.context, valid: () => true, obstacleRevision: () => "0",
      blocked: () => undefined, completed: () => {},
      prepare: r => { turns.push(r.key); return { work: 1 }; },
    });
  const request = (key: string, playerId: number, caller: PlannerCaller = "admission") =>
    planner.request({key, start: 0, goal: 6399, prepare: true, water: false,
      createdTick: 0, obstacleRevision: "0", context: {playerId, caller}});
  return { planner, turns, request };
}

describe("P11 player and command class shares", () => {
  it("gives a sparse faction equal turns despite another faction's many jobs", () => {
    const f = fixture();
    for (let i = 0; i < 20; i++) f.request(`crowded:${i}`, 1);
    f.request("sparse", 2);
    for (let tick = 0; tick < 12; tick++) expect(f.planner.step(tick, 1, 1)).toBe(1);
    expect(f.turns.filter(key => key === "sparse")).toHaveLength(6);
  });
  it("rotates classes within a player's share, retaining old FIFO jobs under arrivals", () => {
    const f = fixture();
    for (let i = 0; i < 10; i++) f.request(`human:${i}`, 1);
    f.request("defense", 1, "defense"); f.request("trade", 1, "trade");
    for (let tick = 0; tick < 12; tick++) {
      f.request(`new:${tick}`, 1);
      f.planner.step(tick, 1, 1);
    }
    expect(f.turns.filter(key => key === "defense")).toHaveLength(4);
    expect(f.turns.filter(key => key === "trade")).toHaveLength(4);
    expect(f.turns.filter(key => key.startsWith("human:"))).toEqual(["human:0", "human:1", "human:2", "human:3"]);
  });
  it("persists the next faction/class turn across restore", () => {
    const a = fixture(), b = fixture();
    a.request("one", 1); a.request("two", 2); a.request("trade", 1, "trade");
    a.planner.step(0, 1, 1); b.planner.restore(a.planner.checkpoint());
    a.turns.length = 0;
    for (let tick = 1; tick < 13; tick++) {
      expect(b.planner.step(tick, 1, 1)).toBe(a.planner.step(tick, 1, 1));
    }
    expect(b.turns).toEqual(a.turns);
    expect(b.planner.checkpoint()).toEqual(a.planner.checkpoint());
  });
});
