import { describe, expect, it, vi } from "vitest";
import { TrenchPositioning, type TrenchMission } from "../../src/skirmish/domain/TrenchPositioning";
import { BUDGETS, SKIRMISH } from "../../src/skirmish/content/TacticalRules";
import { skirmishVisitBudget } from "../../src/skirmish/domain/SkirmishStance";
import { secondsToTicks } from "../../src/skirmish/Protocol";
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

  it("visits every reloading skirmisher inside its trigger window, however many there are (R2-P18)", () => {
    // A 2.5 s reload leaves this many ticks before the last second, when a
    // withdrawal may no longer start.
    const window = secondsToTicks(2.5) - SKIRMISH.minRemainingTicks;
    expect(SKIRMISH.visitTicks).toBeLessThanOrEqual(window);
    for (const states of [1, 32, 96, 300, 1000]) {
      const budget = skirmishVisitBudget(states);
      expect(budget).toBeGreaterThanOrEqual(BUDGETS.skirmish);
      // Round-robin: every state is visited within ceil(states / budget) ticks.
      expect(Math.ceil(states / budget)).toBeLessThanOrEqual(SKIRMISH.visitTicks);
    }
    // In the simulation: 300 registered states are all visited within visitTicks steps.
    const ctx = buildDuel({ age: "EarlyMedieval", a: "idle", b: "idle" }), e = ctx.game.expansion!;
    const stance = e.skirmish as unknown as { states: Map<number, unknown>; cursor: number; step(): void };
    const archer = ctx.A.find((s) => e.unit(s).role === "ranged")!;
    const ids: number[] = [];
    for (let i = 0; i < 300; i++) {
      const copy = ctx.game.addSquad({ ...structuredClone(archer), id: ctx.game.allocateId(), x: archer.x + (i % 20) * 256, y: archer.y + Math.floor(i / 20) * 256, stance: "skirmish" });
      ids.push(copy.id);
      stance.states.set(copy.id, { phase: "ready" });
    }
    const start = stance.cursor;
    for (let t = 0; t < SKIRMISH.visitTicks; t++) stance.step();
    expect(stance.cursor - start).toBeGreaterThanOrEqual(stance.states.size);
  });
});
