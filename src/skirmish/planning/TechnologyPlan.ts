import { TREES, type Tree } from "../domain/Definitions";
export type PlanAge = string;
export interface PlannedAge {
  id: PlanAge;
  name: string;
  period: string;
}

export const UNIT_ROLES = [
  "frontline",
  "antiCavalry",
  "rangedInfantry",
  "lightCavalry",
  "heavyCavalry",
  "rangedCavalry",
] as const;
export type UnitRole = (typeof UNIT_ROLES)[number];
export const ROLE_NAMES: Record<UnitRole, string> = {
  frontline: "Frontline infantry",
  antiCavalry: "Anti-cavalry infantry",
  rangedInfantry: "Ranged infantry",
  lightCavalry: "Light cavalry",
  heavyCavalry: "Heavy cavalry",
  rangedCavalry: "Ranged cavalry",
};
export type Decision = "baseline" | "proposed" | "confirmed";
export interface PlannedTechnology {
  /** Building artwork subjects bundled by a planner-only research node. */
  buildingUnlocks?: string[];
  id: string;
  name: string;
  age: PlanAge;
  tree: Tree;
  order: number;
  prerequisites: string[];
  description: string;
  notes: string;
  decision: Decision;
  kind: "unlock" | "upgrade" | "capstone";
  gold: number | null;
  researchSeconds: number | null;
}
export interface PlannedUnit {
  id: string;
  name: string;
  age: PlanAge;
  role: UnitRole;
  availability: "available" | "unavailable" | "undecided";
  prerequisites: string[];
  notes: string;
  decision: Decision;
}
export interface CivilizationPlan {
  id: string;
  name: string;
  notes: string;
  ages: PlannedAge[];
  technologies: PlannedTechnology[];
  units: PlannedUnit[];
}
export interface TechnologyPlan {
  schemaVersion: 2;
  civilizations: CivilizationPlan[];
}

/** Strict boundary for file imports and saves. Planning graphs allow arbitrary
 * node counts and cross-branch edges, but never missing parents, future-age
 * prerequisites, or cycles. Runtime slot numbers are not node identity. */
export function validatePlan(value: unknown): string[] {
  const errors: string[] = [];
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const strings = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string");
  const text = (v: unknown) => typeof v === "string" && v.length <= 20000;
  const id = (v: unknown) =>
    typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,119}$/.test(v);
  const decision = (v: unknown) =>
    ["baseline", "proposed", "confirmed"].includes(v as string);
  if (
    !object(value) ||
    value.schemaVersion !== 2 ||
    !Array.isArray(value.civilizations) ||
    value.civilizations.length < 1 ||
    value.civilizations.length > 100
  )
    return ["Expected a version 2 plan with 1–100 civilizations."];
  const civIds = new Set<string>();
  for (const civ of value.civilizations) {
    if (
      !object(civ) ||
      !id(civ.id) ||
      !text(civ.name) ||
      !(civ.name as string).trim() ||
      !text(civ.notes) ||
      !Array.isArray(civ.ages) ||
      civ.ages.length < 1 ||
      civ.ages.length > 20 ||
      !Array.isArray(civ.technologies) ||
      !Array.isArray(civ.units) ||
      civ.technologies.length > 1000 ||
      civ.units.length > 1000
    ) {
      errors.push("Invalid civilization record.");
      continue;
    }
    const label = civ.name as string;
    const ageIds: string[] = [];
    let invalidAges = false;
    for (const age of civ.ages as unknown[]) {
      if (
        !object(age) ||
        typeof age.id !== "string" ||
        !/^[A-Za-z][A-Za-z0-9-]{0,79}$/.test(age.id) ||
        !text(age.name) ||
        !(age.name as string).trim() ||
        !text(age.period) ||
        ageIds.includes(age.id)
      ) {
        invalidAges = true;
        break;
      }
      ageIds.push(age.id);
    }
    if (invalidAges) {
      errors.push(`${label}: invalid or duplicate ages.`);
      continue;
    }
    if (civIds.has(civ.id as string))
      errors.push(`Duplicate civilization ID: ${civ.id}`);
    civIds.add(civ.id as string);
    let malformed = false;
    const techIds = new Set<string>();
    const unitIds = new Set<string>();
    const slots = new Set<string>();
    for (const node of civ.technologies) {
      if (
        !object(node) ||
        !id(node.id) ||
        !text(node.name) ||
        !(node.name as string).trim() ||
        !ageIds.includes(node.age as string) ||
        !TREES.includes(node.tree as Tree) ||
        !Number.isSafeInteger(node.order) ||
        (node.order as number) < 0 ||
        !strings(node.prerequisites) ||
        !text(node.description) ||
        !text(node.notes) ||
        (node.buildingUnlocks !== undefined &&
          (!strings(node.buildingUnlocks) ||
            node.buildingUnlocks.some(
              (name: string) => !/^[A-Za-z][A-Za-z -]{0,99}$/.test(name),
            ))) ||
        !decision(node.decision) ||
        !["unlock", "upgrade", "capstone"].includes(node.kind as string) ||
        (node.gold !== null &&
          (!Number.isSafeInteger(node.gold) || (node.gold as number) < 0)) ||
        (node.researchSeconds !== null &&
          (!Number.isSafeInteger(node.researchSeconds) ||
            (node.researchSeconds as number) < 0))
      ) {
        errors.push(`${label}: invalid technology record.`);
        malformed = true;
        continue;
      }
      if (techIds.has(node.id as string))
        errors.push(`${label}: duplicate technology ID ${node.id}.`);
      techIds.add(node.id as string);
      if (
        new Set(node.prerequisites as string[]).size !==
        (node.prerequisites as string[]).length
      )
        errors.push(`${label}: duplicate prerequisites on ${node.name}.`);
    }
    for (const unit of civ.units) {
      if (
        !object(unit) ||
        !id(unit.id) ||
        !text(unit.name) ||
        !(unit.name as string).trim() ||
        !ageIds.includes(unit.age as string) ||
        !UNIT_ROLES.includes(unit.role as UnitRole) ||
        !["available", "unavailable", "undecided"].includes(
          unit.availability as string,
        ) ||
        !strings(unit.prerequisites) ||
        !text(unit.notes) ||
        !decision(unit.decision)
      ) {
        errors.push(`${label}: invalid unit record.`);
        malformed = true;
        continue;
      }
      if (unitIds.has(unit.id as string))
        errors.push(`${label}: duplicate unit ID ${unit.id}.`);
      unitIds.add(unit.id as string);
      const slot = `${unit.age}:${unit.role}`;
      if (slots.has(slot))
        errors.push(`${label}: more than one unit in ${slot}.`);
      slots.add(slot);
      if (
        new Set(unit.prerequisites as string[]).size !==
        (unit.prerequisites as string[]).length
      )
        errors.push(`${label}: duplicate prerequisites on ${unit.name}.`);
    }
    if (malformed) continue;
    const plan = civ as unknown as CivilizationPlan;
    const technologies = new Map(plan.technologies.map((n) => [n.id, n]));
    for (const node of [...plan.technologies, ...plan.units]) {
      for (const parentId of node.prerequisites) {
        const parent = technologies.get(parentId);
        if (!parent)
          errors.push(
            `${label}: ${node.name} requires missing technology ${parentId}.`,
          );
        else if (ageIds.indexOf(parent.age) > ageIds.indexOf(node.age))
          errors.push(
            `${label}: ${node.name} requires later-age technology ${parent.name}.`,
          );
      }
    }
    for (const node of plan.technologies.filter((n) => n.kind === "capstone")) {
      if (node.age !== ageIds[ageIds.length - 1])
        errors.push(
          `${label}: capstone ${node.name} must be in the final age.`,
        );
      if (plan.technologies.some((n) => n.prerequisites.includes(node.id)))
        errors.push(
          `${label}: capstone ${node.name} must terminate its technology branch.`,
        );
    }
    // Iterative topological validation avoids stack exhaustion on imported graphs.
    const remaining = new Map(
      plan.technologies.map((n) => [
        n.id,
        n.prerequisites.filter((p) => technologies.has(p)).length,
      ]),
    );
    const children = new Map<string, string[]>();
    for (const n of plan.technologies)
      for (const p of n.prerequisites)
        children.set(p, [...(children.get(p) ?? []), n.id]);
    const queue = [...remaining]
      .filter(([, count]) => count === 0)
      .map(([key]) => key);
    let visited = 0;
    for (let i = 0; i < queue.length; i++) {
      visited++;
      for (const child of children.get(queue[i]) ?? []) {
        const count = remaining.get(child)! - 1;
        remaining.set(child, count);
        if (count === 0) queue.push(child);
      }
    }
    if (visited !== plan.technologies.length)
      errors.push(`${label}: prerequisite graph contains a cycle.`);
  }
  return errors;
}

export function cloneCivilization(
  source: CivilizationPlan,
  name: string,
  id: string,
): CivilizationPlan {
  return {
    ...structuredClone(source),
    name,
    id,
    notes: `Draft copied from ${source.name}. Review inherited unlocks and dependencies.`,
  };
}
