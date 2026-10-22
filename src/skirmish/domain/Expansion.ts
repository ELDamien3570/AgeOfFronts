import { secondsToTicks } from '../Protocol';
import { TrenchOccupancy } from "./TrenchOccupancy";
import { chargeFallbackOrder } from "./CommandPolicy";
import { aiVesselPreference } from "./AiVesselChoice";
import { airfieldAircraftCount } from "./AirfieldCapacity";
import { constructionAvailabilityRejection } from "../content/ConstructionAvailability";
import { SkirmishStance } from "./SkirmishStance";
import { tacticalTerrain, type TacticalTerrain } from "./TacticalTerrain";
import { TacticalFeatureIndex } from "./TacticalFeatureIndex";
import { effectiveRange, maxEffectiveRange, elevationRangeAt } from "./ElevationAdvantage";
import { EngagementManager } from './EngagementManager';
import { createManpower, recipeCapacity, scaledRecipeCost, maximumHealth, HEALTH_SCALE } from './Manpower';
import { airBases, baseAccepts, type AirBase } from './AirBases';
import { DRONE_SWARM, aircraftSlots, droneOffset, droneDamageShare } from '../content/DroneSwarms';
import { recruitmentVariant } from '../content/FormationRecipes';
import { quoteEnlargement } from './Enlargement';
import { SpatialGrid } from "../SpatialGrid";
import { flightTicks, flightSpeed, flightReachable, aircraftRecruitmentAge, missionKind, FLIGHT_RULES, aircraftRecruitmentCost } from "../content/FlightOperations";
import { shoreTransportDefinition } from "../content/ShoreTransport";
import { buildingGroundBounds } from "../BuildingFootprint";
import { availableGold, paidCost } from "./Gold";
import { extractionPriority, stoneExtractionAllowed } from "./AiExtractionPolicy";
import { PairRelations } from "./PairRelations";
import { AiOperations } from "./AiOperations";
import { AutomaticBuildingTiers } from "./AutomaticBuildingTiers";
import { DiplomaticGeography } from "./DiplomaticGeography";
import { restoreArray } from "../StateTransfer";
import type { GameMap } from "../../core/game/GameMap";
import type { BuildingQueries } from "../BuildingIndex";
import type { UnitQueries } from "../UnitIndex";
import { DamageLedger } from "../Conquest";
import type { LandPaths, WaterPaths } from "../Pathfinding";
import type {
  Building,
  BuildingType,
  Command,
  Player,
  Ship,
  Squad,
} from "../Protocol";
import { FIXED, TICKS_PER_SECOND } from "../Protocol";
import type { AiDifficulty } from "../Protocol";
import { chargeAligned, FORMATION_MOTION } from "../FormationLocomotion";
import { recoveredChargeStrength } from './ChargeStrength';
import { armCavalryBonus, CAVALRY_ENGAGEMENT_REACH } from './CavalryAssault';
import { isCavalryTroopClass } from './Definitions';
import { formationDoctrine, formationEnvelope } from './FormationGeometry';
import { formationContact, CONTACT_TOLERANCE } from './FormationContact';
import { CONTACT } from '../content/TacticalRules';
import { AIRCRAFT_RULES, BOMBER_ATTACK, ATOMIC_ATTACK, DRONE_ATTACK, NAVAL_AIR_ATTACK, STRATEGIC_PAYLOADS, STRATEGIC_RULES } from "../content/ModernWeapons";
import { personalityOf } from "../content/AiPersonalities";
import {
  DEFENSIVE_BUILDINGS,
  automaticBuildingTier,
  buildingCost,
  buildingIntegrity,
  buildingTechnology,
  productionBuildingType,
} from "../content/Buildings";
import { startingEconomy } from "../content/StartingEconomy";
import { TRIBE_BUILDING_ORDER, TRIBE_MILITARY_BUILDING_ORDER, tribeBuildingLimit, tribeBuildingRejection, tribeMineCounts, tribeAdvanceRejection } from "./TribeDevelopment";
import { resourceVisibleAtAge } from "../content/Resources";
import { CONTENT_HASH } from "../content/Catalog";
import { TECHNOLOGIES, technologyAt } from "../content/Technology";
import { UNIT, UNITS, VESSEL, VESSELS } from "../content/Units";
import { AiModernization } from "./AiMilitaryDevelopment";
import { AiForceInventory } from "./AiForceInventory";
import {
  acceptsAlliance,
  buildingPriority,
  economicBuildingTarget,
} from "./AiPersonality";
import { Armies, type ArmyWorld } from "./Armies";
import { Battle, type BattleWorld } from "./Battle";
import {
  AGES,
  startingGameplayAge,
  type StartingAge,
  type Age,
  type Aircraft,
  type ExpansionSnapshot,
  type MatchEvent,
  type TechnologySpeed,
  type UnitDefinition,
} from "./Definitions";
import { Diplomacy } from "./Diplomacy";
import { Fortifications, type TowerSiteIndex } from "./Fortifications";
import {
  Progression,
  advanceRejection,
  researchRejection,
} from "./Progression";
import { affordableRefitPrefix, sumCosts, VESSEL_REFIT_PORT_MESSAGE, vesselRefitCost, vesselRefitPortReady } from "./RefitQuote";
import { unitRefitCost } from "./Refitting";
import { vesselEffects } from "./ResearchEffects";
import { rescaledHullHealth } from "./NavalCombat";
import { Roads } from "./Roads";
import { Recruitment, RECRUITMENT_SECONDS } from "./Recruitment";
import type { RecruitmentJob, VesselDefinition } from "./Definitions";
import { Supply, costRejection, spend } from "./Supply";
import { Trade } from "./Trade";
import { structureAim, structureContact } from "./StructureTargeting";
import { StructureAttackPreparation, type StructureAttackPreparationState } from "./StructureAttackPreparation";
import { squadRadius, standable, tilePoint } from "../SquadGeometry";
import type { CoastIndex } from "../CoastIndex";
import { AiEconomicDirector } from "./AiEconomicDirector";
import type { NuclearWasteland } from "./NuclearWasteland";
import { blastHitsAlly, blastOwners } from "./BlastDiplomacy";
const TRIBE_MILITARY_TECHNOLOGIES = [...TECHNOLOGIES].sort((a, b) => Number(!!a.optional) - Number(!!b.optional) ||
  ["warfare", "economic", "naval"].indexOf(a.tree) - ["warfare", "economic", "naval"].indexOf(b.tree));

export interface ExpansionWorld extends BattleWorld, ArmyWorld {
  formationFits(s:Squad,point:{x:number;y:number},heading?:number):boolean;
  trenchBuildingRevision():number;
  wasteland: NuclearWasteland;
  spatialFacts(phase: import("../PhaseSpatialViews").SpatialPhase): import("../PhaseSpatialViews").PhaseSpatialFacts;
  recruitment: Recruitment;
  options?: { seaTradeRouting?: "lanes-v1"; runAi?: boolean; formationLocomotion?: boolean; aiEconomy?: boolean; aiDefenses?:boolean; aiNaval?:boolean; aiWarPolicy?:boolean; diplomacyRules?:"raids-v1"; deferredPlanning?:boolean; territoryIncomeScale?:number; resourceDensity?: 1 | 2 | 3 | 5; resourceOutput?: 1 | 2 | 3 | 5; alliances?: boolean; startingAge?: StartingAge; maximumAge?: Age; humanNames?: readonly string[]; startProtectionMinutes?: number; timeLimitMinutes?: number; aiDifficulty?: AiDifficulty; tribeOpening?: "playtest-v1" };
  map: GameMap;
  owners: Uint8Array;
  claims: Uint8Array;
  progress: Uint8Array;
  paths: LandPaths;
  waterPaths: WaterPaths;
  coast: CoastIndex;
  winner: number | null;
  applyCommand(command: Command): string | null;
  buildingsAt(tile: number): readonly Building[];
  towersNear(tile:number,radius:number):Iterable<Building>;
  tileOf(squad: { x: number; y: number }): number;
  ownedLand(playerId: number): Iterable<number>;
  /** The `limit` owned tiles closest to `anchor`, ordered by distance then id. */
  ownedLandNearest(playerId: number, anchor: number, limit: number, after?: number): number[];
  hasUnclaimedFrontier?(owner:number):boolean;
  buildingSite(playerId: number, type: BuildingType, tile: number, age?: Age): string | null;
  squadCapacity(player: Player): number;
  canDeploy?(squad:Squad,troops:number,definitionId?:string):boolean;
  aiGeneration(playerId: number): number;
  ship(id:number):Ship | undefined;
  building(id:number):Building | undefined;
  buildingFacts(): BuildingQueries;
  squadFacts(): UnitQueries<Squad>;
  shipFacts(): UnitQueries<Ship>;
  installSquadPath(id: number, path: readonly number[]): void;
  /** Drops pending movement planning for these squads (a superseding order). */
  cancelMovement?(squadIds: readonly number[]): void;
  removeBuilding(id: number): boolean;
  factionAdjacent(a: number, b: number): boolean;
  admitStructureAttack?(playerId: number, squads: readonly Squad[], points: Map<number, {x:number;y:number}>, target: NonNullable<Squad["structureTarget"]>): void;
  prepareStructureAttack?(playerId: number, squads: readonly Squad[], target: NonNullable<Squad["structureTarget"]>): string | null;
}
// Match-level application coordinator; each domain service owns its own rules.
// All services operate on the same authoritative world, never a parallel game.
/** P26: AI progression phase within its 3 s cycle. (id * 3) only used every third tick. */
export function progressionStagger(playerId: number): number {
  return playerId % secondsToTicks(3);
}
export class Expansion {
  checkpoint() { return structuredClone({trenches:this.trenches.checkpoint(),skirmish:this.skirmish.checkpoint(),features:this.features.checkpoint(),progression:this.progression.checkpoint(),diplomacy:this.diplomacy.checkpoint(),fortifications:this.fortifications.checkpoint(),supply:this.supply.checkpoint(),trade:this.trade.checkpoint(),roads:this.roads.checkpoint(),battle:this.battle.checkpoint(),armies:this.armies.checkpoint(),engagements:this.engagements.checkpoint(),modernization:this.modernization.checkpoint(),economy:this.economy.checkpoint(),aircraft:this.aircraft,winners:this.winners,events:this.events,nextEvent:this.nextEvent,tribePlans:[...this.tribePlans],geography:this.geography.checkpoint(),operations:this.operations.checkpoint(),relations:this.relations.checkpoint()}); }
  restore(saved: ReturnType<Expansion["checkpoint"]>): void {
    this.automaticTiers.reset();
    this.metadataIdentity={};
    const state=structuredClone(saved);
    this.features.restore(state.features);
    this.tribePlans.clear();
    for (const [id, plan] of state.tribePlans ?? []) this.tribePlans.set(id, plan);
    if (state.operations) this.operations.restore(state.operations);
    this.relations.restore(state.relations);
    if (state.geography) this.geography.restore(state.geography);
    this.progression.restore(state.progression);
    this.diplomacy.restore(state.diplomacy);
    this.fortifications.restore(state.fortifications);
    this.supply.restore(state.supply);
    this.trade.restore(state.trade);
    this.roads.restore(state.roads);
    this.battle.restore(state.battle);
    this.armies.restore(state.armies);
    this.trenches.restore(state.trenches);
    this.skirmish.restore(state.skirmish);
    this.engagements.restore(state.engagements);
    this.modernization.restore(state.modernization);
    if (state.economy) this.economy.restore(state.economy);
    restoreArray(this.aircraft,state.aircraft); restoreArray(this.winners,state.winners); restoreArray(this.events,state.events); this.nextEvent=state.nextEvent;
  }

  readonly trenches:TrenchOccupancy;
  readonly skirmish:SkirmishStance;
  readonly terrain:TacticalTerrain;
  readonly features:TacticalFeatureIndex;
  readonly progression: Progression;
  private readonly automaticTiers = new AutomaticBuildingTiers();
  readonly diplomacy: Diplomacy;
  readonly fortifications: Fortifications;
  readonly supply: Supply;
  readonly trade: Trade;
  readonly roads: Roads;
  readonly battle: Battle;
  readonly armies: Armies;
  readonly engagements: EngagementManager;
  readonly modernization = new AiModernization();
  readonly economy: AiEconomicDirector;
  readonly geography: DiplomaticGeography;
  readonly operations: AiOperations;
  readonly relations: PairRelations;
  private readonly towerSites:TowerSiteIndex;
  readonly aircraft: Aircraft[] = [];
  private airTargets?: SpatialGrid<Aircraft>;
  private readonly nearbyAircraft: Aircraft[]=[];
  readonly winners: number[] = [];
  readonly events: MatchEvent[] = [];
  private nextEvent = 1;
  private readonly tribePlans = new Map<number, { nextType: number; tiles: Partial<Record<BuildingType, number>>; landAfter?:Partial<Record<BuildingType,number>> }>();
  announce(event: Omit<MatchEvent, "id" | "tick">): void {
    this.events.push({ ...event, id: this.nextEvent++, tick: this.world.tick });
    if (this.events.length > 80) this.events.shift();
  }
  readonly victoryMode: "solo" | "allied";
  readonly startingAge: Age;
  constructor(
    readonly world: ExpansionWorld,
    seed: number,
    mode: "solo" | "allied" = "solo",
    technologySpeed: TechnologySpeed = 1,
    startingAge: StartingAge = world.options?.startingAge ?? "StoneAge",
  ) {
    this.terrain=tacticalTerrain(world.map);
    this.features=new TacticalFeatureIndex(this.terrain,world.paths);
    this.startingAge = startingGameplayAge(startingAge);
    this.towerSites={at:tile=>world.buildingsAt(tile),nearby:(tile,radius)=>world.towersNear(tile,radius)};
    this.progression = new Progression(technologySpeed, startingAge, world.options?.maximumAge);
    this.victoryMode = mode;
    this.diplomacy = new Diplomacy(undefined,world.options?.diplomacyRules);
    this.diplomacy.onAutomaticAction=(actorId,otherId,action)=>this.announce({kind:"diplomacy",actorId,otherId,action});
    this.fortifications = new Fortifications(world.map, this.diplomacy);
    this.supply = new Supply(world.map, this.progression, seed, world.options?.resourceDensity, world.options?.resourceOutput);
    this.roads = new Roads(world.map);
    this.operations = new AiOperations(this);
    this.relations = new PairRelations(world, this.diplomacy, this.operations);
    this.trade = new Trade(
      world,
      this.supply,
      this.progression,
      this.diplomacy,
      this.fortifications,
      this.roads,
      (a,b)=>this.relations.atWar(a,b),
      (a,b)=>this.diplomacy.raids?this.diplomacy.declaredWar(a,b):this.relations.atWar(a,b),
      owner=>this.relations.signatureFor(owner),
    );
    this.trade.onCapture = (captor, victim, value) => this.operations.rememberGrievance(victim, captor, "raid", value > 100 ? 2 : 1);
    this.battle = new Battle(
      world,
      world.map.width(),
      world.map.height(),
      this.diplomacy,
      this.fortifications,
      this.progression,
    );
    this.battle.setWidth(world.map.width());
    this.armies = new Armies(world, this.progression);
    this.trenches=new TrenchOccupancy(this);
    this.skirmish=new SkirmishStance(this);
    this.battle.occupationCover=(s,source)=>this.trenches.cover(s,source);
    this.armies.advisoryMovement=id=>this.skirmish.active(id);
    this.engagements=new EngagementManager(this);
    this.armies.setEngagementManager(this.engagements);
    this.economy = new AiEconomicDirector(this);
    this.geography = new DiplomaticGeography(world, this.economy.navalFacts);

    this.supply.aiProduction = playerId => this.economy.production(playerId);
  }
  add(player: Player): void {
    this.progression.add(player.id);
    this.supply.add(player.id);
    Object.assign(this.supply.inventories[player.id], startingEconomy(this.progression.startingAge, player.kind === "tribe").items);
  }
  unit(squad: Squad): UnitDefinition {
    return this.battle.definition(squad);
  }
  stepStructurePreparation(state: StructureAttackPreparationState, budget: number): number {
    if (budget === 0) return 0;
    const building = state.target.buildingId === undefined ? undefined : this.world.building(state.target.buildingId),
      wall = state.target.barrierId === undefined ? undefined : this.fortifications.barrier(state.target.barrierId), target = building ?? wall;
    if (!target || (target.health ?? 1) <= 0 || !this.diplomacy.canAttackStructure(state.playerId, target.playerId)) {
      state.stage = "failed"; state.reason = "Structure target is no longer hostile or available"; return 1;
    }
    const key = building ? `b:${building.id}:${building.playerId}:${building.tile}` : `w:${wall!.id}:${wall!.playerId}:${this.fortifications.version}`;
    if (state.targetKey !== undefined && state.targetKey !== key) {
      const restarts = (state.geometryRestarts ?? 0) + 1, consumed = state.consumed;
      if (restarts > 3) { state.stage = "failed"; state.reason = "Structure geometry kept changing during preparation"; return 1; }
      const members = state.members.map(member => { const squad = this.world.squad(member.id)!; return { ...member, origin: { x: squad.x, y: squad.y } }; });
      Object.assign(state, StructureAttackPreparation.create(state.playerId, members, state.target), {
        aim: undefined, candidate: undefined, best: undefined, centre: undefined, consumed: consumed + 1, geometryRestarts: restarts, targetKey: key });
      return 1;
    }
    state.targetKey = key;
    for (const member of state.members) {
      const squad = this.world.squad(member.id), profile = squad && this.unit(squad).attack;
      if (!squad || squad.kind !== member.kind || profile!.range !== member.range || !!member.elevationEligible!==(profile!.perSoldier===true&&profile!.channel==="ranged") || !profile!.targets.includes(building ? "structure" : "wall")) {
        state.stage = "failed"; state.reason = "Selected weapon changed during structure preparation"; return 1;
      }
    }
    return new StructureAttackPreparation(this.world.map, this.world.paths, this.fortifications, building ? [building.tile] : wall!.tiles, state,
      (id,from,to)=>effectiveRange(this.world,from,this.unit(this.world.squad(id)!).attack,to), {
        extent: id => formationEnvelope(this.world.squad(id)!, this.world.tick).broadRadius + Math.SQRT2 * FIXED / 2,
        contact: (id, from, tile) => {
          const contact = structureContact({...this.world.squad(id)!, ...from}, tile, this.world.map.width(), this.world.tick);
          return contact ? {gap: Math.max(0, contact.gap - CONTACT_TOLERANCE), point: contact.target} : undefined;
        },
      }).step(budget);
  }
  available(player: Player, line: Squad["kind"]): UnitDefinition | undefined {
    return UNITS.filter(
      (u) =>
        u.line === line &&
        ["frontline", "ranged", "mounted"].includes(u.role) &&
        this.progression.has(player.id, u.technologyId),
    ).slice(-1)[0];
  }
  recruitment(player: Player, line: Squad["kind"]) {
    for (const unit of UNITS.filter(
      (u) =>
        u.line === line && ["frontline", "ranged", "mounted"].includes(u.role),
    )
      .slice()
      .reverse()) {
      if (
        !this.progression.has(player.id, unit.technologyId) ||
        costRejection(player, this.supply.inventories[player.id], unit.cost)
      )
        continue;
      const building = this.world.buildings.find(
        (b) =>
          b.playerId === player.id &&
          !b.remainingTicks &&
          b.type === unit.building &&
          AGES.indexOf(b.age ?? "StoneAge") >= AGES.indexOf(unit.age),
      );
      if (building) return { unit, building };
    }
    return undefined;
  }
  /** The researched transport a faction's squads become on water, with its
   * research effects, or undefined when the faction cannot take to water. */
  transport(playerId: number): VesselDefinition | undefined {
    const completed = this.progression.states[playerId]?.completed ?? [],
      definition: VesselDefinition | undefined = shoreTransportDefinition(completed);
    return definition && vesselEffects(definition, completed);
  }
  vessel(ship: Ship) {
    const definition = VESSEL.get(ship.definitionId ?? "") ??
      VESSELS.find((v) => v.age === "StoneAge" && v.kind === ship.kind)!,
      completed = this.progression.states[ship.playerId].completed;
    return vesselEffects(definition, completed);
  }
  /** Research-adjusted maximum health of a new `definition` hull. */
  vesselMaxHealth(playerId: number, definition: VesselDefinition): number {
    return vesselEffects(definition, this.progression.states[playerId]?.completed ?? []).health;
  }
  /** R2-M14: research changed this player's hull maxima since `previous`;
   * keep every ship's share of maximum health, so a full fleet stays full and
   * on station instead of retreating to port as "damaged". */
  rescaleShipHealth(playerId: number, previous: readonly string[]): void {
    const completed = this.progression.states[playerId]?.completed ?? [];
    for (const s of this.world.ships) {
      if (s.playerId !== playerId) continue;
      const definition = VESSEL.get(s.definitionId ?? "") ??
        VESSELS.find((v) => v.age === "StoneAge" && v.kind === s.kind)!;
      const oldMax = vesselEffects(definition, previous).health,
        newMax = vesselEffects(definition, completed).health;
      if (oldMax !== newMax)
        this.world.updateShip(s.id, { health: rescaledHullHealth(s.health, oldMax, newMax) });
    }
  }
  buildRejection(
    player: Player,
    type: BuildingType,
    tile: number,
    age: Age,
    placementOnly = false,
  ): string | null {
    const availability = constructionAvailabilityRejection(type);
    if (availability) return availability;
    const tribal = tribeBuildingRejection(player,type,tile,this.progression.states[player.id].age,
      this.world.buildingFacts().byOwner(player.id), t => this.supply.resourceSites.at(t)?.resource);
    if (tribal) return tribal;
    const technology = buildingTechnology(type, age);
    if (!technology || (!placementOnly && !this.progression.has(player.id, technology)))
      return "Research this building's technology first";
    const state = this.progression.states[player.id];
    if (productionBuildingType(type, state.age, state.completed) !== type)
      return "Armories are replaced by researched arms factories";
    const tier = automaticBuildingTier(type, state.age, state.completed);
    if (!placementOnly && tier && tier !== age)
      return "Build this structure at its latest researched tier";
    const plan =
      (type === "tower" || type === "trench")
        ? this.fortifications.towerPlan(
            tile,
            player.id,
            age,
            type === "tower" ? this.towerSites : this.world.buildingFacts(),
            type,
            t => type !== "trench" || this.world.owners[t] === player.id,
          )
        : null;
    if (
      type === "tower" &&
      this.world.squads.some(
        (s) =>
          s.embarkedOn === null &&
          (this.world.tileOf(s) === tile ||
            plan?.links.some((l) => l.tiles.includes(this.world.tileOf(s)))),
      )
    )
      return "Move troops clear of the tower and planned wall tiles";
    const bounds = buildingGroundBounds(this.world.map, tile, type);
    for (let y=bounds.top; y<bounds.bottom; y++) for (let x=bounds.left; x<bounds.right; x++)
      if (this.world.map.isValidCoord(x,y) && this.fortifications.blocked(this.world.map.ref(x,y), player.id))
        return "Cannot build on an intact wall";
    const node = this.supply.resourceSites.at(tile);
    const visible = node && resourceVisibleAtAge(node.resource, this.progression.states[player.id].age);
    if (
      type === "mine" &&
      (!node || !visible || node.resource === "horses" || node.resource === "oil")
    )
      return "Mines must be placed directly on a mineral deposit";
    if ((type === "oil-well" || type === "oil-rig") && (!visible || node?.resource !== "oil"))
      return "Oil extraction needs an oil deposit";
    const resourceSite = this.supply.resourceSites.rejection(type,tile);
    if (resourceSite) return resourceSite;
    const existingCount = this.world.buildingFacts().countOfType(player.id, type);
    const cost = buildingCost(type, age, existingCount),
      wallCost =
        plan?.gold ?? 0;
    return placementOnly ? null : costRejection(player, this.supply.inventories[player.id], {
      ...cost,
      gold: (cost.gold ?? 0) + wallCost,
    });
  }
  built(player: Player, building: Building): void {
    const age = building.age ?? this.progression.states[player.id].age;
    const plan =
      (building.type === "tower" || building.type === "trench")
        ? this.fortifications.towerPlan(
              building.tile,
              player.id,
              age,
              building.type === "tower" ? this.towerSites : this.world.buildingFacts(),
              building.type,
              t => building.type !== "trench" || this.world.owners[t] === player.id,
            )
        : null;
    const existingCount = Math.max(
      0,
      this.world.buildingFacts().countOfType(player.id, building.type) - 1,
    );
    const cost = buildingCost(building.type, age, existingCount);
    spend(player, this.supply.inventories[player.id], {
      ...cost,
      gold: (cost.gold ?? 0) + (plan?.gold ?? 0),
    });
    const maxHealth = buildingIntegrity(building.type, age,this.progression.states[player.id].completed);
    this.world.updateBuilding(building.id, { age, maxHealth, health: maxHealth });
    if (plan) this.fortifications.addTower(building, plan);
  }
  command(player: Player, command: Command): string | null | undefined {
    const { world } = this;
    if (command.type === "alliance" && !["declare", "offer-peace", "accept-peace", "reject-peace", "dont-embargo", "allow-embargo"].includes(command.action) && world.options?.alliances === false) return "Alliances are disabled for this match";
    if (command.type === "upgrade-building") return "Buildings upgrade automatically with research";
    if(command.type==="occupy") {const result=this.trenches.command(command);if(!result)this.skirmish.observe(command);return result;}
    if(command.type==="stance")return this.skirmish.command(command);
    const armyResult = this.armies.command(player, command);
    if(armyResult===null){this.trenches.observe(command);this.skirmish.observe(command);}
    if (armyResult !== undefined) return armyResult;
    if (command.type === "research") {
      return this.progression.research(player, command.technologyId);
    }
    if (command.type === "advance-age")
      return tribeAdvanceRejection(player, world.players, this.progression.states) ?? this.progression.advance(player);
    if (command.type === "production-priority")
      return this.supply.setPriorities(player, world.buildings, command.buildingType, command.recipeIds);
    if (command.type === "reset-production-priorities") {
      this.supply.resetPriorities(player.id);
      return null;
    }
    if (command.type === "trade-pause") {
      if (typeof command.naval !== "boolean" || typeof command.paused !== "boolean") return "Invalid trade control";
      this.trade.setPaused(player.id, command.naval, command.paused); return null;
    }
    if (command.type === "trade-block") {
      const other = world.players.find(p => p.id === command.otherId);
      if (!other || other.id === player.id || other.eliminated || typeof command.blocked !== "boolean") return "Choose a living trading faction";
      this.trade.setBlocked(player.id, other.id, command.blocked, command.naval); return null;
    }
    if (command.type === "produce")
      return this.supply.setProduction(
        player,
        world.building(command.buildingId!),
        command.recipeId,
      );
    if (command.type === "alliance") {
      const previous = JSON.stringify(this.diplomacy.state);
      const result = this.diplomacy.action(
        player,
        world.players.find((p) => p.id === command.otherId),
        command.action,
        world.tick,
      );
      if (!result && previous !== JSON.stringify(this.diplomacy.state))
        this.announce({
          kind: "diplomacy",
          actorId: player.id,
          otherId: command.otherId,
          // A reciprocal offer accepts the incoming offer. Record the outcome
          // now; later snapshots may arrive after this alliance already ends.
          action:
            (command.action === "offer" || command.action === "offer-long-term") &&
            this.diplomacy.allied(player.id, command.otherId) &&
            !this.diplomacy.state.offers.some(o => o.proposer === player.id && o.recipient === command.otherId)
              ? "accept"
              : command.action,
        });
      if (!result && (this.diplomacy.allied(player.id, command.otherId)||command.action==="accept-peace"||command.action==="offer-peace"&&!this.diplomacy.hostile(player.id,command.otherId))) {
        for (const s of world.squads) {
          if (
            s.charge?.targetId &&
            !this.diplomacy.hostile(
              s.playerId,
              world.squad(s.charge!.targetId!)?.playerId ??
                0,
            )
          ) {
            this.world.updateSquad(s.id, { charge: null });
            this.world.updateSquad(s.id, { order: { type: "hold" } });
            this.world.installSquadPath(s.id, []);
          }
          if (s.structureTarget) {
            const target =
              world.buildings.find(
                (b) => b.id === s.structureTarget!.buildingId,
              ) ??
              this.fortifications.barriers.find(
                (b) => b.id === s.structureTarget!.barrierId,
              );
            if (
              !target ||
              !this.diplomacy.hostile(s.playerId, target.playerId)
            ) {
              this.world.updateSquad(s.id, { structureTarget: null });
              this.world.updateSquad(s.id, { order: { type: "hold" } });
              this.world.installSquadPath(s.id, []);
            }
          }
          if (
            s.order.type === "attack" &&
            !this.diplomacy.hostile(
              s.playerId,
              world.squad((s.order as { targetId: number }).targetId)?.playerId ?? 0,
            )
          ) {
            this.world.updateSquad(s.id, { order: { type: "hold" } });
            this.world.installSquadPath(s.id, []);
          }
          this.world.updateSquad(s.id, { queuedOrders: s.queuedOrders.filter(
            (o) =>
              o.type !== "attack" ||
              this.diplomacy.hostile(
                s.playerId,
                world.squad(o.targetId)?.playerId ?? 0,
              ),
          ) });
        }
        for (let tile = 0; tile < world.owners.length; tile++)
          if (
            world.claims[tile] &&
            this.diplomacy.allied(world.owners[tile], world.claims[tile])
          ) {
            world.claims[tile] = 0;
            world.progress[tile] = 0;
          }
      }
      return result;
    }
    if (command.type === "repair") {
      const ids =
        command.buildingIds ??
        (command.buildingId !== undefined ? [command.buildingId] : []);
      if (ids.length) {
        let lastError: string | null = null;
        let anySuccess = false;
        for (const buildingId of ids) {
          const res = this.fortifications.repair(
            player,
            world.building(buildingId),
            undefined,
          );
          if (res === null) anySuccess = true;
          else lastError = res;
        }
        return anySuccess
          ? null
          : (lastError ?? "Choose a completed owned structure");
      }
      return this.fortifications.repair(
        player,
        undefined,
        this.fortifications.barriers.find((w) => w.id === command.barrierId),
      );
    }
    if (command.type === "recruit-aircraft")
      return this.recruitAircraft(
        player,
        command.buildingId,
        command.definitionId,
        command.autoRecruit === true,
        command.buildingIds,
      );
    if (command.type === "transfer-aircraft") {
      const bases=this.aviationBases();
      const destination = bases.find(b=>b.id===command.buildingId && b.playerId===player.id && b.kind!=='drone-facility');
      if (!destination) return "Choose an operational owned airfield or carrier";
      const selected = [...new Set(command.aircraftIds)].map(id => this.aircraft.find(a => a.id === id));
      const point = {x:destination.x,y:destination.y};
      if (!selected.length || selected.some(a => !a || a.playerId !== player.id || a.health <= 0 ||
        a.state !== "ready" || a.definitionId === "drone" || a.airfieldId === destination.id ||
        !bases.some(b=>b.id===a.airfieldId && b.playerId===player.id && baseAccepts(b,a.definitionId)) ||
        !flightReachable(a, point.x, point.y)))
        return "Select ready owned planes within flight range of a different airfield";
      if (airfieldAircraftCount(this.aircraft, destination.id) +
        world.recruitment.count(player.id, "aircraft", destination.id) + selected.length > destination.capacity)
        return "Destination airfield has insufficient parking space";
      for (const a of selected as Aircraft[]) {
        a.transfer = { destinationId: destination.id };
        a.target = { ...point };
        a.state = "transferring";
        a.mission = undefined;
        a.flightBudgetTicks ??= a.fuelTicks;
      }
      return null;
    }
    if (command.type === "sortie") {
      const mission = command.mission ?? "bombing";
      const bases=new Map(this.aviationBases(false).map(b=>[b.id,b]));
      if(command.targetBuildingId!==undefined || command.targetUnitId!==undefined) {
        if(mission!=='drone' || command.targetBuildingId!==undefined && command.targetUnitId!==undefined) return 'Choose one drone target';
        const target=command.targetBuildingId!==undefined?world.building(command.targetBuildingId):(world.squad(command.targetUnitId!)??world.ship(command.targetUnitId!));
        if(!target || ('tile' in target ? (target.health??0)<=0 || !this.diplomacy.canAttackStructure(player.id,target.playerId) : ('troops' in target?target.troops<=0:target.health<=0) || !this.diplomacy.hostile(player.id,target.playerId))) return 'Choose a hostile building or unit';
      }
      const selected = [...new Set(command.aircraftIds)].map((id) =>
        this.aircraft.find((a) => a.id === id),
      );
      if (
        !selected.length ||
        selected.some(
          (a) => {
            const field = a && bases.get(a.airfieldId);
            return !a || a.health <= 0 || a.playerId !== player.id || a.state !== "ready" ||
              a.definitionId !== missionKind(mission) || !flightReachable(a,command.x,command.y) ||
              !field || field.playerId !== player.id || !baseAccepts(field,a.definitionId);
          },
        ) ||
        !this.validPosition(command.x, command.y)
      )
        return "Select ready owned aircraft and a valid destination";
      if(mission === "bombing" || mission === "atomic") {
        const blocked=this.strikeRejection(player.id,command.x,command.y,(mission === "atomic" ? ATOMIC_ATTACK : BOMBER_ATTACK).projectile!.blastRadius,mission === "atomic");
        if(blocked) return blocked;
      }
      if(mission === "atomic") {
        if(!this.progression.has(player.id,"rus-earlymodern-nuclear-weapons")) return "Research Nuclear Weapons first";
        const stock=this.supply.inventories[player.id];
        if((stock["payload:atomic"]??0)<selected.length) return "Needs one atomic bomb per bomber";
        stock["payload:atomic"]-=selected.length;
      }
      for (const a of selected as Aircraft[]) {
        if(mission==='drone') {this.launchDroneSwarm(a,command);continue;}
        if(bases.get(a.airfieldId)?.kind==='carrier')a.baseKind='carrier';
        a.mission=mission;
        a.atomicPayload=mission === "atomic";
        a.target = { x: command.x, y: command.y };
        a.state = "outbound";
        a.flightBudgetTicks ??= a.fuelTicks;
        // Flight budget was filled at recruitment/landing; orders cannot refill it.
      }
      return null;
    }
    if (command.type === "launch")
      return this.launch(
        player,
        command.launcherId,
        command.payload,
        command.x,
        command.y,
        command.buildingId,
      );
    if (command.type === "refit-ships") {
      const target = VESSEL.get(command.definitionId),
        selected = [...new Set(command.shipIds)].map((id) =>
          world.ship(id),
        );
      if (
        !target ||
        target.kind === "trade" ||
        !this.progression.has(player.id, target.technologyId)
      )
        return "Research a military vessel refit first";
      const eligible=selected.filter((s):s is Ship=>!!s&&s.playerId===player.id&&!s.refit&&!s.fighting&&s.kind===target.kind&&AGES.indexOf(this.vessel(s).age)<AGES.indexOf(target.age)).sort((a,b)=>a.id-b.id);
      if(!eligible.length)return "Refit a compatible fleet out of combat with no active refit";
      if(!vesselRefitPortReady(world.buildingFacts().byType(player.id,"port"),target))return VESSEL_REFIT_PORT_MESSAGE;
      const costs=eligible.map(s=>vesselRefitCost(target,this.vessel(s)));
      const count=affordableRefitPrefix(costs,availableGold(player),this.supply.inventories[player.id]);
      if(!count)return costRejection(player,this.supply.inventories[player.id],costs[0])??"No affordable vessel refit";
      spend(player,this.supply.inventories[player.id],sumCosts(costs.slice(0,count)));
      for(const s of eligible.slice(0,count)){
        world.updateShip(s.id,{refit:{targetId:target.id,remainingTicks:secondsToTicks(10),totalTicks:secondsToTicks(10)},destination:null,waypoints:[],path:[],nextPathIndex:0,attackTargetId:null});
      }
      return null;
    }
    if (command.type === "naval-priority") {
      const selected = [...new Set(command.shipIds)].map(id => world.ship(id));
      if (!selected.length || selected.some(s => !s || s.playerId !== player.id || s.kind !== "warship"))
        return "Select your warships";
      for (const s of selected as Ship[]) world.updateShip(s.id, {
        navalPriority: command.priority, navalTargetId: undefined, navalTargetKind: undefined,
      });
      return null;
    }
    if (command.type === "naval-attack") {
      const afloat = world.squad(command.targetId),
        target =
          world.ship(command.targetId) ??
          world.building(command.targetId) ??
          (afloat?.afloat ? afloat : undefined),
        selected = [...new Set(command.shipIds)].map((id) =>
          world.ship(id),
        );
      if (!target || !("tile" in target
        ? this.diplomacy.canAttackStructure(player.id, target.playerId)
        : this.diplomacy.hostile(player.id, target.playerId)))
        return "Choose an enemy vessel or coastal structure";
      if (
        !selected.length ||
        selected.some(
          (s) =>
            !s || s.playerId !== player.id || s.kind !== "warship" || s.refit,
        )
      )
        return "Select your available warships";
      if(selected.some(s=>!this.vessel(s!).attack?.targets.includes("tile" in target ? "structure" : "ship"))) return "This vessel cannot attack that target";
      for (const s of selected as Ship[]) {
        this.world.updateShip(s.id, { attackTargetId: target.id });
        this.world.updateShip(s.id, { lastPlanTick: -60 });
        // An attack order interrupts any recovery, as a sail order does; the
        // port slot is released and retreat restarts once the fight ends.
        if (s.repairState && s.repairState !== "patrolling" && s.repairState !== "idle")
          this.world.updateShip(s.id, { repairState: "patrolling", repairPortId: null });
      }
      return null;
    }
    if(command.type==='cancel-enlarge') {
      let count=0;
      for(const id of [...new Set(command.squadIds)]) {const s=world.squad(id),job=s?.manpower?.enlargement;if(!s||s.playerId!==player.id||!job)continue;
        player.gold+=job.cost.gold??0;player.reserves+=job.cost.reserves??0;
        for(const [item,n] of Object.entries(job.cost.items??{}))this.supply.inventories[player.id][item]=(this.supply.inventories[player.id][item]??0)+n;
        world.updateSquad(id,{manpower:{...s.manpower!,enlargement:null}});count++;
      }return count?null:'No enlargement to cancel';
    }
    if(command.type==='enlarge') {
      const selected=[...new Set(command.squadIds)].map(id=>world.squad(id)).filter((s):s is Squad=>!!s&&s.definitionId===command.definitionId);
      const quote=quoteEnlargement(selected,undefined,player,this.progression.states[player.id].completed,this.supply.inventories[player.id],world.owners,world.map.width());
      if(!quote||quote.reason)return quote?.reason??'Research a larger compatible recipe first';
      if(quote.selected.some(s=>world.canDeploy && !world.canDeploy(world.squad(s.id)!,s.troops+quote.terms.added)))return 'There is no room to enlarge this formation';
      if(!this.trenches.reserveChanges(quote.selected.map(s=>({id:s.id,capacity:quote.target.formationRecipe!.enlargedCapacity}))))return 'Exit the trench or free trench space first';
      spend(player,this.supply.inventories[player.id],quote.cost);
      for(const s of quote.selected){world.updateSquad(s.id,{manpower:{...s.manpower!,enlargement:{definitionId:quote.target.id,targetCapacity:quote.target.formationRecipe!.enlargedCapacity,added:quote.terms.added,cost:paidCost(player,quote.terms.cost),totalTicks:quote.terms.ticks,remainingTicks:quote.terms.ticks}},order:{type:'hold'},queuedOrders:[],charge:null});world.installSquadPath(s.id,[]);}
      return null;
    }
    if (command.type === "refit") {
      const target = UNIT.get(command.definitionId),
        selected = [...new Set(command.squadIds)].map((id) =>
          world.squad(id),
        );
      if (!target || !this.progression.has(player.id, target.technologyId))
        return "Research the requested refit first";
      const eligible=selected.filter((s):s is Squad=>!!s&&s.playerId===player.id&&s.embarkedOn===null&&!s.afloat&&!s.refit&&!s.moved&&!s.fighting&&world.owners[world.tileOf(s)]===player.id&&this.unit(s).line===target.line&&this.unit(s).role===target.role&&this.unit(s).troopClass===target.troopClass&&this.unit(s).formationRecipe?.model===target.formationRecipe?.model&&!s.manpower?.enlargement&&AGES.indexOf(this.unit(s).age)<AGES.indexOf(target.age)).sort((a,b)=>a.id-b.id);
      if(!eligible.length)return "Refit a compatible stationary group on owned land, out of combat";
      const costs=eligible.map(s=>unitRefitCost(target,this.unit(s),1,recruitmentVariant(target.id,this.progression.states[player.id].completed)));
      const count=affordableRefitPrefix(costs,availableGold(player),this.supply.inventories[player.id]);
      if(!count)return costRejection(player,this.supply.inventories[player.id],costs[0])??"No affordable refit";
      if(eligible.slice(0,count).some(s=>world.canDeploy && !world.canDeploy(s,Math.min(s.troops,recipeCapacity(target,recruitmentVariant(target.id,this.progression.states[player.id].completed))),target.id)))return "There is no room for this refitted formation";
      if(eligible.slice(0,count).some(s=>this.trenches.occupants.has(s.id)&&(target.formationRecipe?.model!=="soldiers"||formationDoctrine(target.id).mounted)))return "Exit the trench before refitting to mounted or hull units";
      if(!this.trenches.reserveChanges(eligible.slice(0,count).map(s=>({id:s.id,capacity:recipeCapacity(target,recruitmentVariant(target.id,this.progression.states[player.id].completed))}))))return "Exit the trench or free trench space first";
      spend(player,this.supply.inventories[player.id],sumCosts(costs.slice(0,count)));
      for(const s of eligible.slice(0,count)){
        world.updateSquad(s.id,{refit:{targetId:target.id,recipeVariant:recruitmentVariant(target.id,this.progression.states[player.id].completed),totalTicks:secondsToTicks(10),remainingTicks:secondsToTicks(10)},order:{type:"hold"},queuedOrders:[],charge:null});
        world.installSquadPath(s.id,[]);
      }
      return null;
    }
    if (command.type === "charge") {
      const fallback = (reason: string) => {
        const order = chargeFallbackOrder(world.map, command, id => !!world.squad(id));
        return order ? world.applyCommand({ type: "order", playerId: player.id, squadIds: command.squadIds, order }) : reason;
      };
      const selected = [...new Set(command.squadIds)].map((id) =>
        world.squad(id),
      );
      if (!selected.length || !this.validPosition(command.x, command.y))
        return "Choose units and a valid charge destination";
      if (
        selected.some(
          (s) =>
            !s ||
            s.playerId !== player.id ||
            s.embarkedOn !== null ||
            Boolean(s.refit) || Boolean(s.manpower?.enlargement) ||
            !this.unit(s).charge ||
            (!isCavalryTroopClass(this.unit(s).troopClass) &&
              ((s.chargeReadyTick ?? 0) > world.tick || Boolean(s.charge))) ||
            Math.hypot(s.x - command.x, s.y - command.y) >
              this.unit(s).charge!.maximumDistance,
        )
      )
        return fallback("Every requested unit must have a ready charge in range");
      const tile = world.map.ref(
        Math.floor(command.x / FIXED),
        Math.floor(command.y / FIXED),
      );
      const paths = selected.map((s) =>
        world.paths.find(world.tileOf(s!), tile, (t) =>
          this.fortifications.blocked(t, player.id),
        ),
      );
      if (paths.some((p) => !p)) return fallback("Charge destination is blocked");
      if (
        command.targetId !== undefined &&
        !this.diplomacy.hostile(
          player.id,
          world.squad(command.targetId)?.playerId ?? 0,
        )
      )
        return fallback("Choose a hostile charge target");
      // A charge supersedes a move still being planned (e.g. the first click of
      // the double click that issued it), so that move can never commit later.
      world.cancelMovement?.(selected.map((s) => s!.id));
      selected.forEach((s, i) => {
        const mounted=isCavalryTroopClass(this.unit(s!).troopClass);
        // A rush already lodged in this target is sustained melee. Reissuing it
        // must not duplicate the impact or revoke its authorized overlap.
        // Only a target actually in contact is "lodged"; a charge to a point
        // must never become an attack on a far, stale engagement target (C1).
        const lodged=mounted && s!.cavalryEngagement && s!.cavalryEngagement.phase!=='withdrawing'
          ? s!.cavalryEngagement.targetIds.find(id=>(command.targetId===undefined || id===command.targetId) && this.lodgedTarget(s!,id))
          : undefined;
        if(lodged!==undefined){
          const armed=armCavalryBonus(s!,this.unit(s!),world.tick);
          world.updateSquad(s!.id,{order:{type:'attack',targetId:lodged},cavalryMelee:undefined,queuedOrders:[],...(armed?{cavalryEngagement:armed}:{})});
          return;
        }
        const continuing=mounted && s!.charge && s!.charge.phase!=='recovery';
        const strength=continuing?s!.charge!.strength??1:recoveredChargeStrength(s!.chargeReadyTick,world.tick,this.unit(s!).charge!.cooldownTicks);
        world.updateSquad(s!.id, {
          charge: { phase: continuing?s!.charge!.phase:mounted || !world.options?.formationLocomotion ? "approach" : "preparing", strength, x: command.x, y: command.y, startTick: continuing?s!.charge!.startTick:world.tick, committedTick: continuing?s!.charge!.committedTick:0, targetId: command.targetId },
          ...(mounted?{cavalryMelee:undefined,meleeStrike:undefined,cavalryEngagement:undefined}:{}),
          order: { type: "move", tile,x:command.x,y:command.y }, nextPathIndex: 0, queuedOrders: [], structureTarget: null,
        });
        world.installSquadPath(s!.id, paths[i]!);
      });
      return null;
    }
    if (command.type === "attack-structure") {
      const building = world.building(command.buildingId!),
        barrier = this.fortifications.barriers.find(
          (w) => w.id === command.barrierId,
        ),
        target = building ?? barrier;
      if (!target || !this.diplomacy.canAttackStructure(player.id, target.playerId))
        return "Choose an enemy structure";
      const selected = [...new Set(command.squadIds)].map((id) =>
        world.squad(id),
      );
      if (
        !selected.length ||
        selected.some(
          (s) =>
            !s || s.playerId !== player.id || s.embarkedOn !== null || s.refit,
        )
      )
        return "Select your available troops";
      const orders: { s: Squad; tile: number; path: number[] }[] = [];
      if (world.options?.deferredPlanning && world.prepareStructureAttack) {
        for (const s of selected as Squad[])
          if (!this.unit(s).attack.targets.includes(building ? "structure" : "wall")) return "This weapon cannot attack that structure";
        return world.prepareStructureAttack(player.id, selected as Squad[], { buildingId: building?.id, barrierId: barrier?.id });
      }
      for (const s of selected as Squad[]) {
        const targetTiles = building ? [building.tile] : barrier!.tiles;
        const profile=this.unit(s).attack;
        if(!profile.targets.includes(building ? "structure" : "wall")) return "This weapon cannot attack that structure";
        if(structureAim(s,targetTiles,elevationRangeAt(world,s,profile),player.id,world.map.width(),this.fortifications)){
          orders.push({s,tile:world.tileOf(s),path:[]});continue;
        }
        const approaches = new Set<number>();
        const extent = Math.ceil(maxEffectiveRange(this.unit(s).attack) / FIXED);
        for (const tile of targetTiles)
        for (
          let y = Math.max(0, world.map.y(tile) - extent);
          y <= Math.min(world.map.height() - 1, world.map.y(tile) + extent);
          y++
        )
          for (
            let x = Math.max(0, world.map.x(tile) - extent);
            x <= Math.min(world.map.width() - 1, world.map.x(tile) + extent);
            x++
          ) {
            const t = world.map.ref(x, y);
            if (
              world.paths.walkable(t) &&
              !this.fortifications.blocked(t, player.id) &&
              standable(world.map, tilePoint(world.map, t), squadRadius(s.kind)) &&
              structureAim(tilePoint(world.map, t), targetTiles, elevationRangeAt(world,tilePoint(world.map,t),this.unit(s).attack),
                player.id, world.map.width(), this.fortifications)
            )
              approaches.add(t);
          }
        let found: { tile: number; path: number[] } | undefined;
        const before = world.paths.work;
        for (const t of [...approaches].sort(
          (a, b) =>
            world.map.euclideanDistSquared(a, world.tileOf(s)) -
              world.map.euclideanDistSquared(b, world.tileOf(s)) || a - b,
        ).slice(0, 32)) {
          const remaining = 4096 - (world.paths.work - before);
          if (remaining <= 0) break;
          const path = world.paths.find(world.tileOf(s), t, (n) =>
            this.fortifications.blocked(n, player.id),
            remaining,
          );
          if (path) {
            found = { tile: t, path };
            break;
          }
        }
        if (!found)
          return "No legal structure approach found within the planning budget";
        orders.push({ s, ...found });
      }
      for (const { s, tile, path } of orders) {
        this.world.updateSquad(s.id, { order: { type: "move", tile } });
        this.world.installSquadPath(s.id, path);
        this.world.updateSquad(s.id, { nextPathIndex: 0 });
        this.world.updateSquad(s.id, { queuedOrders: [] });
        this.world.updateSquad(s.id, { charge: null });
        this.world.updateSquad(s.id, { structureTarget: {
          buildingId: building?.id,
          barrierId: barrier?.id,
        } });
      }
      return null;
    }
    return undefined;
  }
  /** Nuclear orders protect allies without requiring war with every blast
   * victim. Conventional bomber orders retain normal attack permissions. */
  private strikeRejection(playerId: number, x: number, y: number, radius: number, nuclear = false): string | null {
    const d = this.diplomacy;
    if (nuclear) return blastHitsAlly(this.world, playerId, x, y, radius,
      (a, b) => d.allied(a, b), this.fortifications.barriers) ? "Nuclear blast would hit an allied faction" : null;
    for (const owner of blastOwners(this.world, x, y, radius))
      if (owner !== 0 && owner !== playerId && !d.canAttackStructure(playerId, owner))
        return d.protected(playerId, owner) ? "Peace protection is still active" : "Choose a hostile building or unit";
    return null;
  }
  private validPosition(x: number, y: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < this.world.map.width() * FIXED &&
      y < this.world.map.height() * FIXED
    );
  }
  private aviationBases(owned=true): AirBase[] {
    return airBases(this.world.buildings,this.world.ships,this.world.map.width(),owned?this.world.owners:undefined);
  }
  private launchDroneSwarm(seed:Aircraft,command:Extract<Command,{type:'sortie'}>):void {
    const candidates:{id:number;kind:'building'|'squad'|'ship';x:number;y:number;maximum:number}[]=[];
    const addBuilding=(b:Building)=>{const point=this.battle.position(b);candidates.push({id:b.id,kind:'building',...point,maximum:b.maxHealth??b.health??1200});};
    const addSquad=(s:Squad)=>candidates.push({id:s.id,kind:'squad',x:s.x,y:s.y,maximum:s.manpower?maximumHealth(s)/HEALTH_SCALE:1000});
    if(command.targetBuildingId!==undefined) addBuilding(this.world.building(command.targetBuildingId)!);
    else if(command.targetUnitId!==undefined) {const squad=this.world.squad(command.targetUnitId);if(squad)addSquad(squad);else {const ship=this.world.ship(command.targetUnitId)!;candidates.push({id:ship.id,kind:'ship',x:ship.x,y:ship.y,maximum:this.vessel(ship).health});}}
    else {
      const inArea=(point:{x:number;y:number})=>(point.x-command.x)**2+(point.y-command.y)**2<=DRONE_SWARM.areaRadius**2;
      for(const b of this.world.buildings) if((b.health??1)>0 && this.diplomacy.canAttackStructure(seed.playerId,b.playerId) && inArea(this.battle.position(b))) addBuilding(b);
      for(const s of this.world.squads) if(s.troops>0 && s.embarkedOn===null && this.diplomacy.hostile(seed.playerId,s.playerId) && inArea(s)) addSquad(s);
      for(const ship of this.world.ships)if(ship.health>0&&this.diplomacy.hostile(seed.playerId,ship.playerId)&&inArea(ship))candidates.push({id:ship.id,kind:'ship',x:ship.x,y:ship.y,maximum:this.vessel(ship).health});
      candidates.sort((a,b)=>a.id-b.id);candidates.splice(32);
    }
    const original={...seed};
    for(let index=0;index<DRONE_SWARM.size;index++) {
      const offset=droneOffset(index), aim={x:command.x+offset.x,y:command.y+offset.y};
      const target=candidates.length===1?candidates[0]:candidates.slice().sort((a,b)=>(a.x-aim.x)**2+(a.y-aim.y)**2-((b.x-aim.x)**2+(b.y-aim.y)**2)||a.id-b.id)[0];
      // Soldier/hull manpower supports fixed-point wounds; legacy troop counts
      // and building/ship integrity remain integers across replication.
      const precision=target?.kind==='squad' && this.world.squad(target.id)?.manpower?HEALTH_SCALE:1;
      const member:Aircraft={...original,id:index===0?original.id:this.world.allocateId(),health:DRONE_SWARM.health,state:'outbound',mission:'drone',
        x:original.x,y:original.y,target:{x:command.x,y:command.y},atomicPayload:false,
        drone:{swarmId:original.id,index,targetId:target?.id,targetKind:target?.kind,damage:target?droneDamageShare(Math.round(target.maximum*precision),index)/precision:0}};
      if(index===0) Object.assign(seed,member);else this.aircraft.push(member);
    }
  }
  private advanceDrone(a:Aircraft):void {
    if(a.fuelTicks--<=0){a.health=0;return;}
    const member=a.drone!,target=member.targetKind==='building'?this.world.building(member.targetId!):(this.world.squad(member.targetId!)??this.world.ship(member.targetId!));
    const alive=target && ('tile' in target?(target.health??1)>0 && this.diplomacy.canAttackStructure(a.playerId,target.playerId):('troops' in target?target.troops>0:target.health>0) && this.diplomacy.hostile(a.playerId,target.playerId));
    const center=alive?('tile' in target?this.battle.position(target):target):a.target!;
    if(alive)a.target={x:center.x,y:center.y};
    const offset=droneOffset(member.index);
    const goal={x:Math.round(Math.max(1,Math.min(this.world.map.width()*FIXED-1,center.x+offset.x))),
      y:Math.round(Math.max(1,Math.min(this.world.map.height()*FIXED-1,center.y+offset.y)))};
    const dx=goal.x-a.x,dy=goal.y-a.y,d=Math.hypot(dx,dy),speed=flightSpeed('drone');
    if(d>speed){a.x+=Math.round(dx*speed/d);a.y+=Math.round(dy*speed/d);return;}
    a.x=goal.x;a.y=goal.y;
    const payload={targetId:alive?member.targetId!:-1,kind:member.targetKind??'squad',damage:alive?member.damage:0};
    if(this.battle.fire({...a,domain:'aircraft'},goal,DRONE_ATTACK,1,'bomb',1,0,'fpv-drone',undefined,undefined,undefined,payload)) a.health=0;
  }
  private recruitAircraft(player:Player,id:number,kind:Aircraft['definitionId'],automatic=false,buildingIds?:readonly number[]):string|null {
    if(!['fighter','bomber','drone'].includes(kind))return 'Unknown aircraft type';
    const bases=this.aviationBases().filter(b=>b.playerId===player.id && baseAccepts(b,kind) && aircraftRecruitmentAge(kind,b.age,t=>this.progression.has(player.id,t)));
    const free=(b:AirBase)=>airfieldAircraftCount(this.aircraft,b.id)+this.world.recruitment.count(player.id,'aircraft',b.id)<b.capacity;
    let field=bases.find(b=>b.id===id);
    if(automatic||buildingIds) field=bases.filter(b=>(!buildingIds||buildingIds.includes(b.id))&&free(b))
      .sort((a,b)=>this.world.recruitment.byProducer(a.id).reduce((n,j)=>n+j.remainingTicks,0)-this.world.recruitment.byProducer(b.id).reduce((n,j)=>n+j.remainingTicks,0)||a.id-b.id)[0];
    if(!field) return 'Needs researched aviation and an operational owned launch site';
    if(!free(field)||aircraftSlots(this.aircraft,player.id)+this.world.recruitment.count(player.id,'aircraft')>=AIRCRAFT_RULES.factionCapacity) return 'Launch site or aircraft capacity reached';
    const cost=aircraftRecruitmentCost(kind),rejection=costRejection(player,this.supply.inventories[player.id],cost);
    if(rejection)return rejection;
    spend(player,this.supply.inventories[player.id],cost);
    this.world.recruitment.enqueue({playerId:player.id,buildingId:field.id,category:'aircraft',kind,definitionId:kind,cost:paidCost(player,cost),totalTicks:RECRUITMENT_SECONDS.aircraft*TICKS_PER_SECOND});
    return null;
  }
  completeAircraft(job:RecruitmentJob):boolean {
    const field=this.aviationBases().find(b=>b.id===job.buildingId&&b.playerId===job.playerId&&baseAccepts(b,job.kind as Aircraft['definitionId']));
    if(!field)return false;
    const age=aircraftRecruitmentAge(job.kind as Aircraft['definitionId'],field.age,t=>this.progression.has(job.playerId,t));
    if(!age)return false;
    this.aircraft.push({id:this.world.allocateId(),playerId:job.playerId,definitionId:job.kind as Aircraft['definitionId'],age,airfieldId:field.id,
      x:field.x,y:field.y,...(field.kind==='carrier'?{baseKind:'carrier' as const}:{}),health:AIRCRAFT_RULES.health,target:null,state:'ready',reloadTick:0,fuelTicks:flightTicks(job.kind as Aircraft['definitionId'],field.age)});
    return true;
  }
  private launch(
    player: Player,
    id: number,
    payload: "icbm" | "hydrogen" | "mirv",
    x: number,
    y: number,
    targetBuildingId?: number,
  ): string | null {
    if (targetBuildingId !== undefined) {
      const target = this.world.building(targetBuildingId);
      if (!target || (target.health ?? 1) <= 0 || target.playerId === 0 || this.diplomacy.allied(player.id, target.playerId))
        return "Choose an enemy building";
      x = ((target.tile % this.world.map.width()) + .5) * FIXED;
      y = (Math.floor(target.tile / this.world.map.width()) + .5) * FIXED;
    }
    if (
      !["icbm", "hydrogen", "mirv"].includes(payload) ||
      !this.validPosition(x, y) ||
      !this.progression.has(player.id, "modern-strategic-weapons")
    )
      return "Research Strategic Weapons and choose a valid target";
    const blocked = this.strikeRejection(player.id, x, y, STRATEGIC_PAYLOADS[payload].blastRadius, true);
    if (blocked) return blocked;
    const building = this.world.buildings.find(
      (b) =>
        b.id === id &&
        b.playerId === player.id &&
        !b.remainingTicks &&
        (b.health ?? 1) > 0 &&
        ((b.type === "missile-silo" && payload !== "mirv") ||
          (b.type === "mirv-launcher" && payload === "mirv")),
    );
    const unit = this.world.squads.find(
      (s) =>
        s.id === id &&
        s.playerId === player.id &&
        this.unit(s).role === "launcher" &&
        payload === "mirv" &&
        s.troops > 0 &&
        !s.refit && !s.manpower?.enlargement &&
        !s.fighting &&
        !s.charge &&
        s.order.type === "hold" &&
        !s.moved &&
        s.embarkedOn === null &&
        (s.deploymentTicks ?? 0) >= secondsToTicks(5),
    );
    const launcher = building ?? unit;
    if (!launcher)
      return "Choose a compatible ready launcher; mobile launchers must stand clear of combat for five seconds";
    const ready = building?.launchReadyTick ?? unit?.chargeReadyTick ?? 0;
    if (ready > this.world.tick) return "Launcher is reloading";
    const definition = STRATEGIC_PAYLOADS[payload];
    const cost = { gold: STRATEGIC_RULES.gold, items: { [`payload:${payload}`]: 1 } },
      rejection = costRejection(
        player,
        this.supply.inventories[player.id],
        cost,
      );
    if (rejection) return rejection;
    if (!this.battle.canFire(definition.warheads))
      return "Strategic flight capacity reached";
    spend(player, this.supply.inventories[player.id], cost);
    if (building) this.world.updateBuilding(building.id, { launchReadyTick: this.world.tick + STRATEGIC_RULES.reloadTicks });
    else this.world.updateSquad(unit!.id, { chargeReadyTick: this.world.tick + STRATEGIC_RULES.reloadTicks });
    const position = building ? this.battle.position(building) : unit!;
    this.battle.fire(
      {
        id,
        playerId: player.id,
        x: position.x,
        y: position.y,
        domain: building ? "building" : "squad",
      },
      { x, y },
      {
        channel: "ranged",
        damage: definition.damage,
        range: 0,
        reloadTicks: STRATEGIC_RULES.reloadTicks,
        movingReloadPercent: 100,
        bonuses: { structure: 10000, wall: 10000 },
        penetration: 5000,
        targets: [
          "infantry",
          "ranged",
          "mounted",
          "vehicle",
          "siege",
          "ship",
          "structure",
          "wall",
        ],
        projectile: {
          diameter: FIXED / 2,
          speed: STRATEGIC_RULES.speed,
          blastRadius: definition.blastRadius,
        },
      },
      definition.damage,
      payload === "mirv" ? "mirv" : "icbm",
      undefined,
      definition.warheads,
      payload,
      targetBuildingId,
    );
    return null;
  }
  private thinkPeace(player:Player):void {
    const {world,diplomacy}=this;
    const own=world.squadFacts().aliveByOwner(player.id).reduce((n,s)=>n+s.troops,0);
    const operation = this.operations.state(player.id);
    const campaignContext = `${operation?.phase}:${operation?.since}:${operation?.intent?.motive}:${operation?.intent?.goal}`;
    const willingness = new Map<number, boolean>();
    const willing=(other:Player)=>{
      if (!willingness.has(other.id)) willingness.set(other.id, this.operations.willingPeace(player, other));
      return willingness.get(other.id)!;
    };
    for(const offer of [...diplomacy.state.offers])if(offer.kind==="peace"&&offer.recipient===player.id){
      const other=world.players.find(p=>p.id===offer.proposer);if(!other)continue;
      this.command(player,{type:"alliance",playerId:player.id,otherId:other.id,action:willing(other)?"accept-peace":"reject-peace"});
    }
    for(const other of world.players)if(other.id!==player.id&&!other.eliminated&&diplomacy.hostile(player.id,other.id)&&willing(other)){
      const enemy=world.squadFacts().aliveByOwner(other.id).reduce((n,s)=>n+s.troops,0);
      const context=`${campaignContext}:${diplomacy.declaredWar(player.id,other.id)}:${Math.floor(own/100)}:${Math.floor(enemy/100)}:${Math.floor(player.land/100)}:${Math.floor(other.land/100)}`;
      const result=diplomacy.action(player,other,"offer-peace",world.tick,context);
      if(!result)this.announce({kind:"diplomacy",actorId:player.id,otherId:other.id,action:"offer-peace"});
    }
  }
  beforeStep(): void {
    this.features.step();
    const { world } = this;
    for (const id of this.tribePlans.keys()) if (!world.players.some(p => p.id === id && p.kind === "tribe" && !p.eliminated)) this.tribePlans.delete(id);
    const researched = world.players.map((p) => this.progression.states[p.id]?.completed.length ?? 0);
    this.progression.step(world.players, (player, age) =>
      this.announce({ kind: "age", actorId: player.id, age }),
    );
    world.players.forEach((p, i) => {
      const completed = this.progression.states[p.id]?.completed;
      if (completed && completed.length !== researched[i])
        this.rescaleShipHealth(p.id, completed.slice(0, researched[i]));
    });
    this.automaticTiers.step(world.players, this.progression.states, world.buildingFacts(),
      (id, patch) => {
        const building = world.buildings.find(b => b.id === id);
        if (building?.type === "armory" && patch.type === "arms-factory") {
          const priorities = this.supply.priorities[building.playerId];
          if (priorities?.armory && priorities["arms-factory"] === undefined)
            priorities["arms-factory"] = [...priorities.armory];
        }
        return world.updateBuilding(id, patch);
      });
    const treaties = [...this.diplomacy.state.alliances];
    this.diplomacy.step(world.tick, world.players);
    for (const treaty of treaties)
      if (treaty.expiresTick <= world.tick)
        this.announce({
          kind: "diplomacy",
          actorId: treaty.a,
          otherId: treaty.b,
          action: "expire",
        });
    this.fortifications.step(world.tick, world.buildings,
      (id, health) => world.updateBuilding(id, { health }));
    this.trenches.step();
    this.skirmish.step();
    this.supply.step(world.tick, world.players, world.buildings, world.owners, world.squads,
      {buildings: world.buildingFacts(), squads: world.squadFacts()});
    for (const s of world.ships) {
      if (!s.refit) continue;
      const remainingTicks = s.refit.remainingTicks - 1;
      if (remainingTicks > 0) {
        world.updateShip(s.id, { refit: { ...s.refit, remainingTicks } });
        continue;
      }
      // A refit keeps the hull's share of health (R2-M14 / N10): a half-repaired
      // hull comes out half-repaired at the new class's maximum.
      const target = VESSEL.get(s.refit.targetId),
        oldMax = this.vessel(s).health,
        newMax = target ? this.vesselMaxHealth(s.playerId, target) : oldMax;
      world.updateShip(s.id, { definitionId: s.refit.targetId, xp: 0, refit: null,
        health: rescaledHullHealth(s.health, oldMax, newMax) });
    }
    for (const s of world.squads) {
      const enlargement=s.manpower?.enlargement;
      if(enlargement) {
        if(s.fighting||s.embarkedOn!==null||s.afloat||world.owners[world.tileOf(s)]!==s.playerId){this.command(world.players.find(p=>p.id===s.playerId)!,{type:'cancel-enlarge',playerId:s.playerId,squadIds:[s.id]});continue;}
        if(enlargement.remainingTicks<=1 && world.canDeploy && !world.canDeploy(s,s.troops+enlargement.added))continue;
        const remainingTicks=enlargement.remainingTicks-1;
        world.updateSquad(s.id,{...(remainingTicks<=0?{troops:s.troops+enlargement.added}:{}),manpower:{...s.manpower!,...(remainingTicks<=0?{capacity:enlargement.targetCapacity,variant:'enlarged',revision:s.manpower!.revision+1,enlargement:null}:{enlargement:{...enlargement,remainingTicks}})}});
        continue;
      }
      if (s.refit) {
        if(s.fighting || s.moved || s.embarkedOn!==null || s.afloat || world.owners[world.tileOf(s)]!==s.playerId) continue;
        const remainingTicks = s.refit.remainingTicks - 1;
        if (remainingTicks <= 0) {
          const target = UNIT.get(s.refit.targetId)!;
          const variant=s.refit.recipeVariant??'base';
          const manpower=createManpower(target,variant),retained=Math.min(s.troops,manpower.capacity),surplus=s.troops-retained;
          if(world.canDeploy && !world.canDeploy(s,retained,target.id))continue;
          const player=world.players.find(p=>p.id===s.playerId)!;
          if(s.manpower?.model==='soldiers'){player.reserves+=surplus;manpower.wounds=Math.min(manpower.hp-1,Math.ceil(s.manpower.wounds*manpower.hp/s.manpower.hp));}
          else if(s.manpower)manpower.hullHealth=Math.floor((s.manpower.hullHealth??s.manpower.hp)*manpower.hp/s.manpower.hp);
          manpower.revision=(s.manpower?.revision??0)+1;
          if(this.unit(s).tags.includes('mounted')&&surplus)this.supply.inventories[s.playerId].horses=(this.supply.inventories[s.playerId].horses??0)+surplus;
          world.updateSquad(s.id, { definitionId: target.id, kind: target.line, troops:retained,manpower,xp: 0, nextAttackTick:Math.max(world.tick,s.nextAttackTick??0),refit: null });
        } else world.updateSquad(s.id, { refit: { ...s.refit, remainingTicks } });
      }
      if (s.charge?.phase === "preparing" && isCavalryTroopClass(this.unit(s).troopClass)) {
        world.updateSquad(s.id,{charge:{...s.charge,phase:'approach'}});
      }
      if (s.charge?.phase === "preparing" && chargeAligned(s) && (s.locomotion?.speed ?? 0) === 0 &&
        world.tick - s.charge.startTick >= FORMATION_MOTION.prepareTicks) {
        world.updateSquad(s.id, { charge: { ...s.charge, phase: "approach", startTick: world.tick } });
      }
      const rushTarget=s.charge?.phase==='approach' && isCavalryTroopClass(this.unit(s).troopClass) && s.charge.targetId!==undefined?world.squad(s.charge.targetId):undefined;
      const rushContact=!!rushTarget && this.diplomacy.hostile(s.playerId,rushTarget.playerId) && formationContact(s,rushTarget,world.tick).gap<=CONTACT.release;
      if (
        s.charge?.phase === "approach" &&
        (rushContact || world.tick - s.charge.startTick >= this.unit(s).charge!.runupTicks &&
          (!world.options?.formationLocomotion || (chargeAligned(s) && s.moved && (s.locomotion?.speed ?? 0)>0)))
      ) {
        world.updateSquad(s.id, {
          charge: { ...s.charge, phase: "committed", committedTick: world.tick,
          },
          chargeReadyTick: world.tick + this.unit(s).charge!.cooldownTicks,
        });
      }
    }
    this.modernization.clean(world.squads, world.tick);
    this.economy.step();
    if (world.options?.runAi !== false)
      this.thinkProgression();
  }
  afterMovement(): void {
    for (const s of this.world.squads)
      if (this.unit(s).role === "launcher")
        this.world.updateSquad(s.id, { deploymentTicks: s.troops > 0 &&
          !s.refit && !s.manpower?.enlargement &&
          !s.charge &&
          s.embarkedOn === null &&
          !s.moved &&
          !s.fighting &&
          s.order.type === "hold"
            ? Math.min(secondsToTicks(5), (s.deploymentTicks ?? 0) + 1)
            : 0 });
    this.advanceAircraft();
    this.trade.step();
    this.battle.advanceProjectiles(this.aircraft);
    this.trade.removeRetired();
    for (let i = this.world.buildings.length - 1; i >= 0; i--)
      if ((this.world.buildings[i].health ?? 1) <= 0)
        this.world.removeBuilding(this.world.buildings[i].id);
    for (let i = this.aircraft.length - 1; i >= 0; i--)
      if (
        this.aircraft[i].health <= 0 ||
        this.world.players.find((p) => p.id === this.aircraft[i].playerId)
          ?.eliminated
      )
        this.aircraft.splice(i, 1);
  }
  private advanceAircraft(): void {
    const targets=this.airTargets??=new SpatialGrid<Aircraft>(this.world.map.width()*FIXED,this.world.map.height()*FIXED,8*FIXED,a=>a.playerId);
    targets.rebuild(this.aircraft.filter(a=>a.health>0&&a.state!=="ready"));
    const bases=new Map(this.aviationBases(false).map(b=>[b.id,b]));
    // Naval rockets use an independent AA reload and the ordinary authoritative projectile lifecycle.
    for(const ship of this.world.ships) {
      if(ship.health<=0 || ship.kind!=="warship" || !this.progression.has(ship.playerId,"rus-modern-naval-missiles-air-defence") || this.world.tick<(ship.airDefenseTick??0))continue;
      targets.query(ship.x,ship.y,12*FIXED,this.nearbyAircraft);
      const target=this.nearbyAircraft.filter(a=>a.health>0&&this.diplomacy.hostile(ship.playerId,a.playerId)).sort((a,b)=>(a.x-ship.x)**2+(a.y-ship.y)**2-((b.x-ship.x)**2+(b.y-ship.y)**2)||a.id-b.id)[0];
      if(!target)continue;
      if(this.battle.fire({...ship,domain:"ship"},target,NAVAL_AIR_ATTACK,200,"shell",secondsToTicks(.5),0,"naval-air-defence",undefined,target.id)) {
        this.world.updateShip(ship.id,{airDefenseTick:this.world.tick+secondsToTicks(2)});
      }
    }
    for(const b of this.world.buildings) {
      if(b.type!=="anti-air-emplacement"||b.remainingTicks||(b.health??1)<=0||this.world.tick<(b.nextAttackTick??0))continue;
      const point=this.battle.position(b);targets.query(point.x,point.y,NAVAL_AIR_ATTACK.range,this.nearbyAircraft);
      const target=this.nearbyAircraft.filter(a=>a.health>0&&this.diplomacy.hostile(b.playerId,a.playerId)).sort((a,c)=>(a.x-point.x)**2+(a.y-point.y)**2-((c.x-point.x)**2+(c.y-point.y)**2)||a.id-c.id)[0];
      if(!target)continue;
      if(this.battle.fire({id:b.id,playerId:b.playerId,...point,domain:"building"},target,NAVAL_AIR_ATTACK,200,"shell",secondsToTicks(.5),0,"naval-air-defence",undefined,target.id)) {
        this.world.updateBuilding(b.id,{nextAttackTick:this.world.tick+NAVAL_AIR_ATTACK.reloadTicks});
        this.world.volleys.push({id:this.world.allocateId(),squadId:b.id,playerId:b.playerId,definitionId:"naval-air-defence",tick:this.world.tick,fromX:point.x,fromY:point.y,toX:target.x,toY:target.y});
      }
    }
    // Fighter guns target start-of-tick health and land together after every
    // aircraft has acted, so creation order never decides a mirrored duel (R2-L8, C2).
    const startHealth=new Map(this.aircraft.map(a=>[a.id,a.health]));
    const gunHits=new Map<number,{target:Aircraft;hits:{playerId:number;damage:number}[]}>();
    for (const a of this.aircraft) {
      if (a.health <= 0) continue;
      if(a.definitionId==="drone" && a.drone && a.state!=="ready"){this.advanceDrone(a);continue;}
      if (a.state === "transferring" && a.transfer) {
        this.advanceTransfer(a);
        continue;
      }
      const base=bases.get(a.airfieldId);
      if(!base || base.playerId!==a.playerId || !baseAccepts(base,a.definitionId)) {
        if(a.state==='ready' || a.definitionId==='drone' || a.baseKind!=='carrier'){a.health=0;continue;}
        a.state='transferring';a.transfer={destinationId:-1};this.advanceTransfer(a);continue;
      }
      if (a.definitionId === "fighter" && a.state !== "ready") {
        targets.query(a.x,a.y,8*FIXED,this.nearbyAircraft);
        const enemy = this.nearbyAircraft
          .filter(
            (t) =>
              t.id !== a.id && (startHealth.get(t.id) ?? t.health) > 0 && t.state !== "ready" && this.diplomacy.hostile(a.playerId, t.playerId) &&
              (t.x - a.x) ** 2 + (t.y - a.y) ** 2 < (8 * FIXED) ** 2,
          )
          .sort((b, c) => Number(c.definitionId === "bomber") - Number(b.definitionId === "bomber") || b.id - c.id)[0];
        if (enemy && this.world.tick >= a.reloadTick) {
          const staged = gunHits.get(enemy.id) ?? { target: enemy, hits: [] };
          const health = (startHealth.get(enemy.id) ?? enemy.health) - staged.hits.reduce((n, h) => n + h.damage, 0);
          staged.hits.push({ playerId: a.playerId, damage: 200 });
          gunHits.set(enemy.id, staged);
          if (this.world.volleys.length < 4096) this.world.volleys.push({id:this.world.allocateId(),tick:this.world.tick,squadId:a.id,playerId:a.playerId,definitionId:"fighter-guns",fromX:a.x,fromY:a.y,toX:enemy.x,toY:enemy.y,sourceKind:"aircraft",targetKind:"aircraft",targetId:enemy.id,damage:Math.max(0,Math.min(200,health))});
          a.reloadTick = this.world.tick + secondsToTicks(2);
        }
      }
      if(a.state === "ready") {a.x=base.x;a.y=base.y;a.fuelTicks=flightTicks(a.definitionId,this.progression.has(a.playerId,"rus-modern-airfields") ? "Modern" : a.age??base.age??"EarlyModern");a.flightBudgetTicks=a.fuelTicks;continue;}
      if (!a.target) continue;
      if(a.state !== "returning") {if(a.fuelTicks<=0)a.state="returning";else a.fuelTicks--;}
      if(a.state === "patrolling") {
        // Pursue contacts inside the assigned patrol area; otherwise maintain a continuous orbit.
        targets.query(a.target.x,a.target.y,24*FIXED,this.nearbyAircraft);
        const contact=this.nearbyAircraft.filter(t=>t.health>0&&t.playerId!==a.playerId&&this.diplomacy.hostile(a.playerId,t.playerId)&&(t.x-a.target!.x)**2+(t.y-a.target!.y)**2<=(24*FIXED)**2)
          .sort((b,c)=>Number(c.definitionId==="bomber")-Number(b.definitionId==="bomber") || (b.x-a.x)**2+(b.y-a.y)**2-((c.x-a.x)**2+(c.y-a.y)**2)||b.id-c.id)[0];
        const phase=this.world.tick*flightSpeed(a.definitionId)/(4*FIXED)+a.id*1.7;
        const goalX=Math.max(1,Math.min(this.world.map.width()*FIXED-1,contact?.x ?? a.target.x+Math.cos(phase)*4*FIXED));
        const goalY=Math.max(1,Math.min(this.world.map.height()*FIXED-1,contact?.y ?? a.target.y+Math.sin(phase)*4*FIXED));
        const dx=goalX-a.x,dy=goalY-a.y;
        const d=Math.hypot(dx,dy),speed=flightSpeed(a.definitionId);
        if(d>0){a.x+=Math.round(dx*Math.min(1,speed/d));a.y+=Math.round(dy*Math.min(1,speed/d));}
        continue;
      }
      const speed=flightSpeed(a.definitionId);
      const goal =
          a.state === "returning" ? {x:base.x,y:base.y} : a.target,
        dx = goal.x - a.x,
        dy = goal.y - a.y,
        distance = Math.hypot(dx, dy);
      if (distance > speed) {
        a.x += Math.round((dx * speed) / distance);
        a.y += Math.round((dy * speed) / distance);
        continue;
      }
      a.x = goal.x;
      a.y = goal.y;
      if (a.state === "returning") {
        a.state = "ready";
        a.target = null;
        if(a.atomicPayload) {this.supply.inventories[a.playerId]["payload:atomic"]=(this.supply.inventories[a.playerId]["payload:atomic"]??0)+1;a.atomicPayload=false;}
        a.fuelTicks=flightTicks(a.definitionId,this.progression.states[a.playerId].completed.includes("rus-modern-airfields")?"Modern":a.age??base.age??"EarlyModern");
      } else {
        if(a.definitionId === "fighter") {a.state="patrolling";continue;}
        if (a.definitionId === "bomber" || a.definitionId === "drone") {
          const fired=this.battle.fire(
            { ...a, domain: "aircraft" },
            a.target,
            a.mission === "atomic" ? ATOMIC_ATTACK : a.definitionId === "drone" ? DRONE_ATTACK : BOMBER_ATTACK,
            a.mission === "atomic" ? 24000 : a.definitionId === "drone" ? 10000 : BOMBER_ATTACK.damage,
            "bomb",
            TICKS_PER_SECOND,
            0,
            a.mission === "atomic" ? "atomic" : "bomb",
          );
          if(!fired)continue;
          a.atomicPayload=false;
        }
        if(a.definitionId === "drone") {a.health=0;continue;}
        a.state = "returning";
      }
    }
    for (const id of [...gunHits.keys()].sort((a, b) => a - b)) {
      const { target, hits } = gunHits.get(id)!;
      if (target.health <= 0) continue;
      const health = target.health, damage = new DamageLedger();
      for (const hit of hits) {
        const dealt = Math.min(hit.damage, Math.max(0, target.health));
        target.health -= hit.damage;
        if (dealt > 0) damage.add(target.id, hit.playerId, dealt);
      }
      if (health > 0 && target.health <= 0) this.world.recordMilitaryLosses([target], damage);
    }
  }
  private lodgedTarget(s:Squad,targetId:number):boolean {
    const target=this.world.squad(targetId);
    return !!target && target.troops>0 && this.diplomacy.hostile(s.playerId,target.playerId) &&
      formationContact(s,target,this.world.tick).gap<=CAVALRY_ENGAGEMENT_REACH;
  }
  private advanceTransfer(a:Aircraft):void {
    const transfer=a.transfer!,bases=this.aviationBases().filter(b=>b.playerId===a.playerId&&baseAccepts(b,a.definitionId));
    let destination=bases.find(b=>b.id===transfer.destinationId);
    if(!destination) {
      destination=bases.filter(b=>airfieldAircraftCount(this.aircraft,b.id)+this.world.recruitment.count(a.playerId,'aircraft',b.id)<b.capacity)
        .sort((b,c)=>(b.x-a.x)**2+(b.y-a.y)**2-((c.x-a.x)**2+(c.y-a.y)**2)||b.id-c.id)[0];
      if(!destination){a.health=0;return;}
      transfer.destinationId=destination.id;
    }
    a.fuelTicks=Math.max(0,a.fuelTicks-1);
    a.target={x:destination.x,y:destination.y};
    const dx=destination.x-a.x,dy=destination.y-a.y,distance=Math.hypot(dx,dy),speed=flightSpeed(a.definitionId);
    if(distance>speed){a.x+=Math.round(dx*speed/distance);a.y+=Math.round(dy*speed/distance);return;}
    a.x=destination.x;a.y=destination.y;a.airfieldId=destination.id;a.state='ready';a.target=null;delete a.transfer;
    if(destination.kind==='carrier')a.baseKind='carrier';else delete a.baseKind;
    a.fuelTicks=flightTicks(a.definitionId,this.progression.has(a.playerId,'rus-modern-airfields')?'Modern':a.age??destination.age);
    a.flightBudgetTicks=a.fuelTicks;
    if(a.atomicPayload){this.supply.inventories[a.playerId]['payload:atomic']=(this.supply.inventories[a.playerId]['payload:atomic']??0)+1;a.atomicPayload=false;}
  }

  private thinkProgression(): void {
    for (const player of this.world.players) {
      if (
        !player.ai ||
        player.eliminated ||
        this.world.tick % secondsToTicks(3) !== progressionStagger(player.id)
      )
        continue;
      if (player.kind === "tribe") {
        if(this.diplomacy.raids)this.thinkPeace(player);
        this.thinkTribeDevelopment(player);
        continue;
      }
      const state = this.progression.states[player.id];
      const personality = personalityOf(player);
      if(this.diplomacy.raids)this.thinkPeace(player);
      if (!this.economy.enabled(player)) {
      if (
        !advanceRejection(state, availableGold(player), this.progression.technologySpeed, this.progression.maximumAge)
      )
        this.world.applyCommand({ type: "advance-age", playerId: player.id });
      for (const tree of personality.researchOrder) {
        const next = TECHNOLOGIES.find(
          (t) =>
            t.tree === tree &&
            !researchRejection(
              state,
              availableGold(player),
              t.id,
              this.progression.technologySpeed,
            ),
        );
        if (next)
          this.world.applyCommand({
            type: "research",
            playerId: player.id,
            technologyId: next.id,
          });
      }
      const own = this.world.buildingFacts().byOwner(player.id);
      const squadCount = this.world.squadFacts().byOwner(player.id).length;
      // Nearest owned land is order-independent (it is derived from ownership),
      // so checkpoints never need the per-player tile sets.
      let nearestOwned: number[] | undefined;
      // Supply applies the same automatic allocation to humans and AI.
      for (const type of buildingPriority(personality, [
        "city",
        "barracks",
        "factory",
        "mine",
        "archery",
        "stables",
        "blacksmith",
        "armory",
        "arms-factory",
        "siege-workshop",
        "depot",
        "port",
        "oil-well",
        "oil-rig",
        "airstrip",
        "nuclear-facility",
        "drone-facility",
        "missile-defence",
        "missile-silo",
        "mirv-launcher",
      ])) {
        const extraction = type === "mine" || type === "oil-well" || type === "oil-rig";
        if (
          !extraction &&
          own.filter((b) => b.type === type && b.age === state.age).length >=
            economicBuildingTarget(
              personality,
              type,
              squadCount,
            )
        )
          continue;
        const tech = buildingTechnology(type, state.age);
        if (!tech || !this.progression.has(player.id, tech)) continue;
        // Location-independent affordability precedes every location search.
        // These types do not generate walls; final commands still own payment.
        if (costRejection(player, this.supply.inventories[player.id],
          buildingCost(type, state.age, own.filter((b) => b.type === type).length))) continue;
        const candidates =
          extraction
            ? this.supply.deposits
                .filter(
                  (d) =>
                    d.owner === player.id &&
                    (d.resource !== "stone" || stoneExtractionAllowed(own)) &&
                    !own.some((b) => b.tile === d.tile && b.type === type),
                )
                .sort((a,b) => extractionPriority(a.resource) - extractionPriority(b.resource) || a.tile - b.tile)
                .map((d) => d.tile)
            : (nearestOwned ??= this.world.ownedLandNearest(
                player.id,
                player.base,
                256,
              )).slice();
        for (const tile of (extraction ? candidates : candidates.sort(
          (a, b) =>
            this.world.map.euclideanDistSquared(a, player.base) -
              this.world.map.euclideanDistSquared(b, player.base) || a - b,
        )))
          if (
            this.economy.recovery.canBuild(player.id,type,tile) &&
            this.world.applyCommand({
              type: "build",
              playerId: player.id,
              buildingType: type,
              tile,
            }) === null
          )
            break;
      }
      this.thinkCapabilities(player);
      }
      this.thinkAirAndStrategic(player);
      for (const offer of this.diplomacy.state.offers.filter(
        (o) => o.recipient === player.id && o.kind!=="peace",
      )) {
        const proposer = this.world.players.find(
          (p) => p.id === offer.proposer,
        )!;
        const accept = acceptsAlliance(
          personality,
          player,
          proposer,
          this.diplomacy.state.alliances.filter(
            (t) => (t.a === player.id || t.b === player.id) && t.a !== proposer.id && t.b !== proposer.id,
          ).length,
          (this.diplomacy.state.betrayal[proposer.id] ?? 0) > this.world.tick,
        );
        this.world.applyCommand({
          type: "alliance",
          playerId: player.id,
          otherId: proposer.id,
          action: accept ? "accept" : "reject",
        });
      }
      if (this.victoryMode === "allied")
        for (const treaty of this.diplomacy.state.alliances.filter(
          (t) => t.a === player.id || t.b === player.id,
        ))
          if (!treaty.longTerm && treaty.expiresTick - this.world.tick <= secondsToTicks(30))
            this.world.applyCommand({
              type: "alliance",
              playerId: player.id,
              otherId: treaty.a === player.id ? treaty.b : treaty.a,
              action: "renew",
            });
      // Proactive coalitions only in allied-conquest matches. Solo opponents
      // still respond to offers, but do not create new conquest deadlocks.
      const interval = personality.diplomacy.offerIntervalTicks;
      if (
        this.victoryMode === "allied" &&
        interval &&
        this.world.tick >= secondsToTicks(90) &&
        Math.floor(this.world.tick / secondsToTicks(3)) % (interval / secondsToTicks(3)) ===
          player.id % (interval / secondsToTicks(3)) &&
        !this.diplomacy.state.offers.some((o) => o.proposer === player.id)
      ) {
        const allies = this.diplomacy.state.alliances.filter(
          (t) => t.a === player.id || t.b === player.id,
        ).length;
        const partner = this.world.players
          .filter(
            (p) =>
              p.id !== player.id &&
              this.diplomacy.aiOfferAvailable(p.id, this.world.tick) &&
              this.geography.eligible(player, p) &&
              !this.diplomacy.allied(player.id, p.id) &&
              acceptsAlliance(
                personality,
                player,
                p,
                allies,
                (this.diplomacy.state.betrayal[p.id] ?? 0) > this.world.tick,
              ),
          )
          .sort(
            (a, b) =>
              this.world.map.euclideanDistSquared(player.base, a.base) -
                this.world.map.euclideanDistSquared(player.base, b.base) ||
              a.id - b.id,
          )[0];
        if (partner)
          this.world.applyCommand({
            type: "alliance",
            playerId: player.id,
            otherId: partner.id,
            action: "offer",
          });
      }
    }
  }
  private thinkTribeDevelopment(player: Player): void {
    const state = this.progression.states[player.id];
    const militarizing = this.operations.promotionPressure(player.id);
    const objective = this.operations.recruitmentObjective(player.id);
    const force = this.world.squadFacts().aliveByOwner(player.id).length + this.world.recruitment.byOwner(player.id).filter(j => j.category === "land").length;
    const recruit = militarizing && force < (objective?.squads ?? this.world.squadCapacity(player))
      ? this.recruitment({ ...player, gold: Number.MAX_SAFE_INTEGER }, "infantry") : undefined;
    // Retain one actually producible recruit's gold. Missing equipment must not
    // reserve funds away from the infrastructure needed to make that equipment.
    const heldGold = recruit ? scaledRecipeCost(recruit.unit, recruitmentVariant(recruit.unit.id, state.completed)).gold ?? 0 : 0;
    const developmentGold = () => Math.max(0, availableGold(player) - heldGold);
    if (!tribeAdvanceRejection(player, this.world.players, this.progression.states) &&
        !advanceRejection(state, developmentGold(), this.progression.technologySpeed, this.progression.maximumAge, "tribe"))
      this.world.applyCommand({ type: "advance-age", playerId: player.id });
    const technologies = militarizing ? TRIBE_MILITARY_TECHNOLOGIES : TECHNOLOGIES;
    const next = technologies.find(t => t.age === state.age &&
      !researchRejection(state, developmentGold(), t.id, this.progression.technologySpeed));
    if (next) this.world.applyCommand({ type: "research", playerId: player.id, technologyId: next.id });
    const own = this.world.buildingFacts().byOwner(player.id);
    const mined = tribeMineCounts(own,t => this.supply.resourceSites.at(t)?.resource);
    // Coastal tribes fund one useful sea entrance before additional land capacity.
    const coastal = this.economy.placements.coasts(player.id);
    if(!militarizing && coastal.length && !own.some(b=>b.type==="port") && state.completed.includes(buildingTechnology("port",state.age)!)) {
      const site=coastal.slice(0,8).find(tile=>this.economy.recovery.canBuild(player.id,"port",tile) &&
        this.world.buildingSite(player.id,"port",tile,state.age)===null);
      if(site!==undefined && this.world.applyCommand({type:"build",playerId:player.id,buildingType:"port",tile:site,age:state.age})===null)return;
    }
    const plan = this.tribePlans.get(player.id) ?? { nextType: 0, tiles: {}, landAfter: {} as Partial<Record<BuildingType,number>> };
    this.tribePlans.set(player.id, plan);
    // One type and at most sixteen legal site attempts per strategic pass.
    const order = militarizing ? TRIBE_MILITARY_BUILDING_ORDER : TRIBE_BUILDING_ORDER;
    for (let checked = 0; checked < order.length; checked++) {
      const type = order[plan.nextType++ % order.length];
      plan.nextType %= order.length;
      const count = own.filter(b => b.type === type).length;
      const technology = buildingTechnology(type, state.age);
      if ((type !== "mine" && count >= tribeBuildingLimit(type, state.age)) || !technology ||
          !state.completed.includes(technology) ||
          costRejection({ ...player, gold: developmentGold() }, this.supply.inventories[player.id], buildingCost(type, state.age, count))) continue;
      const extraction = type === "mine" || type === "oil-well" || type === "oil-rig";
      // Tribes use distinct extractor sites and share the authoritative
      // per-resource mine cap, including already-paid foundations.
      const candidates = type === "port" ? this.economy.placements.coasts(player.id) : extraction
        ? this.supply.deposits.filter(d => this.world.owners[d.tile] === player.id && resourceVisibleAtAge(d.resource, state.age) &&
          (d.resource !== "stone" || stoneExtractionAllowed(own)) && !own.some(b => b.tile === d.tile) &&
          (type === "mine" ? !["oil","horses"].includes(d.resource) && (mined.get(d.resource)??0) < tribeBuildingLimit("mine",state.age) : d.resource === "oil"))
          .sort((a,b) => extractionPriority(a.resource) - extractionPriority(b.resource) || a.tile - b.tile).map(d => d.tile)
        : this.world.ownedLandNearest(player.id, player.base, 256, plan.landAfter?.[type]);
      if (!candidates.length) {
        // Restart a completed traversal so newly acquired nearer land is not
        // permanently skipped. Older checkpoints begin with the first page.
        if (type !== "port" && !extraction && plan.landAfter) { delete plan.landAfter[type]; plan.tiles[type]=0; }
        continue;
      }
      for (let i = 0; i < Math.min(16, candidates.length); i++) {
        const cursor = plan.tiles[type] ?? 0;
        plan.tiles[type] = (cursor + 1) % candidates.length;
        const finishedPage = type !== "port" && !extraction && plan.tiles[type] === 0;
        if (finishedPage) (plan.landAfter ??= {})[type] = candidates[candidates.length-1];
        const tile = candidates[cursor % candidates.length];
        if (this.economy.recovery.canBuild(player.id,type,tile) &&
          this.world.applyCommand({ type: "build", playerId: player.id,
            buildingType: type, tile, age: state.age }) === null) return;
        if (finishedPage) break;
      }
      return;
    }
  }
  private thinkCapabilities(player: Player): void {
    const personality = personalityOf(player);
    const force = new AiForceInventory(player.id, this.world.squadFacts().byOwner(player.id), this.world.recruitment.byOwner(player.id));
    const own = this.world.buildingFacts().byOwner(player.id).filter(b => !b.remainingTicks),
      squads = this.world.squadFacts().byOwner(player.id).filter(s => s.embarkedOn === null),
      stock = this.supply.inventories[player.id];
    this.modernization.reserve(
      player,
      squads,
      this.progression.states[player.id].completed,
      stock,
      this.world.tick,
    );
    let rally: number | undefined;
    for (const squad of squads) {
      const lease = this.modernization.leases.get(squad.id);
      if (!lease || squad.refit) continue;
      if (squad.fighting || this.world.owners[this.world.tileOf(squad)] !== player.id) {
        if (rally === undefined) {
          if (this.world.owners[player.base] === player.id) rally = player.base;
          else {
            let bestDistance = Infinity;
            for (const tile of this.world.ownedLand(player.id)) {
              const distance = this.world.map.euclideanDistSquared(
                tile,
                player.base,
              );
              if (
                distance < bestDistance ||
                (distance === bestDistance && tile < (rally ?? Infinity))
              ) {
                rally = tile;
                bestDistance = distance;
              }
            }
          }
        }
        if (
          rally !== undefined &&
          (squad.order.type !== "move" || squad.order.tile !== rally)
        )
          this.world.applyCommand({
            type: "order",
            playerId: player.id,
            squadIds: [squad.id],
            order: { type: "move", tile: rally },
          });
      } else if (!squad.moved && !squad.fighting) {
        this.world.applyCommand({
          type: "refit",
          playerId: player.id,
          squadIds: [squad.id],
          definitionId: lease.targetId,
        });
      } else if (squad.order.type !== "hold") {
        this.world.applyCommand({
          type: "order",
          playerId: player.id,
          squadIds: [squad.id],
          order: { type: "hold" },
        });
      }
    }
    for (const u of UNITS.filter(
      (u) =>
        !["frontline", "ranged", "mounted"].includes(u.role) &&
        this.progression.has(player.id, u.technologyId),
    )
      .slice()
      .reverse()) {
      if (
        force.role(u.role) >=
          (["siege", "artillery"].includes(u.role)
            ? personality.siegeCopies
            : 2) ||
        costRejection(player, stock, u.cost)
      )
        continue;
      const b = own.find(
        (b) =>
          b.type === u.building &&
          AGES.indexOf(b.age ?? "StoneAge") >= AGES.indexOf(u.age),
      );
      if (b) {
        this.world.applyCommand({
          type: "recruit",
                autoRecruit: true,
          playerId: player.id,
          buildingId: b.id,
          definitionId: u.id,
        });
        break;
      }
    }
    for (const s of squads.filter(
      (s) =>
        this.unit(s).attack.bonuses.structure &&
        !s.refit && !s.manpower?.enlargement &&
        !this.modernization.holds(s.id),
    )) {
      const target = this.world.buildings
        .filter(
          (b) =>
            this.diplomacy.hostile(player.id, b.playerId) &&
            (b.health ?? 1) > 0,
        )
        .sort(
          (a, b) =>
            this.world.map.euclideanDistSquared(this.world.tileOf(s), a.tile) -
              this.world.map.euclideanDistSquared(
                this.world.tileOf(s),
                b.tile,
              ) || a.id - b.id,
        )[0];
      // Keep the current approach (or firing position) when the same live,
      // hostile structure remains best. Reissuing resets its path every think.
      if (target && s.structureTarget?.buildingId !== target.id)
        this.world.applyCommand({
          type: "attack-structure",
          playerId: player.id,
          squadIds: [s.id],
          buildingId: target.id,
        });
    }
    for (const kind of ["warship"] as const) {
      const count = this.world.shipFacts().byKind(player.id, kind).length + force.queuedShips(kind);
      if (
        count >=
        Math.min(
          32,
          Math.max(
            1,
            Math.ceil(
              squads.length /
                (kind === "warship" ? personality.squadsPerWarship : 16),
            ),
          ),
        )
      )
        continue;
      for (const v of aiVesselPreference(VESSELS.filter(
        (v) =>
          v.kind === kind && this.progression.has(player.id, v.technologyId),
      ))) {
        const port = own.find(
          (b) =>
            b.type === "port" &&
            AGES.indexOf(b.age ?? "StoneAge") >= AGES.indexOf(v.age),
        );
        if (port && !costRejection(player, stock, v.cost)) {
          this.world.applyCommand({
            type: "recruit-ship",
                autoRecruit: true,
            playerId: player.id,
            buildingId: port.id,
            shipType: kind,
            definitionId: v.id,
          });
          break;
        }
      }
    }
  }
  private thinkAirAndStrategic(player: Player): void {
    const own=this.world.buildingFacts().byOwner(player.id).filter(b=>!b.remainingTicks && (b.health ?? 1)>0);
    const squads=this.world.squadFacts().aliveByOwner(player.id);
    const force=new AiForceInventory(player.id,squads,this.world.recruitment.byOwner(player.id));
    const stock=this.supply.inventories[player.id];
    const atWar=(id:number)=>this.diplomacy.hostile(player.id,id) &&
      (this.diplomacy.declaredWar(player.id,id) || this.operations.offensiveTarget(player.id)===id);
    const enemies=this.world.squads.filter(s=>s.troops>0 && s.embarkedOn===null && atWar(s.playerId));
    const plannedAircraft = new Map<string, number>();
    for (const base of own.filter((b) => b.type === "airstrip" || b.type === "drone-facility"))
      for (const definitionId of (base.type === "drone-facility" ? ["drone"] : ["fighter","bomber"]) as Aircraft["definitionId"][])
        if (
          this.aircraft.filter(
            (a) => a.playerId === player.id && a.definitionId === definitionId,
          ).length + force.queuedAircraft(definitionId) + (plannedAircraft.get(definitionId) ?? 0) < 4
        )
          if (this.world.applyCommand({
            type: "recruit-aircraft",
                autoRecruit: true,
            playerId: player.id,
            buildingId: base.id,
            definitionId,
          }) === null) plannedAircraft.set(definitionId, (plannedAircraft.get(definitionId) ?? 0) + 1);
    const enemy = enemies.sort((a, b) => b.troops-a.troops || a.id-b.id)[0];
    const structures=this.world.buildings.filter(b=>atWar(b.playerId) && !b.remainingTicks && (b.health ?? 1)>0)
      .sort((a,b)=>Number(b.type==="city")-Number(a.type==="city") || a.id-b.id);
    const structure=structures[0];
    const aim=enemy ?? (structure ? this.battle.position(structure) : undefined);
    if (aim) {
      const ready = this.aircraft.filter(
        (a) => a.playerId === player.id && a.state === "ready",
      );
      const airTargets=[...enemies.slice(0,16),...structures.slice(0,16).map(b=>this.battle.position(b))];
      const incoming=this.aircraft.filter(a=>a.health>0 && a.state!=="ready" && a.definitionId!=="drone" && atWar(a.playerId)).slice(0,16);
      const friendly=[...this.world.squads.filter(s=>s.troops>0&&!atWar(s.playerId)),...own.map(b=>this.battle.position(b))];
      // Skip refused blasts before choosing a target. Nuclear orders protect
      // allies; conventional bombing also requires normal attack permission.
      // Memoised per pass: candidates repeat per aircraft.
      const strikeChecks=new Map<string,boolean>();
      const strikeAllowed=(t:{x:number;y:number},radius:number,nuclear=false)=>{
        const key=`${t.x},${t.y},${radius},${nuclear}`;let allowed=strikeChecks.get(key);
        if(allowed===undefined){allowed=!this.strikeRejection(player.id,t.x,t.y,radius,nuclear);strikeChecks.set(key,allowed);}
        return allowed;
      };
      const bombRadius=BOMBER_ATTACK.projectile!.blastRadius,atomicRadius=ATOMIC_ATTACK.projectile!.blastRadius;
      // At most 32 candidates per ready aircraft, once per existing staggered strategic pass.
      for(const aircraft of ready) {
        const targets=aircraft.definitionId === "fighter" ? [...incoming,...airTargets].slice(0,32) : aircraft.definitionId === "drone" ? [...structures.filter(b=>b.type==="missile-defence").slice(0,16).map(b=>this.battle.position(b)),...airTargets].slice(0,32) : airTargets;
        const bomber=aircraft.definitionId==="bomber";
        let target=targets.find(t=>flightReachable(aircraft,t.x,t.y)&&(!bomber||strikeAllowed(t,bombRadius)));
        if(!target)continue;
        let mission:import("../content/FlightOperations").AirMission=aircraft.definitionId==="fighter"?"patrol":aircraft.definitionId==="drone"?"drone":"bombing";
        if(bomber && this.progression.has(player.id,"rus-earlymodern-nuclear-weapons") && (stock["payload:atomic"]??0)>0) {
          const atomic=targets.find(t=>flightReachable(aircraft,t.x,t.y)&&!friendly.some(s=>(s.x-t.x)**2+(s.y-t.y)**2<=(16*FIXED)**2)&&strikeAllowed(t,atomicRadius,true));
          if(atomic){target=atomic;mission="atomic";}
        }
        this.world.applyCommand({type:"sortie",mission,playerId:player.id,aircraftIds:[aircraft.id],x:target.x,y:target.y});
      }
      const launchers=[...own.filter(b=>["missile-silo","mirv-launcher"].includes(b.type)),
        ...squads.filter(s=>this.unit(s).role==="launcher")];
      if(!launchers.length)return;
      const strategicTargets=[...structures.slice(0,16).map(b=>({...this.battle.position(b),buildingId:b.id})),
        ...enemies.slice(0,16).map(s=>({x:s.x,y:s.y,buildingId:undefined}))];
      const protectedPositions=[...this.world.squads.filter(s=>s.troops>0 && !atWar(s.playerId)),
        ...this.world.ships.filter(s=>s.health>0 && !atWar(s.playerId)),
        ...this.world.buildings.filter(b=>!atWar(b.playerId) && (b.health ?? 1)>0).map(b=>this.battle.position(b))];
      for (const launcher of launchers) {
        const payloads =
          "type" in launcher && launcher.type === "missile-silo"
            ? ["hydrogen","icbm"] as const : ["mirv"] as const;
        const strike=payloads.flatMap(payload=>{
          if(!(stock[`payload:${payload}`]>0))return [];
          const radius=STRATEGIC_PAYLOADS[payload].blastRadius;
          const target=strategicTargets.find(t=>!protectedPositions.some(s=>(s.x-t.x)**2+(s.y-t.y)**2<=radius**2)&&strikeAllowed(t,radius,true));
          return target ? [{payload,target}] : [];
        })[0];
        if(!strike)continue;
        this.world.applyCommand({
          type: "launch",
          playerId: player.id,
          launcherId: launcher.id,
          payload:strike.payload,
          x: strike.target.x,
          y: strike.target.y,
          buildingId: strike.target.buildingId,
        });
      }
    }
  }
  /** Synchronous capture batch: prove the complete ray rectangle empty once.
   * Building/diplomacy eligibility remains live for each visited tile. */
  captureQuery(squad: Squad, radius: number): ((tile: number) => boolean) & { originIndependent: boolean } {
    const position = this.world.tileOf(squad), map = this.world.map;
    const cx = map.x(position), cy = map.y(position);
    const obstacleFree = this.fortifications.obstacleFreeArea(
      Math.min(squad.x, (cx - radius + 0.5) * FIXED),
      Math.min(squad.y, (cy - radius + 0.5) * FIXED),
      Math.max(squad.x, (cx + radius + 0.5) * FIXED),
      Math.max(squad.y, (cy + radius + 0.5) * FIXED),
    );
    const version = this.fortifications.version, x = squad.x, y = squad.y;
    return Object.assign((tile:number) => this.captureEligible(squad, tile, obstacleFree &&
      version === this.fortifications.version && squad.x === x && squad.y === y &&
      Math.abs(map.x(tile) - cx) <= radius && Math.abs(map.y(tile) - cy) <= radius),
      {originIndependent:obstacleFree && radius>=1});
  }
  canCaptureTile(squad: Squad, tile: number): boolean {
    return this.captureEligible(squad, tile, false);
  }
  private captureEligible(squad: Squad, tile: number, obstacleFree: boolean): boolean {
    if(!this.diplomacy.canCapture(squad.playerId,this.world.owners[tile]))return false;
    if(this.diplomacy.raids&&this.world.buildingsAt(tile).some(b=>!this.diplomacy.canCapture(squad.playerId,b.playerId)))return false;
    if(this.diplomacy.raids&&this.world.buildingsAt(tile).some(b=>!this.diplomacy.canCapture(squad.playerId,b.playerId)))return false;
    if (!this.operations.canEnter(squad.playerId, this.world.owners[tile], tile)) return false;
    if (
      this.world.owners[tile] !== squad.playerId &&
      this.diplomacy.allied(squad.playerId, this.world.owners[tile])
    )
      return false;
    if (
      this.world
        .buildingsAt(tile)
        .some(
          (b) =>
            b.tile === tile &&
            DEFENSIVE_BUILDINGS.includes(b.type) &&
            (b.health ?? 1) > 0 &&
            this.diplomacy.hostile(squad.playerId, b.playerId),
        )
    )
      return false;
    if (obstacleFree || !this.fortifications.hasObstacles) return true;
    return this.fortifications.clear(
      squad,
      {
        x: (this.world.map.x(tile) + 0.5) * FIXED,
        y: (this.world.map.y(tile) + 0.5) * FIXED,
      },
      squad.playerId,
    );
  }
  coalition(): number[] | null {
    if (this.victoryMode !== "allied") return null;
    // Tribes neither join nor block a coalition (13 R2.1).
    const live = this.world.players.filter((p) => !p.eliminated && p.kind === "regular");
    // Pairwise alliance is insufficient at match opening: conquest must first
    // remove at least one regular faction.
    if (
      !live.length ||
      !this.world.players.some((p) => p.kind === "regular" && p.eliminated) ||
      live.some((a) => live.some((b) => !this.diplomacy.allied(a.id, b.id)))
    )
      return null;
    return live.map((p) => p.id);
  }
  private metadataIdentity={};
  replicationMetadata(){return {identity:this.metadataIdentity,revisions:{
    rulesetId:1,startingAge:1,maximumAge:1,contentHash:1,technologySpeed:1,victoryMode:1,
    progression:this.progression.revision,diplomacy:this.diplomacy.revision,
    productionPlans:this.supply.controlRevision,productionPriorities:this.supply.controlRevision,
    tradeControls:this.trade.controlRevision,
    tradeReceipts:this.trade.receiptRevision,
    pairRelations:this.relations.revision,
    events:this.nextEvent,roadRevision:this.roads.revision,fortificationRevision:this.fortifications.version,
    fallout:this.world.wasteland.revision,
  }};}
  snapshot(includeTraders = true): ExpansionSnapshot {
    return {
      armies: this.armies.snapshot(),
      fallout: this.world.wasteland.snapshot(),
      rulesetId: "ages-v1",
      startingAge: this.startingAge,
      ...(this.progression.maximumAge ? { maximumAge: this.progression.maximumAge } : {}),
      contentHash: CONTENT_HASH,
      technologySpeed: this.progression.technologySpeed,
      fortificationRevision: this.fortifications.version,
      events: this.events,
      roadRevision: this.roads.revision,
      roads: this.roads.packed(),
      progression: this.progression.states,
      inventories: this.supply.inventories,
      production: this.supply.jobs,
      recruitment: this.world.recruitment.jobs,
      productionPlans: this.supply.productionPlans(),
      productionPriorities: this.supply.priorities,
      deposits: this.supply.deposits,
      diplomacy: this.diplomacy.state,
      ...(this.diplomacy.raids?{diplomacyRules:this.diplomacy.rules}:{}),
      activeOffensives: this.operations.activeOffensives(),
      pairRelations: this.relations.snapshot(),
      traders: includeTraders ? this.trade.actors.map(
        ({ path: _path, nextPathIndex: _index, supplyWaitTicks: _supplyWait,
          supplyWaitStartedTick: _waitStart, tripSupplyTicks: _tripSupply, routeOriginOwner: _routeOwner, ...actor }) =>
          ({ ...actor, waitingForCargo: actor.state === "loading" && _waitStart !== undefined }),
      ) : [],
      barriers: this.fortifications.barriers,
      projectiles: this.battle.projectiles,
      aircraft: this.aircraft,
      victoryMode: this.victoryMode,
      winners: this.winners,
      deliveredGold: this.trade.deliveredGold,
      tradeReceipts:[...this.trade.receipts.values()],
      tradeSites:this.trade.siteSnapshot(),
      tradeCapturedValue: this.trade.capturedValue,
      tradeLostValue: this.trade.lostValue,
      tradeControls: this.trade.controls,
      tradeEnemies: Object.fromEntries(this.world.players.filter(p=>!p.ai && !p.eliminated).map(p=>
        [p.id,this.world.players.filter(q=>q.id!==p.id && !q.eliminated && this.trade.atWar(p.id,q.id)).map(q=>q.id)])),
    };
  }
}
