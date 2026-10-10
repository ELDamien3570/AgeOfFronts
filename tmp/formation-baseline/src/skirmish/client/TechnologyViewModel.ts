import { STARTING_TECHNOLOGIES, TECHNOLOGY } from "../content/Technology";
import { AGES, TREES, type Age, type Tree } from "../domain/Definitions";
import type { EmpireViewModel } from "./EmpireViewModel";

/** Presentation of the pinned research catalogue; browsing never changes progress. */
export class TechnologyViewModel {
  constructor(
    readonly empire: EmpireViewModel,
    readonly age: Age,
  ) {}
  get ages() {
    const current = AGES.indexOf(this.empire.progression.age);
    return AGES.map((age, i) => ({
      age,
      state: i === current ? "current" : i < current ? "catch-up" : "future",
    }));
  }
  get trees() {
    return TREES.map((tree) => {
      const nodes = this.empire.nodes(this.age).filter((n) => n.tree === tree);
      const job = this.empire.progression.research[tree];
      return {
        tree,
        nodes: nodes.map((n) => ({
          ...n,
          status: n.completed
            ? (STARTING_TECHNOLOGIES.includes(n.id) || (n.age === (this.empire.expansion.startingAge ?? "StoneAge") && n.slot === 1))
              ? "Starting grant"
              : "Completed"
            : n.researching
              ? `${Math.ceil(job!.remainingTicks / 20)}s remaining`
              : (n.reason ?? "Available"),
          // Stable catalogue slots determine layout only. Edges use real IDs.
          row: n.slot <= 1 ? 0 : n.slot <= 3 ? 1 : n.slot - 2,
          column: n.slot === 3 ? 2 : 1,
          span: n.slot === 2 || n.slot === 3 ? 1 : 2,
        })),
        completed: nodes.filter((n) => n.completed).length,
        total: nodes.length,
        job: job
          ? {
              name: TECHNOLOGY.get(job.technologyId)!.name,
              remaining: Math.ceil(job.remainingTicks / 20),
              age: TECHNOLOGY.get(job.technologyId)!.age,
            }
          : undefined,
      };
    });
  }
  tree(tree: Tree) {
    return this.trees.find((t) => t.tree === tree)!;
  }
}
