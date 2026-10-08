import {
  AGES,
  TREES,
  type Age,
  type Technology,
  type Tree,
} from "../domain/Definitions";
import data from "./technologies.json";
export const TECHNOLOGIES = data as Technology[];
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
  { gold: 3_000, ticks: 700 },
  { gold: 18_750, ticks: 800 },
  { gold: 27_500, ticks: 900 },
  { gold: 40_000, ticks: 1000 },
  { gold: 57_500, ticks: 1100 },
  { gold: 82_500, ticks: 1200 },
] as const;
export function treeWorkload(age: Age, tree: Tree): number {
  return TECHNOLOGIES.filter((t) => t.age === age && t.tree === tree).length;
}
export function validateTechnologies(): void {
  if (TECHNOLOGY.size !== 85 || TECHNOLOGIES.length !== 85)
    throw new Error("Expected 85 unique technologies");
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
      if (!p || p.tree !== t.tree || AGES.indexOf(p.age) > AGES.indexOf(t.age))
        throw new Error("Invalid research edge");
      visit(parent);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const age of AGES)
    for (const tree of TREES) {
      const nodes = TECHNOLOGIES.filter(
        (t) => t.age === age && t.tree === tree,
      );
      const count = age === "BronzeAge" && tree === "warfare" ? 5 : 4;
      if (
        nodes.length !== count ||
        new Set(nodes.map((t) => t.slot)).size !== count ||
        nodes.some((t) => t.slot < 1 || t.slot > count)
      )
        throw new Error("Invalid tree workload");
      for (const t of nodes) visit(t.id);
    }
}
validateTechnologies();
