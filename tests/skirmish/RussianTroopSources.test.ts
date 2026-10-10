import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const expected = {
  "BronzeAge-RiverArcher": "BronzeAge/RiverArcher",
  "ClassicalAge-RecurveArcher": "ClassicalAge/RecurveArcher",
  "BronzeAge-BronzeSpearman": "BronzeAge/BronzeSpearman",
};
const calibration = JSON.parse(readFileSync("src/skirmish/content/RussianVisualCalibration.json", "utf8"));
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
describe("requested Russian top-down troop sources", () => {
  for (const [key, folder] of Object.entries(expected))
    it(`${key} uses the top-down review for every baked pose`, () => {
      const path = `Art/Runtime/Russians/Troops/${key}/animations.json`;
      const baked = JSON.parse(readFileSync(path, "utf8"));
      expect(baked.source).toBe(
        `Art/Cultures/Russians/Units/${folder}/TopDownReview/animations.json`,
      );
      expect(baked.metadataHash).toBe(hash(baked.source));
      expect(baked.animations.map((c: any) => c.id)).toEqual(expect.arrayContaining([
        "idle",
        "running",
        "attack",
        "death",
      ]));
      for (const [source, sha] of Object.entries(baked.hashes)) {
        expect(source).toContain("/TopDownReview/");
        expect(sha).toBe(hash(source));
      }
      const artwork = JSON.parse(readFileSync("src/skirmish/content/RussianTroopArtwork.json", "utf8"));
      const binding = Object.keys(artwork).find(k => artwork[k] === folder);
      const approved = binding ? calibration[binding] : Object.values(calibration).find((v: any) => v.folder === folder);
      const authored = JSON.parse(readFileSync(baked.source, "utf8"));
      for (const clip of baked.animations) {
        const original = authored.animations.find((c: any) => c.id === clip.id);
        expect(clip.durations).toEqual(original.durations);
        expect(clip.frames).toHaveLength(original.frames.length);
        for (let i = 0; i < clip.frames.length; i++) {
          expect(clip.frames[i].pivot.x).toBeCloseTo(
            (approved as any)?.bodyAnchorsPx128?.[clip.id]?.x ?? (original.frames[i].pivot.x * 128) / original.frames[i].width,
          );
          expect(clip.frames[i].pivot.y).toBeCloseTo(
            (approved as any)?.bodyAnchorsPx128?.[clip.id]?.y ?? (original.frames[i].pivot.y * 128) / original.frames[i].height,
          );
        }
      }
    });
});
