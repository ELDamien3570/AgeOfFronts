import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import { generateBlackForest } from "../../src/skirmish/BlackForestMap";
import { BLACK_FOREST_THEME, blackForestLayout } from "../../src/skirmish/BlackForestLayout";
import { generateContinents } from "../../src/skirmish/ContinentsMap";
import { generateMigration } from "../../src/skirmish/MigrationMap";
import { mapIdentity } from "../../src/skirmish/multiplayer/application/MapIdentity";
import {
  BLACK_FOREST_LAYOUT_SALT,
  SIMULATION_STREAM_SALT,
  SPAWN_STREAM_SALT,
} from "../../src/skirmish/SeedStreams";
import { Skirmish } from "../../src/skirmish/Simulation";
import type { LoadedMap } from "../../src/skirmish/Protocol";
import type { RuntimeMap } from "../../src/skirmish/multiplayer/application/MatchExecutor";

const identity = (map: LoadedMap): Promise<string> =>
  mapIdentity({
    width: map.map.width(),
    height: map.map.height(),
    terrain: map.terrain,
    elevation: map.elevation,
    forest: map.forest,
    resourceTerrain: map.resourceTerrain,
  } as RuntimeMap);

describe("salted seed streams (R2-L6)", () => {
  const inlineSalts = [
    0x2b573c21, 0x62bd1739, 0x5a3c91e7, 0x6b2d7e15, 0x472bf319, 0x367cab29,
    0x29fa8371, 0x658fc731, 0x437b951,
  ];
  it("gives the layout, spawn and simulation streams distinct salts that also differ from every generator salt", () => {
    const salts = [BLACK_FOREST_LAYOUT_SALT, SPAWN_STREAM_SALT, SIMULATION_STREAM_SALT];
    expect(new Set([...salts, ...inlineSalts]).size).toBe(salts.length + inlineSalts.length);
    for (const salt of salts) expect(salt).not.toBe(0);
  });

  it("starts the three streams from different sfc32 states for the same seed", () => {
    for (const seed of [0, 1, 42, 2026, 0x7fffffff]) {
      const states = [
        new PseudoRandom(seed).getState(),
        new PseudoRandom(seed ^ BLACK_FOREST_LAYOUT_SALT).getState(),
        new PseudoRandom(seed ^ SPAWN_STREAM_SALT).getState(),
        new PseudoRandom(seed ^ SIMULATION_STREAM_SALT).getState(),
      ].map((state) => state.join(","));
      expect(new Set(states).size).toBe(4);
    }
  });

  it("no longer seeds the simulation PRNG with the raw seed that spawn attempt 0 used", () => {
    const terrain = new Uint8Array(60 * 40).fill(133);
    const map = new GameMapImpl(60, 40, terrain, terrain.length);
    const match = new Skirmish(map, { seed: 42, aiCount: 1, tribes: false, ruleset: "ages-v1" });
    const raw = new PseudoRandom(42).getState();
    expect(match.checkpoint().random).not.toEqual(raw);
    expect(match.checkpoint().random).toEqual(
      new PseudoRandom(42 ^ SIMULATION_STREAM_SALT).getState(),
    );
  });

  it("keeps every Black Forest passage centre line out of the forested map rim", () => {
    // Salting the layout stream made seed 1 at 250 bend a route to y = 3, inside the
    // boundary band that is forced to dense woodland.
    for (const seed of [1, ...Array.from({ length: 40 }, (_, i) => i + 2)]) {
      const layout = blackForestLayout(250, seed);
      for (const passage of layout.passages)
        for (const point of passage.points)
          expect(layout.clearance[Math.floor(point.y) * 250 + Math.floor(point.x)]).toBeGreaterThan(-250);
    }
  });

  it("keeps Migration and Continents identical and records the new Black Forest revision", async () => {
    // Unchanged by salting: the generators already used inline salts.
    expect(await identity(generateMigration(250, 42))).toBe(
      "f49116fe3e50cec2cde62e925d040a09114a668712c7fd6b38ef177032ee2c65",
    );
    expect(await identity(generateContinents(250, 42))).toBe(
      "a43d25279cbc62ffe2fa301ed3f287354b85e0aca052fbbb3ed129cd2503efac",
    );
    // Changed deliberately: layout stream salted, theme revision 4 -> 5.
    expect(BLACK_FOREST_THEME.revision).toBe(5);
    expect(await identity(generateBlackForest(250, 42))).toBe(
      "36a675a8c22f2d277f0aa68b921519d4db29af278371ceba0acd49be5f51eb29",
    );
  });
});
