import { stackLimit } from "../Construction";
import { secondsToTicks } from "../Protocol";
import { producerCompatible } from "../content/Buildings";
import { extractionYieldMultiplier } from "../content/Economy";
import { PRODUCTION_RECIPES } from "../content/Production";
import { resourceTechnology } from "../content/Resources";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import { AI_CAPACITY_SECONDS, infrastructureCapacity } from "./AiInfrastructureCapacity";
import type { AiProductionDemand } from "./AiMilitaryDemand";
import { RESOURCES, type Resource } from "./Definitions";
import type { Expansion } from "./Expansion";

export interface AiResourcePressure {
  resource: Resource;
  shortage: number;
  blocked: boolean;
  sinceTick: number;
  requiredPerSecond: number;
  extractionPerSecond: number;
  /** Current already-paid jobs, not speculative factory output. */
  paidConsumptionPerSecond: number;
  inputStarved: boolean;
  /** Co-bottlenecks in demanded recipes; acquisition need not solve all at once. */
  missingInputs?: readonly string[];
  /** Resumable, checkpointed local eligibility proof; never a hidden site cap. */
  siteCursor?: number;
  siteRevision?: number;
  siteScanComplete?: boolean;
}

/** Last completed economic decisions publish this read model for campaigns.
 * Low refined iron is never itself an iron-ore acquisition objective. */
export function aiResourcePressures(
  expansion: Expansion,
  snapshot: AiEconomicSnapshot,
  demand: AiProductionDemand,
  previous: readonly AiResourcePressure[] = [],
): AiResourcePressure[] {
  const owned = expansion.supply.resourcesByOwner(snapshot.playerId);
  const capacity = infrastructureCapacity(snapshot, demand);
  const recipes = PRODUCTION_RECIPES.filter(r => !r.manualOnly && snapshot.research.includes(r.technologyId));
  const held = (id: string) => (snapshot.liquid.items?.[id] ?? 0) + (snapshot.incoming[id] ?? 0);
  const wanted = (id: string) => (demand.equipment[id] ?? 0) + (demand.materials[id] ?? 0);
  const pressures: AiResourcePressure[] = [];
  for (const resource of RESOURCES) {
    // Horses have passive/breeding income; this model concerns mineral scarcity.
    if (resource === "horses" || resource === "oil" || recipes.some(r => r.outputs[resource]) ||
      !snapshot.research.includes(resourceTechnology(resource).id)) continue;
    const quote = capacity.extractionQuote(resource, owned);
    if (!quote.needed) continue;
    const researchBlocked = new Set(demand.bottlenecks?.filter(b => b.reason === "research").map(b => b.item));
    const consumers = recipes.filter(r => r.inputs[resource] && Object.keys(r.outputs).some(id => wanted(id) > held(id)) &&
      ![...Object.keys(r.inputs), ...Object.keys(r.outputs)].some(id => researchBlocked.has(id)));
    let paidConsumptionPerSecond = 0, inputStarved = false;
    const missingInputs = new Set<string>();
    for (const building of snapshot.buildings) {
      if (building.remainingTicks || (building.health ?? 1) <= 0) continue;
      const job = expansion.supply.jobs[building.id];
      const paid = job && recipes.find(r => r.id === job.recipeId);
      if (job && paid?.inputs[resource]) paidConsumptionPerSecond += paid.inputs[resource] / Math.max(1, job.totalTicks / secondsToTicks(1));
      if (!job) for (const recipe of consumers) {
        if (!producerCompatible(building.type, recipe.building) || (snapshot.liquid.items?.[resource] ?? 0) >= recipe.inputs[resource]) continue;
        inputStarved = true;
        for (const [id, count] of Object.entries(recipe.inputs))
          if ((snapshot.liquid.items?.[id] ?? 0) < count) missingInputs.add(id);
      }
    }
    const extractionPerSecond = snapshot.buildings.reduce((rate, building) => {
      if (building.type !== "mine" || building.remainingTicks || (building.health ?? 1) <= 0) return rate;
      const node = expansion.supply.resourceSites.at(building.tile);
      return rate + (node?.resource === resource ? node.yieldPerSecond * extractionYieldMultiplier(building.age ?? "StoneAge") : 0);
    }, 0);
    if (!inputStarved && paidConsumptionPerSecond <= extractionPerSecond) continue;
    const sites = owned.filter(d => d.resource === resource);
    const candidates = sites.filter(d => {
      const at = snapshot.buildings.filter(b => b.tile === d.tile);
      return !at.length || at.every(b => b.type === "mine") && at.length < stackLimit("mine");
    });
    const prior = previous.find(p => p.resource === resource);
    // Hash semantic geometry rather than mutable revision counters, so a
    // checkpoint restore resumes the same proof at the same candidate.
    let siteRevision = snapshot.generation | 0;
    for (const text of [snapshot.age, ...candidates.map(d => `${d.id}:${d.tile}`),
      ...snapshot.buildings.map(b => `${b.id}:${b.tile}:${b.type}:${(b.health ?? 1) > 0}`)])
      for (let i = 0; i < text.length; i++) siteRevision = (Math.imul(siteRevision, 31) + text.charCodeAt(i)) | 0;
    const current = prior?.siteRevision === siteRevision;
    let siteCursor = current ? prior.siteCursor ?? 0 : 0;
    let siteScanComplete = current ? prior.siteScanComplete ?? false : false;
    let available = false, checked = 0;
    while (siteCursor < candidates.length && checked++ < 32) {
      const site = candidates[siteCursor++];
      if (expansion.world.buildingSite(snapshot.playerId, "mine", site.tile, snapshot.age) === null &&
        expansion.economy.recovery.canBuild(snapshot.playerId, "mine", site.tile)) {
        available = true; siteCursor = 0; siteScanComplete = false; break;
      }
    }
    if (!available && siteCursor >= candidates.length) { siteCursor = 0; siteScanComplete = true; }
    // Incomplete work retains a previous complete proof only for unchanged
    // geometry; new sites must be checked before a resource war is justified.
    const localExpansion = available || !siteScanComplete;
    const sinceTick = prior?.sinceTick ?? snapshot.tick;
    pressures.push({
      resource, shortage: quote.shortage, sinceTick,
      blocked: !localExpansion && snapshot.tick - sinceTick >= secondsToTicks(30),
      requiredPerSecond: Math.max(0, quote.required - quote.held) / AI_CAPACITY_SECONDS,
      extractionPerSecond, paidConsumptionPerSecond, inputStarved,
      missingInputs: [...missingInputs].sort(),
      siteCursor, siteRevision, siteScanComplete,
    });
  }
  return pressures.sort((a, b) => Number(b.blocked) - Number(a.blocked) || b.shortage - a.shortage || (a.resource < b.resource ? -1 : 1)).slice(0, 3);
}
