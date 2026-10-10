import { describe, expect, it } from "vitest";
import { BuildingGunPresentation } from "../../src/skirmish/client/BuildingGunPresentation";
import type { ArcherVolley, Building } from "../../src/skirmish/Protocol";
const gun: Building = {
  id: 12,
  playerId: 1,
  type: "gun-nest",
  tile: 10,
  remainingTicks: 0,
};
const shot = (tick: number, x: number, y: number): ArcherVolley => ({
  id: tick + 100,
  squadId: 12,
  playerId: 1,
  tick,
  fromX: 0,
  fromY: 0,
  toX: x,
  toY: y,
});
describe("building gun presentation", () => {
  it("plays one firing clip toward the actual shot and does not restart duplicate snapshots", () => {
    const view = new BuildingGunPresentation();
    view.update([gun], [shot(10, 100, 20)], 10);
    expect(view.firing(12, 12)).toEqual({ facing: "e", elapsed: 2 });
    view.update([gun], [shot(10, 100, 20)], 12);
    expect(view.firing(12, 15)?.elapsed).toBe(5);
    expect(view.firing(12, 24.5)).toBeUndefined();
    expect(view.idleFacing(12)).toBe("e");
    view.update([gun], [shot(25, -100, 20)], 25);
    expect(view.firing(12, 25)?.facing).toBe("w");
  });
  it("never invents firing for a nearby enemy or a construction site and removes destroyed guns", () => {
    const view = new BuildingGunPresentation();
    view.update([gun], [], 10);
    expect(view.firing(12, 10)).toBeUndefined();
    view.update([{ ...gun, remainingTicks: 1 }], [shot(10, 0, -100)], 10);
    expect(view.firing(12, 10)).toBeUndefined();
    view.update([gun], [shot(11, 0, -100)], 11);
    expect(view.firing(12, 11)?.facing).toBe("n");
    view.update([], [], 12);
    expect(view.firing(12, 12)).toBeUndefined();
  });
});
