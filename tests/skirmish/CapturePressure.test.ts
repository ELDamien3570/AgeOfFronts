import { describe, expect, it } from "vitest";
import { CapturePressure } from "../../src/skirmish/CapturePressure";

describe("sparse capture pressure", () => {
  it("withdraws duplicate defenders without losing the remaining owner or contested pressure",()=>{
    const pressure=new CapturePressure(20);
    pressure.retain(5,1);pressure.retain(5,1);pressure.retain(5,2);
    expect(pressure.at(5)).toBe(255);
    pressure.withdraw(5,1);expect(pressure.at(5)).toBe(255);
    pressure.withdraw(5,2);expect(pressure.at(5)).toBe(1);
    pressure.withdraw(5,1);expect(pressure.at(5)).toBe(0);
    pressure.retain(6,3);pressure.begin();expect(pressure.at(6)).toBe(0);
  });
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
    // One owner byte, one persistent count and up to one touched ordinal.
    expect(pressure.retainedBytes).toBeLessThanOrEqual(90000);
    pressure.begin(); pressure.begin(); expect(pressure.diagnostics.cleared).toBe(0);
  });
});
