import { describe, expect, it, vi } from "vitest";

const solves = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../src/skirmish/domain/FormationSlotAssignment", async importOriginal => {
  const original = await importOriginal<typeof import("../../src/skirmish/domain/FormationSlotAssignment")>();
  return {
    ...original,
    minimumTravelAssignment: (...args: Parameters<typeof original.minimumTravelAssignment>) => {
      solves.count++;
      return original.minimumTravelAssignment(...args);
    },
  };
});

import { minimumTravelAssignment } from "../../src/skirmish/domain/FormationSlotAssignment";
import { formationSlots, reorientedFormation, TURN } from "../../src/skirmish/domain/FormationGeometry";
import { cavalryBattleScene } from "./fixtures/CavalryImpact";

describe("reorientation assignment reuse (R2-P10 a)", () => {
  it("solves a reorientation's assignment once and interpolates it identically", () => {
    const { riders } = cavalryBattleScene();
    for (const shape of ["mass", "line", "wedge", "square"] as const)
      for (const facing of [TURN / 2, TURN / 4, (TURN * 3) / 8]) {
        const s = { ...riders[0], formation: { ...riders[0].formation!, shape, transition: undefined } };
        solves.count = 0;
        const formation = reorientedFormation(s, 0, facing), turned = { ...s, formation };
        expect(solves.count).toBe(1);
        const transition = formation.transition!, source = transition.fromSlots!;
        const target = formationSlots({ ...turned, formation: { ...formation, transition: undefined } }, 0);
        expect(source.length).toBe(target.length);
        // Certification samples the transition: no second Hungarian solve.
        const tick = Math.max(1, Math.floor(transition.duration / 3));
        const mid = formationSlots(turned, tick);
        expect(solves.count).toBe(1);
        // Reference: the assignment solved directly, interpolated by hand.
        const assignment = minimumTravelAssignment(source, target), p = tick / transition.duration;
        expect(mid.map(slot => [slot.x, slot.y])).toEqual(target.map((slot, i) => {
          const from = source[assignment[i]];
          return [Math.round(from.x + (slot.x - from.x) * p), Math.round(from.y + (slot.y - from.y) * p)];
        }));
      }
  });
});
