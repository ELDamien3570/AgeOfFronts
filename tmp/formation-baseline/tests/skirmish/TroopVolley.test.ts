import { describe, expect, it } from "vitest";
import manifest from "../../Art/Cultures/Russians/Units/StoneAge/Javelinist/animations.json";
import {
  FIXED,
  type ArcherVolley,
  type Snapshot,
} from "../../src/skirmish/Protocol";
import { clipFrame, type ActorClip } from "./browser/TroopPrototypeModel";
import {
  javelinThrowTime,
  throwTiming,
  TroopVolley,
  type VolleyThrower,
} from "./browser/TroopVolley";

const clip: ActorClip = manifest.animations.find(
  (clip) => clip.id === "attack",
)!;
const volley: ArcherVolley = {
  id: 1,
  tick: 20,
  squadId: 4,
  definitionId: "stoneage-archer",
  playerId: 1,
  fromX: 10 * FIXED,
  fromY: 10 * FIXED,
  toX: 10 * FIXED,
  toY: 16 * FIXED,
};
const soldier = (
  id: number,
  changes: Partial<VolleyThrower> = {},
): VolleyThrower => ({
  id,
  x: 10 + id * 0.3,
  y: 10,
  angle: 0,
  scale: 0.25,
  speed: 0,
  gaitDistance: 0,
  front: true,
  throwing: true,
  ...changes,
});

describe("individual javelin volleys", () => {
  it("aligns wind-up, release and follow-through with the authored release frame", () => {
    const source = {
      fighting: true,
      lastAttackTick: 20,
      nextAttackTick: 60,
    } as Snapshot["squads"][number];
    expect(throwTiming(clip).release).toBe(480);
    expect(clipFrame(clip, javelinThrowTime(source, 19.99, clip)!)).toBe(2);
    expect(clipFrame(clip, javelinThrowTime(source, 20, clip)!)).toBe(3);
    expect(clipFrame(clip, javelinThrowTime(source, 29, clip)!)).toBe(5);
    expect(javelinThrowTime(source, 30, clip)).toBeUndefined();
  });
  it("releases one javelin at each actual throwing hand in every rank, excluding walkers", () => {
    const presentation = new TroopVolley();
    const front = [
      soldier(0),
      soldier(1, { angle: Math.PI / 2 }),
      soldier(2, { front: false }),
      soldier(3, { throwing: false, speed: 1 }),
    ];
    expect(presentation.sample(volley, 19, front, clip, 2)).toEqual([]);
    const launched = presentation.sample(volley, 20, front, clip, 2);
    expect(launched.map((p) => p.soldierId)).toEqual([0, 1, 2]);
    const frame = clip.frames[3];
    const size = 2 * 0.25 * clip.scale!;
    const dx = (180 / 512 - frame.pivot.x / 512) * size;
    const dy = (370 / 512 - frame.pivot.y / 512) * size;
    expect(launched[0].x).toBeCloseTo(front[0].x + dx);
    expect(launched[0].y).toBeCloseTo(front[0].y + dy);
    expect(launched[1].x).toBeCloseTo(front[1].x - dy);
    expect(launched[1].y).toBeCloseTo(front[1].y + dx);
  });
  it("freezes launch points through later movement, formation turns and source retirement", () => {
    const baseline = new TroopVolley(),
      moving = new TroopVolley();
    for (const presentation of [baseline, moving])
      presentation.sample(volley, 20, [soldier(0)], clip, 2);
    const expected = baseline.sample(volley, 26, [soldier(0)], clip, 2);
    expect(
      moving.sample(
        volley,
        26,
        [soldier(0, { x: 80, y: 90, angle: Math.PI })],
        clip,
        2,
      ),
    ).toEqual(expected);
    expect(moving.sample(volley, 26, [], clip, 2)).toEqual(expected);
    expect(moving.sample(volley, 32, [], clip, 2)).toEqual([]);
    moving.prune([]);
    moving.clear();
    expect(moving.sample(volley, 20, [], clip, 2)).toEqual([]);
  });
});
