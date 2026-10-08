import { describe, expect, it } from "vitest";
import { FIXED } from "../../src/skirmish/Protocol";
import { crossedWaypoint } from "../../src/skirmish/RouteWaypoint";

describe("route waypoint crossing gates", () => {
  it("accepts overshoot outside the old arrival circle without pointing back", () => {
    const goal = { x: 5 * FIXED, y: 6 * FIXED };
    expect(
      crossedWaypoint(
        { x: goal.x + 0.3 * FIXED, y: goal.y + 0.12 * FIXED },
        goal,
        -Math.PI / 2,
      ),
    ).toBe(true);
    expect(
      crossedWaypoint(
        { x: goal.x - 0.1 * FIXED, y: goal.y },
        goal,
        -Math.PI / 2,
      ),
    ).toBe(false);
  });
  it("does not accept displacement outside the local route corridor", () => {
    const goal = { x: 0, y: 0 };
    expect(
      crossedWaypoint({ x: 0.2 * FIXED, y: 0.5 * FIXED }, goal, -Math.PI / 2),
    ).toBe(false);
    expect(crossedWaypoint({ x: FIXED, y: 0 }, goal, -Math.PI / 2)).toBe(false);
  });
  it("uses the same crossing geometry in every travel direction", () => {
    for (const heading of [
      0,
      Math.PI / 4,
      Math.PI / 2,
      Math.PI,
      -Math.PI / 2,
    ]) {
      const ux = -Math.sin(heading),
        uy = Math.cos(heading);
      const position = {
        x: ux * FIXED * 0.2 + uy * FIXED * 0.1,
        y: uy * FIXED * 0.2 - ux * FIXED * 0.1,
      };
      expect(crossedWaypoint(position, { x: 0, y: 0 }, heading)).toBe(true);
    }
  });
});
