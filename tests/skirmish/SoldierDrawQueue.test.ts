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
  it("mixes flat-ground squads and preserves individual order through movement and animation", () => {
    const queue = new SoldierDrawQueue();
    for(let squad=1;squad<=3;squad++)for(let member=0;member<4;member++)
      add(queue,squad,member,100+member,32);
    const first=queue.sort().map(e=>[e.squadId,e.soldierId]);
    expect(first.slice(1).filter((e,i)=>e[0]!==first[i][0]).length).toBeGreaterThan(3);
    queue.clear();
    for(let squad=3;squad>=1;squad--)for(let member=3;member>=0;member--)
      add(queue,squad,member,-member*100,member%2?90:24);
    expect(queue.sort().map(e=>[e.squadId,e.soldierId])).toEqual(first);
  });
  it("draws higher terrain last, regardless of size, screen position and identity", () => {
    const queue=new SoldierDrawQueue();
    queue.add(1,0,0,-300,0,20,image,frame,0,"",900);
    queue.add(2,0,0,500,0,100,image,frame,0,"",100);
    expect(queue.sort().map(e=>e.elevation)).toEqual([100,900]);
    queue.clear();add(queue,3,0,0);
    expect(queue.sort()[0].elevation).toBe(0);
  });
  it("reuses records without retaining stale soldiers or their previous position", () => {
    const queue = new SoldierDrawQueue();
    add(queue, 1, 0, 1);
    const previous = queue.sort()[0];
    add(queue, 2, 0, 2);
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
