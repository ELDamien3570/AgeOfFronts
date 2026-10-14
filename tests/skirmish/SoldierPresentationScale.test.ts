import { describe, expect, it } from "vitest";
import doctrines from "../../src/skirmish/content/formation-doctrines.json";
import { projectilePresentationScale } from "../../src/skirmish/content/ProjectileScale";
import { SOLDIER_SCALE } from "../../src/skirmish/content/SoldierScale";
import {
  columnLayout,
  formationDoctrine,
} from "../../src/skirmish/domain/FormationGeometry";
describe("approved soldier presentation scales", () => {
  it("matches cavalry body and pitch with shared authoritative geometry while preserving infantry", () => {
    for (const [id, authored] of Object.entries(doctrines.doctrines)) {
      const live = formationDoctrine(id);
      if (authored.hull) continue;
      expect(live.bodyWidth).toBe(
        Math.round(
          authored.bodyWidth * SOLDIER_SCALE * (authored.mounted ? 0.9 : 1),
        ),
      );
      expect(live.spacing).toBe(
        Math.round(
          authored.spacing * SOLDIER_SCALE * (authored.mounted ? 0.8 * 0.7 : 1),
        ),
      );
      if (authored.mounted)
        expect(columnLayout(live).spacing).toBe(
          Math.round(256 * SOLDIER_SCALE * 0.7),
        );
    }
  });
  it("shrinks only shafts in all three states, preserving heavy projectiles and bullets", () => {
    for (const kind of ["arrow", "bow", "bolt", "javelin"]) {
      expect(projectilePresentationScale(kind, "flight")).toBe(0.45);
      expect(projectilePresentationScale(kind, "ground")).toBe(0.45);
      expect(projectilePresentationScale(kind, "embedded")).toBe(0.7);
    }
    for (const kind of ["bullet", "shell", "rocket", "bomb", "stone"])
      expect(projectilePresentationScale(kind, "flight")).toBe(1);
  });
});
