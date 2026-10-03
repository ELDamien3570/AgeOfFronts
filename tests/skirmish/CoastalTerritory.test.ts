import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { constructionRejection } from "../../src/skirmish/Construction";
import { coastalRanges } from "../../src/skirmish/content/CoastalTerritory";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { coastalWaterDistances } from "../../src/skirmish/domain/CoastalReach";
import { CoastalTerritory } from "../../src/skirmish/domain/CoastalTerritory";
import { RESOURCES } from "../../src/skirmish/domain/Definitions";
import { generateDeposits } from "../../src/skirmish/domain/DepositGeneration";
import { FIXED, type Ship } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture(width = 500) {
  const height = 40,
    terrain = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < 10; x++) terrain[y * width + x] = 133;
  const map = new GameMapImpl(width, height, terrain, 400);
  const owners = new Uint8Array(terrain.length);
  for (let tile = 0; tile < owners.length; tile++)
    if (map.isLand(tile)) owners[tile] = 1;
  const policy = new CoastalTerritory(map);
  for (let y = 0; y < height; y++) policy.changed(map.ref(9, y));
  const apply = (tick: number, ships: Ship[] = []) => {
    const changes = policy.step(tick, owners, ships);
    for (const c of changes) {
      owners[c.tile] = c.owner;
      policy.changed(c.tile);
    }
    return changes;
  };
  return { map, terrain, owners, policy, apply };
}
describe("scaled coastal water rights and offshore oil", () => {
  it("claims shoreline water in the actual simulation, builds an offshore rig and extracts oil", () => {
    const width = 500,
      height = 120,
      terrain = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < 150; x++) terrain[y * width + x] = 133;
    const m = new Skirmish(
      new GameMapImpl(width, height, terrain, 150 * height),
      {
        seed: 42,
        aiCount: 1,
        runAi: false,
        tribes: false,
        ruleset: "ages-v1",
      },
    );
    const shore = m.map.ref(149, 60),
      site = m.map.ref(150, 60);
    (m as unknown as { changeOwner(t: number, o: number): void }).changeOwner(
      shore,
      1,
    );
    const expansion = m.expansion!;
    expansion.progression.states[1].age = "Modern";
    expansion.progression.states[1].completed = TECHNOLOGIES.map((t) => t.id);
    m.players[0].gold = 50000;
    for (const resource of RESOURCES)
      expansion.supply.inventories[1][resource] = 5000;
    expansion.supply.addDeposit({
      id: 999,
      tile: site,
      owner: 0,
      resource: "oil",
      yieldPerSecond: 3,
    });
    expect(
      m.applyCommand({
        type: "build",
        playerId: 1,
        buildingType: "oil-rig",
        tile: site,
      }),
    ).toContain("claimed");
    for (let i = 0; i < 400; i++) m.step();
    expect(m.owners[site]).toBe(1);
    expect(
      m.applyCommand({
        type: "build",
        playerId: 1,
        buildingType: "oil-rig",
        tile: site,
      }),
    ).toBeNull();
    m.updateBuilding((m.buildings.find((b) => b.type === "oil-rig")!).id, { remainingTicks: 0 });
    const oil = expansion.supply.inventories[1].oil;
    for (let i = 0; i < 20; i++) m.step();
    expect(expansion.supply.inventories[1].oil).toBeGreaterThan(oil);
    for (const player of m.players) {
      const land = [...m.ownedLand(player.id)];
      expect(land.every((t) => m.map.isLand(t))).toBe(true);
      expect(player.land).toBe(land.length);
    }
  });
  it.each([
    [250, 3, 4],
    [500, 6, 8],
    [1000, 12, 16],
  ])("scales oil and claim ranges on %i-cell maps", (width, oil, claim) => {
    const f = fixture(width);
    expect(coastalRanges(f.map)).toMatchObject({
      oilTiles: oil,
      claimTiles: claim,
    });
  });
  it("advances one water layer every twenty seconds and stops at the originating-shore range", () => {
    const f = fixture();
    for (let tick = 20; tick < 400; tick += 20) f.apply(tick);
    expect(f.owners[f.map.ref(10, 20)]).toBe(0);
    f.apply(400);
    expect(f.owners[f.map.ref(10, 20)]).toBe(1);
    expect(f.owners[f.map.ref(11, 20)]).toBe(0);
    for (let tick = 420; tick <= 4000; tick += 20) f.apply(tick);
    expect(f.owners[f.map.ref(17, 20)]).toBe(1);
    expect(f.owners[f.map.ref(18, 20)]).toBe(0);
  });
  it("lets only friendly boats double speed and relinquishes rights when their shore is lost", () => {
    const f = fixture();
    const ship = {
      id: 1,
      playerId: 1,
      x: 10.5 * FIXED,
      y: 20.5 * FIXED,
      health: 100,
    } as Ship;
    for (let tick = 20; tick <= 200; tick += 20) f.apply(tick, [ship]);
    expect(f.owners[f.map.ref(10, 20)]).toBe(1);
    expect(f.owners[f.map.ref(10, 10)]).toBe(0);
    const hostile = fixture();
    for (let tick = 20; tick <= 200; tick += 20)
      hostile.apply(tick, [{ ...ship, playerId: 2 }]);
    expect(hostile.owners[hostile.map.ref(10, 20)]).toBe(0);
    const shore = f.map.ref(9, 20);
    f.owners[shore] = 0;
    f.policy.changed(shore);
    f.apply(220, [ship]);
    expect(f.owners[f.map.ref(10, 20)]).toBe(0);
  });
  it("keeps equidistant opposing shores contested and does not overwrite enemy water", () => {
    const f = fixture();
    for (let y = 0; y < 40; y++) {
      const t = f.map.ref(11, y);
      f.terrain[t] = 133;
      f.owners[t] = 2;
      f.policy.changed(t);
    }
    for (let tick = 20; tick <= 800; tick += 20) f.apply(tick);
    expect(f.owners[f.map.ref(10, 20)]).toBe(0);
    f.owners[f.map.ref(10, 20)] = 2;
    for (let tick = 820; tick <= 1200; tick += 20) f.apply(tick);
    expect(f.owners[f.map.ref(10, 20)]).toBe(2);
  });
  it("places offshore oil inside the same scaled band used by rig placement", () => {
    const f = fixture();
    const distances = coastalWaterDistances(f.map);
    const deposits = Array.from({ length: 20 }, (_, i) =>
      generateDeposits(f.map, i + 1, 3),
    ).flat();
    const oil = deposits.filter(
      (d) => d.resource === "oil" && f.map.isWater(d.tile),
    );
    expect(oil.length).toBeGreaterThan(0);
    expect(oil.every((d) => distances[d.tile] <= 6)).toBe(true);
    const land = new Uint8Array(100 * 80).fill(133);
    const player = new Skirmish(new GameMapImpl(100, 80, land, land.length), {
      seed: 1,
      aiCount: 1,
      runAi: false,
    }).players[0];
    player.gold = 10000;
    const site = f.map.ref(15, 20);
    f.owners[site] = 1;
    expect(
      constructionRejection(f.map, f.owners, [], player, "oil-rig", site),
    ).toBeNull();
    f.owners[site] = 0;
    expect(
      constructionRejection(f.map, f.owners, [], player, "oil-rig", site),
    ).toContain("claimed");
    const deep = f.map.ref(16, 20);
    f.owners[deep] = 1;
    expect(
      constructionRejection(f.map, f.owners, [], player, "oil-rig", deep),
    ).toContain("offshore oil band");
  });
  it("restores water progress and excludes water from authoritative land accounting", () => {
    const f = fixture();
    for (let t = 20; t <= 240; t += 20) f.apply(t);
    const restored = new CoastalTerritory(f.map);
    restored.restore(f.policy.checkpoint());
    expect(restored.step(260, f.owners, [])).toEqual(
      f.policy.step(260, f.owners, []),
    );
    expect(restored.checkpoint()).toEqual(f.policy.checkpoint());
    const m = new Skirmish(f.map, { seed: 1, aiCount: 1, runAi: false });
    const before = m.players.map((p) => p.land);
    const change = (tile: number, owner: number) =>
      (m as unknown as { changeOwner(t: number, o: number): void }).changeOwner(
        tile,
        owner,
      );
    const tile = f.map.ref(15, 20);
    change(tile, 1);
    expect(m.players.map((p) => p.land)).toEqual(before);
    expect([...m.ownedLand(1)]).not.toContain(tile);
    const state = m.checkpoint();
    m.restore(state);
    expect([...m.ownedLand(1)]).not.toContain(tile);
    change(tile, 2);
    expect(m.players.map((p) => p.land)).toEqual(before);
  });
});
