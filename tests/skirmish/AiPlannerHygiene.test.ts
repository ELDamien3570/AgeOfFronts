import { describe, expect, it, vi } from "vitest";
import { TrenchPositioning, type TrenchMission } from "../../src/skirmish/domain/TrenchPositioning";
import { BUDGETS } from "../../src/skirmish/content/TacticalRules";
import { buildDuel } from "./fixtures/AiDuel";
import { trenchLineScene } from "./fixtures/TrenchLine";

// I11: R2-L11 (dead flank phase), R2-L12 (trench-lost recover), R2-P18 (stance budget).
describe("AI planner hygiene (I11)", () => {
  it("restores a legacy flank phase as engage instead of a phase nothing advances", () => {
    const ctx = buildDuel({ age: "EarlyMedieval", a: "ai", b: "idle" });
    const saved = ctx.planner.checkpoint();
    (saved.missions[0][1] as { phase: string }).phase = "flank";
    ctx.planner.restore(saved);
    expect(ctx.planner.missions.get(ctx.planA.id)!.phase).toBe("engage");
  });

  it("regroups home and restarts the recover clock when a held trench is lost", () => {
    const { game, defenders } = trenchLineScene(), e = game.expansion!;
    expect(game.applyCommand({ type: "create-army", playerId: 2, squadIds: defenders.map((s) => s.id) })).toBeNull();
    const army = e.armies.armyOf(defenders[0].id)!, positioning = new TrenchPositioning(e), player = game.players.find((p) => p.id === 2)!;
    const plan: TrenchMission = { purpose: "defense", targetTile: game.map.ref(30, 33), phase: "advance", reason: "", since: 0, home: game.map.ref(5, 5) };
    const order = vi.fn(() => true);
    expect(positioning.step(plan, player, army, defenders, order)).toBe(true);
    for (let i = 0; i < 200; i++) game.step();
    positioning.step(plan, player, army, defenders, order);
    e.fortifications.updateBarrier(e.fortifications.barriers[0].id, { health: 0 });
    e.trenches.step();
    expect(positioning.step(plan, player, army, defenders, order)).toBe(false);
    expect(plan.phase).toBe("recover");
    expect(plan.since).toBe(game.tick);
    expect(order).toHaveBeenCalledWith({ type: "regroup", tile: game.map.ref(5, 5) });
  });

  it("evaluates up to 32 skirmish stances per tick", () => {
    expect(BUDGETS.skirmish).toBe(32);
    const ctx = buildDuel({ age: "EarlyMedieval", a: "idle", b: "idle" }), e = ctx.game.expansion!;
    const stance = e.skirmish as unknown as { states: Map<number, unknown>; step(): void };
    // 20 stale states for squads that no longer exist: one step clears them all.
    for (let i = 0; i < 20; i++) stance.states.set(900000 + i, {});
    stance.step();
    expect(stance.states.size).toBe(0);
  });
});
