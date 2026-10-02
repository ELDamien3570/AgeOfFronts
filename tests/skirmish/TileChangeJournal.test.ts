import { FIXED } from "../../src/skirmish/Protocol";
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import { TileChangeJournal } from "../../src/skirmish/TileChangeJournal";

describe("independent dirty tile cursors", () => {
  it("retains latest identities, supports multiple cursors, and falls back on overflow or restore", () => {
    const journal = new TileChangeJournal(100, 2);
    journal.record(10); const first = journal.revision;
    journal.record(20); journal.record(10);
    expect(journal.since(0)).toEqual([20, 10]); expect(journal.since(first)).toEqual([20, 10]);
    const second = journal.revision; journal.record(30);
    expect(journal.retainedTiles).toBe(2); expect(journal.since(0)).toBeUndefined(); expect(journal.since(second)).toEqual([30]);
    journal.invalidate(); expect(journal.since(second)).toBeUndefined();
    expect(() => journal.record(100)).toThrow();
  });
  it("matches full scanning, preserves independent baselines and reads only changed cells", () => {
    const cells = new Uint8Array(64 * 48).fill(133), map = new GameMapImpl(64, 48, cells, cells.length);
    const game = new Skirmish(map, { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" });
    const fast = new SnapshotEncoder(true), reference = new SnapshotEncoder(true);
    const neutral = game.owners.indexOf(0), squad = game.squads[0];
    squad.x = (map.x(neutral) + 0.5) * FIXED; squad.y = (map.y(neutral) + 0.5) * FIXED;
    expect(fast.encode(game.snapshot(false), game.tileChanges)).toEqual(reference.encode(game.snapshot()));
    const initialRevision = game.tileChanges.revision;
    for (let tick = 0; tick < 12; tick++) {
      game.step();
      if (tick === 4) new SnapshotEncoder(true).encode(game.snapshot(false), game.tileChanges);
      const packet = fast.encode(game.snapshot(false), game.tileChanges);
      expect(packet).toEqual(reference.encode(game.snapshot()));
      expect(fast.diagnostics.tileReads).toBeLessThan(cells.length);
    }
    expect(game.tileChanges.revision).toBeGreaterThan(initialRevision);
  });
  it("invalidates a live encoder on restore and leaves ordinary snapshot arrays isolated", () => {
    const cells = new Uint8Array(64 * 48).fill(133), map = new GameMapImpl(64, 48, cells, cells.length);
    const game = new Skirmish(map, { seed: 47, aiCount: 1, tribes: false, runAi: false });
    const encoder = new SnapshotEncoder(true), baseline = game.checkpoint();
    encoder.encode(game.snapshot(false), game.tileChanges); game.step();
    encoder.encode(game.snapshot(false), game.tileChanges);
    game.restore(baseline);
    const restored = encoder.encode(game.snapshot(false), game.tileChanges);
    expect(restored.tick).toBe(0); expect(encoder.diagnostics.tileReads).toBe(cells.length);
    const ordinary = game.snapshot(); ordinary.owners.fill(255);
    expect(game.owners.includes(255)).toBe(false);
  });
});
