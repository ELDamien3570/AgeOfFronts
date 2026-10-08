import { describe, expect, it } from "vitest";
import { SoldierDrawQueue } from "../../src/skirmish/client/SoldierDrawQueue";
const frame = {
  x: 0,
  y: 0,
  width: 512,
  height: 512,
  pivot: { x: 256, y: 256 },
};
const image = {} as CanvasImageSource;
function add(
  queue: SoldierDrawQueue,
  squad: number,
  member: number,
  y: number,
  size = 32,
) {
  queue.add(squad, member, 100, y, 0, size, image, frame);
}
describe("shared soldier layer", () => {
  it("clears selected rings when reusing records for unselected soldiers", () => {
    const queue = new SoldierDrawQueue();
    queue.add(1, 0, 0, 0, 0, 32, image, frame, 5);
    expect(queue.sort()[0].selectionRadius).toBe(5);
    queue.clear();
    add(queue, 1, 0, 0);
    expect(queue.sort()[0].selectionRadius).toBe(0);
  });
  it("keeps identity ordering regardless of position, sprite size, and insertion order", () => {
    const queue = new SoldierDrawQueue();
    add(queue, 1, 0, 12, 80);
    add(queue, 1, 1, 10, 80);
    add(queue, 2, 0, 11, 32);
    expect(queue.sort().map((e) => [e.squadId, e.soldierId])).toEqual([
      [1, 0],
      [1, 1],
      [2, 0],
    ]);
  });
  it("preserves overlap order as soldiers cross positions", () => {
    const queue = new SoldierDrawQueue();
    for (const [squad, member] of [
      [2, 0],
      [1, 2],
      [1, 0],
      [1, 1],
    ])
      add(queue, squad, member, 100 - squad * 20 - member * 5);
    expect(queue.sort().map((e) => [e.squadId, e.soldierId])).toEqual([
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 0],
    ]);
  });
  it("reuses records without retaining stale soldiers or their previous position", () => {
    const queue = new SoldierDrawQueue();
    add(queue, 1, 0, 1);
    add(queue, 2, 0, 2);
    const previous = queue.sort()[0];
    queue.clear();
    add(queue, 3, 1, 8);
    const next = queue.sort();
    expect(next).toHaveLength(1);
    expect(next[0]).toBe(previous);
    expect([next[0].squadId, next[0].soldierId, next[0].screenY]).toEqual([
      3, 1, 8,
    ]);
  });
});
