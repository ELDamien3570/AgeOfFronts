import { GUN_NEST_ATTACK } from "../../content/Defences";
import { FLIGHT_RULES } from "../../content/FlightOperations";
import {
  AIRCRAFT_RULES,
  ATOMIC_ATTACK,
  BOMBER_ATTACK,
  DRONE_ATTACK,
  NAVAL_AIR_ATTACK,
  STRATEGIC_PAYLOADS,
  STRATEGIC_RULES,
} from "../../content/ModernWeapons";
import { UNITS, VESSELS } from "../../content/Units";
import {
  attackContributors,
  damageAmount,
  type Defence,
} from "../../domain/Combat";
import type { AttackProfile, UnitDefinition } from "../../domain/Definitions";
import {
  createFormation,
  formationDoctrine,
  type FormationShape,
} from "../../domain/FormationGeometry";
import { createManpower, scaledRecipeCost } from "../../domain/Manpower";
import { sustainedInterval } from "../../domain/WeaponTiming";
import { FIXED, TICKS_PER_SECOND } from "../../Protocol";
import { BUILDING_RULES } from "../../Rules";
import { aircraftArtworkId } from "../ArtworkCatalog";

export interface LabEntity {
  key: string;
  id: string;
  name: string;
  category: "unit" | "vessel" | "aircraft" | "weapon" | "building";
  artworkId: string;
  definition: Record<string, unknown>;
  mission?: boolean;
}
export const LAB_ENTITIES: LabEntity[] = [
  ...UNITS.map((u) => ({
    key: `unit:${u.id}`,
    id: u.id,
    name: u.name,
    category: "unit" as const,
    artworkId: u.id,
    definition: structuredClone(u) as unknown as Record<string, unknown>,
  })),
  ...VESSELS.map((v) => ({
    key: `vessel:${v.id}`,
    id: v.id,
    name: v.name,
    category: "vessel" as const,
    artworkId: v.id,
    definition: structuredClone(v) as unknown as Record<string, unknown>,
  })),
];
for (const age of ["EarlyModern", "Modern"] as const)
  for (const kind of ["fighter", "bomber", "drone"] as const) {
    if (kind === "drone" && age !== "Modern") continue;
    const rule = FLIGHT_RULES[kind];
    const attack: AttackProfile =
      kind === "fighter"
        ? {
            channel: "ranged",
            damage: 200,
            range: 8 * FIXED,
            reloadTicks: 2*TICKS_PER_SECOND,
            movingReloadPercent: 100,
            bonuses: {},
            penetration: 0,
            targets: ["aircraft"],
          }
        : structuredClone(kind === "bomber" ? BOMBER_ATTACK : DRONE_ATTACK);
    const id = `${age.toLowerCase()}-${kind}`;
    LAB_ENTITIES.push({
      key: `aircraft:${id}`,
      id,
      name: `${age === "Modern" ? "Modern" : "Early Modern"} ${kind}`,
      category: "aircraft",
      artworkId: aircraftArtworkId(kind, age),
      mission: kind !== "fighter",
      definition: {
        id,
        age,
        kind,
        health: AIRCRAFT_RULES.health,
        ...rule,
        airfieldCapacity: AIRCRAFT_RULES.airfieldCapacity,
        factionCapacity: AIRCRAFT_RULES.factionCapacity,
        attack,
        estimatedSortieSeconds:
          age === "Modern" ? rule.modernSeconds : rule.preModernSeconds,
      },
    });
  }
for (const [id, attack] of Object.entries({
  "gun-nest": GUN_NEST_ATTACK,
  "naval-air-defence": NAVAL_AIR_ATTACK,
  "atomic-bomb": ATOMIC_ATTACK,
})) {
  LAB_ENTITIES.push({
    key: `weapon:${id}`,
    id,
    name: id.replace(/-/g, " "),
    category: "weapon",
    artworkId: id,
    mission: id === "atomic-bomb",
    definition: {
      id,
      attack: structuredClone(attack),
      ...(id === "atomic-bomb" ? { estimatedSortieSeconds: 120 } : {}),
    },
  });
}
for (const [id, payload] of Object.entries(STRATEGIC_PAYLOADS))
  LAB_ENTITIES.push({
    key: `weapon:${id}`,
    id,
    name: id.toUpperCase(),
    category: "weapon",
    artworkId: id,
    definition: {
      id,
      gold: STRATEGIC_RULES.gold,
      warheads: payload.warheads,
      attack: {
        ...structuredClone(BOMBER_ATTACK),
        damage: payload.damage,
        reloadTicks: STRATEGIC_RULES.reloadTicks,
        projectile: {
          ...BOMBER_ATTACK.projectile!,
          blastRadius: payload.blastRadius,
        },
      },
    },
  });
for (const [id, rule] of Object.entries(BUILDING_RULES))
  LAB_ENTITIES.push({
    key: `building:${id}`,
    id,
    name: rule.name,
    category: "building",
    artworkId: `building-modern-${id}`,
    definition: { id, ...structuredClone(rule) },
  });

export interface UnitDraft {
  entity: LabEntity;
  definition: Record<string, unknown>;
  shapes: FormationShape[];
  defaultShape: FormationShape;
}
export function makeDraft(entity: LabEntity): UnitDraft {
  const doctrine = formationDoctrine(entity.id);
  return {
    entity,
    definition: structuredClone(entity.definition),
    shapes: entity.category === "unit" ? [...doctrine.shapes] : [],
    defaultShape: doctrine.defaultShape,
  };
}
export interface DpsTarget {
  tag: Defence["tags"][number];
  armourKind: "points" | "percentage";
  meleeArmour: number;
  rangedArmour: number;
  healthPercent: number;
  accuracy: number;
  cover: number;
  soldiers: boolean;
}
export function estimatedDps(
  draft: UnitDraft,
  target: DpsTarget,
  variant: "base" | "enlarged",
  shape: FormationShape,
) {
  const definition = draft.definition;
  const unit =
    draft.entity.category === "unit"
      ? (definition as unknown as UnitDefinition)
      : undefined;
  const capacity = unit?.formationRecipe
    ? variant === "base"
      ? unit.formationRecipe.capacity
      : unit.formationRecipe.enlargedCapacity
    : 1;
  const defence: Defence = {
    tags: [target.tag],
    armourKind: target.armourKind,
    meleeArmour: target.meleeArmour,
    rangedArmour: target.rangedArmour,
    healthPercent: target.healthPercent,
    cover: target.cover,
    soldiers: target.soldiers,
    bonusResistance: {},
  };
  const profiles =
    unit?.meleeAttack || unit?.rangedAttack
      ? [unit.meleeAttack, unit.rangedAttack].filter(
          (p): p is AttackProfile => !!p,
        )
      : definition.attack
        ? [definition.attack as AttackProfile]
        : [];
  return profiles.map((profile) => {
    const contributors =
      unit?.formationRecipe?.model === "soldiers"
        ? attackContributors(
            {
              troops: capacity,
              manpower: createManpower(unit, variant),
              formation: { ...createFormation(unit.id), shape },
              definitionId: unit.id,
            },
            profile,
            undefined,
            {
              ...formationDoctrine(unit.id),
              shapes: [...draft.shapes],
              defaultShape: draft.defaultShape,
            },
          )
        : profile.perSoldier
          ? capacity
          : 1000;
    // Aggregate profiles use normalized strength, soldier weapons use actual
    // eligible contributor count. Keep the domain's armour and bonus math.
    const damage =
      (damageAmount(
        profile,
        defence,
        profile.perSoldier ? capacity : 1000,
        0,
        profile.perSoldier ? capacity : 1000,
        profile.perSoldier ? contributors : contributors / 1000,
      ) *
        target.accuracy) /
      100;
    const cycleSeconds = draft.entity.mission
      ? Number(definition.estimatedSortieSeconds)
      : sustainedInterval(profile) / TICKS_PER_SECOND;
    return {
      channel: profile.channel,
      contributors,
      damage,
      cycleSeconds,
      dps: cycleSeconds > 0 ? damage / cycleSeconds : 0,
      eligible: profile.targets.includes(target.tag),
    };
  });
}
export function validateDraft(definition: Record<string, unknown>) {
  // Soldier content uses attack as an alias of its primary weapon channel.
  // JSON round trips lose object identity; restore that invariant in drafts.
  const primary = definition.rangedAttack ?? definition.meleeAttack;
  if (primary) definition.attack = primary;
  function walk(value: unknown, path: string) {
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0))
      throw new Error(`${path} must be finite and non-negative`);
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value))
        walk(child, `${path}.${key}`);
  }
  walk(definition, "definition");
  const unit = definition as unknown as UnitDefinition;
  const r = unit.formationRecipe;
  if (
    r &&
    (!Number.isInteger(r.capacity) ||
      !Number.isInteger(r.enlargedCapacity) ||
      r.capacity < 1 ||
      r.enlargedCapacity < r.capacity ||
      r.enlargedCapacity > 144 ||
      r.soldierHp <= 0)
  )
    throw new Error(
      "Recipe counts must be integers from 1 to 144; enlarged count must be at least base count; HP must be positive.",
    );
  if (r?.model === "hull" && (r.capacity !== 1 || r.enlargedCapacity !== 1))
    throw new Error(
      "Hull recipes represent one vehicle; soldier counts do not apply.",
    );
  // Paid soldiers and mounts are recipe facts, never independent balance knobs.
  if (r?.model === "soldiers" && unit.cost) {
    r.reserveCost = r.capacity;
    unit.cost.reserves = r.capacity;
    if (unit.tags?.includes("mounted"))
      unit.cost.items = { ...unit.cost.items, horses: r.capacity };
    else if (unit.cost.items?.horses !== undefined) {
      const items = { ...unit.cost.items };
      delete items.horses;
      unit.cost.items = items;
    }
  }
  for (const p of [unit.attack, unit.meleeAttack, unit.rangedAttack].filter(
    (p): p is AttackProfile => !!p,
  )) {
    if (
      !Array.isArray(p.targets) ||
      !p.bonuses ||
      !Number.isFinite(p.damage) ||
      !Number.isFinite(p.range)
    )
      throw new Error(
        "Attack profiles require damage, range, targets and bonuses.",
      );
    if (
      p.perSoldier
        ? !(p.rpm! > 0) ||
          !Number.isInteger(p.shotsPerReload) ||
          p.shotsPerReload! < 1
        : !(p.reloadTicks > 0)
    )
      throw new Error("Attack cadence and magazine size must be positive.");
  }
}
export function draftRecruitmentCost(
  draft: UnitDraft,
  variant: "base" | "enlarged",
) {
  if (draft.entity.category !== "unit") return undefined;
  const unit = draft.definition as unknown as UnitDefinition;
  if (!unit.formationRecipe || !unit.cost) return undefined;
  return scaledRecipeCost(unit, variant);
}
