import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { UnitPresentation } from "../../src/skirmish/client/UnitPresentation";
import { UNIT } from "../../src/skirmish/content/Units";
import { FIXED, type Building } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

function fixture(id = "bronzeage-siege") {
  const terrain = new Uint8Array(80 * 50).fill(133);
  const m = new Skirmish(new GameMapImpl(80, 50, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  const unit = m.squads.find((s) => s.playerId === 1)!,
    enemy = m.squads.find((s) => s.playerId === 2)!;
  m.owners.fill(0); // Neutral occupation arena, independent of random camp positions.
  m.squads.splice(0, m.squads.length, unit, enemy);
  unit.definitionId = id;
  unit.kind = UNIT.get(id)!.line;
  unit.x = 30.5 * FIXED;
  unit.y = 20.5 * FIXED;
  enemy.x = 65.5 * FIXED;
  enemy.y = 40.5 * FIXED;
  for (const s of m.squads) {
    s.order = { type: "hold" };
    s.path = [];
    s.queuedOrders = [];
  }
  return { m, unit, enemy, tile: m.tileOf(unit) };
}
function building(
  m: Skirmish,
  type: Building["type"],
  x: number,
  y: number,
  health = 1200,
): Building {
  const b = m.addBuilding({
    id: m.allocateId(),
    playerId: 2,
    type,
    tile: m.map.ref(x, y),
    remainingTicks: 0,
    age: "StoneAge" as const,
    health,
    maxHealth: health,
  });

  return b;
}

describe("slow assault occupation", () => {
  it.each(["stoneage-siege", "bronzeage-siege", "bronzeage-field-support"])(
    "%s captures only its undefended local footprint in four ticks",
    (id) => {
      const { m, unit, tile } = fixture(id);
      m.owners.fill(2);
      for (let i = 0; i < 3; i++) m.step();
      expect(m.owners[tile]).toBe(2);
      m.step();
      expect(m.owners[tile]).toBe(1);
      expect(m.owners[m.map.ref(40, 20)]).toBe(2);
      expect(UNIT.get(id)!.speedPercent).toBe(25);
      expect(m.ordinarySpeed(unit)).toBeLessThan(
        m.ordinarySpeed({
          ...unit,
          definitionId: "stoneage-infantry",
          kind: "infantry",
        }),
      );
    },
  );
  it("denies accelerated capture under resistance from a noncapturing enemy unit", () => {
    const { m, enemy, tile } = fixture();
    m.owners[tile] = 2;
    enemy.definitionId = "modern-launcher";
    enemy.x = 35.5 * FIXED;
    enemy.y = 20.5 * FIXED;
    for (let i = 0; i < 4; i++) m.step();
    expect(m.owners[tile]).toBe(2);
    enemy.embarkedOn = 999;
    m.step();
    expect(m.owners[tile]).toBe(1);
  });
  it.each(["tower", "trench", "gun-nest"] as const)(
    "%s prevents fast capture until destroyed",
    (type) => {
      const { m, tile } = fixture();
      const b = building(m, type, 35, 20);
      m.updateBuilding((b).id, { nextAttackTick: 1000 }); // Isolate occupation resistance from lethal gunfire.
      for (let i = 0; i < 4; i++) m.step();
      expect(m.owners[tile]).toBe(0);
      m.updateBuilding((b).id, { health: 0 });
      m.step();
      expect(m.owners[tile]).toBe(1);
    },
  );
  it("does not bypass an intact enemy wall and captures behind it only after the breach", () => {
    const { m } = fixture();
    const a = building(m, "tower", 32, 18),
      b = building(m, "tower", 32, 23);
    const forts = m.expansion!.fortifications;
    forts.addTower(b, forts.towerPlan(b.tile, 2, "StoneAge", [a, b]));
    forts.barriers[0].remainingTicks = 0;
    const tile = m.map.ref(33, 20);
    for (let i = 0; i < 4; i++) m.step();
    expect(m.owners[tile]).toBe(0);
    m.updateBuilding((a).id, { health: 0 });
    m.updateBuilding((b).id, { health: 0 });
    forts.barriers[0].health = 0;
    for (let i = 0; i < 4; i++) m.step();
    expect(m.owners[tile]).toBe(1);
  });
  it("keeps ranged artillery from capturing land", () => {
    const { m, tile } = fixture("modern-siege");
    for (let i = 0; i < 35; i++) m.step();
    expect(m.owners[tile]).toBe(0);
  });
});

describe("structural damage and firing presentation", () => {
  it.each(["bronzeage-siege", "modern-siege"])(
    "%s damages and destroys a building through the normal step and snapshot pipeline",
    (id) => {
      const { m, unit } = fixture(id);
      const b = building(
        m,
        id === "bronzeage-siege" ? "tower" : "city",
        id === "bronzeage-siege" ? 31 : 35,
        20,
        2000,
      );
      unit.structureTarget = { buildingId: b.id };
      const encoder = new SnapshotEncoder(),
        decoder = new SnapshotDecoder();
      decoder.decode(encoder.encode(m.snapshot()));
      for (let i = 0; i < 1000 && (b.health ?? 0) === b.maxHealth; i++)
        m.step();
      const damaged = decoder
        .decode(encoder.encode(m.snapshot()))
        .buildings.find((x) => x.id === b.id);
      expect(b.health).toBeLessThan(b.maxHealth!);
      if (damaged) expect(damaged.health).toBe(b.health);
      for (let i = 0; i < 1000 && m.buildings.includes(b); i++) m.step();
      expect(m.buildings).not.toContain(b);
      expect(
        decoder
          .decode(encoder.encode(m.snapshot()))
          .buildings.some((x) => x.id === b.id),
      ).toBe(false);
    },
  );
  it("faces building and nearest wall targets, preserving the authoritative shot heading during recovery", () => {
    const { m, unit } = fixture("modern-siege");
    const b = building(m, "city", 35, 20);
    unit.structureTarget = { buildingId: b.id };
    unit.fighting = true;
    const presentation = new UnitPresentation(),
      before = JSON.stringify(m.snapshot());
    presentation.update(m.snapshot());
    expect(presentation.firingAngle(unit.id)).toBeCloseTo(-Math.PI / 2);
    expect(JSON.stringify(m.snapshot())).toBe(before);
    m.expansion!.battle.fire(
      unit,
      { x: unit.x, y: unit.y - 5 * FIXED },
      UNIT.get(unit.definitionId!)!.attack,
      100,
      "shell",
      20,
      0,
      unit.definitionId,
    );
    unit.lastAttackTick = m.tick;
    unit.moved = true;
    presentation.update(m.snapshot());
    expect(presentation.firingAngle(unit.id, m.tick)).toBeCloseTo(-Math.PI);
    expect(presentation.firingAngle(unit.id, m.tick + 100)).toBeCloseTo(
      -Math.PI / 2,
    );
    unit.structureTarget = { barrierId: 500 };
    m.expansion!.fortifications.barriers.push({
      id: 500,
      a: 1,
      b: 2,
      playerId: 2,
      age: "StoneAge",
      health: 2000,
      maxHealth: 2000,
      remainingTicks: 0,
      tiles: [m.map.ref(25, 25), m.map.ref(30, 24)],
    });
    presentation.update(m.snapshot());
    expect(presentation.firingAngle(unit.id)).toBeCloseTo(0);
  });
});
