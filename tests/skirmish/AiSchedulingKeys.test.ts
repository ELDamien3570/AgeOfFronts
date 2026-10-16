import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { secondsToTicks } from "../../src/skirmish/Protocol";
import { forceBucket } from "../../src/skirmish/domain/AiOperations";
import { progressionStagger } from "../../src/skirmish/domain/Expansion";

// I10: P26 (progression stagger) and P25 (operations sleep key).
describe("AI scheduling keys (I10)", () => {
  it("spreads AI progression over every tick of its 3 s cycle", () => {
    const cycle = secondsToTicks(3);
    const phases = new Set(Array.from({ length: cycle }, (_, i) => progressionStagger(i + 1)));
    expect(phases.size).toBe(cycle);
  });

  it("buckets rival force counts so a single recruit does not wake sleeping factions", () => {
    let previous = 0;
    for (let n = 0; n <= 2000; n++) {
      const b = forceBucket(n);
      expect(b).toBeGreaterThanOrEqual(previous);
      expect(b - previous).toBeLessThanOrEqual(1);
      previous = b;
    }
    expect(forceBucket(0)).toBe(0);
    // About 25% per bucket: a large army needs a material change to move a bucket.
    const changes = Array.from({ length: 60 }, (_, i) => forceBucket(40 + i) !== forceBucket(41 + i)).filter(Boolean).length;
    expect(changes).toBeLessThanOrEqual(6);
    expect(forceBucket(2000)).toBeLessThan(40);
  });

  it("rotates rejected tribe build sites instead of retrying the same tile (P24)", () => {
    const terrain = new Uint8Array(96 * 64).fill(133), map = new GameMapImpl(96, 64, terrain, terrain.length);
    const game = new Skirmish(map, { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", aiEconomy: true, deferredPlanning: true });
    const tribe = game.players[1], e = game.expansion!;
    tribe.kind = "tribe"; tribe.ai = true; tribe.gold = 1_000_000;
    e.progression.states[tribe.id].completed.push(...TECHNOLOGIES.filter((t) => t.age === "StoneAge").map((t) => t.id));
    for (let i = 0; i < map.width() * map.height(); i++) if (map.euclideanDistSquared(i, tribe.base) <= 10 ** 2) game.owners[i] = tribe.id;
    const original = game.applyCommand.bind(game), tiles: string[] = [];
    vi.spyOn(game, "applyCommand").mockImplementation((c) => {
      if (c.type === "build") { tiles.push(`${c.buildingType}:${c.tile}`); return "Site rejected"; }
      return original(c);
    });
    const think = (e as unknown as { thinkTribeDevelopment(p: typeof tribe): void }).thinkTribeDevelopment.bind(e);
    for (let i = 0; i < 4; i++) think(tribe);
    expect(tiles.length).toBeGreaterThan(16);
    // Each pass moves the per-type cursor on, so no (type, tile) site is retried while untried ones remain.
    expect(new Set(tiles).size).toBe(tiles.length);
  });
});
