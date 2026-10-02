import { describe, expect, it } from "vitest";
import { CapturePressure } from "../../src/skirmish/CapturePressure";

describe("sparse capture pressure", () => {
  it("matches a full-array reference through contests, movement and empty ticks", () => {
    const pressure = new CapturePressure(4096), reference = new Uint8Array(4096);
    for (let tick = 0; tick < 40; tick++) {
      pressure.begin(); reference.fill(0);
      for (let i = 0; i < (tick % 7 === 0 ? 0 : 350); i++) {
        const tile = (i * 13 + tick * 17) % 4096, owner = (i % 54) + 1;
        for (const claimant of [owner, i % 3 ? owner : owner + 1]) {
          const old = reference[tile]; reference[tile] = old === 0 || old === claimant ? claimant : 255;
          pressure.add(tile, claimant);
        }
      }
      expect(Array.from(reference, (_, tile) => pressure.at(tile))).toEqual(Array.from(reference));
    }
  });
  it("clears only touched cells, bounds storage and does not append a contested tile twice", () => {
    const pressure = new CapturePressure(10000);
    pressure.add(500, 1); pressure.add(500, 2); pressure.add(500, 1);
    expect(pressure.at(500)).toBe(255); expect(pressure.diagnostics.touched).toBe(1);
    pressure.begin(); expect(pressure.diagnostics.cleared).toBe(1); expect(pressure.at(500)).toBe(0);
    for (let tile = 0; tile < 10000; tile++) pressure.add(tile, 54);
    expect(pressure.retainedBytes).toBeLessThanOrEqual(50000);
    pressure.begin(); pressure.begin(); expect(pressure.diagnostics.cleared).toBe(0);
  });
});
