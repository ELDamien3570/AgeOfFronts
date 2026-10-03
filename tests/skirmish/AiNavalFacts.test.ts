import { describe, expect, it } from "vitest";
import { unitOwner } from "./UnitFixtures";
import { buildingOwner } from "./BuildingFixtures";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { WaterPaths } from "../../src/skirmish/Pathfinding";
import { FIXED, type Building, type Ship } from "../../src/skirmish/Protocol";
import { AiNavalFacts } from "../../src/skirmish/domain/AiNavalFacts";
import { Recruitment } from "../../src/skirmish/domain/Recruitment";

function fixture() {
  const data = new Uint8Array(60 * 40).fill(133);
  for (let y = 10; y < 40; y++)
    for (let x = 0; x < 60; x++) if (x !== 30) data[y * 60 + x] = 0;
  const map = new GameMapImpl(60, 40, data, 630),
    waterPaths = new WaterPaths(map, false),
    owners = new Uint8Array(data.length).fill(1);
  const buildings: Building[] = [
    [10, 9],
    [40, 9],
    [30, 20],
  ].map(([x, y], index) => ({
    id: index + 1,
    playerId: 1,
    type: "port",
    tile: map.ref(x, y),
    age: "StoneAge",
    remainingTicks: 0,
    health: 1000,
  }));
  const ships: Ship[] = [
    [10, 12, 1],
    [16, 15, 2],
    [40, 12, 1],
  ].map(([x, y, playerId], index) => ({
    id: 100 + index,
    playerId,
    kind: "warship",
    x: (x + 0.5) * FIXED,
    y: (y + 0.5) * FIXED,
    health: 1000,
    destination: null,
    waypoints: [],
    path: [],
    nextPathIndex: 0,
    fighting: false,
    boarding: null,
  }));
  const ownedBuildings = buildingOwner(buildings), ownedShips = unitOwner(ships);
  const buildingIds = new Map(ownedBuildings.values.map((b) => [b.id, b])),
    shipIds = new Map(ownedShips.values.map((s) => [s.id, s])),
    recruitment = new Recruitment();
  const world = {
    map,
    waterPaths,
    owners,
    get buildings() { return ownedBuildings.values; },
    updateBuilding: (id: number, changes: Partial<Omit<Building, "id">>) => ownedBuildings.update(id, changes),
    removeBuilding: (id: number) => { ownedBuildings.remove(id); buildingIds.delete(id); },
    get ships() { return ownedShips.values; },
    updateShip: (id: number, changes: Partial<Omit<Ship, "id">>) => ownedShips.update(id, changes),
    recruitment,
    building: (id: number) => buildingIds.get(id),
    ship: (id: number) => shipIds.get(id),
  };
  const facts = new AiNavalFacts(world),
    west = waterPaths.component[map.ref(10, 12)],
    east = waterPaths.component[map.ref(40, 12)];
  return { world, facts, west, east, buildingIds };
}
function complete(facts: AiNavalFacts, tick = 0) {
  const before = facts.diagnostics.passes;
  for (let i = 0; i < 100 && facts.diagnostics.passes === before; i++)
    expect(facts.step(tick, 3)).toBeLessThanOrEqual(3);
  expect(facts.diagnostics.passes).toBe(before + 1);
}
describe("shared naval facts", () => {
  it("maintains resumable owned coastal-building cursors through capture and checkpoint restore", () => {
    const { world, facts } = fixture();
    complete(facts);
    const first = facts.readOwnedBuilding(1),
      cursor = first.next;
    expect(first.value!.id).toBe(1);
    world.updateBuilding(world.buildings[0].id, { playerId: 2 });
    world.owners[world.buildings[0].tile] = 2;
    facts.observeBuilding(world.buildings[0]);
    expect(facts.readOwnedBuilding(1, cursor).value!.id).toBe(2);
    expect(facts.readOwnedBuilding(2).value!.id).toBe(1);
    const saved = facts.checkpoint();
    facts.restore(saved);
    expect(facts.readOwnedBuilding(1, cursor).value!.id).toBe(2);
    expect(facts.checkpoint()).toEqual(saved);
  });
  it("bounds scans and classifies an ambiguous port by its actual production sea", () => {
    const { world, facts, west, east } = fixture();
    complete(facts);
    expect(facts.seas(1)).toEqual([west, east].sort((a, b) => a - b));
    const ambiguous = world.buildings[2],
      spawn = world.map
        .neighbors(ambiguous.tile)
        .find((t) => world.waterPaths.walkable(t))!,
      actual = world.waterPaths.component[spawn],
      other = actual === west ? east : west;
    expect([...facts.ports(1, actual)].map((b) => b.id)).toContain(
      ambiguous.id,
    );
    expect([...facts.ports(1, other)].map((b) => b.id)).not.toContain(
      ambiguous.id,
    );
    expect([...facts.ownedShips(1, west)].map((s) => s.id)).toEqual([100]);
    expect([...facts.ownedShips(1, east)].map((s) => s.id)).toEqual([102]);
  });
  it("updates paid strength immediately on payment and completion, without another scan", () => {
    const { world, facts, east } = fixture();
    complete(facts);
    world.recruitment.enqueue({
      playerId: 1,
      buildingId: 2,
      category: "ship",
      kind: "warship",
      definitionId: "stoneage-warship",
      cost: { gold: 700 },
      totalTicks: 1,
    });
    const paid = [...facts.paidShips(1, east)];
    expect(paid).toHaveLength(1);
    expect(world.recruitment.byId(paid[0].id)).toBe(paid[0]);
    world.recruitment.step(
      world.buildings,
      world.owners,
      () => true,
      () => {
        throw new Error("Unexpected refund");
      },
    );
    expect([...facts.paidShips(1, east)]).toEqual([]);
    expect(world.recruitment.byId(paid[0].id)).toBeUndefined();
  });
  it("retains a live producer skipped by a shrinking array cursor", () => {
    const { world, facts, east } = fixture();
    complete(facts);
    world.recruitment.enqueue({
      playerId: 1,
      buildingId: 2,
      category: "ship",
      kind: "warship",
      definitionId: "stoneage-warship",
      cost: { gold: 700 },
      totalTicks: 400,
    });
    expect(facts.step(100, 1)).toBe(1);
    world.removeBuilding(world.buildings[0].id);
    complete(facts, 100);
    expect([...facts.ports(1, east)].map((b) => b.id)).toContain(2);
    expect([...facts.paidShips(1, east)]).toHaveLength(1);
  });
  it("restores fact cursors and group order, and relocates ships between local sectors", () => {
    const { world, facts, west } = fixture();
    facts.step(0, 4);
    const restored = new AiNavalFacts(world);
    restored.restore(facts.checkpoint());
    while (!facts.ready) expect(restored.step(0, 2)).toBe(facts.step(0, 2));
    expect(restored.checkpoint()).toEqual(facts.checkpoint());
    const enemy = world.ships[1],
      near = { x: 16.5 * FIXED, y: 15.5 * FIXED };
    expect([...facts.nearbyShips(west, near, FIXED)].map((s) => s.id)).toEqual([
      101,
    ]);
    world.updateShip(enemy.id, { x: 2.5 * FIXED });
    facts.observeShip(enemy);
    restored.observeShip(enemy);
    expect([...facts.nearbyShips(west, near, FIXED)]).toEqual([]);
    expect([...facts.nearbyShips(west, enemy, FIXED)].map((s) => s.id)).toEqual(
      [101],
    );
    expect(restored.checkpoint()).toEqual(facts.checkpoint());
  });
});
