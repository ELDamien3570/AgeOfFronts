import { describe, expect, it } from "vitest";
import { TICKS_PER_SECOND, type Squad } from "../../src/skirmish/Protocol";
import { buildDuel, runDuel, walledCityDuel } from "./fixtures/AiDuel";

// Roadmap Next #5 exit: AI battle competence (I2-I4, T-a to T-d).
// The duels drive the real AiArmyPlanner mission step on an injected mission.
describe("AI battle competence", { timeout: 120_000 }, () => {
  it.each([40, 41])("AI vs AI makes contact within 30 s and is decided within 150 s (T-b, seed %i)", (seed) => {
    const r = runDuel({ age: "EarlyMedieval", a: "ai", b: "ai", seconds: 150, seed });
    expect(r.firstContact).toBeGreaterThanOrEqual(0);
    expect(r.firstContact).toBeLessThanOrEqual(30);
    expect(r.decided).toBeGreaterThan(0);
    expect(r.decided).toBeLessThanOrEqual(150);
  });

  it("advances the line while only a mounted wing is fighting (I2, R2-M5)", () => {
    const o = { age: "LateMedieval", a: "idle" as const, b: "ai" as const, seconds: 30 };
    const ctx = buildDuel(o), { game, e } = ctx;
    let wingOnlyAdvance = false;
    runDuel(o, ctx, (c) => {
      const live = c.B.map((s) => game.squad(s.id)).filter((s): s is Squad => !!s && s.troops > 0);
      const army = live.length ? e.armies.armyOf(live[0].id) : undefined;
      if (!army) return;
      const role = (s: Squad) => army.slots?.find((r) => r.squadId === s.id)?.role ?? "";
      const wing = live.some((s) => s.fighting && role(s).startsWith("mounted"));
      const line = live.some((s) => s.fighting && (role(s) === "frontline" || role(s) === "ranged"));
      if (wing && !line && army.lastAdvanceTick === game.tick - 1) wingOnlyAdvance = true;
    });
    expect(wingOnlyAdvance).toBe(true);
  });

  it("breaches a ring-walled city: breach phase within 30 s, wall damage within 90 s, siege kept (I3, I4, T7)", () => {
    const { ctx, o, forts } = walledCityDuel(90), { game, e } = ctx;
    const initial = new Map(forts.barriers.map((w) => [w.id, w.health]));
    const siege = ctx.A.filter((s) => e.unit(s).role === "siege").map((s) => s.id);
    let breach = -1, damage = -1, siegeLeft = false;
    const moves = new Map<number, number>(), original = game.applyCommand.bind(game);
    (game as { applyCommand: typeof game.applyCommand }).applyCommand = (c) => {
      if (c.type === "army-order" && c.playerId === ctx.p1.id && c.order.type === "move") moves.set(c.order.tile, (moves.get(c.order.tile) ?? 0) + 1);
      return original(c);
    };
    runDuel(o, ctx, (c) => {
      const plan = c.planner.missions.get(c.planA.id);
      const t = game.tick / TICKS_PER_SECOND;
      if (breach < 0 && plan?.phase === "breach") breach = t;
      if (damage < 0 && forts.barriers.some((w) => w.health < (initial.get(w.id) ?? w.health)) || damage < 0 && forts.barriers.length < initial.size) damage = t;
      if (plan && damage < 0 && siege.some((id) => game.squad(id) && !plan.members.includes(id))) siegeLeft = true;
    });
    expect(breach).toBeGreaterThanOrEqual(0);
    expect(breach).toBeLessThanOrEqual(30);
    expect(damage).toBeGreaterThanOrEqual(0);
    expect(damage).toBeLessThanOrEqual(90);
    expect(siegeLeft).toBe(false);
    // I4 (R2-P19): at most one re-send per objective (it was 31 identical moves in 60 s).
    for (const n of moves.values()) expect(n).toBeLessThanOrEqual(2);
  });
});
