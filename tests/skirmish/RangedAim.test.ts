import { describe, expect, it } from "vitest";
import { AIM_TARGET_RADIUS, predictiveAim } from "./browser/RangedAim";
function trial(velocity: { x: number; y: number }, turn = false) {
  const speed = 520,
    time = 500 / speed;
  const target = { x: 500 - velocity.x * time, y: -velocity.y * time };
  let hits = 0;
  for (let seed = 1; seed <= 10000; seed++) {
    const aim = predictiveAim({ x: 0, y: 0 }, target, velocity, speed, seed);
    const first = turn ? aim.seconds / 2 : aim.seconds;
    const actual = {
      x: target.x + velocity.x * first + (turn ? -velocity.y * first : 0),
      y: target.y + velocity.y * first + (turn ? velocity.x * first : 0),
    };
    if (
      Math.hypot(actual.x - aim.point.x, actual.y - aim.point.y) <
      AIM_TARGET_RADIUS
    )
      hits++;
  }
  return hits / 10000;
}
describe("observed-velocity ranged aiming", () => {
  it.each([
    { x: 0, y: 40 },
    { x: 40, y: 0 },
    { x: -40, y: 0 },
    { x: 28, y: 28 },
  ])(
    "lands about 70%% at reference range for steady velocity %j",
    (velocity) => {
      expect(trial(velocity)).toBeGreaterThan(0.67);
      expect(trial(velocity)).toBeLessThan(0.73);
    },
  );
  it("misses substantially more when a target turns after launch", () =>
    expect(trial({ x: 0, y: 60 }, true)).toBeLessThan(0.2));
  it("produces deterministic frozen endpoints", () => {
    const target = { x: 500, y: 0 },
      velocity = { x: 0, y: 40 };
    const a = predictiveAim({ x: 0, y: 0 }, target, velocity, 520, 7);
    expect(a).toEqual(predictiveAim({ x: 0, y: 0 }, target, velocity, 520, 7));
    target.x += 100;
    expect(a.point.x).toBeLessThan(520);
  });
});
