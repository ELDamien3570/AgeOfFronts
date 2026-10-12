import { describe, expect, it } from "vitest";
import {
  TrenchPositioning,
  type TrenchMission,
} from "../../src/skirmish/domain/TrenchPositioning";
import { trenchLineScene } from "./fixtures/TrenchLine";
describe("AI trench and fire-retreat reconciliation", () => {
  it("uses shared reservations, retains commitment, and releases a destroyed position", () => {
    const { game, defenders } = trenchLineScene(),
      e = game.expansion!;
    expect(
      game.applyCommand({
        type: "create-army",
        playerId: 2,
        squadIds: defenders.map((s) => s.id),
      }),
    ).toBeNull();
    const army = e.armies.armyOf(defenders[0].id)!,
      positioning = new TrenchPositioning(e),
      player = game.players.find((p) => p.id === 2)!;
    const plan: TrenchMission = {
      purpose: "defense",
      targetTile: game.map.ref(30, 33),
      phase: "advance",
      reason: "",
    };
    expect(positioning.step(plan, player, army, defenders)).toBe(true);
    expect(plan.kind).toBe("hold-trench");
    expect(e.trenches.occupants.size).toBe(2);
    for (let i = 0; i < 200; i++) game.step();
    positioning.step(plan, player, army, defenders);
    expect(plan.trench?.phase).toBe("hold");
    plan.targetTile = game.map.ref(50, 50);
    expect(positioning.step(plan, player, army, defenders)).toBe(true);
    const trench = e.fortifications.barriers[0];
    e.fortifications.updateBarrier(trench.id, { health: 0 });
    e.trenches.step();
    expect(positioning.step(plan, player, army, defenders)).toBe(false);
    expect(plan.trench).toBeUndefined();
    expect(plan.phase).toBe("recover");
  });
  it("fire-retreat enables the one reload evaluator and direct Hold suppresses it", () => {
    const { game, defenders, riders } = trenchLineScene(true),
      e = game.expansion!;
    game.applyCommand({
      type: "create-army",
      playerId: 2,
      squadIds: defenders.map((s) => s.id),
    });
    const army = e.armies.armyOf(defenders[0].id)!;
    expect(
      game.applyCommand({
        type: "army-order",
        playerId: 2,
        armyId: army.id,
        order: { type: "fire-retreat", targetId: riders[0].id },
      }),
    ).toBeNull();
    expect(army.posture).toBe("skirmish");
    game.applyCommand({
      type: "army-order",
      playerId: 2,
      armyId: army.id,
      order: { type: "hold" },
    });
    e.skirmish.step();
    expect(
      defenders.every((s) => game.squad(s.id)!.lastWithdrawTick === undefined),
    ).toBe(true);
  });
});
