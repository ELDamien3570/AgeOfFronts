import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { TerritoryAbsorption } from "../../src/skirmish/domain/TerritoryAbsorption";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture(cells = 1) {
  const terrain = new Uint8Array(15 * 15).fill(133);
  const map = new GameMapImpl(15, 15, terrain, terrain.length);
  const owners = new Uint8Array(terrain.length).fill(1);
  const tiles = [map.ref(7, 7), map.ref(8, 7), map.ref(9, 7)].slice(0, cells);
  for (const tile of tiles) owners[tile] = 2;
  const policy = new TerritoryAbsorption(map);
  for (const tile of tiles) policy.changed(tile);
  const buildings = new Set<number>();
  let enemies = true;
  const step = (tick: number) =>
    policy.step(
      tick,
      owners,
      (tile) => buildings.has(tile),
      () => enemies,
    );
  return {
    map,
    terrain,
    owners,
    tiles,
    policy,
    buildings,
    step,
    ally: () => {
      enemies = false;
    },
  };
}

describe("isolated territory absorption", () => {
  it.each([1, 2])("absorbs a %i-cell unclaimed pocket after ten seconds without requiring hostility", (cells) => {
    const f = fixture(cells);
    for (const tile of f.tiles) f.owners[tile] = 0;
    f.ally();
    expect(f.step(20)).toEqual([]);
    expect(f.step(200)).toEqual([]);
    expect(f.step(220)).toEqual([{ owner: 0, recipient: 1, tiles: f.tiles }]);
  });

  it.each(["large", "water", "mixed", "edge", "building"])("does not absorb an unclaimed pocket with a %s boundary or protection", (reason) => {
    const f = fixture(reason === "large" ? 3 : 1);
    for (const tile of f.tiles) f.owners[tile] = 0;
    const neighbor = f.map.ref(7, 6);
    if (reason === "water") f.terrain[neighbor] = 0;
    if (reason === "mixed") f.owners[neighbor] = 3;
    if (reason === "building") f.buildings.add(f.tiles[0]);
    if (reason === "edge") {
      f.owners[f.tiles[0]] = 1;
      f.owners[0] = 0;
      f.policy.changed(0);
    }
    f.step(20);
    expect(f.step(220)).toEqual([]);
  });

  it.each([1, 2])(
    "absorbs a %i-cell pocket only after ten game seconds",
    (cells) => {
      const f = fixture(cells);
      expect(f.step(20)).toEqual([]);
      expect(f.step(200)).toEqual([]);
      expect(f.step(220)).toEqual([{ owner: 2, recipient: 1, tiles: f.tiles }]);
    },
  );

  it("protects the entire pocket with a building, including construction, and restarts after removal", () => {
    const f = fixture(2);
    f.step(20);
    f.buildings.add(f.tiles[1]);
    expect(f.step(220)).toEqual([]);
    f.buildings.clear();
    expect(f.step(240)).toEqual([]);
    expect(f.step(420)).toEqual([]);
    expect(f.step(440)).toHaveLength(1);
  });

  it.each(["large", "neutral", "water", "mixed", "edge", "allied"])(
    "protects %s borders/pockets",
    (reason) => {
      const f = fixture(reason === "large" ? 3 : 1);
      const neighbor = f.map.ref(7, 6);
      if (reason === "neutral") f.owners[neighbor] = 0;
      if (reason === "mixed") f.owners[neighbor] = 3;
      if (reason === "water") f.terrain[neighbor] = 0;
      if (reason === "edge") {
        f.owners[f.tiles[0]] = 1;
        f.owners[0] = 2;
        f.policy.changed(0);
      }
      if (reason === "allied") f.ally();
      f.step(20);
      expect(f.step(220)).toEqual([]);
    },
  );

  it("resets the timer when the recipient changes and discovers pockets split off by capture", () => {
    const f = fixture(3);
    f.step(20);
    f.owners[f.tiles[2]] = 1;
    f.policy.changed(f.tiles[2]);
    expect(f.step(40)).toEqual([]);
    f.owners.fill(3);
    f.owners[f.tiles[0]] = f.owners[f.tiles[1]] = 2;
    f.policy.changed(f.tiles[0]);
    expect(f.step(240)).toEqual([]);
    expect(f.step(440)[0].recipient).toBe(3);
  });

  it.each([0, 2])("applies absorption from owner %i through authoritative ownership accounting and clears capture state", (owner) => {
    const terrain = new Uint8Array(100 * 80).fill(133);
    const game = new Skirmish(
      new GameMapImpl(100, 80, terrain, terrain.length),
      { seed: 42, aiCount: 1, tribes: false, runAi: false },
    );
    const change = (tile: number, owner: number) =>
      (
        game as unknown as { changeOwner(tile: number, owner: number): void }
      ).changeOwner(tile, owner);
    const center = game.map.ref(50, 40);
    for (let y = 36; y <= 44; y++)
      for (let x = 46; x <= 54; x++) change(game.map.ref(x, y), 1);
    change(center, owner);
    for (let i = 0; i < 219; i++) game.step();
    expect(game.owners[center]).toBe(owner);
    const before = game.players.map((p) => p.land);
    game.step();
    expect(game.owners[center]).toBe(1);
    expect(game.players[0].land).toBe(before[0] + 1);
    expect(game.players[1].land).toBe(before[1] - (owner === 2 ? 1 : 0));
    expect([...game.ownedLand(1)]).toContain(center);
    expect([...game.ownedLand(2)]).not.toContain(center);
    expect(game.claims[center]).toBe(0);
    expect(game.progress[center]).toBe(0);
  });
});
