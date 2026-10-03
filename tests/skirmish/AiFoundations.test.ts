import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNIT } from "../../src/skirmish/content/Units";
import { AiForceInventory } from "../../src/skirmish/domain/AiForceInventory";
import { HomeTerritory } from "../../src/skirmish/HomeTerritory";
import { LandPaths } from "../../src/skirmish/Pathfinding";
import { FIXED, type Building } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { tilePoint } from "../../src/skirmish/SquadGeometry";
import { firingPosition } from "../../src/skirmish/TacticalRoutes";

function fixture() {
  const map = new GameMapImpl(100, 64, new Uint8Array(6400).fill(133), 6400);
  const game = new Skirmish(map, {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: true,
    ruleset: "ages-v1",
  });
  const player = game.players[1],
    expansion = game.expansion!;
  const state = expansion.progression.states[player.id];
  state.age = "Modern";
  state.completed = TECHNOLOGIES.map((t) => t.id);
  player.gold = 0;
  player.reserves = 0;
  const think = () => {
    game.tick = (player.id % 20) * 3;
    expansion.beforeStep();
  };
  return { game, map, player, expansion, think };
}

describe("AI foundation policies", () => {
  it.each(["infantry", "archer"] as const)(
    "routes %s around a hostile tower and resumes legal attacks",
    (kind) => {
      const { game, map } = fixture();
      game.options.runAi = false;
      const a = game.squads.find((s) => s.playerId === 1)!,
        b = game.squads.find((s) => s.playerId === 2)!;
      game.squads.splice(0, game.squads.length, a, b);
      { for (const building of game.buildings) game.removeBuilding(building.id); game.addBuilding({
        id: game.allocateId(),
        playerId: 2,
        type: "tower",
        age: "StoneAge",
        tile: map.ref(40, 40),
        remainingTicks: 0,
        health: 2000,
        maxHealth: 2000,
      }); }
      a.kind = kind;
      a.definitionId = `stoneage-${kind}`;
      Object.assign(a, tilePoint(map, map.ref(37, 40)));
      Object.assign(b, tilePoint(map, map.ref(43, 40)));
      game.expansion!.fortifications.step(1, game.buildings);
      expect(game.expansion!.fortifications.clear(a, b, 1)).toBe(false);
      expect(
        game.applyCommand({
          type: "order",
          playerId: 1,
          squadIds: [a.id],
          order: { type: "attack", targetId: b.id },
        }),
      ).toBeNull();
      for (let i = 0; i < 240; i++) {
        a.troops = b.troops = 1000;
        game.step();
      }
      expect(a.lastAttackTick).toBeDefined();
      expect(game.expansion!.fortifications.clear(a, b, 1)).toBe(true);
    },
  );
  it("does no location search or rejected build spam when bankrupt", () => {
    const { game, think } = fixture();
    const nearest = vi.spyOn(game, "ownedLandNearest");
    const commands = vi.spyOn(game, "applyCommand");
    think();
    expect(nearest).not.toHaveBeenCalled();
    expect(
      commands.mock.calls.filter(([c]) => c.type === "build"),
    ).toHaveLength(0);
  });

  it("counts paid queued specialists toward role quotas without displacing core archers", () => {
    const { game, player } = fixture();
    const squad = game.squads.find((s) => s.playerId === player.id)!;
    squad.definitionId = "modern-siege";
    squad.kind = "archer";
    game.squads.splice(0, game.squads.length, squad);
    game.recruitment.enqueue({
      playerId: player.id,
      buildingId: 1,
      category: "land",
      kind: "archer",
      definitionId: "modern-siege",
      totalTicks: 400,
      cost: {},
    });
    const force = new AiForceInventory(
      player.id,
      game.squads,
      game.recruitment.jobs,
    );
    expect(force.role("siege")).toBe(2);
    expect(force.core.archer).toBe(0);
    game.recruitment.jobs.splice(0);
    expect(
      new AiForceInventory(player.id, game.squads, game.recruitment.jobs).role(
        "siege",
      ),
    ).toBe(1);
  });

  it("does not fall through into obsolete specialists when their role quota is committed", () => {
    const { game, player, think, expansion } = fixture();
    player.gold = 100000;
    player.reserves = 100000;
    const building: Building = game.addBuilding({
      id: game.allocateId(),
      playerId: player.id,
      tile: player.base,
      type: "siege-workshop",
      age: "Modern",
      remainingTicks: 0,
    });

    const quota = 3; // at least every existing personality's specialist quota
    for (const role of [
      "siege",
      "artillery",
      "anti-air",
      "launcher",
    ] as const) {
      const unit = [...UNIT.values()]
        .filter((u) => u.role === role)
        .slice(-1)[0]!;
      for (let i = 0; i < quota; i++)
        game.recruitment.enqueue({
          playerId: player.id,
          buildingId: building.id,
          category: "land",
          kind: unit.line,
          definitionId: unit.id,
          totalTicks: 400,
          cost: {},
        });
      Object.assign(expansion.supply.inventories[player.id], unit.cost.items);
    }
    const commands = vi.spyOn(game, "applyCommand");
    think();
    expect(
      commands.mock.calls.filter(([c]) => c.type === "recruit"),
    ).toHaveLength(0);
  });

  it("filters allied pockets at decision time, including treaty expiry with a warm frontier", () => {
    const { map } = fixture();
    const home = new HomeTerritory(map),
      owners = new Uint8Array(6400);
    const base = map.ref(20, 20),
      ally = map.ref(21, 20),
      neutral = map.ref(19, 20);
    owners[base] = 2;
    owners[ally] = 1;
    const frontier = [ally, neutral];
    expect(
      home.goal(
        2,
        base,
        ally,
        owners,
        frontier,
        new Set(),
        (tile) => owners[tile] !== 1,
      ),
    ).toBe(neutral);
    expect(
      home.goal(2, base, ally, owners, [ally], new Set(), () => true),
    ).toBe(ally);
  });

  it("keeps non-targetable nearby infantry in the anti-air replenishment danger check", () => {
    const { game, player } = fixture();
    const unit = game.squads.find((s) => s.playerId === player.id)!;
    const enemy = game.squads.find((s) => s.playerId !== player.id)!;
    game.squads.splice(0, game.squads.length, unit, enemy);
    unit.definitionId = "modern-anti-air";
    unit.kind = "cavalry";
    unit.troops = 100;
    Object.assign(unit, tilePoint(game.map, player.base));
    enemy.x = unit.x + 5 * FIXED;
    enemy.y = unit.y;
    unit.order = { type: "hold" };
    unit.structureTarget = null;
    game.tick = (15 - (unit.id % 15)) % 15;
    game.step();
    expect(unit.order.type).not.toBe("attack");
    expect(unit.order.type).not.toBe("replenish");
  });

  it("reuses clear terrain corridors under dynamic walls and rejects changed masks", () => {
    const { map } = fixture();
    const paths = new LandPaths(map),
      start = map.ref(10, 10),
      goal = map.ref(20, 10);
    const route = paths.find(start, goal)!;
    const checks = paths.telemetry.searches;
    expect(paths.find(start, goal, () => false)).toEqual(route);
    expect(paths.telemetry.searches).toBe(checks);
    const blocked = route[Math.floor(route.length / 2)];
    const detour = paths.find(start, goal, (tile) => tile === blocked)!;
    expect(detour).not.toContain(blocked);
    expect(paths.find(start, goal, () => false)).toEqual(route);
  });

  it("charges finite search limits before work even on hierarchical maps", () => {
    const map = new GameMapImpl(
      180,
      180,
      new Uint8Array(32400).fill(133),
      32400,
    );
    const paths = new LandPaths(map),
      before = paths.work;
    expect(
      paths.find(map.ref(2, 2), map.ref(170, 170), undefined, 8),
    ).toBeNull();
    expect(paths.work - before).toBeLessThanOrEqual(8);
  });

  it("keeps checkpoint continuation identical with different route cache warmth", () => {
    const { game, map } = fixture();
    for (let i = 0; i < 30; i++) game.step();
    const checkpoint = game.checkpoint();
    const restored = new Skirmish(map, game.options);
    restored.restore(checkpoint);
    const squad = game.squads[0],
      start = game.tileOf(squad),
      goal = map.ref(50, 30);
    game.paths.find(start, goal);
    game.paths.find(start, goal);
    for (let i = 0; i < 100; i++) {
      game.step();
      restored.step();
    }
    expect(restored.checkpoint()).toEqual(game.checkpoint());
  });

  it("selects only unblocked firing cells with a clear shot", () => {
    const { game, map } = fixture();
    const [squad, target] = game.squads;
    Object.assign(squad, tilePoint(map, map.ref(20, 30)));
    Object.assign(target, tilePoint(map, map.ref(26, 30)));
    const goal = firingPosition(
      map,
      game.paths,
      squad,
      target,
      4 * FIXED,
      (t) => map.x(t) === 22,
      (from) => from.y > 31 * FIXED,
    );
    expect(goal).not.toBeNull();
    expect(map.x(goal!)).not.toBe(22);
    expect(tilePoint(map, goal!).y).toBeGreaterThan(31 * FIXED);
  });
});
