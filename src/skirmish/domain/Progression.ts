import { DEFAULT_CULTURE } from "../content/Catalog";
import {
  ADVANCES,
  TECHNOLOGIES,
  TECHNOLOGY,
  treeWorkload,
} from "../content/Technology";
import type { Player } from "../Protocol";
import {
  AGES,
  TREES,
  type ProgressionState,
  type TechnologySpeed,
  type Tree,
} from "./Definitions";

// Match pacing changes quotes and jobs, never the shared content catalogue.
export function researchTerms(
  definition: { readonly gold: number; readonly ticks: number },
  speed: TechnologySpeed = 1,
) {
  return {
    gold: Math.ceil(definition.gold / speed),
    ticks: Math.ceil(definition.ticks / speed),
  };
}
export function startingProgression(): ProgressionState {
  return {
    cultureId: DEFAULT_CULTURE.id,
    age: "StoneAge",
    completed: [...DEFAULT_CULTURE.startingTechnologies],
    research: {},
    advancement: null,
  };
}
export function researchRejection(
  state: ProgressionState,
  gold: number,
  id: string,
  speed: TechnologySpeed = 1,
): string | null {
  const t = TECHNOLOGY.get(id);
  if (!t) return "Unknown technology";
  if (AGES.indexOf(t.age) > AGES.indexOf(state.age))
    return "Advance to this age first";
  if (state.completed.includes(id)) return "Technology already completed";
  if (state.research[t.tree]) return "This tree is already researching";
  if (t.prerequisites.some((p) => !state.completed.includes(p)))
    return "Complete the prerequisites first";
  const price = researchTerms(t, speed).gold;
  if (gold < price) return `Needs ${price - gold} more gold`;
  return null;
}
export function treeCompletion(state: ProgressionState, tree: Tree): number {
  return TECHNOLOGIES.filter(
    (t) =>
      t.age === state.age && t.tree === tree && state.completed.includes(t.id),
  ).length;
}
export function advanceRejection(
  state: ProgressionState,
  gold: number,
  speed: TechnologySpeed = 1,
): string | null {
  if (state.age === "Modern") return "Modern is the final age";
  if (state.advancement) return "Age advancement already in progress";
  if (
    TREES.filter(
      (tree) => treeCompletion(state, tree) === treeWorkload(state.age, tree),
    ).length < 2
  )
    return "Complete any two current-age trees";
  const price = researchTerms(ADVANCES[AGES.indexOf(state.age)], speed).gold;
  return gold < price ? `Needs ${price - gold} more gold` : null;
}
export class Progression {
  readonly states: Record<number, ProgressionState> = {};
  constructor(readonly technologySpeed: TechnologySpeed = 1) {
    if (![1, 2, 3].includes(technologySpeed))
      throw new Error("Technology speed must be 1×, 2× or 3×");
  }
  add(playerId: number): void {
    this.states[playerId] = startingProgression();
  }
  inheritCompleted(playerId: number, donorId: number): void {
    const recipient = this.states[playerId],
      donor = this.states[donorId];
    if (!recipient || !donor) return;
    if (AGES.indexOf(donor.age) > AGES.indexOf(recipient.age))
      recipient.age = donor.age;
    recipient.completed = [
      ...new Set([...recipient.completed, ...donor.completed]),
    ];
    // Transfer achievements, never another faction's in-progress jobs.
  }
  has(playerId: number, technologyId: string): boolean {
    return this.states[playerId]?.completed.includes(technologyId) ?? false;
  }
  research(player: Player, id: string): string | null {
    const state = this.states[player.id];
    const rejection = researchRejection(
      state,
      player.gold,
      id,
      this.technologySpeed,
    );
    if (rejection) return rejection;
    const t = TECHNOLOGY.get(id)!,
      terms = researchTerms(t, this.technologySpeed);
    player.gold -= terms.gold;
    state.research[t.tree] = {
      technologyId: id,
      remainingTicks: terms.ticks,
      totalTicks: terms.ticks,
    };
    return null;
  }
  advance(player: Player): string | null {
    const state = this.states[player.id],
      rejection = advanceRejection(state, player.gold, this.technologySpeed);
    if (rejection) return rejection;
    const index = AGES.indexOf(state.age),
      cost = researchTerms(ADVANCES[index], this.technologySpeed);
    player.gold -= cost.gold;
    state.advancement = {
      target: AGES[index + 1],
      remainingTicks: cost.ticks,
      totalTicks: cost.ticks,
    };
    return null;
  }
  step(
    players: readonly Player[],
    advanced?: (player: Player, age: ProgressionState["age"]) => void,
  ): void {
    for (const p of players) {
      if (p.eliminated) continue;
      const state = this.states[p.id];
      for (const tree of TREES) {
        const job = state.research[tree];
        if (job && --job.remainingTicks <= 0) {
          state.completed.push(job.technologyId);
          delete state.research[tree];
        }
      }
      if (state.advancement && --state.advancement.remainingTicks <= 0) {
        state.age = state.advancement.target;
        state.advancement = null;
        advanced?.(p, state.age);
      }
    }
  }
}
