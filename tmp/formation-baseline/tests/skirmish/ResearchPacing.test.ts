import { describe, expect, it } from "vitest";
import { ADVANCES, TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import data from "../../src/skirmish/content/russian-recruitment.json";

describe("research pacing contract", () => {
  it("preserves authored independent research durations and seven paid age transitions", () => {
    for (const technology of TECHNOLOGIES) {
      expect(technology.ticks).toBe(data.technologies.find(t => t.id === technology.id)!.ticks);
      expect(Number.isSafeInteger(technology.ticks)).toBe(true);
      expect(technology.ticks).toBeGreaterThanOrEqual(0);
    }
    expect(ADVANCES.map(a => a.ticks / 20)).toEqual([35,40,45,50,55,60,70]);
  });
});
