import { describe, expect, it } from "vitest";
import { UNIT, VESSELS } from "../../src/skirmish/content/Units";
import {
  breedingPerSecond,
  throughputPercent,
  unitEffects,
  vesselEffects,
} from "../../src/skirmish/domain/ResearchEffects";
import { FIXED } from "../../src/skirmish/Protocol";

describe("explicit Russian research effects", () => {
  it("radios improve twentieth-century and modern infantry without changing cavalry or earlier infantry", () => {
    for (const id of [
      "earlymodern-infantry",
      "modern-infantry",
      "modern-archer",
    ]) {
      const u = UNIT.get(id)!;
      expect(unitEffects(u, ["russian-infantry-radios"]).attack.damage).toBe(
        Math.round(u.attack.damage * 1.1),
      );
    }
    for (const id of ["napoleonic-infantry", "modern-cavalry"]) {
      const u = UNIT.get(id)!;
      expect(unitEffects(u, ["russian-infantry-radios"])).toBe(u);
    }
  });
  it("optics affect modern infantry only", () => {
    const u = UNIT.get("modern-infantry")!;
    expect(unitEffects(u, ["russian-infantry-optics"]).attack.damage).toBe(
      Math.round(u.attack.damage * 1.1),
    );
    const earlier = UNIT.get("earlymodern-infantry")!;
    expect(unitEffects(earlier, ["russian-infantry-optics"])).toBe(earlier);
  });
  it("armour increases tank durability and fire control improves tank attack without modifying base definitions", () => {
    const tank = UNIT.get("present-day-rangedcavalry")!,
      base = structuredClone(tank);
    const upgraded = unitEffects(tank, [
      "russian-tank-armour",
      "russian-tank-fire-control",
    ]);
    expect(upgraded.healthPercent).toBe(Math.round(tank.healthPercent! * 1.2));
    expect(upgraded.attack.damage).toBe(Math.round(tank.attack.damage * 1.1));
    expect(tank).toEqual(base);
    const apc = UNIT.get("present-day-heavycavalry")!;
    expect(
      unitEffects(apc, ["russian-tank-armour", "russian-tank-fire-control"]),
    ).toBe(apc);
  });
  it("missiles increase modern warship strike capability while preserving transport and older hulls", () => {
    const ship = VESSELS.find(
        (v) => v.age === "Modern" && v.kind === "warship",
      )!,
      base = structuredClone(ship),
      upgraded = vesselEffects(ship, ["russian-naval-missiles"]);
    expect(upgraded.attack!.damage).toBe(
      Math.round(ship.attack!.damage * 1.15),
    );
    expect(upgraded.attack!.range).toBe(ship.attack!.range + FIXED);
    expect(upgraded.speed).toBe(ship.speed);
    expect(ship).toEqual(base);
    for (const v of VESSELS.filter(
      (v) => v.age !== "Modern" || v.kind !== "warship",
    ))
      expect(vesselEffects(v, ["russian-naval-missiles"])).toBe(v);
  });
  it("precision manufacturing improves recipe throughput without granting horse breeding", () => {
    expect(throughputPercent(["russian-precision-manufacturing"])).toBe(180);
    expect(breedingPerSecond(["russian-precision-manufacturing"])).toBe(0);
  });
});
