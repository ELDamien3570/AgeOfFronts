import type { Building, Player, Ship, Squad } from "../Protocol";
import { baseReserveIncome, cityReserveIncome } from "../content/Economy";
import { AiForceInventory } from "./AiForceInventory";
import type {
  Age,
  Cost,
  Inventory,
  ProductionJob,
  RecruitmentJob,
} from "./Definitions";
import { PRODUCTION_RECIPES } from "./Supply";

export interface AiEconomicSnapshot {
  playerId: number;
  tick: number;
  generation: number;
  age: Age;
  research: readonly string[];
  liquid: Cost;
  incoming: Inventory;
  buildings: readonly Building[];
  squads: readonly Squad[];
  ships: readonly Ship[];
  recruitment: readonly RecruitmentJob[];
  force: AiForceInventory;
  reserveIncome: number;
  goldIncome: number;
  cap: number;
  headroom: number;
  trainingTicks: number;
  readyTroops: number;
  threatTroops: number;
  isolated?: boolean;
  supplyLimitedSources?: readonly number[];
}
export function economicSnapshot(input: {
  player: Player;
  tick: number;
  generation: number;
  age: Age;
  research: readonly string[];
  inventory: Inventory;
  buildings: readonly Building[];
  squads: readonly Squad[];
  ships: readonly Ship[];
  jobs: readonly RecruitmentJob[];
  production: Record<number, ProductionJob | undefined>;
  cap: number;
  threatTroops: number;
  isolated?: boolean;
  territoryIncomeScale?: number;
}): AiEconomicSnapshot {
  const { player, age } = input;
  const buildings = input.buildings
      .filter((b) => b.playerId === player.id)
      .sort((a, b) => a.id - b.id),
    squads = input.squads
      .filter((s) => s.playerId === player.id && s.troops > 0)
      .sort((a, b) => a.id - b.id),
    recruitment = input.jobs.filter((j) => j.playerId === player.id),
    incoming: Inventory = {};
  for (const b of buildings) {
    const job = input.production[b.id],
      recipe = job && PRODUCTION_RECIPES.find((r) => r.id === job.recipeId);
    if (recipe)
      for (const [id, n] of Object.entries(recipe.outputs))
        incoming[id] = (incoming[id] ?? 0) + n;
  }
  const completed = buildings.filter(
    (b) => !b.remainingTicks && (b.health ?? 1) > 0,
  );
  return {
    playerId: player.id,
    isolated: input.isolated,
    tick: input.tick,
    generation: input.generation,
    age,
    research: [...input.research],
    liquid: {
      gold: player.gold,
      reserves: player.reserves,
      items: { ...input.inventory },
    },
    incoming,
    buildings,
    squads,
    ships: input.ships.filter((s) => s.playerId === player.id),
    recruitment,
    force: new AiForceInventory(player.id, squads, recruitment),
    reserveIncome:
      baseReserveIncome(age) +
      completed
        .filter((b) => b.type === "city")
        .reduce((n, b) => n + cityReserveIncome(b.age ?? "StoneAge",input.research), 0),
    goldIncome:
      20 + Math.floor(player.land / (40 * (input.territoryIncomeScale ?? 1))),
    cap: input.cap,
    headroom: Math.max(
      0,
      input.cap -
        squads.length -
        recruitment.filter((j) => j.category === "land").length,
    ),
    trainingTicks: recruitment
      .filter((j) => j.category === "land")
      .reduce((n, j) => n + j.remainingTicks, 0),
    readyTroops: squads
      .filter((s) => !s.refit && s.embarkedOn === null)
      .reduce((n, s) => n + s.troops, 0),
    threatTroops: input.threatTroops,
  };
}
