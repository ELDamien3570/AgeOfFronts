import { researchRejection, advanceRejection } from "./Progression";
import { TECHNOLOGY } from "../content/Technology";
import { researchUtility, usableNextAge } from "./AiResearchUtility";
import { AiCoastPlanner } from "./AiCoastPlanner";
import { AiTradeOpportunities } from "./AiTradeOpportunities";
import { AiRouteQuotes } from "./AiRouteQuotes";
import { AiFrontRecords } from "./AiFrontRecords";
import { AiModernFronts } from "./AiModernFronts";
import type { Player } from "../Protocol";
import { personalityOf } from "../content/AiPersonalities";
import { resourceTechnology } from "../content/Resources";
import { AiRecovery } from "./AiRecovery";
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
import { AiTransportPlanner } from "./AiTransportPlanner";
import { AiNavalPlanner } from "./AiNavalPlanner";
import { AiPlacementCandidates } from "./AiPlacementCandidates";
import type { Cost, Inventory } from "./Definitions";
import type { Expansion } from "./Expansion";
import { militaryPosture } from "./AiMilitaryPosture";
import { UNIT } from "../content/Units";
import { FIXED } from "../Protocol";

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
  readonly coasts: AiCoastPlanner;
  readonly tradeQuotes: AiTradeOpportunities;
  readonly routes: AiRouteQuotes;
  readonly placements: AiPlacementCandidates;
  readonly military: AiMilitaryDirector;
  readonly losses = new AiLossWindow();
  readonly recovery: AiRecovery;
  readonly cities: AiCityRecords;
  readonly defenses: AiDefenseDirector;
  readonly fronts: AiFrontRecords;
  readonly modernFronts: AiModernFronts;
  readonly navalFacts: AiNavalFacts;
  readonly naval: AiNavalPlanner;
  readonly transports: AiTransportPlanner;
  readonly boundaries?: AiBoundaryIndex;
  private readonly demands = new Map<number, AiProductionDemand>();
  private readonly demandPlanning=new Map<number,{key:string;state:import("./AiMilitaryDemand").AiDemandPreparation}>();
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
    this.recovery = new AiRecovery(expansion);
    this.recovery.rebuild(expansion.world.buildings);
    this.routes = new AiRouteQuotes(expansion);
    this.tradeQuotes = new AiTradeOpportunities(expansion, this);
    this.placements = new AiPlacementCandidates(expansion);
    this.coasts = new AiCoastPlanner(expansion, this);
    this.military = new AiMilitaryDirector(expansion, this);
    this.cities = new AiCityRecords(
      expansion.world.map,
      expansion.world.owners,
      () => expansion.world.buildings,
    );
    this.defenses = new AiDefenseDirector(expansion, this);
    this.navalFacts = new AiNavalFacts(expansion.world);
    this.naval = new AiNavalPlanner(expansion, this);
    this.transports=new AiTransportPlanner(expansion,this);
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
      routes: this.routes.checkpoint(),
      tradeQuotes: this.tradeQuotes.checkpoint(),
      coasts: this.coasts.checkpoint(),
      ledger: this.ledger.checkpoint(),
      assets: this.assets.checkpoint(),
      losses: this.losses.checkpoint(),
      recovery: this.recovery.checkpoint(),
      cities: this.cities.checkpoint(),
      defenses: this.defenses.checkpoint(),
      fronts: this.fronts.checkpoint(),
      modernFronts: this.modernFronts.checkpoint(),
      navalFacts: this.navalFacts.checkpoint(),
      naval: this.naval.checkpoint(),
      transports:this.transports.checkpoint(),
      military:this.military.checkpoint(),
      boundaries: this.boundaries?.checkpoint(),
      demands: [...this.demands],
      demandPlanning:[...this.demandPlanning],
      saving: [...this.saving],
      placements: this.placements.checkpoint(),
      cursor: this.cursor,
      nextDecision: [...this.nextDecision],
    });
  }
  restore(saved: ReturnType<AiEconomicDirector["checkpoint"]>): void {
    this.routes.restore(saved.routes);
    this.tradeQuotes.restore(saved.tradeQuotes);
    this.coasts.restore(saved.coasts);
    this.ownershipTick = -1;
    this.ledger.restore(saved.ledger);
    this.military.restore(saved.military);
    this.demands.clear();this.demandPlanning.clear();
    for(const [id,plan] of structuredClone(saved.demandPlanning??[]))this.demandPlanning.set(id,plan);
    this.saving.clear();
    this.assets.restore(saved.assets ?? []);
    this.losses.restore(saved.losses ?? []);
    this.recovery.restore(saved.recovery);
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
    this.naval.restore(saved.naval);
    this.transports.restore(saved.transports);
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
    this.routes.releasePlayer(playerId);
    this.tradeQuotes.release(playerId);
    this.coasts.release(playerId);
    this.naval.release(playerId);
    this.transports.release(playerId);
    this.defenses.release(playerId);
    this.fronts.release(playerId); this.modernFronts.release(playerId);
    this.military.release(playerId);
    this.losses.release(playerId);
    this.ledger.releasePlayer(playerId);
    this.assets.releasePlayer(playerId);
    this.demands.delete(playerId);this.demandPlanning.delete(playerId);
    this.saving.delete(playerId);
    this.nextDecision.delete(playerId);
  }
  step(): void {
    const { world } = this.expansion;
    this.diagnostics.backgroundWork = 0;
    if (world.options?.aiEconomy !== true || world.options.runAi === false)
      return;
    this.expireOwnership();
    this.recovery.step();
    // Read models and naval assessment share one allowance. Preserve at least
    // sixteen units for city work even during simultaneous cold boundary and
    // naval passes; more becomes available when another consumer is idle.
    const boundaryWork = this.boundaries?.step(world.tick, 32) ?? 0;
    const frontWork = world.options.aiDefenses ? this.fronts.step(16) : 0;
    const navalWork =
      world.options.deferredPlanning
        ? this.navalFacts.step(world.tick, 48 - frontWork)
        : 0;
    const controllerWork =
      world.options.aiNaval && world.options.deferredPlanning
        ? this.naval.step(16)+this.transports.step(16)
        : 0;
    const armyWork=this.military.step(Math.max(0,Math.min(24,112-navalWork-boundaryWork-controllerWork-frontWork)));
    const tradeQuoteWork = this.tradeQuotes.step(Math.min(8, Math.max(0, 112-navalWork-boundaryWork-controllerWork-frontWork-armyWork)));
    const coastWork = this.coasts.step(Math.min(8,Math.max(0,112-navalWork-boundaryWork-controllerWork-frontWork-armyWork-tradeQuoteWork)));
    const cityWork = this.cities.step(
      world.tick,
      128 - navalWork - boundaryWork - controllerWork - frontWork - armyWork - tradeQuoteWork - coastWork,
      8,
    );
    this.diagnostics.backgroundWork =
      navalWork + boundaryWork + controllerWork + frontWork + armyWork + tradeQuoteWork + coastWork + cityWork;
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
      squads: world.squadFacts().byOwner(player.id),
      ships: world.shipFacts().byOwner(player.id),
      jobs: world.recruitment.byOwner(player.id),
      production: supply.jobs,
      cap: world.squadCapacity(player),
      territoryIncomeScale: world.options?.territoryIncomeScale,
      threatTroops: world.squads
        .filter(
          (s) =>
            s.troops > 0 &&
            s.embarkedOn === null &&
            this.expansion.diplomacy.hostile(player.id, s.playerId) &&
            world.map.euclideanDistSquared(world.tileOf(s), player.base) < 40 ** 2 &&
            (world.owners[world.tileOf(s)] === player.id ||
              world.map.euclideanDistSquared(world.tileOf(s), player.base) < 12 ** 2 ||
              (s.order.type === "move" && world.owners[s.order.tile] === player.id) ||
              (s.order.type === "attack" && world.squad(s.order.targetId)?.playerId === player.id)),
        )
        .reduce((n, s) => n + s.troops, 0),
      isolated: this.placements.coasts(player.id).length > 0 && !world.players.some(p =>
        p.id !== player.id && !p.eliminated && world.hostile(player.id,p.id) && world.paths.connected(player.base,p.base)),
    });
    // Planning may invest in an owned, researched deposit before its mine is
    // built. Execution still spends only liquid stock through normal commands.
    const attainable = new Set(
      supply.deposits
        .filter(
          (d) =>
            world.owners[d.tile] === player.id &&
            state.completed.includes(resourceTechnology(d.resource).id),
        )
        .map((d) => d.resource),
    );
    const posture=militaryPosture(snapshot,personalityOf(player),progression.technologySpeed);
    this.guardCities(player);
    const demandKey=JSON.stringify([generation,state.age,state.completed,posture.target,snapshot.buildings.map(b=>[b.id,b.type,b.age,!b.remainingTicks&&(b.health??1)>0]),this.ledger.protected(player.id).items]);
    const pending=this.demandPlanning.get(player.id);
    const demand = militaryDemand(
      snapshot,
      personalityOf(player),
      attainable,
      Math.min(
        8,
        Math.ceil(
          this.losses.sample(player.id, world.tick, player.losses) / 1000,
        ),
      ),
      this.ledger.protected(player.id).items??{},
      64,pending?.key===demandKey?pending.state:undefined,
    );
    if(demand.planning)this.demandPlanning.set(player.id,{key:demandKey,state:demand.planning});else this.demandPlanning.delete(player.id);
    if (demand.deferred) return;
    this.demands.set(player.id, demand);
    const opportunity = {
      resources: supply.deposits.filter(d => world.owners[d.tile] === player.id).map(d => d.resource),
      usableCoast: this.placements.coasts(player.id).length > 0,
      seaThreat: this.naval.missions.get(player.id)?.assessment?.enemyPower ?? 0,
      goods: snapshot.buildings.reduce((n, b) => n + (supply.goods.get(b.id) ?? 0), 0),
      protectedItems: this.ledger.protected(player.id).items ?? {},
    };
    const candidates = economicCandidates(
      snapshot,
      state,
      personalityOf(player),
      demand,
      progression.technologySpeed,
      this.placements.candidates(player, snapshot, demand),
      opportunity,
    );
    if (posture.wealthy) {
      // A separate bounded lane prevents research/refits starving recruitment.
      // Re-read liquid stock after every accepted command, respecting leases.
      let admitted=0;
      const paid=new Set<string>();
      for (const candidate of candidates.filter(c=>c.kind==="recruit")) {
        if (admitted>=3) break;
        const liquid={gold:player.gold,reserves:player.reserves,items:supply.inventories[player.id]};
        const available=this.ledger.spendable(player.id,liquid,candidate.id,candidate.priority);
        if ((available.gold??0)-(candidate.cost.gold??0)<posture.protectedGold || !affordableAiCost(available,candidate.cost)) continue;
        this.diagnostics.commands++;
        if (world.applyCommand(candidate.command)) this.diagnostics.rejected++; else {admitted++;paid.add(candidate.id);}
      }
      // Quotes below must use current liquid funds, not pre-recruitment credit.
      snapshot.liquid={gold:player.gold,reserves:player.reserves,items:{...supply.inventories[player.id]}};
      for (let i=candidates.length-1;i>=0;i--) if (paid.has(candidates[i].id)) candidates.splice(i,1);
    }
    // Refitting existing troops must not consume each development slot while
    // the workshop needed for the remaining troops is still missing.
    if (!candidates.some(c => c.reason.includes("production-prerequisite:")) &&
      snapshot.threatTroops <= snapshot.readyTroops / 2 && this.military.decide(player) && !posture.wealthy) return;
    snapshot.liquid={gold:player.gold,reserves:player.reserves,items:{...supply.inventories[player.id]}};
    this.diagnostics.candidates += candidates.length;
    let goal = this.saving.get(player.id);
    if (
      goal &&
      (goal.intent.generation !== generation ||
        world.tick >= goal.intent.expiresTick ||
        world.tick - goal.lastProgress >= 1200 ||
        (goal.intent.command.type === "research" && (!!researchRejection(state, Number.MAX_SAFE_INTEGER, goal.intent.command.technologyId, progression.technologySpeed) || !researchUtility(TECHNOLOGY.get(goal.intent.command.technologyId)!,snapshot,demand,opportunity).benefit)) ||
        (goal.intent.kind === "advance" && (!!advanceRejection(state, Number.MAX_SAFE_INTEGER, progression.technologySpeed) || !usableNextAge(snapshot,opportunity))))
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
      (challenger.priority === "emergency" || challenger.reason.includes("production-prerequisite:") ||
        (goal.intent.kind !== "research" && goal.intent.kind !== "advance" && challenger.score * 5 > goal.intent.score * 6))
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
      // The current goal retains its partial reservation. Independent research
      // may use only unreserved liquid gold while troop/material supply catches up.
      if (chosen.kind === "recruit") {
        const development = candidates.find(candidate =>
          (candidate.kind === "research" || candidate.kind === "advance") &&
          affordableAiCost(this.ledger.spendable(player.id, snapshot.liquid, candidate.id, candidate.priority), candidate.cost));
        if (development) {
          this.diagnostics.commands++;
          if (world.applyCommand(development.command)) this.diagnostics.rejected++;
        }
      }
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
  private guardCities(player: Player): void {
    const {world,progression}=this.expansion;
    if (!world.options?.aiDefenses || progression.states[player.id].age!=="Modern") return;
    const controller=`city-air:${player.id}`,selected=new Set<import("./AiAssetLeases").AiAsset>();
    const available=world.squadFacts().aliveByOwner(player.id).filter(s=>UNIT.get(s.definitionId??"")?.role==="anti-air" && !s.refit && s.embarkedOn===null);
    const cities=world.buildingFacts().byOwner(player.id).filter(b=>b.type==="city" && !b.remainingTicks && (b.health??1)>0).sort((a,b)=>a.id-b.id);
    for (const city of cities) for (let slot=0;slot<2;slot++) {
      const squad=available.filter(s=>!selected.has(`squad:${s.id}`)).sort((a,b)=>world.map.euclideanDistSquared(world.tileOf(a),city.tile)-world.map.euclideanDistSquared(world.tileOf(b),city.tile) || a.id-b.id)
        .find(s=>this.assets.acquire([{asset:`squad:${s.id}`,playerId:player.id,generation:world.aiGeneration(player.id),controller,priority:"city-defense",createdTick:world.tick,expiresTick:world.tick+100}]));
      if (!squad) break;
      selected.add(`squad:${squad.id}`);
      if (world.map.euclideanDistSquared(world.tileOf(squad),city.tile)>6**2 && !(squad.order.type==="move" && world.map.euclideanDistSquared(squad.order.tile,city.tile)<=6**2)) {
        const tile=world.ownedLandNearest(player.id,city.tile,16).find(t=>world.paths.walkable(t));
        if (tile!==undefined) world.applyCommand({type:"order",playerId:player.id,squadIds:[squad.id],order:{type:"move",tile,x:(world.map.x(tile)+0.5)*FIXED,y:(world.map.y(tile)+0.5)*FIXED}});
      } else if (squad.troops<900 && squad.order.type!=="replenish" && world.owners[world.tileOf(squad)]===player.id && player.reserves>=1000-squad.troops)
        world.applyCommand({type:"order",playerId:player.id,squadIds:[squad.id],order:{type:"replenish"}});
    }
    this.assets.retain(controller,selected);
  }
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
