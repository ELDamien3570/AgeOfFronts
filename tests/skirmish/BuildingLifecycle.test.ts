import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import type { Building } from "../../src/skirmish/Protocol";
import { BUILDING_RULES } from "../../src/skirmish/Rules";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture() {
  const cells = new Uint8Array(128 * 96).fill(133);
  const world = new Skirmish(new GameMapImpl(128, 96, cells, cells.length), {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
  });
  for (const building of world.buildings) world.removeBuilding(building.id);
  return world;
}

describe("authoritative building lifecycle", () => {
  it("owns inputs, preserves live stack identities and replaces same-count records immediately", () => {
    const world = fixture(),
      tile = world.map.ref(20, 20);
    const input = {
      id: world.allocateId(),
      playerId: 1,
      type: "city" as const,
      tile,
      remainingTicks: 0,
    };
    const first = world.addBuilding(input);
    const second = world.addBuilding({ ...input, id: world.allocateId() });
    input.playerId = 2;
    expect(first.playerId).toBe(1);
    expect(Object.isFrozen(world.buildings)).toBe(true);
    expect(world.buildingFacts().at(tile)).toEqual([first, second]);
    world.updateBuilding(first.id, { playerId: 2, age: "BronzeAge" });
    expect(first.playerId).toBe(2);
    expect(world.building(first.id)).toBe(first);
    expect(world.buildingFacts().byOwner(1)).toEqual([second]);
    expect(world.buildingFacts().byOwner(2)).toEqual([first]);
    world.removeBuilding(first.id);
    const replacement = world.addBuilding({
      ...input,
      id: world.allocateId(),
      type: "port",
    });
    expect(world.buildings).toHaveLength(2);
    expect(world.building(first.id)).toBeUndefined();
    expect(world.building(replacement.id)).toBe(replacement);
    expect(world.buildingFacts().at(tile)).toEqual([second, replacement]);
    expect(world.updateBuilding(first.id, { health: 10 })).toBeUndefined();
    expect(world.removeBuilding(first.id)).toBe(false);
    expect(() => world.addBuilding({ ...input, id: second.id })).toThrow(
      "identity",
    );
  });

  it("matches independent full-array facts after randomized spawn, capture, tier, completion, damage and replacement", () => {
    const world = fixture();
    const reference: Building[] = [];
    let state = 47;
    const pick = (limit: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state % limit;
    };
    const types = ["city", "port", "tower", "barracks"] as const;
    for (let mutation = 0; mutation < 300; mutation++) {
      const operation = pick(6);
      if (!reference.length || (operation === 0 && reference.length < 32)) {
        const row: Building = {
          id: world.allocateId(),
          playerId: pick(3),
          type: types[pick(types.length)],
          tile: world.map.ref(20 + pick(8), 20 + pick(8)),
          remainingTicks: pick(4),
          age: "StoneAge",
          health: 1200,
          maxHealth: 1200,
        };
        world.addBuilding(row);
        reference.push({ ...row });
      } else {
        const at = pick(reference.length),
          row = reference[at];
        if (operation === 1) {
          world.removeBuilding(row.id);
          reference.splice(at, 1);
        } else {
          const changes =
            operation === 2
              ? { playerId: pick(3) }
              : operation === 3
                ? { age: "BronzeAge" as const, remainingTicks: pick(3) }
                : operation === 4
                  ? { health: pick(2) ? 0 : 900 }
                  : {
                      type: types[pick(types.length)],
                      tile: world.map.ref(20 + pick(8), 20 + pick(8)),
                    };
          world.updateBuilding(row.id, changes);
          reference[at] = { ...row, ...changes };
        }
      }
      const facts = world.buildingFacts();
      expect(world.buildings).toEqual(reference);
      expect(facts.highestId).toBe(
        Math.max(0, ...reference.map((row) => row.id)),
      );
      for (const owner of [0, 1, 2]) {
        const own = reference.filter((row) => row.playerId === owner);
        expect(facts.byOwner(owner)).toEqual(own);
        expect(facts.production(owner)).toEqual(
          own
            .filter((row) => !row.remainingTicks && (row.health ?? 1) > 0)
            .reduce(
              (sum, row) => ({
                gold: sum.gold + BUILDING_RULES[row.type].goldIncome,
                reserves: sum.reserves + BUILDING_RULES[row.type].reserveIncome,
              }),
              { gold: 0, reserves: 0 },
            ),
        );
        for (const type of types) {
          expect(facts.byType(owner, type)).toEqual(
            own.filter((row) => row.type === type),
          );
          expect(facts.countOfType(owner, type)).toBe(
            own.filter((row) => row.type === type).length,
          );
        }
      }
      for (let y = 20; y < 28; y++)
        for (let x = 20; x < 28; x++) {
          const tile = world.map.ref(x, y);
          expect(facts.at(tile)).toEqual(
            reference.filter((row) => row.tile === tile),
          );
        }
      world.verifyBuildingIndexes();
    }
  });

  it("invalidates geometry, producer eligibility and dynamic facts independently", () => {
    const world = fixture(),
      facts = world.buildingFacts();
    const building = world.addBuilding({
      id: world.allocateId(),
      playerId: 1,
      type: "tower",
      tile: world.map.ref(20, 20),
      remainingTicks: 5,
      health: 1200,
    });
    const revisions = () => [
      facts.geometryRevision,
      facts.producerRevision,
      facts.dynamicRevision,
    ];
    const initial = revisions();
    world.updateBuilding(building.id, { remainingTicks: 4 });
    expect(revisions()).toEqual([initial[0], initial[1], initial[2] + 1]);
    world.updateBuilding(building.id, { health: 1100, nextAttackTick: 100 });
    expect(revisions()).toEqual([initial[0], initial[1], initial[2] + 2]);
    world.updateBuilding(building.id, { health: 1100 });
    expect(revisions()).toEqual([initial[0], initial[1], initial[2] + 2]);
    world.updateBuilding(building.id, { age: "BronzeAge" });
    expect(revisions()).toEqual([initial[0], initial[1] + 1, initial[2] + 3]);
    world.updateBuilding(building.id, { remainingTicks: 0 });
    expect(revisions()).toEqual([initial[0], initial[1] + 2, initial[2] + 4]);
    world.updateBuilding(building.id, { playerId: 2 });
    expect(revisions()).toEqual([initial[0], initial[1] + 3, initial[2] + 5]);
    world.updateBuilding(building.id, { tile: world.map.ref(21, 20) });
    expect(revisions()).toEqual([
      initial[0] + 1,
      initial[1] + 4,
      initial[2] + 6,
    ]);
    world.removeBuilding(building.id);
    expect(revisions()).toEqual([
      initial[0] + 2,
      initial[1] + 5,
      initial[2] + 7,
    ]);
    expect(facts.diagnostics.indexedRows).toBe(0);
    expect(facts.byOwner(2)).toEqual([]);
    expect(facts.highestId).toBe(0);
  });

  it("keeps comparison mode outside authoritative state and catches unsafe ownership bypasses", () => {
    const world = fixture(),
      building = world.addBuilding({
        id: world.allocateId(),
        playerId: 1,
        type: "city",
        tile: world.map.ref(20, 20),
        remainingTicks: 0,
      });
    const saved = world.checkpoint(),
      compared = fixture();
    compared.restore(saved);
    compared.compareBuildingIndexes = true;
    for (let tick = 0; tick < 12; tick++) {
      world.step();
      compared.step();
    }
    expect(compared.checkpoint()).toEqual(world.checkpoint());
    expect(compared.buildingFacts().diagnostics.comparisonRows).toBeGreaterThan(
      0,
    );
    // Deliberately leave the TypeScript ownership contract to exercise its dev audit.
    (building as { playerId: number }).playerId = 2;
    world.compareBuildingIndexes = true;
    expect(() => world.buildingFacts()).toThrow("lifecycle index mismatch");
    expect(building.playerId).toBe(2); // The audit reports; it never silently repairs.
  });

  it("removes and restores coastal facts when an unfinished producer dies or revives", () => {
    const cells = new Uint8Array(128 * 96).fill(133);
    cells.fill(0, 0, 128 * 12);
    const world = new Skirmish(
      new GameMapImpl(128, 96, cells, cells.length - 128 * 12),
      { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" },
    );
    const port = world.addBuilding({
      id: world.allocateId(),
      playerId: 1,
      type: "port",
      tile: world.map.ref(20, 12),
      remainingTicks: 3,
      health: 1000,
    });
    const naval = world.expansion!.economy.navalFacts;
    expect(naval.readOwnedBuilding(1).value?.id).toBe(port.id);
    world.updateBuilding(port.id, { health: 0 });
    expect(naval.readOwnedBuilding(1).value).toBeUndefined();
    world.updateBuilding(port.id, { health: 1000 });
    expect(naval.readOwnedBuilding(1).value?.id).toBe(port.id);
    world.removeBuilding(port.id);
    expect(naval.readOwnedBuilding(1).value).toBeUndefined();
  });

  it("does not rebuild warm facts each tick and reconstructs derived views on restore", () => {
    const world = fixture();
    world.addBuilding({
      id: world.allocateId(),
      playerId: 1,
      type: "city",
      tile: world.map.ref(20, 20),
      remainingTicks: 3,
    });
    const scans = world.buildingFacts().diagnostics.scannedRows;
    for (let tick = 0; tick < 12; tick++) {
      for (let query = 0; query < 20; query++) world.buildingFacts().byOwner(1);
      world.step();
    }
    expect(world.buildingFacts().diagnostics.scannedRows).toBe(scans);
    const saved = world.checkpoint(),
      restored = fixture();
    restored.restore(saved);
    expect(restored.checkpoint()).toEqual(saved);
    expect(restored.buildingFacts().byOwner(1)).toEqual(
      world.buildingFacts().byOwner(1),
    );
    expect(restored.building(world.buildings[0].id)).toBe(
      restored.buildings[0],
    );
    world.verifyBuildingIndexes();
    restored.verifyBuildingIndexes();
    for (let tick = 0; tick < 12; tick++) {
      world.step();
      restored.step();
    }
    expect(restored.checkpoint()).toEqual(world.checkpoint());
  });
});
