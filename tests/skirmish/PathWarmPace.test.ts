import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { TICKS_PER_SECOND } from "../../src/skirmish/Protocol";
import { PATH_WARM_TREES, Skirmish } from "../../src/skirmish/Simulation";

function world() {
  // Large enough for a hierarchy, with a lake so water has one too.
  const width = 240, height = 160, terrain = new Uint8Array(width * height).fill(133);
  for (let y = 40; y < 120; y++) for (let x = 120; x < 220; x++) terrain[y * width + x] = 0;
  return new Skirmish(new GameMapImpl(width, height, terrain, terrain.filter(v => v & 128).length), {
    seed: 7, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning: true,
  });
}

describe("crossing-tree warm-up pace (D5)", () => {
  it("warms 120 trees per simulated second and gates corridors on that schedule", () => {
    expect(PATH_WARM_TREES).toBe(Math.ceil(120 / TICKS_PER_SECOND));
    expect(PATH_WARM_TREES).toBe(15);
    const game = world();
    const gates = (game as unknown as { corridorTicks: { land: number; water: number } }).corridorTicks;
    const land = Math.ceil(game.paths.hierarchyPortals / 15) + 1;
    expect(game.paths.hierarchyPortals).toBeGreaterThan(15);
    expect(gates.land).toBe(land);
    expect(gates.water).toBe(land + Math.ceil(game.waterPaths.hierarchyPortals / 15) + 1);
    // The land hierarchy is fully warm by its gate tick.
    while (game.tick < gates.land - 1) game.step();
    expect(game.paths.warm(0)).toBe(true);
    while (game.tick < gates.water) game.step();
    expect(game.waterPaths.warm(0)).toBe(true);
  });
});
