import { describe, expect, it } from "vitest";
import { TICKS_PER_SECOND, type Squad } from "../../src/skirmish/Protocol";
import { armyLineFighting } from "../../src/skirmish/domain/Armies";
import type { Army } from "../../src/skirmish/domain/Definitions";
import { buildDuel, duelMatrix, runDuel, walledCityDuel } from "./fixtures/AiDuel";

// Roadmap Next #5 exit: AI battle competence (I2-I4, T-a to T-d).
// The duels drive the real AiArmyPlanner mission step on an injected mission.
describe("AI battle competence", { timeout: 120_000 }, () => {
  it("beats an attack-nearest opponent in at least 2 of 4 Early Medieval 9v9 duels (T-a)", () => {
    const m = duelMatrix("EarlyMedieval", "ai", "naive", 150, 2);
    expect(m.wins).toBeGreaterThanOrEqual(2);
    // AI archers no longer stand in melee far more than the opponent's.
    expect(m.mineRanged).toBeLessThanOrEqual(2 * Math.max(1, m.foeRanged));
  });

  it.each([40, 41])("AI vs AI makes contact within 30 s and is decided within 150 s (T-b, seed %i)", (seed) => {
    const r = runDuel({ age: "EarlyMedieval", a: "ai", b: "ai", seconds: 150, seed });
    expect(r.firstContact).toBeGreaterThanOrEqual(0);
    expect(r.firstContact).toBeLessThanOrEqual(30);
    expect(r.decided).toBeGreaterThan(0);
    expect(r.decided).toBeLessThanOrEqual(150);
  });

  it("lands at least one charge bonus in a 60 s Late Medieval duel (T-c)", () => {
    const m = duelMatrix("LateMedieval", "ai", "naive", 60, 1);
    expect(m.bonus).toBeGreaterThanOrEqual(1);
  });

  it("holds the advance creep only for a fighting line, not a fighting mounted wing (I2, R2-M5)", () => {
    const army = { slots: [{ squadId: 1, role: "frontline" }, { squadId: 2, role: "ranged" }, { squadId: 3, role: "mounted-left" }] } as unknown as Pick<Army, "slots">;
    expect(armyLineFighting(army, [{ id: 1, fighting: false }, { id: 2, fighting: false }, { id: 3, fighting: true }])).toBe(false);
    expect(armyLineFighting(army, [{ id: 1, fighting: true }, { id: 3, fighting: false }])).toBe(true);
    expect(armyLineFighting(army, [{ id: 2, fighting: true }])).toBe(true);
    // The live advance still happens in a Late Medieval engagement against a passive line.
    const o = { age: "LateMedieval", a: "idle" as const, b: "ai" as const, seconds: 60 };
    const ctx = buildDuel(o), { game, e } = ctx;
    let advanced = false;
    runDuel(o, ctx, (c) => {
      const live = c.B.map((s) => game.squad(s.id)).filter((s): s is Squad => !!s && s.troops > 0);
      const a = live.length ? e.armies.armyOf(live[0].id) : undefined;
      if (a?.lastAdvanceTick !== undefined) advanced = true;
    });
    expect(advanced).toBe(true);
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
    // I4 (R2-P19): one move per objective change (breach opened, approach chosen),
    // not a re-send every think: it was 31 identical moves in 60 s.
    expect([...moves.values()].reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(8);
  });
});
