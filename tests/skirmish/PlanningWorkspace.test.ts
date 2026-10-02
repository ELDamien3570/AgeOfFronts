import { describe, expect, it } from "vitest";
import { PlanningWorkspace } from "../../src/skirmish/PlanningWorkspace";

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
