import { AGE_NAMES, AGES, type Age } from "../domain/Definitions";
import { TICKS_PER_SECOND } from "../Protocol";
import type { EmpireViewModel } from "./EmpireViewModel";

type ResearchOpportunity =
  | (ReturnType<EmpireViewModel["nodes"]>[number] & {
      kind: "research";
      seconds: number;
    })
  | {
      kind: "advance-age";
      id: "advance-age";
      tree: "age";
      targetAge: Age;
      name: string;
      description: string;
      gold: number;
      ticks: number;
      seconds: number;
      reason: null;
    };

/** Available branches, including affordable catch-up research from older ages. */
export class ResearchOpportunitiesViewModel {
  constructor(readonly empire: EmpireViewModel) {}

  get cards(): ResearchOpportunity[] {
    if (this.empire.player.eliminated) return [];
    const current = AGES.indexOf(this.empire.progression.age);
    const research: ResearchOpportunity[] = AGES.slice(0, current + 1)
      .reverse()
      .flatMap((age) => this.empire.nodes(age))
      .filter((node) => node.reason === null)
      .map((node) => ({
        ...node,
        kind: "research" as const,
        seconds: Math.ceil(node.ticks / TICKS_PER_SECOND),
      }));
    const targetAge = AGES[current + 1];
    const advance = this.empire.advance;
    if (targetAge && advance.cost && advance.reason === null) {
      const name = AGE_NAMES[current + 1];
      return [
        {
          kind: "advance-age",
          id: "advance-age",
          tree: "age",
          targetAge,
          name,
          description: `Reach the ${name} and begin researching its technology trees.`,
          ...advance.cost,
          seconds: Math.ceil(advance.cost.ticks / TICKS_PER_SECOND),
          reason: null,
        },
        ...research,
      ];
    }
    return research;
  }
}
