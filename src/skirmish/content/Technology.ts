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
  technologyAt("StoneAge", "warfare", 1).id,
  technologyAt("StoneAge", "economic", 1).id,
];
export const ADVANCES = [
  { gold: 50_000, ticks: 800 },
  { gold: 75_000, ticks: 900 },
  { gold: 110_000, ticks: 1000 },
  { gold: 160_000, ticks: 1100 },
  { gold: 230_000, ticks: 1200 },
  { gold: 330_000, ticks: 1300 },
] as const;
export function validateTechnologies(): void {
  if (TECHNOLOGY.size !== 84)
    throw new Error("Expected 84 unique technologies");
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
      if (nodes.length !== 4 || new Set(nodes.map((t) => t.slot)).size !== 4)
        throw new Error("Invalid tree workload");
      for (const t of nodes) visit(t.id);
    }
}
validateTechnologies();
