import { describe, expect, it } from "vitest";
import {
  BattleLabModel,
  battleDefinition,
  type BattleEntry,
} from "../../src/skirmish/client/lab/BattleLabModel";
import { UNIT } from "../../src/skirmish/content/Units";
import { remainingHealth } from "../../src/skirmish/domain/Manpower";
import { TICKS_PER_SECOND } from "../../src/skirmish/Protocol";

function entries(): BattleEntry[] {
  return [
    {
      side: 1,
      definitionId: "bronzeage-infantry",
      formations: 1,
      soldiers: 1,
      variant: "base",
      shape: "mass",
    },
    {
      side: 2,
      definitionId: "stoneage-infantry",
      formations: 1,
      soldiers: 2,
      variant: "base",
      shape: "mass",
    },
  ];
}
describe("Balance Preview Page", () => {
  it("uses the promoted mainline armour curve", () => {
    for (const [id, armour] of [
      ["stoneage-infantry", 0],
      ["bronzeage-infantry", 4],
      ["classicalage-infantry", 8],
    ] as const)
      expect(UNIT.get(id)!.meleeArmour).toBe(armour);
  });
  it("creates precisely the configured armies without production or strategic AI", () => {
    const model = new BattleLabModel(entries());
    expect(
      model.game.squads.map((s) => [s.playerId, s.definitionId, s.troops]),
    ).toEqual([
      [1, "bronzeage-infantry", 1],
      [2, "stoneage-infantry", 2],
    ]);
    expect(model.game.players.every((p) => !p.ai)).toBe(true);
    expect(model.game.buildings).toHaveLength(0);
    expect(model.summary(2).troops).toBe(2);
  });
  it("runs the actual movement and damage paths to a completed fight", () => {
    const model = new BattleLabModel(entries(), 4);
    const starting = model.game.squads.map((s) => ({
      x: s.x,
      y: s.y,
      hp: remainingHealth(s),
    }));
    model.start();
    for (let i = 0; i < 90 * TICKS_PER_SECOND && !model.finished; i++)
      model.step();
    expect(model.finished).toBe(true);
    expect(model.summary(1).losses + model.summary(2).losses).toBeGreaterThan(
      0,
    );
    expect(
      model.game.squads.some(
        (s) => s.x !== starting[0].x || s.y !== starting[0].y,
      ),
    ).toBe(true);
  });
  it("leaves a controlled side’s orders alone while its opponent attacks", () => {
    const model = new BattleLabModel(entries(), 8);
    model.controlledSide = 1;
    model.start();
    const own = model.game.squads.find((s) => s.playerId === 1)!;
    for (let i = 0; i < 2 * TICKS_PER_SECOND; i++) model.step();
    expect(own.order.type).toBe("hold");
    expect(model.game.squads.find((s) => s.playerId === 2)!.order.type).toBe(
      "attack",
    );
    expect(
      model.command({
        type: "order",
        playerId: 1,
        squadIds: [own.id],
        order: { type: "move", tile: model.game.map.ref(20, 48) },
      }),
    ).toBeNull();
    for (let i = 0; i < TICKS_PER_SECOND; i++) model.step();
    expect(own.order.type).toBe("move");
  });
  it("keeps two copies of one recipe independently editable without changing live content", () => {
    const baseline = structuredClone(UNIT.get("bronzeage-infantry")!);
    const rows = entries();
    rows[1].definitionId = "bronzeage-infantry";
    rows[0].tuning = {
      hp: 200,
      meleeArmour: 50,
      speedPercent: 120,
      melee: { damage: 80, rpm: 60, bonuses: { mounted: 12 } },
    };
    const model = new BattleLabModel(rows);
    const [a, b] = model.game.squads;
    expect(model.game.expansion!.unit(a).meleeAttack!.damage).toBe(80);
    expect(model.game.expansion!.unit(b).meleeAttack!.damage).toBe(
      baseline.meleeAttack!.damage,
    );
    expect(a.manpower!.hp).toBe(200000);
    expect(model.game.expansion!.unit(a).speedPercent).toBe(120);
    expect(UNIT.get(baseline.id)).toEqual(baseline);
    expect(() => model.game.checkpoint()).toThrow("roster");
    const reset = new BattleLabModel(rows);
    expect(
      reset.game.squads.map((s) => [s.definitionId, s.troops, s.manpower]),
    ).toEqual(
      model.game.squads.map((s) => [s.definitionId, s.troops, s.manpower]),
    );
  });
  it("commits ranged tuning to the projectile rather than the global recipe", () => {
    const rows = entries();
    rows[0].definitionId = "bronzeage-archer";
    rows[0].soldiers = 24;
    rows[0].tuning = {
      ranged: {
        damage: 123,
        rangeTiles: 12,
        rpm: 60,
        reloadSeconds: 1,
        accuracyNear: 90,
        accuracyFar: 80,
      },
    };
    rows[1].tuning = { hp: 100000 };
    const model = new BattleLabModel(rows, 8);
    model.start();
    for (
      let i = 0;
      i < 8 * TICKS_PER_SECOND &&
      !model.game.expansion!.battle.projectiles.length;
      i++
    )
      model.step();
    const projectile = model.game.expansion!.battle.projectiles[0];
    expect(projectile).toBeDefined();
    expect(projectile.damage).toBe(123);
    expect(UNIT.get("bronzeage-archer")!.rangedAttack!.damage).not.toBe(123);
  });
  it("rejects invalid rosters and invalid local stats", () => {
    const rows = entries();
    rows[0].formations = 25;
    expect(() => new BattleLabModel(rows)).toThrow("24");
    rows[0].formations = 1;
    rows[0].soldiers = 10000;
    expect(() => new BattleLabModel(rows)).toThrow("capacity");
    expect(() => battleDefinition("bronzeage-infantry", { hp: NaN })).toThrow(
      "Stat",
    );
    expect(() =>
      battleDefinition("bronzeage-infantry", { ranged: { damage: 1 } }),
    ).toThrow("weapon");
    const empty = new BattleLabModel([]);
    expect(() => empty.start()).toThrow("each side");
  });
});
