import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLUBMAN_MEMBER_SCALE,
  DEMO_BODY_WIDTH_PIXELS,
} from "./browser/DemoActorCalibration";
import { demoFormationSlots } from "./browser/DemoTroopPresentation";
import { DEMO_TROOPS } from "./browser/DemoTroops";
import { TroopChoreography } from "./browser/TroopChoreography";
import {
  formationSlots,
  type FormationLayout,
} from "./browser/TroopPrototypeModel";
const layout = (name: string): FormationLayout =>
  JSON.parse(
    readFileSync(
      `Art/Cultures/Russians/Units/StoneAge/${name}/Formation/formation.json`,
      "utf8",
    ),
  );

describe("fixed cavalry presentation", () => {
  it("keeps larger six-rider formations within their two-cell width and leaves clear rank gaps", () => {
    for (const troop of DEMO_TROOPS.filter((t) => t.mounted)) {
      const source = layout("MountedSpearman");
      const previousSize =
        formationSlots(source, 12, "line", 1.5, true)[0].scale * 1.5;
      const line = demoFormationSlots(source, troop, "line");
      const wedge = demoFormationSlots(source, troop, "wedge");
      expect(line).toHaveLength(6);
      expect(wedge).toHaveLength(6);
      expect(line[0].scale).toBeGreaterThan(previousSize * 1.5);
      expect(wedge[0].scale).toBe(line[0].scale);
      const ranks = new Map<number, number>();
      for (const slot of wedge)
        ranks.set(slot.row, (ranks.get(slot.row) ?? 0) + 1);
      expect([...ranks.values()].sort()).toEqual([1, 2, 3]);
      for (const slots of [line, wedge]) {
        const centers = [...new Set(slots.map((s) => s.y))].sort(
          (a, b) => a - b,
        );
        const mountLength = slots[0].scale * (400 / 512) * (2 / 0.75);
        for (let rank = 1; rank < centers.length; rank++)
          expect(
            (centers[rank] - centers[rank - 1]) * (2 / 0.75) - mountLength,
          ).toBeCloseTo(0.12);
        for (const slot of slots) {
          expect(
            (Math.abs(slot.x) + (slot.scale * (230 / 512)) / 2) * (2 / 0.75),
          ).toBeLessThanOrEqual(1 + 1e-10);
        }
      }
    }
  });
  it("matches every upper-body span to Clubman without changing size between formations", () => {
    const reference = CLUBMAN_MEMBER_SCALE * DEMO_BODY_WIDTH_PIXELS.Clubman;
    for (const troop of DEMO_TROOPS) {
      const source = layout(troop.mounted ? "MountedSpearman" : "Clubman");
      let size: number | undefined;
      for (const shape of troop.mounted
        ? (["line", "wedge"] as const)
        : (["line", "shield-wall", "square", "wedge"] as const)) {
        const slots = demoFormationSlots(source, troop, shape);
        expect(slots).toHaveLength(troop.mounted ? 6 : 12);
        expect(
          slots.every(
            (slot) =>
              Math.abs(
                slot.scale * DEMO_BODY_WIDTH_PIXELS[troop.name] - reference,
              ) < 1e-8,
          ),
        ).toBe(true);
        size ??= slots[0].scale;
        expect(slots.every((slot) => slot.scale === size)).toBe(true);
      }
    }
  });
  it("keeps Clubman unchanged and cavalry size stable after a casualty", () => {
    const foot = DEMO_TROOPS[0],
      source = layout("Clubman");
    for (const shape of ["line", "shield-wall", "square", "wedge"] as const)
      expect(demoFormationSlots(source, foot, shape)).toEqual(
        formationSlots(source, 12, shape, 1, false),
      );
    const cavalry = DEMO_TROOPS.find((t) => t.mounted)!;
    const slots = demoFormationSlots(
      layout("MountedSpearman"),
      cavalry,
      "line",
    );
    const choreography = new TroopChoreography(slots, 1, 0);
    for (let now = 0; now <= 4000; now += 50) choreography.advance(now, 5);
    expect(choreography.soldiers(4000)).toHaveLength(5);
    expect(
      choreography.soldiers(4000).every((s) => s.scale === slots[0].scale),
    ).toBe(true);
  });
});
