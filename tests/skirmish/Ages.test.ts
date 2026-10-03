import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  TECHNOLOGIES,
  technologyAt,
  treeWorkload,
  validateTechnologies,
} from "../../src/skirmish/content/Technology";
import { UNIT, UNITS, defaultUnit } from "../../src/skirmish/content/Units";
import {
  damageAmount,
  defenceOf,
  effectiveDamageShares,
  promotionLevel,
} from "../../src/skirmish/domain/Combat";
import { AGES, TREES } from "../../src/skirmish/domain/Definitions";
import {
  advanceRejection,
  researchRejection,
  treeCompletion,
} from "../../src/skirmish/domain/Progression";
import { FIXED, type Building, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
const make = () => {
  const data = new Uint8Array(96 * 64).fill(133);
  return new Skirmish(new GameMapImpl(96, 64, data, data.length), {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
};
const pos = (s: Squad, x: number, y: number) => {
  s.x = (x + 0.5) * FIXED;
  s.y = (y + 0.5) * FIXED;
  s.order = { type: "hold" };
  s.path = [];
  s.moved = false;
};
const complete = (m: Skirmish) => {
  for (const p of m.players) {
    const s = m.expansion!.progression.states[p.id];
    s.age = "Modern";
    s.completed = TECHNOLOGIES.map((t) => t.id);
    p.gold = 10000000;
    p.reserves = 100000;
  }
};
const building = (
  m: Skirmish,
  type: Building["type"],
  tile: number,
  playerId = 1,
  age: (typeof AGES)[number] = "StoneAge",
) => {
  const b: Building = m.addBuilding({
    id: m.allocateId(),
    type,
    tile,
    playerId,
    remainingTicks: 0,
    age,
    health: 2000,
    maxHealth: 2000,
  });

  return b;
};
const step = (m: Skirmish, n: number) => {
  for (let i = 0; i < n; i++) m.step();
};
describe("age progression and authoritative definitions", () => {
  it("validates 85 named nodes, including the fifth Bronze Warfare technology", () => {
    expect(() => validateTechnologies()).not.toThrow();
    expect(TECHNOLOGIES).toHaveLength(85);
    for (const age of AGES)
      for (const tree of TREES)
        expect(
          TECHNOLOGIES.filter((t) => t.age === age && t.tree === tree),
        ).toHaveLength(age === "BronzeAge" && tree === "warfare" ? 5 : 4);
  });
  it("opens with exactly three flint infantry, three branch grants and no regular buildings", () => {
    const m = make();
    expect(m.buildings).toHaveLength(0);
    for (const p of m.players) {
      expect(m.squads.filter((s) => s.playerId === p.id)).toHaveLength(3);
      expect(m.expansion!.progression.states[p.id].completed).toHaveLength(3);
      expect(
        m.squads
          .filter((s) => s.playerId === p.id)
          .every((s) => s.definitionId === "stoneage-infantry"),
      ).toBe(true);
    }
    expect(m.players[0].gold).toBeGreaterThanOrEqual(1500);
  });
  it("researches all seven ages through legal commands with gold-only parallel jobs", () => {
    const m = make(),
      p = m.players[0],
      e = m.expansion!,
      s = e.progression.states[1];
    p.gold = 10000000;
    const before = p.reserves;
    for (const age of AGES) {
      expect(s.age).toBe(age);
      while (
        TECHNOLOGIES.some((t) => t.age === age && !s.completed.includes(t.id))
      ) {
        for (const tree of TREES) {
          const next = TECHNOLOGIES.find(
            (t) =>
              t.age === age &&
              t.tree === tree &&
              !researchRejection(s, p.gold, t.id),
          );
          if (next)
            expect(
              m.applyCommand({
                type: "research",
                playerId: 1,
                technologyId: next.id,
              }),
            ).toBeNull();
        }
        const jobs = Object.values(s.research);
        expect(jobs.length).toBeGreaterThan(0);
        for (
          let i = 0, n = Math.max(...jobs.map((j) => j!.remainingTicks));
          i < n;
          i++
        )
          e.progression.step(m.players);
      }
      expect(
        TREES.every((t) => treeCompletion(s, t) === treeWorkload(age, t)),
      ).toBe(true);
      if (age !== "Modern") {
        expect(m.applyCommand({ type: "advance-age", playerId: 1 })).toBeNull();
        while (s.advancement) e.progression.step(m.players);
      }
    }
    expect(s.completed).toHaveLength(85);
    expect(p.reserves).toBe(before);
    expect(advanceRejection(s, p.gold)).toMatch(/final/);
    expect(m.winner).toBeNull();
  });
  it("allows branch two and three independently, rejects future ages, and requires current-age trees", () => {
    const m = make(),
      p = m.players[0],
      s = m.expansion!.progression.states[1];
    p.gold = 999999;
    expect(
      m.applyCommand({
        type: "research",
        playerId: 1,
        technologyId: technologyAt("StoneAge", "warfare", 3).id,
      }),
    ).toBeNull();
    expect(
      m.applyCommand({
        type: "research",
        playerId: 1,
        technologyId: technologyAt("BronzeAge", "warfare", 1).id,
      }),
    ).toMatch(/age/);
    expect(
      m.applyCommand({
        type: "research",
        playerId: 1,
        technologyId: technologyAt("StoneAge", "warfare", 2).id,
      }),
    ).toMatch(/already researching/);
    expect(advanceRejection(s, p.gold)).toMatch(/two/);
    s.age = "BronzeAge";
    s.completed = TECHNOLOGIES.filter((t) => t.age === "StoneAge").map(
      (t) => t.id,
    );
    expect(advanceRejection(s, p.gold)).toMatch(/current-age/);
    expect(
      researchRejection(s, p.gold, technologyAt("StoneAge", "naval", 1).id),
    ).toMatch(/completed/);
  });
  it("retains firearm, tank, siege and anti-air target contracts separate from art categories", () => {
    expect(defaultUnit("infantry", "EarlyModern").attack.channel).toBe(
      "ranged",
    );
    const tank = defaultUnit("cavalry", "Modern");
    expect(tank.tags).toEqual(["vehicle"]);
    expect(tank.cost.items?.horses).toBeUndefined();
    expect(tank.cost.items).toEqual({
      "equipment:modern-vehicle": 1,
      "equipment:modern-siege": 1,
    });
    expect(defaultUnit("cavalry", "EarlyModern").charge).toBeUndefined();
    expect(UNIT.get("modern-anti-air")!.attack.targets).toEqual(["aircraft"]);
    expect(UNITS.filter((u) => u.role === "siege")).toHaveLength(7);
  });
});
describe("supply conservation and deployment", () => {
  it("consumes inputs once, produces once, and discards captured work without moving stockpiles", () => {
    const m = make();
    complete(m);
    const e = m.expansion!,
      p = m.players[0],
      inv = e.supply.inventories[1],
      b = building(m, "factory", p.base);
    inv.copper = 8;
    inv.tin = 2;
    expect(
      m.applyCommand({
        type: "produce",
        playerId: 1,
        buildingId: b.id,
        recipeId: "refine-bronze",
      }),
    ).toBeNull();
    e.supply.step(1, m.players, m.buildings, m.owners);
    expect(inv.copper).toBe(0);
    expect(inv.tin).toBe(0);
    const ticks = e.supply.jobs[b.id]!.remainingTicks;
    for (let i = 0; i < ticks; i++)
      e.supply.step(i + 2, m.players, m.buildings, m.owners);
    expect(inv.bronze).toBe(10);
    expect(e.supply.jobs[b.id]).toBeUndefined();
    inv.copper = 8;
    inv.tin = 2;
    e.supply.step(400, m.players, m.buildings, m.owners);
    m.updateBuilding((b).id, { playerId: 2 });
    for (let i = 401; i < 700; i++)
      e.supply.step(i, m.players, m.buildings, m.owners);
    expect(inv.bronze).toBe(10);
    expect(e.supply.inventories[2].bronze).toBe(0);
    expect(inv.copper).toBe(0);
  });
  it("requires a weapon kit and building tier, then spends a single kit and 1,000 reserves", () => {
    const m = make();
    complete(m);
    const p = m.players[0],
      inv = m.expansion!.supply.inventories[1],
      b = building(m, "barracks", p.base, 1, "BronzeAge");
    expect(
      m.applyCommand({
        type: "recruit",
        playerId: 1,
        buildingId: b.id,
        definitionId: "bronzeage-infantry",
      }),
    ).toMatch(/Needs/);
    inv["equipment:bronzeage"] = 1;
    const before = p.reserves;
    expect(
      m.applyCommand({
        type: "recruit",
        playerId: 1,
        buildingId: b.id,
        definitionId: "bronzeage-infantry",
      }),
    ).toBeNull();
    expect(inv["equipment:bronzeage"]).toBe(0);
    expect(p.reserves).toBe(before - 1000);
    expect(
      m.applyCommand({
        type: "recruit",
        playerId: 1,
        buildingId: b.id,
        definitionId: "modern-infantry",
      }),
    ).toMatch(/tier/);
  });
  it("makes an unaffordable group refit atomic and a paid refit preserve health until completion", () => {
    const m = make();
    complete(m);
    const own = m.squads.filter((s) => s.playerId === 1),
      p = m.players[0],
      inv = m.expansion!.supply.inventories[1];
    own[0].troops = 450;
    own[0].xp = 7000;
    inv["equipment:bronzeage"] = 1;
    const gold = p.gold;
    expect(
      m.applyCommand({
        type: "refit",
        playerId: 1,
        squadIds: own.map((s) => s.id),
        definitionId: "bronzeage-infantry",
      }),
    ).toMatch(/Needs/);
    expect(p.gold).toBe(gold);
    expect(own.every((s) => !s.refit)).toBe(true);
    inv["equipment:bronzeage"] = 3;
    expect(
      m.applyCommand({
        type: "refit",
        playerId: 1,
        squadIds: own.map((s) => s.id),
        definitionId: "bronzeage-infantry",
      }),
    ).toBeNull();
    expect(own[0].definitionId).toBe("stoneage-infantry");
    expect(own[0].xp).toBe(7000);
    step(m, 200);
    expect(own[0].definitionId).toBe("bronzeage-infantry");
    expect(own[0].troops).toBe(450);
    expect(own[0].xp).toBe(0);
    expect(inv["equipment:bronzeage"]).toBe(0);
  });
});
describe("bonuses, promotions, volleys and finite impacts", () => {
  it("applies base armour once and additive target bonuses with separate resistance", () => {
    const p = {
        ...defaultUnit("infantry").attack,
        damage: 100,
        bonuses: { mounted: 30 },
      },
      d = {
        tags: ["mounted"] as const,
        meleeArmour: 5000,
        rangedArmour: 9000,
        bonusResistance: { mounted: 10 },
      };
    expect(damageAmount(p, d)).toBe(70);
    expect(damageAmount({ ...p, penetration: 2500 }, d)).toBe(82);
    expect(damageAmount(p, { ...d, tags: ["vehicle"] })).toBe(50);
    expect(damageAmount({ ...p, targets: ["aircraft"] }, d)).toBe(0);
  });
  it("caps the level-seven budget and conserves effective XP with duplicate attacker contributions", () => {
    expect(promotionLevel(20000)).toBe(7);
    expect(
      damageAmount(
        { ...defaultUnit("infantry").attack, damage: 100, bonuses: {} },
        defenceOf(defaultUnit("infantry")),
        1000,
        999999,
      ),
    ).toBe(120);
    const shares = effectiveDamageShares(7, [
      { id: 1, damage: 100 },
      { id: 1, damage: 50 },
      { id: 2, damage: 50 },
    ]);
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(7);
    expect(shares.get(1)).toBe(6);
  });
  it("issues one ranged volley event and reloads five times slower while moving", () => {
    const m = make(),
      s = m.squads[0],
      t = m.squads.find((s) => s.playerId === 2)!;
    m.squads.splice(0, m.squads.length, s, t);
    s.kind = "archer";
    s.definitionId = "stoneage-archer";
    pos(s, 30, 20);
    pos(t, 34, 20);
    s.moved = true;
    m.expansion!.battle.fight([]);
    expect(m.volleys).toHaveLength(1);
    expect(s.nextAttackTick).toBe(200);
    m.expansion!.battle.fight([]);
    expect(m.volleys).toHaveLength(1);
    s.moved = false;
    m.tick = 200;
    m.expansion!.battle.fight([]);
    expect(s.nextAttackTick).toBe(240);
  });
  it("sweeps fast shells and resolves damage and XP once", () => {
    const m = make(),
      s = m.squads[0],
      t = m.squads.find((s) => s.playerId === 2)!;
    m.squads.splice(0, m.squads.length, s, t);
    pos(s, 10, 20);
    pos(t, 20, 20);
    const p = {
      ...defaultUnit("infantry").attack,
      channel: "ranged" as const,
      damage: 100,
      range: 100 * FIXED,
      projectile: { diameter: FIXED / 4, speed: 30 * FIXED, blastRadius: 0 },
    };
    m.expansion!.battle.fire(s, { x: 35 * FIXED, y: t.y }, p, 100);
    m.tick++;
    m.expansion!.battle.advanceProjectiles();
    expect(t.troops).toBeLessThan(1000);
    const troops = t.troops,
      xp = s.xp;
    m.expansion!.battle.advanceProjectiles();
    expect(t.troops).toBe(troops);
    expect(s.xp).toBe(xp);
  });
  it("MIRV splits into exactly four warheads without a parent impact", () => {
    const m = make();
    complete(m);
    const s = m.squads[0],
      e = m.expansion!,
      profile = {
        ...defaultUnit("infantry").attack,
        projectile: {
          diameter: FIXED / 2,
          speed: FIXED,
          blastRadius: FIXED * 3,
        },
      };
    e.battle.fire(
      s,
      { x: 50 * FIXED, y: 30 * FIXED },
      profile,
      24000,
      "mirv",
      720,
      4,
    );
    m.tick = 360;
    e.battle.advanceProjectiles();
    expect(
      e.battle.projectiles.filter((p) => p.kind === "warhead"),
    ).toHaveLength(4);
    expect(e.battle.projectiles.find((p) => p.kind === "mirv")!.impacted).toBe(
      true,
    );
    expect(
      e.battle.projectiles
        .filter((p) => p.kind === "warhead")
        .reduce((n, p) => n + p.damage, 0),
    ).toBe(24000);
  });
  it("aircraft-only anti-air cannot intercept strategic missiles", () => {
    const m = make();
    complete(m);
    const s = m.squads[0],
      t = m.squads.find((s) => s.playerId === 2)!;
    s.definitionId = "modern-anti-air";
    pos(s, 20, 20);
    pos(t, 21, 20);
    const health = t.troops;
    m.expansion!.battle.fight([]);
    expect(t.troops).toBe(health);
    const air = {
      id: m.allocateId(),
      playerId: 2,
      definitionId: "bomber" as const,
      airfieldId: 99,
      x: t.x,
      y: t.y,
      health: 1000,
      target: null,
      state: "outbound" as const,
      reloadTick: 0,
      fuelTicks: 100,
    };
    m.expansion!.battle.fight([air]);
    expect(air.health).toBeLessThan(1000);
  });
});
describe("allied protection and fortifications", () => {
  it("alliances protect automatic targeting, explicit attacks and capture but not ownership", () => {
    const m = make(),
      a = m.players[0],
      b = m.players[1];
    expect(
      m.applyCommand({
        type: "alliance",
        playerId: 1,
        otherId: 2,
        action: "offer",
      }),
    ).toBeNull();
    expect(
      m.applyCommand({
        type: "alliance",
        playerId: 2,
        otherId: 1,
        action: "accept",
      }),
    ).toBeNull();
    const s = m.squads[0],
      t = m.squads.find((s) => s.playerId === 2)!;
    pos(s, 30, 20);
    pos(t, 31, 20);
    expect(
      m.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [s.id],
        order: { type: "attack", targetId: t.id },
      }),
    ).not.toBeNull();
    m.expansion!.battle.fight([]);
    expect(t.troops).toBe(1000);
    expect(t.playerId).toBe(b.id);
    expect(a.eliminated).toBe(false);
  });
  it("intact walls let owners and allies cross every tile while blocking enemies", () => {
    const m = make(),
      e = m.expansion!,
      a = building(m, "tower", 20 * 96 + 20),
      b = building(m, "tower", 20 * 96 + 25);
    e.fortifications.addTower(
      b,
      e.fortifications.towerPlan(b.tile, 1, "StoneAge", [a]),
    );
    e.fortifications.step(1, m.buildings);
    const w = e.fortifications.barriers[0],
      tile = w.tiles[0];
    expect(w.tiles.every((t) => !e.fortifications.blocked(t, 1))).toBe(true);
    expect(e.fortifications.blocked(a.tile, 1)).toBe(false);
    expect(e.fortifications.blocked(tile, 2)).toBe(true);
    m.applyCommand({
      type: "alliance",
      playerId: 1,
      otherId: 2,
      action: "offer",
    });
    m.applyCommand({
      type: "alliance",
      playerId: 2,
      otherId: 1,
      action: "accept",
    });
    expect(w.tiles.every((t) => !e.fortifications.blocked(t, 2))).toBe(true);
    expect(e.fortifications.blocked(a.tile, 2)).toBe(false);
    m.applyCommand({
      type: "alliance",
      playerId: 2,
      otherId: 1,
      action: "break",
    });
    expect(e.fortifications.blocked(tile, 2)).toBe(true);
    expect(e.fortifications.blocked(a.tile, 2)).toBe(true);
    w.health = 0;
    expect(e.fortifications.blocked(tile, 2)).toBe(false);
  });
  it("destruction of the final building awards all remnant land to the finishing faction", () => {
    const m = make();
    complete(m);
    const p = m.players[1],
      s = m.squads[0];
    m.squads.splice(0, m.squads.length, s);
    const b = building(m, "city", p.base, 2);
    m.updateBuilding((b).id, { health: 1 });
    pos(s, (p.base % 96) - 1, Math.floor(p.base / 96));
    s.structureTarget = { buildingId: b.id };
    const remnant = m.owners.findIndex((owner) => owner === 2);
    m.expansion!.battle.fight([]);
    m.expansion!.afterMovement();
    m.step();
    expect(p.eliminated).toBe(true);
    expect(m.owners[remnant]).toBe(1);
  });
  it("roundtrips authoritative unit, building and progression details through snapshots", () => {
    const m = make();
    complete(m);
    const b = building(m, "city", m.players[0].base, 1, "Modern");
    m.squads[0].xp = 3500;
    m.squads[0].lastAttackTick = 77;
    const encoder = new SnapshotEncoder(),
      packet = encoder.encode(m.snapshot());
    const decoded = new SnapshotDecoder().decode(packet);
    expect(decoded.expansion!.progression[1].age).toBe("Modern");
    expect(decoded.squads[0].xp).toBe(3500);
    expect(decoded.squads[0].lastAttackTick).toBe(77);
    expect(decoded.buildings.find((x) => x.id === b.id)!.health).toBe(2000);
  });
});
