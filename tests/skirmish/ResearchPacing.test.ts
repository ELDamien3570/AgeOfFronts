import { describe, expect, it } from "vitest";
import { ADVANCES, TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { AGES } from "../../src/skirmish/domain/Definitions";
describe("research pacing contract", () => {
  it("keeps all normal nodes below their age-up ceiling, with a 60 second Modern ceiling", () => {
    for (const [i, age] of AGES.entries())
      for (const technology of TECHNOLOGIES.filter((t) => t.age === age)) {
        expect(technology.ticks).toBeLessThanOrEqual(
          ADVANCES[i]?.ticks ?? 1200,
        );
        if (technology.ticks)
          expect(technology.ticks).toBeGreaterThanOrEqual((15 + i * 5) * 20);
      }
    expect(ADVANCES.map((a) => a.ticks / 20)).toEqual([35, 40, 45, 50, 55, 60]);
  });
});
