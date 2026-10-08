import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import catalogue from "../../src/skirmish/content/RussianTroopActors.json";
import { UNITS } from "../../src/skirmish/content/Units";
import { RUSSIAN_TROOP_ACTORS } from "../../src/skirmish/client/troops/RussianTroopCatalogue";
import { FORMATION_MOVEMENT } from "../../src/skirmish/content/FormationMovement";

describe("normal skirmish individual artwork", () => {
  it("binds runtime troop identities across renamed eras without sharing age-specific asset keys", () => {
    expect(RUSSIAN_TROOP_ACTORS.size).toBe(29);
    expect(RUSSIAN_TROOP_ACTORS.get("earlymodern-archer")?.name).toBe("Modern-SovietMachineGunner");
    const cavalry = [...RUSSIAN_TROOP_ACTORS.values()].filter(actor => actor.name.endsWith("LightCavalry"));
    expect(new Set(cavalry.map(actor => actor.name)).size).toBe(cavalry.length);
    for (const unit of UNITS.filter(unit => unit.troopClass)) {
      const actor = RUSSIAN_TROOP_ACTORS.get(unit.id);
      expect(!!actor).toBe(`${unit.age}:${unit.troopClass}` in catalogue);
      if (actor) expect(actor.mounted).toBe(unit.troopClass!.endsWith("Cavalry"));
    }
  });
  it("publishes complete bounded clips and preserves normalized pivots and authored pose scales", () => {
    for (const entry of Object.values(catalogue)) {
      const root = `Art/Runtime/Russians/Troops/${entry.key}/`;
      const data = JSON.parse(readFileSync(root + "animations.json", "utf8"));
      const source = JSON.parse(readFileSync(data.source, "utf8"));
      expect(data.actorCount).toBe(1);
      expect(data.animations.map((clip: { id: string }) => clip.id)).toEqual(["idle", "running", "attack", "death"]);
      for (const clip of data.animations) {
        expect(existsSync(root + clip.file)).toBe(true);
        const original = source.animations.find((candidate: { id: string }) => candidate.id === clip.id);
        expect(clip.scale).toBe(original.scale);
        expect(clip.frames).toHaveLength(original.frames.length);
        clip.frames.forEach((frame: { width: number; height: number; pivot: { x: number; y: number } }, i: number) => {
          expect(frame.width).toBe(128); expect(frame.height).toBe(128);
          expect(frame.pivot.x / 128).toBeCloseTo(original.frames[i].pivot.x / original.frames[i].width);
          expect(frame.pivot.y / 128).toBeCloseTo(original.frames[i].pivot.y / original.frames[i].height);
        });
      }
    }
  });
  it("uses the validated mobile-mass movement modes for new local and hosted matches", () => {
    expect(FORMATION_MOVEMENT).toEqual({ formationLocomotion: true, formationReorientation: true, formationFreeTravel: true });
  });
});
