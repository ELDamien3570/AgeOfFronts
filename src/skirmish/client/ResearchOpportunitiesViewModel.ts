import { AGES } from "../domain/Definitions";
import { TICKS_PER_SECOND } from "../Protocol";
import type { EmpireViewModel } from "./EmpireViewModel";

/** Available branches, including affordable catch-up research from older ages. */
export class ResearchOpportunitiesViewModel {
  constructor(readonly empire: EmpireViewModel) {}

  get cards() {
    if (this.empire.player.eliminated) return [];
    const current = AGES.indexOf(this.empire.progression.age);
    return AGES.slice(0, current + 1)
      .reverse()
      .flatMap((age) => this.empire.nodes(age))
      .filter((node) => node.reason === null)
      .map((node) => ({
        ...node,
        seconds: Math.ceil(node.ticks / TICKS_PER_SECOND),
      }));
  }
}
