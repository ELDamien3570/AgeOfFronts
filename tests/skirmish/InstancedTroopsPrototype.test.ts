import { describe, expect, it } from "vitest";
import clubmanLayout from "../../Art/Cultures/Russians/Units/StoneAge/Clubman/Formation/formation.json";
import {
  clampMapScale,
  mapFitScale,
  mapStartingScale,
} from "../../src/skirmish/client/MapCameraScale";
import { squadSymbol } from "../../src/skirmish/client/MapSymbols";
import { squadSpriteSize } from "../../src/skirmish/client/UnitAnimation";
import {
  battlePreviewPlacement,
  blendFormationSlots,
  calibratedSlots,
  clipFrame,
  formationSlots,
  formationVisible,
  frontRankCount,
  liveSlotCount,
  representativeCount,
  resolveFormation,
  type ActorClip,
  type FormationShape,
  type ManualFormation,
} from "./browser/TroopPrototypeModel";

describe("instanced troop presentation contracts", () => {
  it("uses wedge only for charge and limits cavalry to line outside charge", () => {
    for (const selected of [
      "line",
      "shield-wall",
      "square",
    ] as ManualFormation[]) {
      expect(resolveFormation(selected, false, false)).toBe(selected);
      expect(resolveFormation(selected, true, false)).toBe("line");
      expect(resolveFormation(selected, false, true)).toBe("wedge");
      expect(resolveFormation(selected, true, true)).toBe("wedge");
      expect(resolveFormation(selected, false, false)).toBe(selected);
    }
  });
  it("places three distinct 20-v-20 face-offs on cell centers", () => {
    const placements = Array.from({ length: 120 }, (_, i) =>
      battlePreviewPlacement(i),
    );
    expect(new Set(placements.map((p) => `${p.x},${p.y}`)).size).toBe(120);
    for (let encounter = 0; encounter < 3; encounter++) {
      const group = placements.slice(encounter * 40, encounter * 40 + 40);
      expect(group.filter((p) => p.enemy)).toHaveLength(20);
      expect(group.filter((p) => !p.enemy)).toHaveLength(20);
      expect(
        group.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y)),
      ).toBe(true);
      expect(
        Math.max(...group.filter((p) => p.enemy).map((p) => p.y)),
      ).toBeLessThan(
        Math.min(...group.filter((p) => !p.enemy).map((p) => p.y)),
      );
    }
  });
  it("preserves every actor through all four presentation formation templates", () => {
    for (const shape of [
      "line",
      "wedge",
      "shield-wall",
      "square",
    ] as FormationShape[]) {
      for (const count of [5, 12, 24, 48]) {
        const slots = formationSlots(clubmanLayout, count, shape);
        expect(slots.length).toBe(count);
        expect(
          slots.every(
            (slot) =>
              Number.isFinite(slot.x + slot.y + slot.scale) && slot.scale > 0,
          ),
        ).toBe(true);
      }
    }
  });
  it("keeps compressed line blocks proportional as soldier counts change", () => {
    for (const [count, columns, rows] of [
      [12, 4, 3],
      [24, 6, 4],
      [48, 8, 6],
    ]) {
      const line = formationSlots(clubmanLayout, count, "line");
      expect(new Set(line.map((slot) => slot.row)).size).toBe(rows);
      const rank = line.filter((slot) => slot.row === 0);
      expect(rank.length).toBe(columns);
      expect(rank[1].x - rank[0].x).toBeCloseTo(
        0.6 / (Math.ceil(Math.sqrt(count)) - 1),
      );
      expect(
        Math.max(...line.map((s) => s.y)) - Math.min(...line.map((s) => s.y)),
      ).toBeLessThan(0.52);
    }
  });
  it("uses the same actor count for cavalry and scales spacing with horse size", () => {
    expect([5, 12, 24, 48].map((n) => representativeCount(n, true))).toEqual([
      5, 12, 24, 48,
    ]);
    expect(representativeCount(12, false)).toBe(12);
    for (const shape of [
      "line",
      "wedge",
      "shield-wall",
      "square",
    ] as FormationShape[]) {
      const normal = formationSlots(clubmanLayout, 9, shape, 1, true);
      const enlarged = formationSlots(clubmanLayout, 9, shape, 2, true);
      expect(enlarged.map((slot) => [slot.x, slot.y, slot.scale])).toEqual(
        normal.map((slot) => [slot.x * 2, slot.y * 2, slot.scale]),
      );
    }
  });
  it("fills front ranks before back ranks and uses a 1-2-3 cavalry charge triangle", () => {
    for (const shape of ["line", "shield-wall"] as FormationShape[]) {
      for (const count of [3, 5, 6, 9, 12, 18, 24, 36, 48]) {
        const slots = formationSlots(clubmanLayout, count, shape);
        const ranks = [...new Set(slots.map((slot) => slot.row))].map(
          (row) => slots.filter((slot) => slot.row === row).length,
        );
        for (let i = 1; i < ranks.length; i++)
          expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
      }
    }
    const foot = formationSlots(clubmanLayout, 12, "wedge");
    const tipY = Math.max(...foot.map((slot) => slot.y));
    expect(foot.filter((slot) => slot.y === tipY)).toHaveLength(1);
    const horses = formationSlots(clubmanLayout, 6, "wedge", 1.25, true);
    expect(
      [2, 1, 0].map((row) => horses.filter((slot) => slot.row === row).length),
    ).toEqual([1, 2, 3]);
    expect(horses.find((slot) => slot.row === 2)?.x).toBe(0);
  });
  it("packs infantry charge wedges into filled widening triangle ranks", () => {
    for (const count of [5, 12, 24, 48]) {
      const triangle = formationSlots(clubmanLayout, count, "wedge");
      expect(triangle).toHaveLength(count);
      const rows = [...new Set(triangle.map((slot) => slot.row))].sort(
        (a, b) => b - a,
      );
      const counts = rows.map(
        (row) => triangle.filter((slot) => slot.row === row).length,
      );
      expect(counts[0]).toBe(1);
      for (let i = 1; i < counts.length; i++)
        expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
      expect(
        Math.max(...triangle.map((s) => s.x)) -
          Math.min(...triangle.map((s) => s.x)),
      ).toBeLessThan(0.68);
      expect(
        Math.max(...triangle.map((s) => s.y)) -
          Math.min(...triangle.map((s) => s.y)),
      ).toBeLessThan(0.6);
      if (count >= 12)
        expect(counts.filter((size) => size > 2).length).toBeGreaterThanOrEqual(
          2,
        );
    }
  });
  it("uses tight concentric square layers with outward facing", () => {
    const square = formationSlots(clubmanLayout, 12, "square");
    expect(
      new Set(
        square.map((slot) => Math.max(Math.abs(slot.x), Math.abs(slot.y))),
      ).size,
    ).toBe(2);
    expect(new Set(square.map((slot) => slot.angle)).size).toBe(4);
    expect(
      formationSlots(clubmanLayout, 12, "shield-wall").some(
        (slot) => Math.abs(slot.y) < 0.1 && Math.abs(slot.x) < 0.2,
      ),
    ).toBe(true);
  });
  it("keeps actor scale constant across every formation", () => {
    for (const count of [5, 12, 24, 48]) {
      const expected = calibratedSlots(clubmanLayout, count)[0].scale;
      for (const shape of [
        "line",
        "wedge",
        "shield-wall",
        "square",
      ] as FormationShape[])
        expect(
          formationSlots(clubmanLayout, count, shape).every(
            (slot) => slot.scale === expected,
          ),
        ).toBe(true);
    }
  });
  it("starts a reshape at the current pose and ends exactly at the chosen layout", () => {
    const from = formationSlots(clubmanLayout, 12, "shield-wall"),
      to = formationSlots(clubmanLayout, 12, "line");
    expect(
      blendFormationSlots(from, to, 0).map((slot) => [
        slot.x,
        slot.y,
        slot.scale,
      ]),
    ).toEqual(from.map((slot) => [slot.x, slot.y, slot.scale]));
    expect(
      blendFormationSlots(from, to, 1).map((slot) => [
        slot.x,
        slot.y,
        slot.scale,
      ]),
    ).toEqual(to.map((slot) => [slot.x, slot.y, slot.scale]));
    const middle = blendFormationSlots(from, to, 0.5);
    expect(middle[0].x).toBeCloseTo((from[0].x + to[0].x) / 2);
  });
  const clip: ActorClip = {
    id: "idle",
    file: "Idle.png",
    frameCount: 3,
    loop: true,
    durations: [100, 200, 300],
    frames: [],
  };
  it("honors authored unequal frame durations and loops", () => {
    expect(
      [0, 99, 100, 299, 300, 599, 600].map((time) => clipFrame(clip, time)),
    ).toEqual([0, 0, 1, 1, 2, 2, 0]);
  });
  it("holds the last death frame instead of restarting", () => {
    expect(clipFrame({ ...clip, loop: false }, 2000)).toBe(2);
    expect(clipFrame(clip, -1)).toBe(0);
  });
  it("keeps a representative survivor until aggregate strength reaches zero", () => {
    expect(
      [100, 50, 1, 0].map((strength) => liveSlotCount(12, strength)),
    ).toEqual([12, 6, 1, 0]);
  });
  it("uses authored five-person offsets and keeps the three front members together", () => {
    const slots = calibratedSlots(clubmanLayout, 5);
    expect(frontRankCount(slots, 5)).toBe(3);
    expect(frontRankCount(slots, 2)).toBe(2);
    expect(slots.find((slot) => slot.x === 0)).toEqual({
      x: 0,
      y: 70 / 512,
      row: 1,
      scale: 0.36,
    });
  });
  it("packs extra soldiers inside the same authored frame envelope", () => {
    for (const n of [12, 24, 48, 1000]) {
      const slots = calibratedSlots(clubmanLayout, n);
      expect(slots.length).toBe(n);
      for (const slot of slots) {
        expect(Math.abs(slot.x) + slot.scale / 2).toBeLessThanOrEqual(0.5);
        expect(Math.abs(slot.y) + slot.scale / 2).toBeLessThanOrEqual(0.5);
      }
    }
  });
  it("matches fit, spawn and maximum zoom including the game HUD inset", () => {
    const fit = mapFitScale(1000, 800, 500, 250, 200);
    expect(fit).toBe(948 / 500);
    expect(mapStartingScale(1000, 800, fit, 200)).toBe(600 / 48);
    expect(clampMapScale(1000, fit)).toBe(96);
    expect(clampMapScale(0.01, fit)).toBe(fit);
  });
  it("uses the real game detail threshold and 55-pixel squad cap", () => {
    expect(squadSymbol(13.99, 1000, true).artwork).toBe(false);
    expect(squadSymbol(14, 1000, true).artwork).toBe(true);
    expect(squadSpriteSize(27.5, 1000)).toBe(55);
    expect(squadSpriteSize(96, 1000)).toBe(55);
    expect(squadSpriteSize(96, 500)).toBeCloseTo(49.5);
  });
  it("keeps partially visible formations and rejects wholly offscreen ones", () => {
    expect(formationVisible(-10, 100, 20, 800, 600)).toBe(true);
    expect(formationVisible(-21, 100, 20, 800, 600)).toBe(false);
    expect(formationVisible(820, 100, 20, 800, 600)).toBe(true);
  });
});
