import { describe, expect, it } from "vitest";
import { buildDuel } from "./fixtures/AiDuel";

// I8: M3 (human armies on AI handover) and L1 (eliminated AI state).
describe("AI control release", () => {
  it("hands a human army to the AI with automatic tactics and no stale queue", () => {
    const { game, e, p1, A, map } = buildDuel({ age: "EarlyMedieval", a: "idle", b: "idle" });
    p1.ai = false;
    expect(game.applyCommand({ type: "create-army", playerId: p1.id, squadIds: A.map((s) => s.id) })).toBeNull();
    const army = e.armies.armyOf(A[0].id)!;
    expect(game.applyCommand({ type: "army-order", playerId: p1.id, armyId: army.id, order: { type: "move", tile: map.ref(60, 48) } })).toBeNull();
    for (let i = 0; i < 40 && army.order.type !== "move"; i++) game.step();
    expect(game.applyCommand({ type: "army-order", playerId: p1.id, armyId: army.id, order: { type: "move", tile: map.ref(60, 30) }, append: true })).toBeNull();
    expect(army.queuedOrders.length).toBe(1);
    expect(army.autoTactics).toBe(false);
    game.setAiController(p1.id, true);
    const kept = e.armies.armyOf(A[0].id)!;
    expect(kept.id).toBe(army.id);
    expect(kept.autoTactics).toBe(true);
    expect(kept.queuedOrders).toEqual([]);
    expect(kept.order).toEqual({ type: "move", tile: map.ref(60, 48) });
  });

  it("releases an eliminated AI faction's missions and leases", () => {
    const { game, e, p1, A, planA, planner } = buildDuel({ age: "EarlyMedieval", a: "ai", b: "idle" });
    expect(planner.missions.has(planA.id)).toBe(true);
    for (const s of A) game.removeSquad(s.id);
    game.step();
    expect(p1.eliminated).toBe(true);
    expect(planner.missions.size).toBe(0);
    expect(planner.byPlayer.has(p1.id)).toBe(false);
    expect([...e.economy.assets.leases.values()].some((l) => l.playerId === p1.id)).toBe(false);
  });
});
