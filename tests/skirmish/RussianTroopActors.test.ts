import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RUSSIAN_TROOP_ACTORS } from "../../src/skirmish/client/troops/RussianTroopCatalogue";
import { FORMATION_MOVEMENT } from "../../src/skirmish/content/FormationMovement";
import approved from "../../src/skirmish/content/RussianVisualCalibration.json";
import catalogue from "../../src/skirmish/content/RussianTroopActors.json";
import { UNITS } from "../../src/skirmish/content/Units";

describe("normal skirmish individual artwork", () => {
  it("binds runtime troop identities across renamed eras without sharing age-specific asset keys", () => {
    expect(RUSSIAN_TROOP_ACTORS.size).toBe(42);
    expect(RUSSIAN_TROOP_ACTORS.get("earlymodern-archer")?.name).toBe(
      "Modern-SovietMachineGunner",
    );
    const cavalry = [...RUSSIAN_TROOP_ACTORS.values()].filter((actor) =>
      actor.name.endsWith("LightCavalry"),
    );
    expect(new Set(cavalry.map((actor) => actor.name)).size).toBe(
      cavalry.length,
    );
    for (const unit of UNITS.filter((unit) => unit.troopClass)) {
      const actor = RUSSIAN_TROOP_ACTORS.get(unit.id);
      expect(!!actor).toBe(`${unit.age}:${unit.troopClass}` in catalogue);
      if (actor)
        expect(actor.mounted).toBe(
          !actor.vehicle &&
            ["lightCavalry", "heavyCavalry", "rangedCavalry"].includes(
              unit.troopClass!,
            ),
        );
    }
  });
  it("publishes complete bounded clips and preserves normalized pivots and authored pose scales", () => {
    for (const [binding,entry] of Object.entries(catalogue)) {
      const root = `Art/Runtime/Russians/Troops/${entry.key}/`;
      const data = JSON.parse(readFileSync(root + "animations.json", "utf8"));
      const source = JSON.parse(readFileSync(data.source, "utf8"));
      expect(data.actorCount).toBe(1);
      expect(data.animations.map((clip: { id: string }) => clip.id)).toEqual(expect.arrayContaining([
        "idle",
        "running",
        "attack",
        "death",
      ]));
      for (const clip of data.animations) {
        expect(existsSync(root + clip.file)).toBe(true);
        const original =
          source.animations.find(
            (candidate: { id: string }) => candidate.id === clip.id,
          ) ??
          source.animations.find(
            (candidate: { id: string }) =>
              candidate.id ===
              (clip.id === "running" ? "moving" : "moving-shooting"),
          );
        expect(clip.scale).toBe(original.scale);
        expect(clip.frames).toHaveLength(original.frames.length);
        clip.frames.forEach(
          (
            frame: {
              width: number;
              height: number;
              pivot: { x: number; y: number };
            },
            i: number,
          ) => {
            expect(frame.width).toBe(entry.vehicle ? 256 : 128);
            expect(frame.height).toBe(entry.vehicle ? 256 : 128);
            expect(frame.pivot.x / frame.width).toBeCloseTo(
              (approved as any)[binding]?.bodyAnchorsPx128?.[clip.id]?.x / 128 || original.frames[i].pivot.x / original.frames[i].width,
            );
            expect(frame.pivot.y / frame.height).toBeCloseTo(
              (approved as any)[binding]?.bodyAnchorsPx128?.[clip.id]?.y / 128 || original.frames[i].pivot.y / original.frames[i].height,
            );
          },
        );
      }
    }
  });
  it("uses the validated mobile-mass movement modes for new local and hosted matches", () => {
    expect(FORMATION_MOVEMENT).toEqual({
      formationLocomotion: true,
      formationReorientation: true,
      formationFreeTravel: true,
    });
  });
});
