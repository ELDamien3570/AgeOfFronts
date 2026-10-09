import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import footLayout from "../../Art/Cultures/Russians/FormationLayouts/Clubman.json";
import { ARTWORK_CATALOG } from "../../src/skirmish/client/ArtworkCatalog";
import { RUSSIAN_TROOP_ACTORS } from "../../src/skirmish/client/troops/RussianTroopCatalogue";
import type {
  ActorClip,
  FormationLayout,
} from "../../src/skirmish/client/troops/TroopFormationModel";
import { actorFormationSlots } from "../../src/skirmish/client/troops/TroopPacking";
import { TroopVolley } from "../../src/skirmish/client/troops/TroopVolley";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNIT, UNITS, VESSELS } from "../../src/skirmish/content/Units";
import {
  throughputPercent,
  unitEffects,
  vesselEffects,
} from "../../src/skirmish/domain/ResearchEffects";
import { FIXED, type ArcherVolley } from "../../src/skirmish/Protocol";

describe("complete Russian asset integration", () => {
  it("keeps spear and ATGM cohorts on foot at the barracks, without horse costs or vehicle tags", () => {
    for (const unit of UNITS.filter(
      (unit) => unit.troopClass === "antiCavalry",
    )) {
      expect(unit.building).toBe("barracks");
      expect(unit.line).toBe("infantry");
      expect(unit.tags).toContain("infantry");
      expect(unit.tags).not.toContain("vehicle");
      expect(unit.cost.items?.horses).toBeUndefined();
      const actor = RUSSIAN_TROOP_ACTORS.get(unit.id)!;
      expect(actor.mounted).toBe(false);
      expect(actor.vehicle).toBe(false);
      expect(actor.members).toBe(12);
    }
  });
  it("uses sparse fixed-size vehicle groups with clear hull lanes in both supported shapes", () => {
    const vehicles = [...RUSSIAN_TROOP_ACTORS.values()].filter(
      (actor) => actor.vehicle,
    );
    expect(vehicles).toHaveLength(6);
    for (const actor of vehicles)
      for (const shape of ["mass", "line"] as const) {
        const slots = actorFormationSlots(
          footLayout as FormationLayout,
          false,
          shape,
          actor.memberScale,
          actor,
        );
        expect([1, 2]).toContain(slots.length);
        expect(slots).toHaveLength(actor.members!);
        expect(slots.every((slot) => slot.scale === actor.memberScale)).toBe(
          true,
        );
        if (slots.length === 2)
          expect(
            (Math.abs(slots[1].x - slots[0].x) * 2) / 0.75,
          ).toBeGreaterThan(actor.widthWorld!);
      }
    const t14 = RUSSIAN_TROOP_ACTORS.get("present-day-heavycavalry")!;
    expect(t14.widthWorld).toBeGreaterThan(2);
    expect(t14.members).toBe(1);
  });
  it("launches from calibrated barrels for each vehicle, rotates those offsets and keeps the authoritative arrival tick", () => {
    for (const actor of [...RUSSIAN_TROOP_ACTORS.values()].filter(
      (actor) => actor.vehicle,
    )) {
      const manifest = JSON.parse(
        readFileSync(
          `Art/Runtime/Russians/Troops/${actor.name}/animations.json`,
          "utf8",
        ),
      );
      const clip: ActorClip = manifest.animations.find(
        (clip: ActorClip) => clip.id === "attack",
      );
      const frame = clip.frames[clip.releaseFrame!];
      const shot = {
        id: 1,
        tick: 10,
        squadId: 1,
        fromX: 0,
        fromY: 0,
        toX: 12 * FIXED,
        toY: 15 * FIXED,
      } as ArcherVolley;
      const shooter = {
        id: 1,
        x: 1,
        y: 2,
        angle: Math.PI / 2,
        scale: actor.memberScale,
        speed: 0,
        gaitDistance: 0,
        front: true,
        throwing: true,
      };
      const volley = new TroopVolley();
      const launches = volley.sample(
        shot,
        10,
        [shooter],
        clip,
        2 / 0.75,
        actor.releasePoints,
        actor.facingOffset,
        false,
        20,
      );
      expect(launches).toHaveLength(actor.releasePoints!.length);
      const point = actor.releasePoints![0],
        angle = shooter.angle + (actor.facingOffset ?? 0),
        size = (2 / 0.75) * shooter.scale * (clip.scale ?? 1);
      const x = (point.x - frame.pivot.x / frame.width) * size,
        y = (point.y - frame.pivot.y / frame.height) * size;
      expect(launches[0].x).toBeCloseTo(
        1 + x * Math.cos(angle) - y * Math.sin(angle),
      );
      expect(launches[0].y).toBeCloseTo(
        2 + x * Math.sin(angle) + y * Math.cos(angle),
      );
      const after = volley.sample(
        shot,
        29.999,
        [],
        clip,
        2 / 0.75,
        actor.releasePoints,
        actor.facingOffset,
        false,
        20,
      );
      expect(after).toHaveLength(launches.length);
      expect(after[0].x).toBeCloseTo(12, 2);
      expect(after[0].y).toBeCloseTo(15, 2);
      expect(
        volley.sample(
          shot,
          30,
          [],
          clip,
          2 / 0.75,
          actor.releasePoints,
          actor.facingOffset,
          false,
          20,
        ),
      ).toEqual([]);
    }
  });
  it("matches implemented tech names, prices, durations and safe prerequisites to the current saved planner", () => {
    const plan = JSON.parse(
      readFileSync("skirmish/plans/technology-plan.json", "utf8"),
    );
    const russian = plan.civilizations.find(
      (c: { id: string }) => c.id === "russians-rework",
    );
    const gaps = JSON.parse(
      readFileSync("skirmish/plans/RuntimeTechnologyGaps.json", "utf8"),
    );
    for (const node of TECHNOLOGIES) {
      const planned = russian.technologies.find(
        (candidate: { id: string }) => candidate.id === node.id,
      );
      if (!planned) continue;
      expect(node.name).toBe(planned.name);
      expect(node.gold).toBe(planned.gold);
      expect(node.ticks).toBe(planned.researchSeconds * 20);
      if (!gaps.retainedRuntimePrerequisites.includes(node.id))
        expect(node.prerequisites).toEqual(planned.prerequisites);
    }
  });
  it("applies authored upgrades and caches ships by research effects rather than leaking another owner's upgrades", () => {
    const infantry = UNIT.get("napoleonic-infantry")!;
    expect(
      unitEffects(infantry, ["russian-bayonet-drill"]).attack.damage,
    ).toBeGreaterThan(infantry.attack.damage);
    expect(throughputPercent(["russian-machine-tools"])).toBe(110);
    const ship = VESSELS.find(
      (v) => v.age === "Napoleonic" && v.kind === "warship",
    )!;
    const first = vesselEffects(ship, ["russian-copper-sheathing"]);
    const other = vesselEffects(ship, [
      TECHNOLOGIES.find(
        (t) => t.age === "Napoleonic" && t.tree === "naval" && t.slot === 4,
      )!.id,
    ]);
    expect(first.health).toBeGreaterThan(ship.health);
    expect(other.health).toBe(ship.health);
    expect(vesselEffects(ship, [])).toBe(ship);
  });
  it("removes cohort legacy atlas bindings rather than silently drawing unrelated old troops", () => {
    for (const unit of UNITS.filter((unit) => unit.troopClass))
      expect(ARTWORK_CATALOG[unit.id]).toBeUndefined();
  });
});
