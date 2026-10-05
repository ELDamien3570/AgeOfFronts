import { retainSquads } from "./UnitFixtures";
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { HudViewModel } from "../../src/skirmish/client/HudViewModel";
import { SkirmishViewModel } from "../../src/skirmish/client/SkirmishViewModel";
import { CoastIndex } from "../../src/skirmish/CoastIndex";
import { HierarchicalPaths } from "../../src/skirmish/HierarchicalPaths";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { PathTopology } from "../../src/skirmish/PathTopology";
import {
  FIXED,
  TICKS_PER_SECOND,
  type Ship,
} from "../../src/skirmish/Protocol";
import { RouteWork } from "../../src/skirmish/RouteWork";
import {
  BUILDING_RULES,
  MAX_SHIPS,
  SHIP_RULES,
} from "../../src/skirmish/Rules";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
  snapshotTransfers,
} from "../../src/skirmish/SnapshotCodec";
import { buildingTicks } from "../../src/skirmish/content/Buildings";
import { boardingMeeting } from "../../src/skirmish/TacticalRoutes";

const selection = () => ({
  selected: new Set<number>(),
  selectedShips: new Set<number>(),
  selectedBuilding: null as number | null,
});
function plains() {
  const data = new Uint8Array(100 * 80).fill(133);
  return new Skirmish(new GameMapImpl(100, 80, data, data.length), {
    seed: 42,
    aiCount: 1,
    runAi: false,
  });
}

describe("hierarchical terrain routing", () => {
  it("leaves and re-enters a cluster when its local regions are disconnected", () => {
    const data = new Uint8Array(64 * 64).fill(133);
    for (let y = 0; y < 32; y++) data[y * 64 + 16] = 0;
    const map = new GameMapImpl(64, 64, data, 0),
      topology = new PathTopology(map, false),
      hierarchy = new HierarchicalPaths(topology);
    hierarchy.prepare();
    const start = map.ref(1, 1),
      goal = map.ref(30, 30),
      path = hierarchy.find(start, goal)!;
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toBe(goal);
    expect(path.some((tile) => map.y(tile) >= 32)).toBe(true);
  });
  it("limits dynamic repair search without poisoning the following complete search", () => {
    const match = plains(),
      map = match.map,
      start = map.ref(2, 2),
      goal = map.ref(90, 70);
    expect(match.paths.findExact(start, goal, undefined, 8)).toBeNull();
    expect(match.paths.findExact(start, goal)!.length).toBeGreaterThan(70);
  });
  it("refines cached entrances into legal weighted paths through a narrow bridge", () => {
    const width = 128,
      height = 96,
      data = new Uint8Array(width * height).fill(133);
    for (let y = 0; y < height; y++)
      for (let x = 60; x < 67; x++) data[y * width + x] = y === 35 ? 133 : 0;
    for (let y = 40; y < 75; y++)
      for (let x = 75; x < 110; x++) data[y * width + x] = 151;
    const map = new GameMapImpl(width, height, data, 0),
      topology = new PathTopology(map, false),
      hierarchy = new HierarchicalPaths(topology),
      exact = new LandPaths(map);
    hierarchy.prepare();
    for (const [start, goal] of [
      [map.ref(5, 70), map.ref(120, 80)],
      [map.ref(120, 80), map.ref(5, 70)],
    ]) {
      const path = hierarchy.find(start, goal)!;
      expect(path).not.toBeNull();
      expect(path[path.length - 1]).toBe(goal);
      let previous = start,
        cost = 0;
      const neighbors = new Array<number>(8);
      for (const tile of path) {
        const count = topology.neighbors(previous, neighbors);
        expect(neighbors.slice(0, count)).toContain(tile);
        expect(topology.walkable(tile)).toBe(true);
        cost += topology.cost(previous, tile);
        previous = tile;
      }
      let optimum = 0;
      previous = start;
      for (const tile of exact.findExact(start, goal)!) {
        optimum += topology.cost(previous, tile);
        previous = tile;
      }
      expect(cost).toBeGreaterThanOrEqual(optimum);
      expect(cost).toBeLessThan(optimum * 1.3);
      expect(path).toEqual(hierarchy.find(start, goal));
    }
  });
  it("keeps water routes cardinal and refuses disconnected water", () => {
    const width = 96,
      height = 64,
      data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) data[y * width + 48] = 133;
    const map = new GameMapImpl(width, height, data, 0),
      hierarchy = new HierarchicalPaths(new PathTopology(map, true));
    hierarchy.prepare();
    const start = map.ref(2, 3),
      goal = map.ref(35, 60),
      path = hierarchy.find(start, goal)!;
    let previous = start;
    for (const tile of path) {
      expect(map.manhattanDist(previous, tile)).toBe(1);
      previous = tile;
    }
    expect(path[path.length - 1]).toBe(goal);
    expect(hierarchy.find(start, map.ref(80, 40))).toBeNull();
  });
});

describe("large-match indexes and routing work", () => {
  it("keeps refreshed requests in fair FIFO order and charges an explicit deterministic budget", () => {
    const queue = new RouteWork(),
      ran: string[] = [];
    queue.request("a", 2, () => ran.push("old"));
    queue.request("b", 1, () => ran.push("b"));
    queue.request("a", 2, () => ran.push("new"));
    queue.drain(1);
    expect(ran).toEqual([]);
    queue.drain(2);
    expect(ran).toEqual(["new"]);
    queue.drain(1);
    expect(ran).toEqual(["new", "b"]);
    queue.drain(10);
    expect(ran).toEqual(["new", "b"]);
  });
  it("returns the same boarding coast as an exhaustive search, including component filtering and friendly preference", () => {
    const data = new Uint8Array(80 * 60).fill(133);
    for (let y = 0; y < 20; y++) data.fill(0, y * 80, (y + 1) * 80);
    for (let y = 35; y < 40; y++) data.fill(0, y * 80, (y + 1) * 80);
    const map = new GameMapImpl(80, 60, data, 0),
      land = new LandPaths(map),
      water = new WaterPaths(map),
      coast = new CoastIndex(map, land, water),
      match = new Skirmish(map, { seed: 42, aiCount: 1, runAi: false });
    const squads = match.squads.slice(0, 4);
    squads.forEach((s, i) => {
      match.updateSquad(s.id, { x: (10 + i * 4 + 0.5) * FIXED });
      match.updateSquad(s.id, { y: 25.5 * FIXED });
    });
    const ship: Ship = {
      id: 900,
      playerId: 1,
      kind: "transport",
      x: 55.5 * FIXED,
      y: 10.5 * FIXED,
      health: 1000,
      destination: null,
      path: [],
      nextPathIndex: 0,
      waypoints: [],
      fighting: false,
      boarding: null,
    };
    const tileOf = (s: { x: number; y: number }) =>
      map.ref(Math.floor(s.x / FIXED), Math.floor(s.y / FIXED));
    for (const friendly of [false, true]) {
      match.owners.fill(0);
      if (friendly) match.owners[map.ref(70, 20)] = 1;
      let best: {
          landTile: number;
          waterTile: number;
          squadIds: number[];
        } | null = null,
        score = Infinity;
      for (let tile = 0; tile < data.length; tile++) {
        if (
          !land.walkable(tile) ||
          !squads.every((s) => land.connected(tileOf(s), tile))
        )
          continue;
        for (const sea of map.neighbors(tile)) {
          if (!water.connected(tileOf(ship), sea)) continue;
          const cost =
            (match.owners[tile] === 1 ? 0 : 100000) +
            Math.max(...squads.map((s) => map.manhattanDist(tileOf(s), tile))) *
              70 +
            map.manhattanDist(tileOf(ship), sea) * 56;
          if (cost < score) {
            score = cost;
            best = {
              landTile: tile,
              waterTile: sea,
              squadIds: squads.map((s) => s.id),
            };
          }
        }
      }
      expect(
        boardingMeeting(map, land, water, match.owners, ship, squads, coast),
      ).toEqual(best);
    }
    match.updateSquad(squads[0].id, { y: 50.5 * FIXED });
    expect(
      boardingMeeting(map, land, water, match.owners, ship, squads, coast),
    ).toBeNull();
  });
  it("resolves indexed naval combat like brute-force nearest targeting with simultaneous damage", () => {
    const data = new Uint8Array(100 * 80).fill(133);
    data.fill(0, 0, 100 * 40);
    const match = new Skirmish(new GameMapImpl(100, 80, data, 0), {
      seed: 42,
      aiCount: 1,
      runAi: false,
    });
    for (const record of match.squads) match.removeSquad(record.id);
    for (let i = 0; i < 128; i++)
      match.addShip({
        id: 1000 + i,
        playerId: (i % 2) + 1,
        kind: i % 5 ? "warship" : "transport",
        x: (10 + (i % 16) * 2 + 0.5) * FIXED,
        y: (5 + Math.floor(i / 16) * 2 + 0.5) * FIXED,
        health: 1000,
        destination: null,
        path: [],
        nextPathIndex: 0,
        waypoints: [],
        fighting: false,
        boarding: null,
      });
    const hits = new Map<number, number>();
    for (const ship of match.ships) {
      const rules = SHIP_RULES[ship.kind];
      if (!rules.damage) continue;
      const targets = match.ships.filter(
        (s) =>
          s.playerId !== ship.playerId &&
          (s.x - ship.x) ** 2 + (s.y - ship.y) ** 2 <= rules.range ** 2,
      );
      targets.sort(
        (a, b) =>
          (a.x - ship.x) ** 2 +
            (a.y - ship.y) ** 2 -
            ((b.x - ship.x) ** 2 + (b.y - ship.y) ** 2) || a.id - b.id,
      );
      if (targets.length)
        hits.set(targets[0].id, (hits.get(targets[0].id) ?? 0) + rules.damage);
    }
    match.step();
    for (const ship of match.ships)
      expect(ship.health).toBe(1000 - (hits.get(ship.id) ?? 0));
  });
});

describe("transferable presentation snapshots", () => {
  it("round trips live fields, queued orders, deltas, removals and resets without changing previous snapshots", () => {
    const match = plains(),
      encoder = new SnapshotEncoder(),
      decoder = new SnapshotDecoder();
    const squad = match.squads[0];
    match.updateSquad(squad.id, { order: { type: "move", tile: 10, x: 2400, y: 1200 } });
    match.updateSquad(squad.id, { queuedOrders: [
      { type: "attack", targetId: match.squads[match.squads.length - 1].id },
      { type: "board", tile: 20, shipId: 1000 },
      { type: "replenish" },
      { type: "hold" },
    ] });
    match.updateSquad(squad.id, { firingCharge: 80 });
    match.updateSquad(squad.id, { combatTargetId: match.squads[match.squads.length - 1].id });
    const firstPacket = encoder.encode(match.snapshot()),
      received = structuredClone(firstPacket, {
        transfer: snapshotTransfers(firstPacket),
      });
    expect(firstPacket.squads.byteLength).toBe(0);
    const first = decoder.decode(received);
    expect({ ...first, changedTiles: undefined }).toEqual({
      ...match.snapshot(),
      changedTiles: undefined,
    });
    const previous = structuredClone(first);
    match.updateSquad(squad.id, { troops: 777 });
    match.owners[20] = 2;
    match.claims[21] = 1;
    match.progress[21] = 15;
    match.updateBuilding((match.buildings[0]).id, { remainingTicks: 10 });
    match.removeBuilding(match.buildings[match.buildings.length - 1].id);
    const secondPacket = encoder.encode(match.snapshot());
    expect(secondPacket.tiles).toHaveLength(4);
    expect(secondPacket.removedBuildings).toHaveLength(1);
    const second = decoder.decode(
      structuredClone(secondPacket, {
        transfer: snapshotTransfers(secondPacket),
      }),
    );
    expect({ ...second, changedTiles: undefined }).toEqual({
      ...match.snapshot(),
      changedTiles: undefined,
    });
    expect(first).toEqual(previous);
    expect(encoder.encode(match.snapshot()).tiles).toHaveLength(0);
    const fresh = plains(),
      newPacket = new SnapshotEncoder().encode(fresh.snapshot());
    const reset = decoder.decode(newPacket);
    expect({ ...reset, changedTiles: undefined }).toEqual({
      ...fresh.snapshot(),
      changedTiles: undefined,
    });
  });
});

describe("stacked buildings and large fleets", () => {
  it("permits 15 cities at one site with independent cost, construction and full income", () => {
    const match = plains(),
      tile = match.map.ref(30, 25),
      player = match.players[0];
    // Keep factions alive, with defenders distant from the construction site.
    for (const record of match.squads) match.updateSquad(record.id, {
      x:(match.map.x(match.player(record.playerId)!.base)+.5)*FIXED,
      y:(match.map.y(match.player(record.playerId)!.base)+.5)*FIXED,order:{type:"hold"},path:[],
    });
    match.owners[tile] = 1;
    player.gold = 100000;
    const before = player.gold;
    for (let i = 0; i < 15; i++)
      expect(
        match.applyCommand({
          type: "build",
          playerId: 1,
          buildingType: "city",
          tile,
        }),
      ).toBeNull();
    const expectedCost = Array.from({ length: 15 }, (_, i) =>
      Math.round(BUILDING_RULES.city.cost * Math.min(4,1 + i * 0.3)),
    ).reduce((a, b) => a + b, 0);
    expect(player.gold).toBe(before - expectedCost);
    expect(
      match.applyCommand({
        type: "build",
        playerId: 1,
        buildingType: "city",
        tile,
      }),
    ).toBe("A single site can support at most 15 stacked buildings");
    const cities = match.buildings.filter((b) => b.tile === tile);
    expect(cities).toHaveLength(15);
    expect(new Set(cities.map((b) => b.id)).size).toBe(15);
    expect(
      match.applyCommand({
        type: "build",
        playerId: 1,
        buildingType: "factory",
        tile,
      }),
    ).toMatch(/same type/);
    match.owners[tile + 1] = 1;
    expect(
      match.applyCommand({
        type: "build",
        playerId: 1,
        buildingType: "city",
        tile: tile + 1,
      }),
    ).toMatch(/three tiles/);
    const totalTicks = cities.reduce(
      (sum, b) => sum + (b.buildTicks ?? b.remainingTicks),
      0,
    );
    for (let i = 0; i < totalTicks - 1; i++) match.step();
    const beforeIncome = (player.reserves = 0);
    match.step();
    expect(player.reserves - beforeIncome).toBe(
      40 +
        Math.floor(player.land / 20) +
        15 * BUILDING_RULES.city.reserveIncome,
    );
    const s = selection();
    s.selectedBuilding = cities[0].id;
    const card = new HudViewModel(
      new SkirmishViewModel(match.snapshot(), s),
    ).selectionCard(null);
    if (card.mode !== "detail") throw new Error("Expected stack card");
    expect(card.card.count).toBe(15);
    expect(
      card.card.stats.find((s) => s.label === "Combined reserve income")?.value,
    ).toBe("+600 / sec");
  });
  it("captures every copy while preserving independent construction progress", () => {
    const match = plains(),
      tile = match.map.ref(30, 25);
    match.owners[tile] = 1;
    match.players[0].gold = 10000;
    for (let i = 0; i < 3; i++)
      expect(
        match.applyCommand({
          type: "build",
          playerId: 1,
          buildingType: "city",
          tile,
        }),
      ).toBeNull();
    const enemy = match.squads.find((s) => s.playerId === 2)!;
    retainSquads(match, [enemy]);
    // Unfinished cities alone no longer keep the builder alive.
    match.addBuilding({id:match.allocateId(),playerId:1,type:"city",tile:match.player(1)!.base,remainingTicks:0});
    match.updateSquad(enemy.id, { x: 30.5 * FIXED });
    match.updateSquad(enemy.id, { y: 25.5 * FIXED });
    for (let i = 0; i < 60; i++) match.step();
    const stack = match.buildings.filter((b) => b.tile === tile);
    expect(stack).toHaveLength(3);
    expect(stack.every((b) => b.playerId === 2)).toBe(true);
    expect(stack[0].remainingTicks).toBe(buildingTicks("city", 0) - 60);
    expect(stack[1].remainingTicks).toBe(buildingTicks("city", 1));
    expect(stack[2].remainingTicks).toBe(buildingTicks("city", 2));
  });
  it("admits exactly 64 ships and rejects the next purchase without spending", () => {
    const data = new Uint8Array(100 * 80).fill(133);
    data.fill(0, 0, 100 * 20);
    const match = new Skirmish(new GameMapImpl(100, 80, data, 0), {
        seed: 42,
        aiCount: 1,
        runAi: false,
      }),
      tile = match.map.ref(30, 20);
    match.owners[tile] = 1;
    match.players[0].gold = 100000;
    expect(
      match.applyCommand({
        type: "build",
        playerId: 1,
        buildingType: "port",
        tile,
      }),
    ).toBeNull();
    const port = match.buildings[match.buildings.length - 1];
    match.updateBuilding((port).id, { remainingTicks: 0 });
    for (let i = 0; i < MAX_SHIPS; i++)
      expect(
        match.applyCommand({
          type: "recruit-ship",
          playerId: 1,
          buildingId: port.id,
          shipType: i % 2 ? "warship" : "transport",
        }),
      ).toBeNull();
    expect(match.ships).toHaveLength(64);
    const gold = match.players[0].gold;
    expect(
      match.applyCommand({
        type: "recruit-ship",
        playerId: 1,
        buildingId: port.id,
        shipType: "warship",
      }),
    ).toMatch(/64/);
    expect(match.players[0].gold).toBe(gold);
  });
  it("normalizes territory production on expanded maps while preserving building income", () => {
    const match = plains();
    match.options.territoryIncomeScale = 4;
    const p = match.players[0];
    p.land = 800;
    const gold = p.gold,
      reserves = p.reserves;
    for (let i = 0; i < TICKS_PER_SECOND; i++) match.step();
    expect(p.gold - gold).toBe(10 + Math.floor(800 / 160));
    expect(p.reserves - reserves).toBe(40 + Math.floor(800 / 80));
  });
});
