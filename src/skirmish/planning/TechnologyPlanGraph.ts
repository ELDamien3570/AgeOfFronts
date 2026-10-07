import { AGES, TREES, type Age } from "../domain/Definitions";
import type { PlannedTechnology } from "./TechnologyPlan";

export interface ResearchPlacement {
  row: number;
  column: 1 | 2;
  span: 1 | 2;
}
export interface ResearchAgeLayout {
  age: Age;
  rows: number;
  placements: Map<string, ResearchPlacement>;
}

/** Dependency depth creates the split/join structure. Display order breaks
 * sibling ties only, so moving a node never puts it above its prerequisites.
 * All branches share depth bands, including cross-branch dependencies. */
export function layoutResearch(
  technologies: readonly PlannedTechnology[],
): ResearchAgeLayout[] {
  return AGES.map((age) => {
    const nodes = technologies.filter((n) => n.age === age);
    const remaining = new Set(nodes.map((n) => n.id));
    const localIds = new Set(remaining);
    const depth = new Map<string, number>();
    while (remaining.size) {
      let progressed = false;
      for (const node of nodes) {
        if (!remaining.has(node.id)) continue;
        const parents = node.prerequisites.filter((id) => localIds.has(id));
        if (parents.some((id) => !depth.has(id))) continue;
        depth.set(
          node.id,
          Math.max(-1, ...parents.map((id) => depth.get(id)!)) + 1,
        );
        remaining.delete(node.id);
        progressed = true;
      }
      if (!progressed)
        throw new Error("Cannot lay out cyclic research dependencies.");
    }
    const placements = new Map<string, ResearchPlacement>();
    let start = 0;
    const maxDepth = Math.max(-1, ...depth.values());
    for (let level = 0; level <= maxDepth; level++) {
      let height = 1;
      for (const tree of TREES) {
        const siblings = nodes
          .filter((n) => n.tree === tree && depth.get(n.id) === level)
          .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        height = Math.max(height, Math.ceil(siblings.length / 2));
        siblings.forEach((node, index) => {
          const singleton =
            siblings.length % 2 === 1 && index === siblings.length - 1;
          placements.set(node.id, {
            row: start + Math.floor(index / 2),
            column: singleton ? 1 : (((index % 2) + 1) as 1 | 2),
            span: singleton ? 2 : 1,
          });
        });
      }
      start += height;
    }
    return { age, rows: Math.max(1, start), placements };
  });
}

/** Transitive sets support tracing the complete path, not just the adjacent edge. */
export function researchRelations(
  technologies: readonly PlannedTechnology[],
  selected: string | undefined,
) {
  const ancestors = new Set<string>(),
    descendants = new Set<string>();
  if (!selected) return { ancestors, descendants };
  const nodes = new Map(technologies.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  for (const n of technologies)
    for (const parent of n.prerequisites)
      children.set(parent, [...(children.get(parent) ?? []), n.id]);
  const visit = (
    initial: readonly string[],
    output: Set<string>,
    next: (id: string) => readonly string[],
  ) => {
    const queue = [...initial];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (id === selected || output.has(id)) continue;
      output.add(id);
      queue.push(...next(id));
    }
  };
  visit(
    nodes.get(selected)?.prerequisites ?? [],
    ancestors,
    (id) => nodes.get(id)?.prerequisites ?? [],
  );
  visit(
    children.get(selected) ?? [],
    descendants,
    (id) => children.get(id) ?? [],
  );
  return { ancestors, descendants };
}
