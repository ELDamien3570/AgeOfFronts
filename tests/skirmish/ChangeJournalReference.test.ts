import { describe, expect, it } from "vitest";
import { EntityChangeJournal } from "../../src/skirmish/EntityChangeJournal";
import { TileChangeJournal } from "../../src/skirmish/TileChangeJournal";

describe("sparse journal reference equivalence", () => {
  it("matches the original recount for independent lagging cursors, eviction, reuse and reset", () => {
    const entities = new EntityChangeJournal(7),
      tiles = new TileChangeJournal(20, 7);
    const reference = new Map<
      number,
      { revision: number; added: number; removed: number }
    >();
    let floor = 0,
      revision = 0,
      random = 47;
    const next = () =>
      (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
    for (let step = 0; step < 1000; step++) {
      if (step % 43 === 0) {
        reference.clear();
        floor = ++revision;
        entities.invalidate();
        tiles.invalidate();
      } else {
        const id = next() % 20,
          kind = (["add", "change", "remove"] as const)[next() % 3],
          previous = reference.get(id);
        reference.delete(id);
        reference.set(id, {
          revision: ++revision,
          added: kind === "add" ? revision : (previous?.added ?? 0),
          removed: kind === "remove" ? revision : (previous?.removed ?? 0),
        });
        if (reference.size > 7) {
          const [oldest, entry] = reference.entries().next().value!;
          floor = entry.revision;
          reference.delete(oldest);
        }
        entities.record(id, kind);
        tiles.record(id);
      }
      for (const cursor of [
        revision,
        revision - 1,
        revision - 6,
        0,
        revision + 1,
      ]) {
        const valid = cursor >= floor && cursor <= revision;
        const expected = [...reference].filter(
          ([, change]) => change.revision > cursor,
        );
        expect(entities.since(cursor)).toEqual(
          valid
            ? expected
                .map(([id, change]) => ({
                  id,
                  removed: change.removed > cursor,
                  added: change.added,
                }))
                .sort((a, b) => a.added - b.added)
            : undefined,
        );
        expect(tiles.since(cursor)).toEqual(
          valid ? expected.map(([id]) => id) : undefined,
        );
      }
      expect(entities.retainedIds).toBe(reference.size);
      expect(tiles.retainedTiles).toBe(reference.size);
    }
  });
  it("reads no history for unchanged cursors and only one row for a sparse update", () => {
    const entities = new EntityChangeJournal(10000),
      tiles = new TileChangeJournal(10000, 10000);
    for (let id = 0; id < 10000; id++) {
      entities.record(id, "add");
      tiles.record(id);
    }
    const cursor = entities.revision;
    expect(entities.since(cursor)).toEqual([]);
    expect(tiles.since(cursor)).toEqual([]);
    expect(entities.diagnostics.reads).toBe(0);
    expect(tiles.diagnostics.reads).toBe(0);
    entities.record(47, "change");
    tiles.record(47);
    expect(entities.since(cursor)).toEqual([
      { id: 47, removed: false, added: 48 },
    ]);
    expect(tiles.since(cursor)).toEqual([47]);
    expect(entities.diagnostics.reads).toBe(1);
    expect(tiles.diagnostics.reads).toBe(1);
  });
});
