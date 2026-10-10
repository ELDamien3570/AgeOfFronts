import { describe, expect, it } from "vitest";
import { Renderer } from "../../src/skirmish/client/Renderer";
import { SoldierSelectionIndex } from "../../src/skirmish/client/SoldierSelectionIndex";
import { FIXED, type Snapshot } from "../../src/skirmish/Protocol";

function fixture() {
  const index = new SoldierSelectionIndex();
  const squads = [1, 2, 3].map((id) => ({
    id,
    playerId: id === 3 ? 2 : 1,
    x: 0,
    y: 0,
    troops: 1000,
    kind: "infantry",
    embarkedOn: null,
    afloat: null,
  })) as { -readonly [P in keyof Snapshot["squads"][number]]: Snapshot["squads"][number][P] }[];
  const renderer = Object.create(Renderer.prototype) as Renderer;
  Object.assign(renderer, {
    scale: 12,
    offsetX: 100,
    offsetY: 50,
    snapshot: { squads },
    eraArtwork: new Map(),
  });
  Object.defineProperty(renderer, "artwork", { value: new Map() });
  renderer.squadArtworkHitTest = (s, p, scale) => index.hitTest(s.id, p, scale);
  renderer.squadArtworkIntersectsBox = (s, box) =>
    index.intersectsBox(s.id, box);
  index.beginFrame();
  index.add(1, 10, 10, 0.3);
  index.add(2, 10, 10, 0.3);
  index.add(3, 20, 20, 0.3);
  index.commit();
  return { renderer, index, squads };
}
describe("renderer soldier picking", () => {
  it("selects stray soldiers, honors owner filters, and resolves overlap consistently", () => {
    const { renderer, squads } = fixture();
    expect(renderer.squadAt(220, 170, 1)?.id).toBe(2);
    expect(renderer.squadAt(340, 290, 1)).toBeUndefined();
    expect(renderer.squadAt(340, 290)?.id).toBe(3);
    squads[1].embarkedOn = 5;
    expect(renderer.squadAt(220, 170, 1)?.id).toBe(1);
    renderer.pan(30, 20);
    expect(renderer.squadAt(250, 190, 1)?.id).toBe(1);
  });
  it("uses member intersections for reverse drag boxes and retains root fallback", () => {
    const { renderer, squads, index } = fixture();
    expect(renderer.squadIntersectsBox(squads[0], 222, 172, 218, 168)).toBe(
      true,
    );
    index.clear();
    expect(renderer.squadAt(220, 170, 1)).toBeUndefined();
    squads[0].x = 2 * FIXED;
    squads[0].y = 2 * FIXED;
    expect(renderer.squadIntersectsBox(squads[0], 120, 70, 128, 78)).toBe(true);
    expect(renderer.squadAt(124, 74, 1)?.id).toBe(1);
  });
});
