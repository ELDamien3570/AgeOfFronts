import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../../Art/Terrain/Wall Kit/Wall_Kit_Manifest.json";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { wallTier } from "../../src/skirmish/client/WallArtwork";
import { WallPresentation } from "../../src/skirmish/client/WallPresentation";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { AGES, type Barrier } from "../../src/skirmish/domain/Definitions";
import { FIXED, type Building } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function match(aiCount = 1) {
  const data = new Uint8Array(64 * 48).fill(133);
  return new Skirmish(new GameMapImpl(64, 48, data, data.length), {
    seed: 47,
    aiCount,
    runAi: false,
    tribes: false,
    ruleset: "ages-v1",
  });
}
function tower(m: Skirmish, x: number, y: number): Building {
  const b: Building = m.addBuilding({
    id: m.allocateId(),
    playerId: 1,
    type: "tower",
    tile: m.map.ref(x, y),
    age: "StoneAge",
    remainingTicks: 0,
    health: 2000,
    maxHealth: 2000,
  });

  return b;
}
function barrier(a: Building, b: Building, tiles: number[], id = 1): Barrier {
  return {
    id,
    a: a.id,
    b: b.id,
    age: "StoneAge",
    playerId: 1,
    tiles,
    health: 2000,
    maxHealth: 2000,
    remainingTicks: 0,
  };
}
it("blocks physical corner contact while preserving weapon rays and owner passage",()=>{
  const m=match(),a=tower(m,10,5),b=tower(m,12,5),forts=m.expansion!.fortifications;
  forts.barriers.push(barrier(a,b,[m.map.ref(10,5),m.map.ref(11,5),m.map.ref(12,5)]));
  forts.step(m.tick,m.buildings);
  const from={x:9.5*FIXED,y:4.8*FIXED},to={x:13.5*FIXED,y:4.8*FIXED};
  expect(forts.clear(from,to,2)).toBe(true);
  expect(forts.clearMovement(from,to,2,0.45*FIXED)).toBe(false);
  expect(forts.clearMovement(from,to,1,0.45*FIXED)).toBe(true);
  expect(forts.clearMovement({...from,y:4.4*FIXED},{...to,y:4.4*FIXED},2,0.45*FIXED)).toBe(true);
});

describe("wall artwork topology", () => {
  it("uses the authored shared cell size, pivots, and padded atlas rectangles for every piece", () => {
    expect(manifest.worldFootprintCells).toBe(1);
    for (const tier of manifest.tiers) {
      const base = new URL(
        `../../Art/Terrain/Wall Kit/${tier.id}/`,
        import.meta.url,
      );
      const meta = JSON.parse(
        readFileSync(new URL("tiles.json", base), "utf8"),
      );
      expect(meta.pivot).toEqual({ x: 128, y: 128 });
      const png = readFileSync(new URL("Wall_Atlas_Padded.png", base));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual(
        meta.paddedAtlasSize,
      );
      expect(meta.tiles.map((t: { mask: number }) => t.mask)).toEqual(
        Array.from({ length: 16 }, (_, i) => i),
      );
      for (const tile of meta.tiles) {
        expect(tile.paddedRect.width).toBe(meta.tileSize);
        expect(tile.paddedRect.height).toBe(meta.tileSize);
        expect(tile.paddedRect.x + tile.paddedRect.width).toBeLessThanOrEqual(
          meta.paddedAtlasSize[0],
        );
        expect(tile.paddedRect.y + tile.paddedRect.height).toBeLessThanOrEqual(
          meta.paddedAtlasSize[1],
        );
      }
      const pngTower = readFileSync(new URL("Tower.png", base));
      expect([pngTower.readUInt32BE(16), pngTower.readUInt32BE(20)]).toEqual([
        meta.tileSize,
        meta.tileSize,
      ]);
    }
    expect(AGES.map(wallTier)).toEqual([
      "Palisades",
      "StoneWalls",
      ...Array(5).fill("MassiveStoneWalls"),
    ]);
  });
  it("connects ordered runs through a corner and joins tower endpoints at the same pivot", () => {
    const m = match(),
      a = tower(m, 5, 5),
      b = tower(m, 10, 8),
      forts = m.expansion!.fortifications;
    forts.addTower(b, forts.towerPlan(b.tile, 1, "StoneAge", [a]));
    forts.step(1, m.buildings);
    const view = new WallPresentation();
    view.update(m.snapshot());
    const mask = (x: number, y: number) =>
      view.tiles.find((t) => t.tile === m.map.ref(x, y))?.mask;
    expect(mask(5, 5)).toBe(4);
    expect(mask(5, 6)).toBe(5);
    expect(mask(5, 8)).toBe(3);
    expect(mask(7, 8)).toBe(10);
    expect(mask(10, 8)).toBe(8);
    expect(view.tiles.filter((t) => t.gate)).toHaveLength(1);
    expect(view.tiles.find((t) => t.gate)?.mask).toBe(10);
    const cached = view.tiles;
    view.update(m.snapshot());
    expect(view.tiles).toBe(cached);
    forts.barriers[0].health = 0;
    forts.step(2, m.buildings);
    view.update(m.snapshot());
    expect(view.tiles).toHaveLength(0);
  });
  it("keeps adjacent parallel spans separate and unions actual tower junctions", () => {
    const m = match(),
      a = tower(m, 5, 5),
      b = tower(m, 10, 5),
      c = tower(m, 5, 6),
      d = tower(m, 10, 6),
      e = tower(m, 10, 10);
    const forts = m.expansion!.fortifications;
    forts.barriers.push(
      barrier(
        a,
        b,
        [9, 8, 7, 6].map((x) => m.map.ref(x, 5)),
      ),
      barrier(
        c,
        d,
        [9, 8, 7, 6].map((x) => m.map.ref(x, 6)),
        2,
      ),
      barrier(
        b,
        e,
        [9, 8, 7, 6].map((y) => m.map.ref(10, y)),
        3,
      ),
    );
    forts.step(1, m.buildings);
    const view = new WallPresentation();
    view.update(m.snapshot());
    expect(view.tiles.find((t) => t.tile === m.map.ref(7, 5))?.mask).toBe(10);
    expect(view.tiles.find((t) => t.tile === m.map.ref(7, 6))?.mask).toBe(10);
    expect(view.tiles.find((t) => t.tile === b.tile)?.mask).toBe(12);
    expect(view.tiles.filter((t) => t.gate)).toHaveLength(0);
  });
});

describe("friendly fortification passage", () => {
  it("updates tower passage and removes its old wall when ownership changes on the same tile", () => {
    const m = match(),
      a = tower(m, 5, 5),
      b = tower(m, 10, 5),
      forts = m.expansion!.fortifications;
    forts.addTower(b, forts.towerPlan(b.tile, 1, "StoneAge", [a]));
    forts.step(1, m.buildings);
    const revision = forts.version;
    expect(forts.blocked(a.tile, 1)).toBe(false);
    expect(forts.blocked(a.tile, 2)).toBe(true);
    m.updateBuilding((a).id, { playerId: 2 });
    forts.step(2, m.buildings);
    expect(forts.version).toBeGreaterThan(revision);
    expect(forts.blocked(a.tile, 1)).toBe(true);
    expect(forts.blocked(a.tile, 2)).toBe(false);
    expect(forts.barriers).toHaveLength(0);
    expect(forts.blocked(m.map.ref(7, 5), 2)).toBe(false);
  });
  it("routes and moves own and allied squads through a wall spanning the map; rejects an enemy route", () => {
    const m = match(2),
      forts = m.expansion!.fortifications;
    // Isolate the wall corridor from the resource-site placement restriction.
    m.expansion!.supply.deposits.splice(0);
    for (const p of m.players) {
      p.gold = 1e7;
      m.expansion!.progression.states[p.id].completed = TECHNOLOGIES.map(
        (t) => t.id,
      );
    }
    for (let x = 0; x < 64; x++) {
      const tile = m.map.ref(x, 24),
        old = m.owners[tile];
      if (old) m.player(old)!.land--;
      m.owners[tile] = 1;
      m.players[0].land++;
    }
    for (const x of [0, 10, 20, 30, 40, 50, 60, 63]) {
      expect(
        m.applyCommand({
          type: "build",
          playerId: 1,
          buildingType: "tower",
          tile: m.map.ref(x, 24),
          age: "StoneAge",
        }),
      ).toBeNull();
      m.updateBuilding((m.buildings[m.buildings.length - 1]).id, { remainingTicks: 0 });
    }
    // The completed towers form the wall; keep their weapons inactive in this navigation fixture.
    for (const b of m.buildings)
      if (b.type === "tower") m.updateBuilding((b).id, { remainingTicks: 100000 });
    forts.step(1, m.buildings);
    expect(
      m.applyCommand({
        type: "alliance",
        playerId: 1,
        otherId: 3,
        action: "offer",
      }),
    ).toBeNull();
    expect(
      m.applyCommand({
        type: "alliance",
        playerId: 3,
        otherId: 1,
        action: "accept",
      }),
    ).toBeNull();
    for (const s of m.squads) {
      m.updateSquad(s.id, { x: (5 + s.playerId * 15) * FIXED });
      m.updateSquad(s.id, { y: (4 + (s.id % 3) * 2) * FIXED });
    }
    const own = m.squads.find((s) => s.playerId === 1)!,
      ally = m.squads.find((s) => s.playerId === 3)!,
      enemy = m.squads.find((s) => s.playerId === 2)!;
    m.updateSquad(own.id, { x: 20.5 * FIXED });
    m.updateSquad(ally.id, { x: 50.5 * FIXED });
    m.updateSquad(enemy.id, { x: 40.5 * FIXED });
    for (const squad of [own, ally, enemy]) m.updateSquad(squad.id, { y: 20.5 * FIXED });
    for (let x = 0; x < 64; x++) {
      expect(forts.blocked(m.map.ref(x, 24), 1)).toBe(false);
      expect(forts.blocked(m.map.ref(x, 24), 3)).toBe(false);
      expect(forts.blocked(m.map.ref(x, 24), 2)).toBe(true);
    }
    for (const s of [own, ally])
      expect(
        m.applyCommand({
          type: "order",
          playerId: s.playerId,
          squadIds: [s.id],
          order: { type: "move", tile: m.map.ref(Math.floor(s.x / FIXED), 29) },
        }),
      ).toBeNull();
    expect(
      m.applyCommand({
        type: "order",
        playerId: 2,
        squadIds: [enemy.id],
        order: { type: "move", tile: m.map.ref(40, 29) },
      }),
    ).toMatch(/cannot be reached/);
    for (let i = 0; i < 320; i++) m.step();
    expect(own.y / FIXED).toBeGreaterThan(28);
    expect(ally.y / FIXED).toBeGreaterThan(28);
    expect(enemy.y / FIXED).toBeLessThan(24);
    expect(
      m.expansion!.fortifications.barriers.every(
        (w) => w.health === w.maxHealth,
      ),
    ).toBe(true);
  });
});
