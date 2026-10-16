import { describe, expect, it } from "vitest";
import { buildDuel, injectAiMission } from "./fixtures/AiDuel";

// I1 (M2 = R2-M6): an annihilated army releases only its own mission.
describe("AI army failure isolation", () => {
  it("keeps a sibling mission and its army when one army is destroyed", () => {
    const ctx = buildDuel({ age: "EarlyMedieval", a: "idle", b: "idle" });
    const { game, e, p1, p2, A, planner } = ctx;
    p1.ai = true;
    const first = A.slice(0, 4), second = A.slice(4);
    const lost = injectAiMission(ctx, p1, first, [84, 48], [44, 48], p2.id, "combat", "lost", true);
    const kept = injectAiMission(ctx, p1, second, [84, 48], [44, 48], p2.id, "combat", "kept", true);
    const keptArmy = kept.armyId;
    for (const s of first) game.removeSquad(s.id);
    (planner as any).diagnostics.work = 0;
    (planner as any).stepMission(p1, lost, 8);
    expect(planner.missions.has(lost.id)).toBe(false);
    expect(planner.missions.has(kept.id)).toBe(true);
    expect(planner.byPlayer.get(p1.id)).toEqual([kept.id]);
    expect(e.armies.armies.some((a) => a.id === keptArmy)).toBe(true);
    for (const s of second) expect(e.economy.assets.owns(`squad:${s.id}`, kept.id)).toBe(true);
  });
});
