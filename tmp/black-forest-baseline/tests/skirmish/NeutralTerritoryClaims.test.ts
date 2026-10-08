import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { NeutralTerritoryClaims } from "../../src/skirmish/domain/NeutralTerritoryClaims";

function fixture(width = 100, height = 80, side = 6) {
  const terrain = new Uint8Array(width * height).fill(133);
  const map = new GameMapImpl(width, height, terrain, terrain.length);
  const owners = new Uint8Array(terrain.length).fill(1);
  const tiles: number[] = [];
  for (let y = 10; y < 10 + side; y++)
    for (let x = 10; x < 10 + side; x++) {
      const tile = map.ref(x, y);
      tiles.push(tile);
      owners[tile] = 0;
    }
  const policy = new NeutralTerritoryClaims(map);
  policy.changed(tiles[0]);
  let land = owners.length - tiles.length;
  const buildings = new Set<number>();
  const step = (tick: number) =>
    policy.step(
      tick,
      owners,
      (t) => buildings.has(t),
      () => land,
    );
  const apply = (tick: number) => {
    const result = step(tick);
    for (const pocket of result)
      for (const tile of pocket.tiles) {
        owners[tile] = pocket.recipient;
        land++;
        policy.changed(tile);
      }
    return result;
  };
  return {
    terrain,
    map,
    owners,
    tiles,
    policy,
    step,
    apply,
    buildings,
    setLand: (n: number) => {
      land = n;
    },
  };
}

describe("gradual enclosed neutral land claims", () => {
  it("fills a sizable pocket inward one layer every ten seconds", () => {
    const f = fixture();
    expect(f.apply(20)).toEqual([]);
    expect(f.apply(200)).toEqual([]);
    expect(f.apply(220)[0].tiles).toHaveLength(20);
    f.buildings.add(f.tiles[0]); // A building on already claimed land must not halt the inward wave.
    expect(f.owners[f.map.ref(12, 12)]).toBe(0);
    expect(f.apply(420)[0].tiles).toHaveLength(12);
    expect(f.apply(620)[0].tiles).toHaveLength(4);
    expect(f.tiles.every((t) => f.owners[t] === 1)).toBe(true);
  });
  it("rejects a map-sized enclosure and an affordable-looking ring with too little owned land", () => {
    const enormous = fixture(100, 100, 80);
    for (let tick = 20; tick <= 500; tick++)
      expect(enormous.step(tick)).toEqual([]);
    const ring = fixture();
    ring.setLand(100);
    ring.step(20);
    expect(ring.step(220)).toEqual([]);
    ring.setLand(200);
    expect(ring.step(240)).toEqual([]);
    expect(ring.step(440)[0].tiles).toHaveLength(20);
  });
  it("allows water to complete a boundary but cancels when a land exit opens", () => {
    const f = fixture();
    for (let x = 10; x < 16; x++) f.terrain[f.map.ref(x, 9)] = 0;
    f.step(20);
    const exit = f.map.ref(9, 12);
    f.owners[exit] = 0;
    f.policy.changed(exit);
    expect(f.step(220)).toEqual([]);
  });
  it("never absorbs another country's land and resets a protected pocket's timer", () => {
    const f = fixture();
    f.step(20);
    f.buildings.add(f.tiles[0]);
    expect(f.step(220)).toEqual([]);
    f.buildings.clear();
    f.step(240);
    f.owners[f.map.ref(9, 12)] = 2;
    f.policy.changed(f.map.ref(9, 12));
    expect(f.step(440)).toEqual([]);
  });
  it("bounds discovery work and restores unfinished searches deterministically", () => {
    const f = fixture(600, 600, 100);
    f.step(20);
    expect(f.policy.checkpoint().scan!.head).toBeLessThanOrEqual(2048);
    const restored = new NeutralTerritoryClaims(f.map);
    restored.restore(f.policy.checkpoint());
    for (let tick = 21; tick <= 260; tick++) {
      const a = f.step(tick);
      const b = restored.step(
        tick,
        f.owners,
        () => false,
        () => f.owners.length - f.tiles.length,
      );
      expect(b).toEqual(a);
    }
    expect(restored.checkpoint()).toEqual(f.policy.checkpoint());
  });
});
