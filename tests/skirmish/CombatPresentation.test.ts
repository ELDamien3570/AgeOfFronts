import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { ARTWORK_CATALOG } from "../../src/skirmish/client/ArtworkCatalog";
import {
  combatTargets,
  impactSize,
  shellVisual,
  squadArtworkPose,
  volleyVisual,
  weaponEmitters,
  weaponVisual,
} from "../../src/skirmish/client/CombatEffectsViewModel";
import { HudViewModel } from "../../src/skirmish/client/HudViewModel";
import {
  SkirmishViewModel,
  type SelectionState,
} from "../../src/skirmish/client/SkirmishViewModel";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNITS } from "../../src/skirmish/content/Units";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
function setup() {
  const data = new Uint8Array(80 * 50).fill(133);
  return new Skirmish(new GameMapImpl(80, 50, data, data.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
}
describe("read-only enemy inspection and weapon presentation", () => {
  it("shows an enemy's actual owner research and strength without putting it in command selections", () => {
    const m = setup(),
      enemy = m.squads.find((s) => s.playerId === 2)!;
    enemy.definitionId = "modern-archer";
    enemy.kind = "archer";
    enemy.troops = 600;
    m.expansion!.progression.states[2].completed = TECHNOLOGIES.map(
      (t) => t.id,
    );
    const selection: SelectionState = {
      selected: new Set(),
      selectedShips: new Set(),
      selectedBuilding: null,
      inspectedSquadId: enemy.id,
    };
    const vm = new SkirmishViewModel(m.snapshot(), selection),
      hud = new HudViewModel(vm);
    expect(vm.selectedSquads).toHaveLength(0);
    expect(vm.canReplenish).toBe(false);
    const card = hud.selectionCard(null);
    expect(card.mode).toBe("detail");
    if (card.mode !== "detail") throw new Error("Expected detail");
    expect(card.card.title).toContain("Marksmen");
    expect(card.card.subtitle).toContain("read only");
    expect(card.card.meter?.value).toBe(600);
    expect(
      card.card.stats.find((s) => s.label === "Ranged Armour")?.value,
    ).toContain("points");
    vm.state.squads.splice(
      vm.state.squads.findIndex((s) => s.id === enemy.id),
      1,
    );
    expect(hud.selectionCard(null).mode).toBe("empty");
  });
  it("separates bows, crossbows, gunfire, stones, cannon shells and missiles", () => {
    expect(
      [
        "stoneage-archer",
        "bronzeage-archer",
        "latemedieval-archer",
        "earlymodern-archer",
        "modern-infantry",
        "classicalage-siege",
        "earlymedieval-field-support",
        "latemedieval-siege",
        "modern-anti-air",
        "icbm",
      ].map(weaponVisual),
    ).toEqual([
      "javelin",
      "arrow",
      "bolt",
      "bullet",
      "bullet",
      "stone",
      "bolt",
      "shell",
      "rocket",
      "rocket",
    ]);
    for (const unit of UNITS.filter(
      (u) =>
        u.role === "ranged" ||
        u.role === "artillery" ||
        (u.role === "siege" && !u.placeholder),
    ))
      expect(ARTWORK_CATALOG[unit.id]?.clips?.idle, unit.id).toBeDefined();
  });
  it("rotates five weapon emitters and retains their release coordinates throughout a volley", () => {
    const down = weaponEmitters({ x: 100, y: 100 }, 0, 40, "arrow"),
      right = weaponEmitters({ x: 100, y: 100 }, -Math.PI / 2, 40, "arrow");
    expect(down).toHaveLength(5);
    expect(right[3].x - 100).toBeCloseTo(down[3].y - 100);
    const volley = {
      id: 1,
      tick: 10,
      squadId: 1,
      playerId: 1,
      definitionId: "earlymodern-archer",
      fromX: 0,
      fromY: 0,
      toX: 100,
      toY: 0,
    };
    const before = structuredClone(volley),
      from = { x: 10, y: 20 },
      to = { x: 100, y: 20 };
    const visual = volleyVisual(volley, 10, from, to, 40)!;
    expect(visual.points.map(({ x, y }) => ({ x, y }))).toEqual(
      visual.emitters,
    );
    expect(volleyVisual(volley, 14, from, to, 40)).toBeNull();
    expect(volley).toEqual(before);
  });
  it("stores firing definitions on released events, and cosmetic bomb size does not change gameplay radius", () => {
    const m = setup(),
      source = m.squads[0],
      target = m.squads.find((s) => s.playerId === 2)!;
    m.squads.splice(0, m.squads.length, source, target);
    source.definitionId = "modern-cavalry";
    source.kind = "cavalry";
    source.x = 10 * FIXED;
    source.y = 10 * FIXED;
    target.x = 12 * FIXED;
    target.y = 10 * FIXED;
    m.expansion!.battle.fight([]);
    const projectile = m.expansion!.battle.projectiles[0];
    expect(projectile.definitionId).toBe("modern-cavalry");
    expect(projectile.attackScale).toBe(1);
    const before = structuredClone(projectile),
      visual = shellVisual(
        projectile,
        projectile.impactTick,
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        40,
      );
    expect(visual.x).toBe(100);
    expect(visual.y).toBeCloseTo(100);
    expect(impactSize("impact-bomb", 2 * FIXED, 20)).toBeGreaterThan(
      impactSize("impact-shell", 2 * FIXED, 20),
    );
    expect(projectile).toEqual(before);
  });
  it("shows the release pose on the shot tick and winds up just before the next ranged shot", () => {
    const m = setup(),
      squad = m.squads[0];
    squad.definitionId = "earlymodern-archer";
    squad.lastAttackTick = 100;
    squad.nextAttackTick = 140;
    squad.fighting = true;
    expect(squadArtworkPose(squad, 100)).toEqual({
      clip: "attack",
      elapsed: 10,
    });
    expect(squadArtworkPose(squad, 110).clip).toBe("idle");
    expect(squadArtworkPose(squad, 135)).toEqual({
      clip: "attack",
      elapsed: 5,
    });
    expect(squad.lastAttackTick).toBe(100);
  });
  it("shows own committed missile and bombing targets and removes resolved or foreign targets", () => {
    const m = setup(),
      state = m.snapshot();
    state.expansion!.aircraft.push({
      id: 20,
      playerId: 1,
      definitionId: "bomber",
      airfieldId: 1,
      health: 100,
      x: 0,
      y: 0,
      target: { x: 40 * FIXED, y: 40 * FIXED },
      state: "outbound",
      reloadTick: 0,
      fuelTicks: 500,
    });
    expect(combatTargets(state).map((t) => t.kind)).toEqual(["bombing"]);
    state.expansion!.aircraft[0].state = "returning";
    expect(combatTargets(state)).toHaveLength(0);
  });
});
