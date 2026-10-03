import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Diplomacy } from "../../src/skirmish/domain/Diplomacy";
import { Fortifications } from "../../src/skirmish/domain/Fortifications";
import { Recruitment } from "../../src/skirmish/domain/Recruitment";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

const map = () => new GameMapImpl(96, 64, new Uint8Array(6144).fill(133), 6144);
describe("maintained recruitment and resource facts", () => {
  it("matches independent owner/producer scans through mutation, cancellation and restore", () => {
    const queue = new Recruitment();
    let seed = 47;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    for (let step = 0; step < 300; step++) {
      if (
        !queue.jobs.length ||
        (random() % 3 === 0 && queue.jobs.length < 32)
      ) {
        queue.enqueue({
          playerId: (random() % 4) + 1,
          buildingId: random() % 6,
          category: "land",
          kind: "infantry",
          totalTicks: 100,
          cost: { gold: 20 },
        });
      } else if (random() % 3 === 0)
        queue.cancel((random() % 4) + 1, {}, () => {});
      else {
        const job = queue.jobs[random() % queue.jobs.length];
        queue.updateJob(job.id, {
          playerId: (random() % 4) + 1,
          buildingId: random() % 6,
          remainingTicks: random() % 100,
        });
      }
      if (step % 29 === 0) queue.restore(queue.checkpoint());
      for (let owner = 1; owner <= 4; owner++) {
        expect(queue.byOwner(owner)).toEqual(
          queue.jobs.filter((job) => job.playerId === owner),
        );
        expect(queue.count(owner, "land")).toBe(queue.byOwner(owner).length);
      }
      for (let producer = 0; producer < 6; producer++)
        expect(queue.byProducer(producer)).toEqual(
          queue.jobs.filter((job) => job.buildingId === producer),
        );
      for (const job of queue.jobs) expect(queue.byId(job.id)).toBe(job);
    }
    const view = queue.byOwner(queue.jobs[0].playerId);
    queue.updateJob(queue.jobs[0].id, { remainingTicks: 0 });
    expect(queue.byOwner(queue.jobs[0].playerId)).toBe(view);
    expect(Object.isFrozen(queue.jobs)).toBe(true);
  });
  it("keeps geometry warm through owner/yield changes and reconstructs imports exactly", () => {
    const game = new Skirmish(map(), {
      seed: 47,
      aiCount: 1,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
    });
    const supply = game.expansion!.supply;
    supply.replaceDeposits(
      Array.from({ length: 16 }, (_, id) => ({
        id,
        tile: game.map.ref(10 + id, 20),
        owner: id % 3,
        resource: "stone" as const,
        yieldPerSecond: 2,
      })),
    );
    const before = supply.resourceSites.diagnostics(),
      geometry = supply.geometryRevision;
    for (let i = 0; i < 100; i++) {
      supply.updateDeposit(i % 16, { owner: i % 4 });
      expect(supply.resourceSites.at(supply.deposits[i % 16].tile)).toBe(
        supply.deposits[i % 16],
      );
      for (let owner = 0; owner < 4; owner++)
        expect(supply.resourcesByOwner(owner)).toEqual(
          supply.deposits.filter((node) => node.owner === owner),
        );
      game.buildingPlacement(1, "factory", game.map.ref(50, 40), "StoneAge");
    }
    supply.updateDeposit(0, { yieldPerSecond: 3 });
    const after = supply.resourceSites.diagnostics();
    expect(after.geometryRebuilds).toBe(before.geometryRebuilds);
    expect(after.signatureRows).toBe(before.signatureRows);
    expect(supply.geometryRevision).toBe(geometry + 1);
    const oldTile = supply.deposits[0].tile;
    supply.updateDeposit(0, { tile: game.map.ref(4, 4) });
    expect(supply.resourceSites.at(oldTile)).toBeUndefined();
    expect(supply.resourceSites.at(game.map.ref(4, 4))?.id).toBe(0);
    const saved = supply.checkpoint();
    supply.replaceDeposits([]);
    supply.restore(saved);
    for (const node of supply.deposits)
      expect(supply.resourceSites.at(node.tile)).toBe(node);
    for (let owner = 0; owner < 4; owner++)
      expect(supply.resourcesByOwner(owner)).toEqual(
        saved.deposits.filter((node) => node.owner === owner),
      );
  });
});
describe("local defensive broad phases", () => {
  it("reuses static collision bodies across warm combat/projectile stages and refreshes captured facts", () => {
    const game = new Skirmish(map(), {
      seed: 47,
      aiCount: 1,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
    });
    for (const squad of game.squads) game.removeSquad(squad.id);
    const first = game.addBuilding({id: game.allocateId(), playerId: 1, type: "city",
      tile: game.map.ref(20, 20), remainingTicks: 0, health: 1000, age: "StoneAge"});
    const battle = game.expansion!.battle;
    battle.fight([]);
    const allocations = battle.telemetry.structureAllocations,
      rebuilds = battle.telemetry.structureRebuilds;
    expect(allocations).toBeGreaterThan(0);
    for (let i = 0; i < 12; i++) {
      battle.fight([]);
      battle.advanceProjectiles();
    }
    expect(battle.telemetry.structureAllocations).toBe(allocations);
    expect(battle.telemetry.structureRebuilds).toBe(rebuilds);
    game.updateBuilding(first.id, { playerId: 2 });
    battle.fight([]);
    expect(battle.telemetry.structureRebuilds).toBe(rebuilds + 1);
    expect(battle.telemetry.structureAllocations).toBe(allocations);
  });

  it("matches full wall-circle scans, deduplicates cells and preserves canonical budget order", () => {
    const terrain = map(),
      forts = new Fortifications(terrain, new Diplomacy());
    const walls = Array.from({ length: 200 }, (_, i) => ({
      id: 500 - i,
      playerId: 1,
      age: "StoneAge" as const,
      a: 1,
      b: 1,
      health: i % 9 ? 100 : 0,
      maxHealth: 100,
      remainingTicks: 0,
      tiles: [
        terrain.ref((i * 7) % 90, (i * 11) % 60),
        terrain.ref((i * 7 + 1) % 90, (i * 11) % 60),
      ],
    }));
    forts.restore({
      barriers: walls,
      nextId: 501,
      towers: new Map(),
      repairs: new Map(),
      version: 2,
    });
    for (let i = 0; i < 40; i++) {
      const x = ((i * 13) % 96) * FIXED,
        y = ((i * 17) % 64) * FIXED,
        radius = ((i % 12) + 1) * FIXED;
      expect(forts.nearbyBarriers(x, y, radius).map((w) => w.id)).toEqual(
        walls
          .filter((w) =>
            w.tiles.some(
              (tile) =>
                ((terrain.x(tile) + 0.5) * FIXED - x) ** 2 +
                  ((terrain.y(tile) + 0.5) * FIXED - y) ** 2 <=
                radius ** 2,
            ),
          )
          .map((w) => w.id),
      );
    }
  });
  it("skips empty nest searches and fires on the first tick an enemy enters", () => {
    const game = new Skirmish(map(), {
      seed: 47,
      aiCount: 1,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
    });
    for (const building of game.buildings) game.removeBuilding(building.id);
    const nest = game.addBuilding({
      id: game.allocateId(),
      playerId: 1,
      tile: game.map.ref(20, 20),
      type: "gun-nest",
      age: "Modern",
      remainingTicks: 0,
      health: 1000,
    });
    for (const squad of game.squads)
      game.updateSquad(squad.id, { x: 80 * FIXED, y: 50 * FIXED });
    const battle = game.expansion!.battle;
    for (let tick = 0; tick < 8; tick++) {
      game.tick = tick;
      battle.fight([]);
    }
    expect(battle.telemetry.nestSearches).toBe(0);
    expect(battle.telemetry.emptyNestSkips).toBe(8);
    const enemy = game.squads.find((s) => s.playerId === 2)!;
    game.updateSquad(enemy.id, { x: 22 * FIXED, y: 20 * FIXED });
    game.tick = 8;
    battle.fight([]);
    expect(battle.telemetry.nestSearches).toBe(1);
    expect(nest.nextAttackTick).toBeGreaterThan(8);
    expect(
      game.volleys.some((v) => v.squadId === nest.id && v.tick === 8),
    ).toBe(true);
  });
});
