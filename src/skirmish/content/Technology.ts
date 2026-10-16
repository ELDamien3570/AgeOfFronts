import { secondsToTicks } from '../Protocol';
import {
  AGES,
  TREES,
  type Age,
  type Technology,
  type Tree,
} from "../domain/Definitions";
import { RUSSIAN_RECRUITMENT } from "./RussianRecruitment";
import { CAPACITY_TECHNOLOGIES } from './FormationRecipes';
export const TECHNOLOGIES = [...RUSSIAN_RECRUITMENT.technologies,...CAPACITY_TECHNOLOGIES] as Technology[];
export function canonicalTechnologyId(id: string): string {
  return (RUSSIAN_RECRUITMENT.aliases as Record<string, string>)[id] ?? id;
}
export const packageTechnology = (age: Age, slug: string) =>
  `rus-${age.toLowerCase()}-${slug}`;
export const TECHNOLOGY = new Map(TECHNOLOGIES.map((t) => [t.id, t]));
export function technologyAt(age: Age, tree: Tree, slot: number): Technology {
  const definition = TECHNOLOGIES.find(
    (t) => t.age === age && t.tree === tree && t.slot === slot,
  );
  if (!definition) throw new Error("Missing technology slot");
  return definition;
}
export const STARTING_TECHNOLOGIES = [
  technologyAt("StoneAge", "naval", 1).id,
  technologyAt("StoneAge", "warfare", 1).id,
  technologyAt("StoneAge", "economic", 1).id,
];
export const ADVANCES = [
  // Post-Stone prices follow capped market throughput, not the former unlimited
  // unload economy. Research catalogue prices use the same one-third rebalance.
  // Owner decision OD-2 (13 R8(2)): advancement takes 90-180 s, 15 s longer
  // per age (was 50-85 s), so the serial floor to Modern grows by ~8 min.
  { gold: 3_000, ticks: secondsToTicks(90) },
  { gold: 18_750, ticks: secondsToTicks(105) },
  { gold: 27_500, ticks: secondsToTicks(120) },
  { gold: 40_000, ticks: secondsToTicks(135) },
  { gold: 57_500, ticks: secondsToTicks(150) },
  { gold: 82_500, ticks: secondsToTicks(165) },
  { gold: 120_000, ticks: secondsToTicks(180) },
] as const;
export function treeWorkload(age: Age, tree: Tree): number {
  return TECHNOLOGIES.filter((t) => t.age === age && t.tree === tree && !t.optional).length;
}
export function validateTechnologies(): void {
  if (TECHNOLOGY.size !== TECHNOLOGIES.length)
    throw new Error("Duplicate technology IDs");
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error("Cyclic technology tree");
    if (visited.has(id)) return;
    const t = TECHNOLOGY.get(id);
    if (!t) throw new Error(`Unknown prerequisite ${id}`);
    visiting.add(id);
    for (const parent of t.prerequisites) {
      const p = TECHNOLOGY.get(parent);
      if (!p || AGES.indexOf(p.age) > AGES.indexOf(t.age))
        throw new Error("Invalid research edge");
      visit(parent);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const age of AGES)
    for (const tree of TREES) {
      const nodes = TECHNOLOGIES.filter(
        (t) => t.age === age && t.tree === tree && !t.optional,
      );
      const count = nodes.length;
      if (
        count < 1 ||
        new Set(nodes.map((t) => t.slot)).size !== count ||
        nodes.some((t) => t.slot < 1 || t.slot > count)
      )
        throw new Error("Invalid tree workload");
      for (const t of nodes) visit(t.id);
    }
  for(const t of TECHNOLOGIES.filter(t=>t.optional))visit(t.id);
}
validateTechnologies();
