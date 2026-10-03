import { AiFrontRecords } from "./AiFrontRecords";
import { AiModernFronts } from "./AiModernFronts";
import type { Player } from "../Protocol";
import { personalityOf } from "../content/AiPersonalities";
import { resourceTechnology } from "../content/Resources";
import { AiAssetLeases } from "./AiAssetLeases";
import { AiBoundaryIndex } from "./AiBoundaryIndex";
import { AiBudgetLedger, affordableAiCost } from "./AiBudgetLedger";
import { AiCityRecords } from "./AiCityRecords";
import { AiDefenseDirector } from "./AiDefenseDirector";
import { economicCandidates, type AiEconomicIntent } from "./AiEconomicPlanner";
import { economicSnapshot } from "./AiEconomicSnapshot";
import { AiLossWindow } from "./AiLossWindow";
import { militaryDemand, type AiProductionDemand } from "./AiMilitaryDemand";
import { AiMilitaryDirector } from "./AiMilitaryDirector";
import { AiNavalFacts } from "./AiNavalFacts";
import { AiNavalPlanner } from "./AiNavalPlanner";
import { AiPlacementCandidates } from "./AiPlacementCandidates";
import type { Cost, Inventory } from "./Definitions";
import type { Expansion } from "./Expansion";

interface Saving {
  intent: AiEconomicIntent;
  since: number;
  lastProgress: number;
  funded: number;
}
/** Application coordinator. Quotes remain pure; domain commands own payment. */
export class AiEconomicDirector {
  readonly ledger = new AiBudgetLedger();
  readonly assets = new AiAssetLeases();
  readonly placements: AiPlacementCandidates;
  readonly military: AiMilitaryDirector;
  readonly losses = new AiLossWindow();
  readonly cities: AiCityRecords;
  readonly defenses: AiDefenseDirector;
  readonly fronts: AiFrontRecords;
  readonly modernFronts: AiModernFronts;
  readonly navalFacts: AiNavalFacts;
  readonly naval: AiNavalPlanner;
  readonly boundaries?: AiBoundaryIndex;
  private readonly demands = new Map<number, AiProductionDemand>();
  private readonly saving = new Map<number, Saving>();
  private cursor = 0;
  private readonly nextDecision = new Map<number, number>();
  readonly diagnostics = {
    backgroundWork: 0,
    decisions: 0,
    candidates: 0,
    commands: 0,
    rejected: 0,
    abandoned: 0,
  };
  constructor(private readonly expansion: Expansion) {
    this.placements = new AiPlacementCandidates(expansion);
    this.military = new AiMilitaryDirector(expansion, this);
    this.cities = new AiCityRecords(
      expansion.world.map,
      expansion.world.owners,
      () => expansion.world.buildings,
    );
    this.defenses = new AiDefenseDirector(expansion, this);
    this.navalFacts = new AiNavalFacts(expansion.world);
    this.naval = new AiNavalPlanner(expansion, this);
    this.fronts = new AiFrontRecords(expansion, this);
    this.modernFronts = new AiModernFronts(expansion, this);
    if (
      expansion.world.options?.aiEconomy &&
      expansion.world.options.aiDefenses
    )
      this.boundaries = new AiBoundaryIndex(
        expansion.world.map,
        expansion.world.owners,
        (tile) => expansion.world.paths.walkable(tile),
      );
  }
  enabled(player: Player): boolean {
    return (
      this.expansion.world.options?.aiEconomy === true &&
      player.ai &&
      player.kind === "regular" &&
      !player.eliminated
    );
  }
  checkpoint() {
    return structuredClone({
      ledger: this.ledger.checkpoint(),
      assets: this.assets.checkpoint(),
      losses: this.losses.checkpoint(),
      cities: this.cities.checkpoint(),
      defenses: this.defenses.checkpoint(),
      fronts: this.fronts.checkpoint(),
      modernFronts: this.modernFronts.checkpoint(),
      navalFacts: this.navalFacts.checkpoint(),
      naval: this.naval.checkpoint(),
      boundaries: this.boundaries?.checkpoint(),
      demands: [...this.demands],
      saving: [...this.saving],
      placements: this.placements.checkpoint(),
      cursor: this.cursor,
      nextDecision: [...this.nextDecision],
    });
  }
  restore(saved: ReturnType<AiEconomicDirector["checkpoint"]>): void {
    this.ownershipTick = -1;
    this.ledger.restore(saved.ledger);
    this.demands.clear();
    this.saving.clear();
    this.assets.restore(saved.assets ?? []);
    this.losses.restore(saved.losses ?? []);
    this.cities.restore(
      saved.cities ?? {
        scan: undefined,
        records: [],
        proposals: [],
        nextScan: 0,
        recordKeys: [],
      },
    );
    this.defenses.restore(
      saved.defenses ?? {
        projects: [],
        allowances: [],
        cityCursors: [],
        cursor: 0,
        nextBuild: 0,
        outlines: [],
        proposalRetry: [],
      },
    );
    this.fronts.restore(saved.fronts ?? { records: [], cursors: [], player: 0, scan: undefined });
    this.modernFronts.restore(saved.modernFronts ?? { sections: [], player: 0, nextBuild: 0, retries: [] });
    if (saved.navalFacts) this.navalFacts.restore(saved.navalFacts);
    this.naval.restore(saved.naval ?? { missions: [], cursor: 0, serial: 0 });
    if (saved.boundaries) this.boundaries?.restore(saved.boundaries);
    else this.boundaries?.resetForRebuild();
    for (const [id, demand] of saved.demands)
      this.demands.set(id, structuredClone(demand));
    for (const [id, goal] of saved.saving)
      this.saving.set(id, structuredClone(goal));
    this.placements.restore(saved.placements);
    this.cursor = saved.cursor;
    this.nextDecision.clear();
    for (const [id, tick] of saved.nextDecision)
      this.nextDecision.set(id, tick);
  }
  release(playerId: number): void {
    this.naval.release(playerId);
    this.defenses.release(playerId);
    this.fronts.release(playerId); this.modernFronts.release(playerId);
    this.military.release(playerId);
    this.losses.release(playerId);
    this.ledger.releasePlayer(playerId);
    this.assets.releasePlayer(playerId);
    this.demands.delete(playerId);
    this.saving.delete(playerId);
    this.nextDecision.delete(playerId);
  }
  step(): void {
    const { world } = this.expansion;
    this.diagnostics.backgroundWork = 0;
    if (world.options?.aiEconomy !== true || world.options.runAi === false)
      return;
    this.expireOwnership();
    // Read models and naval assessment share one allowance. Preserve at least
    // sixteen units for city work even during simultaneous cold boundary and
    // naval passes; more becomes available when another consumer is idle.
    const boundaryWork = this.boundaries?.step(world.tick, 32) ?? 0;
    const frontWork = world.options.aiDefenses ? this.fronts.step(16) : 0;
    const navalWork =
      world.options.aiNaval && world.options.deferredPlanning
        ? this.navalFacts.step(world.tick, 48 - frontWork)
        : 0;
    const controllerWork =
      world.options.aiNaval && world.options.deferredPlanning
        ? this.naval.step(32)
        : 0;
    const cityWork = this.cities.step(
      world.tick,
      128 - navalWork - boundaryWork - controllerWork - frontWork,
      8,
    );
    this.diagnostics.backgroundWork =
      navalWork + boundaryWork + controllerWork + frontWork + cityWork;
    if (world.options.aiDefenses) { this.defenses.step(); this.modernFronts.step(32); }
    if (world.tick % 3) return;
    for (let i = 0; i < world.players.length; i++) {
      const player = world.players[this.cursor % world.players.length];
      this.cursor = (this.cursor + 1) % world.players.length;
      if (
        !this.enabled(player) ||
        (this.nextDecision.get(player.id) ?? 0) > world.tick
      )
        continue;
      this.nextDecision.set(player.id, world.tick + 60);
      this.decide(player);
      break;
    }
  }
  production(playerId: number): {
    demand?: AiProductionDemand;
    protectedInputs?: Inventory;
  } {
    const player = this.expansion.world.players.find((p) => p.id === playerId);
    if (!player || !this.enabled(player)) return {};
    const base = this.demands.get(playerId),
      materials = { ...base?.materials };
    if (this.expansion.world.options?.aiDefenses)
      for (const [id, n] of Object.entries(this.defenses.production(playerId)))
        materials[id] = (materials[id] ?? 0) + n;
    if (this.expansion.world.options?.aiDefenses)
      for (const [id, n] of Object.entries(this.modernFronts.production(playerId))) materials[id] = (materials[id] ?? 0) + n;
    return {
      demand: { ...(base ?? { equipment: {}, units: {} }), materials },
      protectedInputs: { ...this.ledger.protected(playerId).items },
    };
  }
  decide(player: Player): void {
    if (!this.enabled(player)) {
      this.release(player.id);
      return;
    }
    const { world, progression, supply } = this.expansion,
      state = progression.states[player.id];
    const generation = world.aiGeneration(player.id);
    this.expireOwnership();
    this.diagnostics.decisions++;
    const snapshot = economicSnapshot({
      player,
      tick: world.tick,
      generation,
      age: state.age,
      research: state.completed,
      inventory: supply.inventories[player.id],
      buildings: world.buildingFacts().byOwner(player.id),
      squads: world.squads,
      ships: world.ships,
      jobs: world.recruitment.jobs,
      production: supply.jobs,
      cap: world.squadCapacity(player),
      territoryIncomeScale: world.options?.territoryIncomeScale,
      threatTroops: world.squads
        .filter(
          (s) =>
            s.troops > 0 &&
            s.embarkedOn === null &&
            this.expansion.diplomacy.hostile(player.id, s.playerId) &&
            world.map.euclideanDistSquared(world.tileOf(s), player.base) <
              40 ** 2,
        )
        .reduce((n, s) => n + s.troops, 0),
    });
    const renewable = new Set(
      supply.deposits
        .filter(
          (d) =>
            world.owners[d.tile] === player.id &&
            state.completed.includes(resourceTechnology(d.resource).id) &&
            (d.resource === "horses" ||
              snapshot.buildings.some(
                (b) => b.tile === d.tile && !b.remainingTicks,
              )),
        )
        .map((d) => d.resource),
    );
    const demand = militaryDemand(
      snapshot,
      personalityOf(player),
      renewable,
      Math.min(
        8,
        Math.ceil(
          this.losses.sample(player.id, world.tick, player.losses) / 1000,
        ),
      ),
    );
    if (demand.deferred) return;
    this.demands.set(player.id, demand);
    if (
      snapshot.threatTroops <= snapshot.readyTroops / 2 &&
      this.military.decide(player)
    )
      return;
    const candidates = economicCandidates(
      snapshot,
      state,
      personalityOf(player),
      demand,
      progression.technologySpeed,
      this.placements.candidates(player, snapshot, demand),
    );
    this.diagnostics.candidates += candidates.length;
    let goal = this.saving.get(player.id);
    if (
      goal &&
      (goal.intent.generation !== generation ||
        world.tick >= goal.intent.expiresTick ||
        world.tick - goal.lastProgress >= 1200)
    ) {
      this.ledger.release(goal.intent.id);
      this.saving.delete(player.id);
      goal = undefined;
      this.diagnostics.abandoned++;
    }
    const challenger = candidates[0];
    if (
      goal &&
      challenger &&
      (challenger.priority === "emergency" ||
        challenger.score * 5 > goal.intent.score * 6)
    ) {
      this.ledger.release(goal.intent.id);
      this.saving.delete(player.id);
      goal = undefined;
    }
    const chosen = goal?.intent ?? challenger;
    if (!chosen) return;
    const own = this.ledger.spendable(
      player.id,
      snapshot.liquid,
      chosen.id,
      chosen.priority,
    );
    const amounts: Cost = {
      gold: Math.min(own.gold ?? 0, chosen.cost.gold ?? 0),
      reserves: Math.min(own.reserves ?? 0, chosen.cost.reserves ?? 0),
      items: {},
    };
    const items: Inventory = {};
    for (const [id, n] of Object.entries(chosen.cost.items ?? {}))
      items[id] = Math.min(own.items?.[id] ?? 0, n);
    amounts.items = items;
    const funded =
      (amounts.gold ?? 0) +
      (amounts.reserves ?? 0) +
      Object.values(items).reduce((n, v) => n + v, 0);
    if (
      !this.ledger.tryReserve(
        {
          id: chosen.id,
          playerId: player.id,
          generation,
          claimant: chosen.id,
          priority: chosen.priority,
          amounts,
          createdTick: goal?.since ?? world.tick,
          progressTick: world.tick,
          expiresTick: chosen.expiresTick,
        },
        snapshot.liquid,
      )
    )
      return;
    if (!affordableAiCost(own, chosen.cost)) {
      this.saving.set(player.id, {
        intent: chosen,
        since: goal?.since ?? world.tick,
        funded,
        lastProgress:
          !goal || funded > goal.funded ? world.tick : goal.lastProgress,
      });
      return;
    }
    this.diagnostics.commands++;
    const rejection = world.applyCommand(chosen.command);
    // Accepted commands paid their exact authoritative cost. Rejected quotes
    // are released and re-evaluated, never retried against stale ownership.
    this.ledger.release(chosen.id);
    this.saving.delete(player.id);
    if (rejection) this.diagnostics.rejected++;
  }
  private ownershipTick = -1;
  private expireOwnership(): void {
    const { world } = this.expansion;
    if (this.ownershipTick === world.tick) return;
    this.ownershipTick = world.tick;
    this.ledger.expire(
      world.tick,
      new Map(world.players.map((p) => [p.id, world.aiGeneration(p.id)])),
    );
    // Aircraft currently has no maintained ID index. Build it only when a
    // controller actually owns aircraft; land/naval ownership uses live indexes.
    let aircraft: Set<number> | undefined;
    this.assets.expire(
      world.tick,
      (id) => world.aiGeneration(id),
      (asset) => {
        const [kind, value] = asset.split(":"),
          id = Number(value);
        if (kind === "squad") return !!world.squad(id);
        if (kind === "ship") return !!world.ship(id);
        aircraft ??= new Set(this.expansion.aircraft.map((a) => a.id));
        return aircraft.has(id);
      },
    );
  }
}
