import { describe, expect, it } from "vitest";
import { PlanningWorkspace } from "../../src/skirmish/PlanningWorkspace";

it("copies only active slot records and preserves exact free-slot order across sparse restore", () => {
  const arena = new PlanningWorkspace(1024), restored = new PlanningWorkspace(1024);
  const first = arena.allocate(12, 8, -1, 10)!;
  const retired = arena.allocate(13, 9, first, 11)!;
  const third = arena.allocate(14, 10, first, 12)!;
  arena.release(retired);
  const saved = arena.checkpoint();
  expect(saved).toMatchObject({ empty: false, sparse: true });
  if (saved.empty || !saved.sparse) throw new Error("Expected sparse active checkpoint");
  expect(saved.slots.length).toBe(2);
  const bytes = Object.values(saved).reduce((sum, value) => sum + (ArrayBuffer.isView(value) ? value.byteLength : 0), 0);
  expect(bytes).toBe(2 * 32 + 1022 * 4);
  expect(bytes).toBeLessThan(arena.bytes / 4);
  restored.restore(saved);
  expect(restored.checkpoint()).toEqual(saved);
  expect(restored.tile[first]).toBe(12);
  expect(restored.parent[third]).toBe(first);
  for (let i = 0; i < 100; i++) expect(restored.allocate(i, 3, first, 4)).toBe(arena.allocate(i, 3, first, 4));
  expect(restored.checkpoint()).toEqual(arena.checkpoint());
});

it("restores legacy full arenas and rejects malformed sparse free/active partitions", () => {
  const arena = new PlanningWorkspace(8);
  arena.allocate(20, 4, -1, 7);
  const legacy = { empty: false as const, capacity: 8, freeCount: 7,
    tile: arena.tile.slice(), parent: arena.parent.slice(), cost: arena.cost.slice(),
    score: arena.score.slice(), position: arena.position.slice(), free: arena.free.slice() };
  const restored = new PlanningWorkspace(8);
  restored.restore(legacy);
  expect(restored.checkpoint()).toEqual(arena.checkpoint());
  const saved = arena.checkpoint();
  if (saved.empty || !saved.sparse) throw new Error("Expected sparse active checkpoint");
  const before = restored.checkpoint();
  saved.free[0] = saved.slots[0];
  expect(() => restored.restore(saved)).toThrow("partition");
  expect(restored.checkpoint()).toEqual(before);
});

describe("planning arena recovery", () => {
  it("omits untouched buffers and restores into a previously used arena", () => {
    const fresh = new PlanningWorkspace(8),
      reused = new PlanningWorkspace(8);
    reused.allocate(40, 0, -1, 0);
    const checkpoint = fresh.checkpoint();
    expect(checkpoint.empty).toBe(true);
    expect(checkpoint.free).toBeUndefined();
    reused.restore(checkpoint);
    expect(reused.used).toBe(0);
    expect(reused.checkpoint()).toEqual(checkpoint);
    expect(reused.allocate(3, 1, -1, 4)).toBe(fresh.allocate(3, 1, -1, 4));
  });
  it("retains reused allocation order without serializing inactive search values", () => {
    const warm = new PlanningWorkspace(8),
      restored = new PlanningWorkspace(8);
    const first = warm.allocate(10, 1, -1, 1)!,
      second = warm.allocate(20, 2, first, 2)!;
    warm.release(first);
    warm.release(second);
    const saved = warm.checkpoint();
    expect(saved.empty).toBe(true);
    restored.restore(saved);
    for (let i = 0; i < 8; i++)
      expect(restored.allocate(i, i, -1, i)).toBe(warm.allocate(i, i, -1, i));
    expect(restored.checkpoint()).toEqual(warm.checkpoint());
  });
  it("preserves active search values and accepts earlier full-buffer checkpoints", () => {
    const warm = new PlanningWorkspace(8),
      restored = new PlanningWorkspace(8);
    const slot = warm.allocate(77, 3, -1, 5)!;
    warm.position[slot] = 2;
    const saved = warm.checkpoint();
    expect(saved.empty).toBe(false);
    const earlier = { ...saved };
    delete (earlier as { capacity?: number }).capacity;
    restored.restore(earlier);
    expect(restored.checkpoint()).toEqual(saved);
    expect(restored.allocate(44, 2, slot, 3)).toBe(
      warm.allocate(44, 2, slot, 3),
    );
  });
});
