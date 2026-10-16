import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { aiBackgroundScale } from "../../src/skirmish/domain/AiEconomicDirector";
import { COAST_SHORTLIST } from "../../src/skirmish/domain/AiCoastPlanner";

function game(aiCount: number) {
  const width = 160, height = 120, data = new Uint8Array(width * height).fill(133);
  for (let y = 0; y < height; y++) for (let x = 120; x < width; x++) data[y * width + x] = 0;
  return new Skirmish(new GameMapImpl(width, height, data, data.filter((v) => v & 128).length), {
    seed: 42, aiCount, tribes: false, runAi: true, ruleset: "ages-v1", aiEconomy: true, aiNaval: true, deferredPlanning: true,
  });
}

// I9: P2 / P23 (allowances scale with faction count), P3 (coast turns), P4 (front scans).
describe("AI background budgets scale with the faction count (I9)", () => {
  it("scales the allowance unit per 8 AI-economy factions", () => {
    expect([1, 8, 9, 16, 45].map(aiBackgroundScale)).toEqual([1, 1, 2, 2, 6]);
  });

  it("gives every per-faction controller one turn per scale unit each tick", () => {
    const g = game(14), e = g.expansion!;
    g.tick = 80;
    const naval = vi.spyOn(e.economy.naval, "step"), coasts = vi.spyOn(e.economy.coasts, "step");
    e.economy.step();
    // 14 AI factions -> scale 2: two naval turns of 16 each, two coast turns.
    expect(naval.mock.calls.map((c) => c[0])).toEqual([16, 16]);
    expect(coasts).toHaveBeenCalledTimes(2);
    expect(e.economy.diagnostics.backgroundWork).toBeLessThanOrEqual(128 * 2);
  });

  it("does not spend a coast turn on a non-AI faction, and quotes a full shortlist at once (P3)", () => {
    const g = game(1), e = g.expansion!, coasts = e.economy.coasts as unknown as { cursor: number; goals: Map<number, { phase: string; shortlist: unknown[]; index: number }>; step(b?: number): number };
    const ai = g.players.find((p) => p.ai)!, human = g.players.find((p) => !p.ai)!;
    coasts.cursor = g.players.indexOf(human);
    coasts.step(8);
    const goal = coasts.goals.get(ai.id);
    expect(goal).toBeDefined();
    goal!.phase = "scan";
    goal!.shortlist = Array.from({ length: COAST_SHORTLIST }, (_, i) => ({ tile: g.map.ref(119, i), water: g.map.ref(120, i), sea: 0, score: 1 }));
    coasts.cursor = g.players.indexOf(ai);
    coasts.step(1);
    expect(goal!.phase).not.toBe("scan");
  });

  it("finishes a modern-front assessment while the roster churns (P4)", () => {
    const g = game(1), e = g.expansion!, ai = g.players.find((p) => p.ai)!;
    const fronts = e.economy.modernFronts as unknown as { assessment(section: unknown, budget: number): number };
    const section = { id: "s", playerId: ai.id, anchor: ai.base, reserve: ai.base, members: [] } as { assessment?: { cursor: number } };
    const before = g.squads.length;
    expect(before).toBeGreaterThan(1);
    fronts.assessment(section, 1);
    expect(section.assessment!.cursor).toBe(1);
    const template = structuredClone(g.squads[0]);
    g.addSquad({ ...template, id: g.allocateId(), x: 5 * FIXED, y: 5 * FIXED } as Squad);
    fronts.assessment(section, 1);
    expect(section.assessment!.cursor).toBe(2);
  });
});
