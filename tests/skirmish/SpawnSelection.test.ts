import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { SpawnSelectionViewModel } from "../../src/skirmish/client/SpawnSelectionViewModel";
import { SpawnSelection } from "../../src/skirmish/domain/SpawnSelection";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture(seed = 42) {
  const terrain = new Uint8Array(120 * 80).fill(133);
  for (let y = 0; y < 80; y++) terrain.fill(0, y * 120 + 52, y * 120 + 62);
  const map = new GameMapImpl(120, 80, terrain, terrain.length);
  const options = {
    seed,
    humanNames: ["A", "B"],
    aiCount: 3,
    tribes: true,
    ruleset: "ages-v1" as const,
    runAi: false,
  };
  return { map, options, setup: new SpawnSelection(map, options) };
}
describe("human spawn reservations and seeded faction placement", () => {
  it("accepts different landmasses, changes a reservation, and preserves both humans in the final world", () => {
    const { map, options, setup } = fixture();
    expect(setup.select(1, map.ref(20, 20))).toBeNull();
    expect(setup.select(2, map.ref(90, 50))).toBeNull();
    expect(setup.select(1, map.ref(30, 30))).toBeNull();
    const match = new Skirmish(map, { ...options, humanSpawns: setup.choices });
    expect(match.players[0].base).toBe(map.ref(30, 30));
    expect(match.players[1].base).toBe(map.ref(90, 50));
    expect(match.squads.filter((s) => s.playerId === 1)).toHaveLength(3);
    expect(match.squads.filter((s) => s.playerId === 2)).toHaveLength(3);
    for (const [index, a] of match.players.entries())
      for (const b of match.players.slice(index + 1)) {
        const radius =
          (a.kind === "tribe" ? 3 : 6) + (b.kind === "tribe" ? 3 : 6) + 4;
        expect(map.euclideanDistSquared(a.base, b.base)).toBeGreaterThanOrEqual(
          radius ** 2,
        );
      }
  });
  it("rejects water, tiny islands, invalid seats and overlapping reservations without losing the last choice", () => {
    const { map, setup } = fixture();
    const first = map.ref(20, 20);
    setup.select(1, first);
    expect(setup.select(1, map.ref(56, 20))).toMatch(/viable/);
    expect(setup.select(2, first)).toMatch(/farther/);
    expect(setup.select(3, first)).toMatch(/seat/);
    expect(setup.choices).toEqual([{ playerId: 1, tile: first }]);
    const data = new Uint8Array(80 * 50).fill(133);
    for (let y = 0; y < 50; y++) data.fill(0, y * 80 + 55, (y + 1) * 80);
    for (let y = 20; y < 24; y++) data.fill(133, y * 80 + 65, y * 80 + 69);
    const island = new GameMapImpl(80, 50, data, data.length);
    expect(
      new SpawnSelection(island, { seed: 1, aiCount: 1 }).select(
        1,
        island.ref(66, 21),
      ),
    ).toMatch(/viable/);
  });
  it("uses deterministic fallback only for unchosen humans and varies AI and tribe positions by seed", () => {
    const { setup, map, options } = fixture();
    setup.select(2, map.ref(90, 50));
    const first = setup.resolve();
    const repeated = new SpawnSelection(map, {
      ...options,
      humanSpawns: setup.choices,
    }).resolve();
    expect(first).toEqual(repeated);
    expect(first[1]).toBe(map.ref(90, 50));
    expect(
      new SpawnSelection(map, {
        ...options,
        seed: 43,
        humanSpawns: setup.choices,
      }).resolve(),
    ).not.toEqual(first);
  });
  it("samples interior starts as well as edges instead of maximizing distance each time", () => {
    const data = new Uint8Array(160 * 100).fill(133);
    const map = new GameMapImpl(160, 100, data, data.length);
    const bases = Array.from(
      { length: 24 },
      (_, seed) => new SpawnSelection(map, { seed, aiCount: 1 }).resolve()[1],
    );
    expect(
      bases.filter(
        (tile) =>
          map.x(tile) > 40 &&
          map.x(tile) < 120 &&
          map.y(tile) > 25 &&
          map.y(tile) < 75,
      ).length,
    ).toBeGreaterThan(2);
  });
  it("shows the full real-time countdown and accepted reservations without starting gameplay", () => {
    const { map, options } = fixture();
    const vm = new SpawnSelectionViewModel(
      map,
      options,
      { remainingMs: 20_000, reservations: [] },
      1,
      100,
    );
    expect(vm.seconds(100)).toBe(20);
    expect(vm.seconds(19_100)).toBe(1);
    expect(vm.seconds(25_100)).toBe(0);
    vm.update(
      {
        remainingMs: 5000,
        reservations: [{ playerId: 1, tile: map.ref(20, 20) }],
      },
      15_100,
    );
    expect(vm.chosenTile).toBe(map.ref(20, 20));
    expect(vm.hint(15_100)).toContain("Spawn reserved");
  });
});
