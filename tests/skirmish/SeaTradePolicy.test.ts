import { describe, expect, it } from "vitest";
import { ceilingDistance, chooseReadySeaPort, chooseSeaDiscovery } from "../../src/skirmish/domain/SeaTradePolicy";
const row = (portTile: number, steps: number, allied = false) => ({ portTile, receiverId: portTile + 100,
  owner: allied ? 2 : 3, berth: portTile, distanceSquared: steps * steps, steps, allied, use: { laneId: portTile, reverse: false } });
describe("nearby reusable sea-trade policy", () => {
  it("prefers allies within the near set and rejects a far cached ally", () => {
    expect(chooseReadySeaPort([row(1, 30), row(2, 45, true), row(3, 100, true)])?.portTile).toBe(2);
    expect(chooseReadySeaPort([row(1, 30), row(2, 47, true)])?.portTile).toBe(1);
    expect(chooseReadySeaPort([row(1, 0), row(2, 16, true)])?.portTile).toBe(2);
  });
  it("rotates physical ports deterministically after successful commits only", () => {
    const rows = [row(9, 30), row(2, 31), row(5, 32)];
    expect([undefined, 2, 5, 9].map(after => chooseReadySeaPort(rows, after)?.portTile)).toEqual([2, 5, 9, 2]);
    expect(chooseReadySeaPort(rows, 2)?.portTile).toBe(5);
  });
  it("computes unsquared integer ceiling distance at exact boundaries", () => {
    for (let squared = 0; squared < 10000; squared++) {
      const distance = ceilingDistance(squared);
      expect(distance * distance >= squared).toBe(true);
      expect(distance === 0 || (distance - 1) * (distance - 1) < squared).toBe(true);
    }
    expect(chooseSeaDiscovery([row(1, 30), { ...row(2, 46, true), distanceSquared: 46 * 46 + 1 }])?.portTile).toBe(1);
  });
});
