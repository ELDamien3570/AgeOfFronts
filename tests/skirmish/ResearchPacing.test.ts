import {TICKS_PER_SECOND} from '../../src/skirmish/Protocol';
import { describe, expect, it } from "vitest";
import { ADVANCES, TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import formations from "../../src/skirmish/content/formation-recipes.json";
import data from "../../src/skirmish/content/russian-recruitment.json";

describe("research pacing contract", () => {
  it("preserves authored independent research durations and seven paid age transitions", () => {
    for (const technology of TECHNOLOGIES) {
      expect(technology.ticks).toBe([...data.technologies,...formations.technologies].find(t => t.id === technology.id)!.ticks);
      expect(Number.isSafeInteger(technology.ticks)).toBe(true);
      expect(technology.ticks).toBeGreaterThanOrEqual(0);
    }
    expect(ADVANCES.map(a => a.ticks / TICKS_PER_SECOND)).toEqual([50,55,60,65,70,75,85]);
  });
});
