import { availableGold, spendGold, paidCost } from "./domain/Gold";
import { validFactionColor } from "./lobby/FactionPalette";
import { DEFENSIVE_BUILDINGS } from "./content/Buildings";
import { domainRouteKey, type DomainRouteOwner, type DomainRoutePorts, type DomainRouteConsumer } from "./domain/DomainRoutePorts";
import { EntityCollection } from "./EntityCollection";
import { EntityChangeJournal } from "./EntityChangeJournal";
import type { ReplicatedEntities } from "./ReplicatedEntities";
import type { SnapshotSource } from "./SnapshotCodec";
import { limitedRouteRetry } from "./RouteRetryPolicy";
import { FactionAdjacency } from "./FactionAdjacency";
import { TileChangeJournal } from "./TileChangeJournal";
import { CapturePressure } from "./CapturePressure";
import { UnitIndex, type UnitQueries } from "./UnitIndex";
import type { RuntimePhase } from "./RuntimeDiagnostics";
import { startingEconomy } from "./content/StartingEconomy";
import { tribeBuildingLimit } from "./domain/TribeDevelopment";
import type { RecruitmentJob } from "./domain/Definitions";
import { restoreArray, restoreMap, restoreSet } from "./StateTransfer";
import type { GameMap } from "../core/game/GameMap";
import { PseudoRandom } from "../core/PseudoRandom";
import { BuildingIndex, type BuildingQueries } from "./BuildingIndex";
import { CommandApplications } from "./CommandApplications";
import { CoastIndex } from "./CoastIndex";
import { shoreTransportCapacity, shoreTransportDefinition } from "./content/ShoreTransport";
import { ShoreRoutes } from "./domain/ShoreRoutes";
import { ShoreTransport } from "./domain/ShoreTransport";
import { structureAim } from "./domain/StructureTargeting";
import { ConquestCredit, DamageLedger } from "./Conquest";
import { constructionRejection } from "./Construction";
import { buildingCostMultiplier, buildingTicks, buildingIntegrity } from "./content/Buildings";
import { defaultUnit, UNIT, VESSEL } from "./content/Units";
import { STARTING_AGE_TROOPS, baseReserveIncome, cityReserveIncome } from "./content/Economy";
import { personalityOf } from "./content/AiPersonalities";
import { FACTIONS } from "./content/Factions";
import {
  buildingPriority,
  recruitmentOrder,
  type AiPersonalityId,
} from "./domain/AiPersonality";
import { FactionRoster } from "./domain/FactionRoster";
import { AiForceInventory } from "./domain/AiForceInventory";
import { canPromoteTribe } from "./FactionRules";
import { damageAmount, effectiveDamageShares, scaledAttack } from "./domain/Combat";
import { commandRejection } from "./domain/CommandPolicy";
import { AGES, type Age } from "./domain/Definitions";
import { Expansion } from "./domain/Expansion";
import { Occupation } from "./domain/Occupation";
import { TerritoryAbsorption } from "./domain/TerritoryAbsorption";
import { CoastalTerritory } from "./domain/CoastalTerritory";
import { Recruitment, RECRUITMENT_SECONDS } from "./domain/Recruitment";
import { costRejection, spend } from "./domain/Supply";
import {
  squadCap,
  TRIBE_BASE_RADIUS,
  TRIBE_INTERCEPT_RANGE,
  TRIBE_PURSUIT_RANGE,
  TRIBE_STARTING_SQUADS,
  TRIBE_STARTING_RESERVES,
  TRIBE_STARTING_GOLD,
  matchTribeCount,
  MAX_AI_OPPONENTS,
  MAX_HUMAN_PLAYERS,
  MAX_TRIBES,
} from "./FactionRules";
import { forestOf } from "./Forest";
import { Formations } from "./Formations";
import { FiringPositions } from "./FiringPositions";
import { HomeTerritory } from "./HomeTerritory";
import { PlayerAttackContinuation } from "./domain/PlayerAttackContinuation";
import { LocalAvoidance, type MovementIntent } from "./LocalAvoidance";
import { LocalDetours } from "./LocalDetours";
import { PassageTraffic } from "./PassageTraffic";
import { LandPaths, WaterPaths } from "./Pathfinding";
import type {
  ArcherVolley,
  Building,
  BuildingType,
  Command,
  DefenseZone,
  MatchOptions,
  Order,
  Player,
  Ship,
  ShipType,
  Snapshot,
  Squad,
} from "./Protocol";
import {
  CAPTURE_RADIUS,
  CAPTURE_TICKS,
  FIXED,
  MAX_FACTIONS,
  MAX_QUEUED_ORDERS,
  MELEE_RANGE,
  SQUAD_TROOPS,
  TICKS_PER_SECOND,
} from "./Protocol";
import { RouteWork } from "./RouteWork";
import { RoutePlanner } from "./RoutePlanner";
import { MovementAdmission } from "./MovementAdmission";
import { ShipMovementAdmission } from "./ShipMovementAdmission";
import type { MatchRouteTask, ArmyRouteRequest } from "./domain/RouteTask";
import {
  ARCHER_ARROW_TICKS,
  ARCHER_CHARGE_REQUIRED,
  ARCHER_MOVING_CHARGE,
  ARCHER_STATIONARY_CHARGE,
  BUILDING_RULES,
  MAX_SHIPS,
  REPLENISH_DELAY,
  REPLENISH_PER_SECOND,
  SHIP_RULES,
  SQUAD_RULES,
  STARTING_GOLD,
} from "./Rules";
import { SpatialGrid, type WorldPoint } from "./SpatialGrid";
import {
  ARRIVAL_TOLERANCE,
  distanceSquared,
  FORMATION_SPACING,
  meleeContact,
  pointTile,
  squadRadius,
  squadSeparation,
  standable,
  tilePoint,
  traversable,
} from "./SquadGeometry";
import { SpawnSelection } from "./domain/SpawnSelection";
import { boardingMeeting, firingPosition } from "./TacticalRoutes";
import { terrainSpeed } from "./Terrain";

const STARTING_TROOPS = 12_000;
const BASE_RADIUS = 6;
// Capture uses radius three on every active squad, every tick. Preserve the
// original row-major disk while avoiding repeated corner tests/map bounds.
const RADIAL_SPANS = Array.from({ length: BASE_RADIUS + 1 }, (_, radius) =>
  Array.from({ length: radius * 2 + 1 }, (_, row) =>
    Math.floor(Math.sqrt(radius * radius - (row - radius) ** 2)),
  ),
);
const ROUTE_EFFORT_LIMIT = 20_000;
// Crossing trees built per tick until every portal has one (land, then water).
const PATH_WARM_TREES = 4;
export const WARSHIP_PATROL_RADIUS = 2;
export const WARSHIP_COMBAT_COOLDOWN = 60;
export const WARSHIP_REPAIR_FRACTION = 0.10;

// Fixed-step, integer-position simulation. Browser timing and rendering never
// determine gameplay. Human and AI players enter through applyCommand().
export class Skirmish {
  /** Optional observer; excluded from save state and authoritative decisions. */
  onPhase?: (phase: RuntimePhase, milliseconds: number) => void;
  /** Development-only full-reference comparisons; excluded from checkpoints. */
  compareBuildingIndexes = false;
  compareUnitIndexes = false;
  private diagnosticPhase(phase: RuntimePhase, start: number): number {
    if (!this.onPhase) return 0;
    const now = performance.now();
    this.onPhase(phase, Math.max(0, now - start));
    return now;
  }

  readonly commandApplications = new CommandApplications({apply: command => this.applyCommand(command), tick: () => this.tick});
  private readonly controlGenerations = new Map<number, number>();
  aiGeneration(playerId: number): number { return this.controlGenerations.get(playerId) ?? 0; }
  /** Transfer control without replacing any domain state or legitimate orders. */
  setAiController(playerId: number, ai: boolean): void {
    const player = this.player(playerId);
    if (!player || player.ai === ai) return;
    player.ai = ai;
    if (this.options.infiniteGoldForPlayers) player.infiniteGold = !ai;
    for(const squad of this.squadIndex.byOwner(playerId))this.playerAttacks.forget(squad.id);
    this.controlGenerations.set(playerId, (this.controlGenerations.get(playerId) ?? 0) + 1);
    this.expansion?.economy.release(playerId);
    this.expansion?.operations.release(playerId);
    this.commandApplications.release(playerId, this.tick);
  }
  checkpoint() { return structuredClone({playerAttacks:this.playerAttacks.checkpoint(),version:1 as const,width:this.map.width(),height:this.map.height(),options:this.options,players:this.players,squads:this.squads,buildings:this.buildings,ships:this.ships,volleys:this.volleys,defenseZones:this.defenseZones,owners:this.owners,claims:this.claims,progress:this.progress,detours:this.detours,navigationProgress:this.navigationProgress,orderRevisions:this.orderRevisions,queuedLegs:this.queuedLegs,controlGenerations:this.controlGenerations,activeClaims:this.activeClaims,tick:this.tick,winner:this.winner,combatTicks:this.combatTicks,producedTroops:this.producedTroops,nextId:this.nextId,nextVolleyId:this.nextVolleyId,random:this.random.getState(),forest:forestOf(this.map)?.checkpoint(),routeWork:this.routeWork.checkpoint(),planning:this.routePlanner.checkpoint(),admission:this.movementAdmission.checkpoint(),shipAdmission:this.shipAdmission.checkpoint(),commandApplications:this.commandApplications.checkpoint(),shorePlanning:this.shoreTransport.checkpoint(),recruitment:this.recruitment.checkpoint(),expansion:this.expansion?.checkpoint(),territoryAbsorption:this.territoryAbsorption.checkpoint(),coastalTerritory:this.coastalTerritory.checkpoint(),homeTerritory:this.homeTerritory.checkpoint(),avoidance:this.avoidance.checkpoint(),passageTraffic:this.passageTraffic.checkpoint(),conquest:this.conquest.checkpoint()}); }
  restore(saved: ReturnType<Skirmish["checkpoint"]>): void {
    if (saved.version!==1 || saved.width!==this.map.width() || saved.height!==this.map.height() || JSON.stringify(saved.options)!==JSON.stringify(this.options) || Boolean(saved.expansion)!==Boolean(this.expansion)) throw new Error("Checkpoint does not match this simulation");
    const state=structuredClone(saved);
    for (const player of state.players) player.colorKind ??= FACTIONS.find(faction => faction.id === player.factionId)?.kind ?? player.kind;
    restoreArray(this.players,state.players);
    this.squadEntities.restoreOwned(state.squads);
    this.buildingEntities.restoreOwned(state.buildings);
    this.shipEntities.restoreOwned(state.ships);
    this.recruitment.restore(state.recruitment);
    restoreArray(this.volleys,state.volleys);
    restoreArray(this.defenseZones,state.defenseZones);
    if (state.owners.length!==this.owners.length) throw new Error("Invalid checkpoint tile array"); this.owners.set(state.owners);
    if (state.claims.length!==this.claims.length) throw new Error("Invalid checkpoint tile array"); this.claims.set(state.claims);
    if (state.progress.length!==this.progress.length) throw new Error("Invalid checkpoint tile array"); this.progress.set(state.progress);
    this.rebuildOwnedTiles();
    this.tileChanges.invalidate();
    this.adjacency.rebuild();
    restoreMap(this.detours,state.detours);
    restoreMap(this.navigationProgress,state.navigationProgress);
    this.navigationCleanupNeeded = true;
    restoreMap(this.orderRevisions,state.orderRevisions);
    restoreMap(this.queuedLegs,state.queuedLegs ?? new Map());
    restoreMap(this.controlGenerations,state.controlGenerations ?? new Map());
    restoreSet(this.activeClaims,state.activeClaims);
    this.tick=state.tick;
    this.commandApplications.restore(state.commandApplications ?? {pending: [], recent: []});
    this.winner=state.winner;
    this.combatTicks=state.combatTicks;
    this.producedTroops=state.producedTroops;
    this.nextId=state.nextId;
    this.nextVolleyId=state.nextVolleyId;
    this.territoryAbsorption.restore(state.territoryAbsorption);
    this.coastalTerritory.restore(state.coastalTerritory);
    this.homeTerritory.restore(state.homeTerritory);
    this.playerAttacks.restore(state.playerAttacks);
    this.avoidance.restore(state.avoidance);
    this.passageTraffic.restore(state.passageTraffic);
    this.conquest.restore(state.conquest);
    if (state.forest) { const field=forestOf(this.map); if (!field) throw new Error("Missing forest field"); field.restore(state.forest); }
    this.random=PseudoRandom.fromState(state.random); this.routeWork.restore(state.routeWork); if (state.expansion) this.expansion!.restore(state.expansion);
    this.shoreTransport.restore(state.shorePlanning);
    this.routePlanner.restore(state.planning ?? {landRevision:this.paths.revision,waterRevision:this.waterPaths.revision,jobs:[]});
    this.movementAdmission.restore(state.admission ?? {pending:[],nextId:1,events:[]});
    this.shipAdmission.restore(state.shipAdmission ?? {pending:[],nextId:1,events:[]});
    this.spatial.rebuild(this.squads.filter(s=>s.embarkedOn===null)); this.navalSpatial.rebuild(this.ships);
  }

  readonly recruitment = new Recruitment();
  readonly expansion?: Expansion;
  readonly tileChanges: TileChangeJournal;
  private readonly adjacency: FactionAdjacency;
  factionAdjacent(a: number, b: number): boolean { return this.adjacency.adjacent(a, b); }
  readonly owners: Uint8Array;
  readonly claims: Uint8Array;
  readonly progress: Uint8Array;
  readonly players: Player[] = [];
  private readonly squadIndex = new UnitIndex<Squad>();
  private readonly shipIndex = new UnitIndex<Ship>();
  private readonly squadChanges = new EntityChangeJournal();
  private readonly shipChanges = new EntityChangeJournal();
  private readonly buildingChanges = new EntityChangeJournal();
  private readonly squadEntities = new EntityCollection<Squad>({
    added: squad => { this.squadIndex.add(squad); this.squadChanges.record(squad.id, "add"); },
    changed: squad => { this.squadIndex.changed(squad); this.squadChanges.record(squad.id, "change"); },
    removed: id => {
      this.squadIndex.remove(id); this.squadChanges.record(id, "remove");
      this.navigationProgress.delete(id); this.detours.delete(id);
      this.orderRevisions.delete(id); this.queuedLegs.delete(id);
      this.routeWork.cancel(`navigation:${id}`); this.routePlanner.cancel(`navigation:${id}`);
    },
    restored: squads => { this.squadIndex.rebuild(squads); this.squadChanges.invalidate(); },
  });
  get squads(): readonly Squad[] { return this.squadEntities.values; }
  private readonly buildingEntities = new EntityCollection<Building>({
    added: building => { this.buildingIndex.add(building); this.buildingChanges.record(building.id, "add"); this.expansion?.economy.navalFacts.observeBuilding(building); },
    changed: building => {
      const revision = this.buildingIndex.producerRevision;
      this.buildingIndex.changed(building); this.buildingChanges.record(building.id, "change");
      if (revision !== this.buildingIndex.producerRevision) this.expansion?.economy.navalFacts.observeBuilding(building);
    },
    removed: id => { this.buildingIndex.remove(id); this.buildingChanges.record(id, "remove"); this.expansion?.economy.navalFacts.forgetBuilding(id); },
    restored: buildings => { this.buildingIndex.rebuild(buildings); this.buildingChanges.invalidate(); },
  });
  get buildings(): readonly Building[] { return this.buildingEntities.values; }
  private readonly shipEntities = new EntityCollection<Ship>({
    added: ship => { this.shipIndex.add(ship); this.shipChanges.record(ship.id, "add"); },
    changed: ship => { this.shipIndex.changed(ship); this.shipChanges.record(ship.id, "change"); },
    removed: id => { this.shipIndex.remove(id); this.shipChanges.record(id, "remove"); this.expansion?.economy.navalFacts.forgetShip(id); },
    restored: ships => { this.shipIndex.rebuild(ships); this.shipChanges.invalidate(); },
  });
  get ships(): readonly Ship[] { return this.shipEntities.values; }
  readonly volleys: ArcherVolley[] = [];
  readonly defenseZones: DefenseZone[] = [];
  readonly paths: LandPaths;
  readonly waterPaths: WaterPaths;
  tick = 0;
  winner: number | null = null;
  combatTicks = 0;
  producedTroops = 0;
  private nextId = 1;
  private nextVolleyId = 1;
  private random: PseudoRandom;
  private readonly pressure: CapturePressure;
  private readonly activeClaims = new Set<number>();
  private readonly occupation = new Occupation();
  private readonly territoryAbsorption: TerritoryAbsorption;
  private readonly coastalTerritory: CoastalTerritory;
  private readonly ownedTiles = new Map<number, Set<number>>();
  private readonly ownedWater = new Map<number, Set<number>>();
  private readonly formations: Formations;
  private readonly avoidance: LocalAvoidance;
  private readonly passageTraffic: PassageTraffic;
  private readonly collisionHostile = (a: number, b: number): boolean => this.hostile(a, b);
  private readonly spatial: SpatialGrid<Squad>;
  private readonly navalSpatial: SpatialGrid<Ship>;
  private readonly heldSpatial: SpatialGrid<Squad>;
  private readonly buildingIndex: BuildingIndex;
  readonly coast: CoastIndex;
  private readonly shoreTransport: ShoreTransport;
  // At most 24 route jobs per tick, and no more than ROUTE_EFFORT_LIMIT units of
  // search effort once a job completes: both are deterministic counters.
  // With no tower or wall the test is always false, so the unobstructed (and
  // cacheable) search returns the identical route.
  private obstacleTest(playerId: number): ((tile: number) => boolean) | undefined {
    const forts = this.expansion?.fortifications;
    const policy = this.expansion?.operations.enabled(this.player(playerId));
    return forts?.hasObstacles || policy
      ? (tile) => !!forts?.blocked(tile, playerId) || (!!policy && !this.aiFootprintAllowed(playerId, tile))
      : undefined;
  }
  private aiCanPursue(playerId: number, rival: number, tile: number): boolean {
    return !this.options.aiWarPolicy || (this.expansion?.operations.canPursue(playerId, rival, tile) ?? true);
  }
  private aiCanEnter(playerId: number, tile: number): boolean {
    return !this.options.aiWarPolicy || (this.expansion?.operations.canEnter(playerId, this.owners[tile], tile) ?? true);
  }
  private routeFootprints?: Map<number, Map<number, boolean>>;
  // Neighbouring footprint tests share tile permissions within the same
  // synchronous tick/drain. The footprint revision fences invalidate both.
  private routeEntries?: Map<number, Map<number, boolean>>;
  readonly playerAttacks=new PlayerAttackContinuation();
  private footprintOperationRevision = -1;
  private footprintDiplomacyRevision = -1;
  private footprintThreatRevision = -1;
  /** Capture/contact radius, not only the unit centre, defines foreign entry. */
  private aiFootprintAllowed(playerId: number, tile: number): boolean {
    if (!this.options.aiWarPolicy || !this.expansion?.operations.enabled(this.player(playerId))) return true;
    const cache = this.routeFootprints;
    if (cache) {
      const operations = this.expansion.operations.revision, diplomacy = this.expansion.diplomacy.revision, threats = this.expansion.operations.permissionRevision;
      if (operations !== this.footprintOperationRevision || diplomacy !== this.footprintDiplomacyRevision || threats !== this.footprintThreatRevision) {
        cache.clear(); this.routeEntries?.clear(); this.footprintOperationRevision = operations; this.footprintDiplomacyRevision = diplomacy; this.footprintThreatRevision = threats;
      }
      const known = cache.get(playerId)?.get(tile);
      if (known !== undefined) return known;
    }
    let allowed = true;
    let entries = this.routeEntries?.get(playerId);
    if (this.routeEntries && !entries) this.routeEntries.set(playerId, entries = new Map());
    const component = this.paths.component[tile];
    this.eachInRadius(tile, CAPTURE_RADIUS, neighbor => {
      if (!allowed || this.paths.component[neighbor] !== component) return;
      // These two permissions are unconditional in AiOperations.canEnter;
      // avoid hashing the overwhelmingly common home/unclaimed tile reads.
      const owner = this.owners[neighbor];
      if (!owner || owner === playerId) return;
      let entry = entries?.get(neighbor);
      if (entry === undefined) {
        entry = this.aiCanEnter(playerId, neighbor);
        entries?.set(neighbor, entry);
      }
      if (!entry) allowed = false;
    });
    if (cache) {
      let tiles = cache.get(playerId);
      if (!tiles) cache.set(playerId, tiles = new Map());
      tiles.set(tile, allowed);
    }
    return allowed;
  }
  notifyHostileAction(victim: number, attacker: number, tile: number): void {
    if (this.options.aiWarPolicy) this.expansion?.operations.threatened(victim, attacker, tile);
  }
  private pathsWarm = false;
  private drainRoutes(): void {
    if(this.routeFootprints){this.drainRouteBatch();return;}
    // Standalone drains used by domain tools retain a synchronous cache too.
    this.routeFootprints=new Map();
    this.routeEntries=new Map();
    try{this.drainRouteBatch();}finally{this.routeFootprints=undefined;this.routeEntries=undefined;}
  }
  private drainRouteBatch(): void {
    this.routeWork.drain(24, {
      read: () => this.paths.work,
      limit: ROUTE_EFFORT_LIMIT,
    },task=>{
      const id=task.kind==="navigation"?this.squad(task.squadId)?.playerId:
        task.kind==="army"?this.squad(task.request.squadId)?.playerId:task.playerId;
      return id!==undefined&&!this.player(id)?.ai;
    },this.tick);
    this.routePlanner.step(this.tick);
    if(this.options.deferredPlanning) {
      this.movementAdmission.stepInteractive(this.tick,128);
      this.shoreTransport.stepInteractive(256);
      const landWork = this.movementAdmission.step(this.tick, 32);
      const shipWork = this.shipAdmission.step(this.tick, 16);
      const shoreWork = this.shoreTransport.stepPlanning(32);
      const armyWork = this.expansion?.armies.stepPlanning(16) ?? 0;
      const tradeWork = this.expansion?.trade.stepPlanning(16) ?? 0;
      const remaining = 128 - landWork - shipWork - shoreWork - armyWork - tradeWork;
      const used = this.movementAdmission.step(this.tick, remaining);
      this.shipAdmission.step(this.tick, remaining - used);
    }
  }
  private readonly routeWork = new RouteWork<Exclude<MatchRouteTask,{kind:"admission"|"ship-admission"}>>(task => this.executeRouteTask(task));
  readonly routePlanner: RoutePlanner<Extract<MatchRouteTask,{kind:"navigation"|"admission"|"ship-admission"|"domain"}>>;
  readonly movementAdmission: MovementAdmission;
  readonly shipAdmission: ShipMovementAdmission;
  private domainConsumer(owner: DomainRouteOwner): DomainRouteConsumer | undefined {
    return owner === "army" ? this.expansion?.armies : owner === "shore" ? this.shoreTransport : owner === "strategy" ? this.expansion?.economy.routes : this.expansion?.trade;
  }
  get domainRoutes(): DomainRoutePorts | undefined {
    if (!this.options.deferredPlanning) return undefined;
    return this.domainRoutePorts;
  }
  private readonly domainRoutePorts: DomainRoutePorts = {
    hostile: this.collisionHostile,
    priority:id=>!this.player(id)?.ai,
    request:(task,start,goal,water=false)=>this.routePlanner.request({key:domainRouteKey(task),start,goal,water,createdTick:this.tick,
      obstacleRevision:water ? "water" : this.domainRoutePorts.revision(task.playerId, task.owner),context:task}),
    cancel:task=>this.routePlanner.cancel(domainRouteKey(task)),
    generation:id=>this.aiGeneration(id), revision:(id,owner)=>this.routingObstacleRevision(id, owner !== "trade"),
    tick:()=>this.tick, orderRevision:id=>this.orderRevisions.get(id)??0,
    clear:(squad,end)=>distanceSquared(squad,end)<= (3*FIXED)**2 && traversable(this.map,squad,end,squadRadius(squad.kind)) &&
      (!this.expansion || this.expansion.fortifications.clearMovement(squad,end,squad.playerId,squadRadius(squad.kind))),
    destinationValid:(squad,point,selected)=>{
      if (!this.aiFootprintAllowed(squad.playerId,pointTile(this.map,point)) || !standable(this.map,point,squadRadius(squad.kind)) ||
        (this.expansion && !this.expansion.fortifications.clearMovement(point,point,squad.playerId,squadRadius(squad.kind)))) return false;
      const nearby:Squad[]=[]; this.spatial.query(point.x,point.y,2*FIXED,nearby);
      return nearby.every(other=>selected.has(other.id) || distanceSquared(point,other)>=squadSeparation(squad, other, this.collisionHostile)**2);
    },
    event:(owner,event)=>{if(owner!=="strategy")this.commandApplications.observe(owner,event);},
  };
  private routingObstacleRevision(playerId?: number, military = true):string {
    const policy = !military ? "civilian" : playerId === undefined ? this.expansion?.operations.revision ?? 0 : this.expansion?.operations.navigationRevision(playerId) ?? "unrestricted";
    return `${policy}:${this.expansion?.fortifications.version ?? 0}:${this.expansion?.diplomacy.state.alliances.map(t=>`${t.a},${t.b}`).join(";") ?? ""}`;
  }
  admitStructureAttack(playerId: number, squads: readonly Squad[], points: Map<number, WorldPoint>, target: NonNullable<Squad["structureTarget"]>): void {
    if (squads.every(s => points.get(s.id)?.x === s.x && points.get(s.id)?.y === s.y)) {
      this.movementAdmission.cancel(squads.map(s => s.id), this.tick);
      for (const s of squads) {
        this.activateOrder(s, { type: "hold" });
        this.updateSquad(s.id, { queuedOrders: [], charge: null, structureTarget: { ...target } });
      }
      return;
    }
    const first = points.values().next().value!;
    this.movementAdmission.start(playerId, squads, pointTile(this.map, first), this.tick, points, false, target);
  }
  private readonly orderRevisions = new Map<number, number>();
  private readonly queuedLegs = new Map<number, { attempts: number; retryAt: number; paused?: boolean }>();
  private readonly localDetours: LocalDetours;
  private readonly homeTerritory: HomeTerritory;
  private readonly conquest = new ConquestCredit();
  private readonly detours = new Map<number, WorldPoint[]>();
  private navigationCleanupNeeded = false;
  private readonly navigationProgress = new Map<
    number,
    { x: number; y: number; tick: number; recovery: number }
  >();

  constructor(
    readonly map: GameMap,
    readonly options: MatchOptions,
  ) {
    this.territoryAbsorption = new TerritoryAbsorption(map);
    this.coastalTerritory = new CoastalTerritory(map);
    const humanCount = options.humanNames?.length ?? 1;
    if (options.humanColors) {
      const chosen = options.humanColors.filter(color => color !== null);
      if (options.humanColors.length !== humanCount || chosen.some(color => !validFactionColor(color)) || new Set(chosen).size !== chosen.length)
        throw new Error("Human faction colors must be valid, unique palette choices for the human seats.");
    }
    if (humanCount < 1 || humanCount > MAX_HUMAN_PLAYERS || options.humanNames?.some(name => typeof name !== "string" || !name.trim() || Array.from(name).length > 20))
      throw new Error("Invalid human faction roster");
    if (
      !Number.isInteger(options.aiCount) ||
      options.aiCount < (options.humanNames ? 0 : 1) ||
      options.aiCount > MAX_AI_OPPONENTS ||
      options.aiCount + humanCount > MAX_FACTIONS
    )
      throw new Error(
        `Choose between one and ${MAX_AI_OPPONENTS} AI opponents`,
      );
    if (
      options.tribeCount !== undefined &&
      (!Number.isInteger(options.tribeCount) ||
        options.tribeCount < 0 ||
        options.tribeCount > MAX_TRIBES)
    )
      throw new Error(`Choose between 0 and ${MAX_TRIBES} tribes`);
    if (!Number.isInteger(options.seed)) throw new Error("Invalid match seed");
    if (
      options.territoryIncomeScale !== undefined &&
      (!Number.isFinite(options.territoryIncomeScale) ||
        options.territoryIncomeScale < 1 ||
        options.territoryIncomeScale > 64)
    )
      throw new Error("Invalid territory income scale");
    this.random = new PseudoRandom(options.seed);
    const size = map.width() * map.height();
    this.tileChanges = new TileChangeJournal(size);
    this.owners = new Uint8Array(size);
    this.claims = new Uint8Array(size);
    this.progress = new Uint8Array(size);
    this.pressure = new CapturePressure(size);
    this.paths = new LandPaths(map, false);
    this.adjacency = new FactionAdjacency(map, this.owners, tile => this.paths.walkable(tile));
    this.waterPaths = new WaterPaths(map, false);
    this.routePlanner = new RoutePlanner(this.paths,this.waterPaths,{
      allowExclusiveRetry: request => request.context.kind !== "domain" || request.context.owner !== "trade",
      priority: request => !this.player(request.context.playerId ?? 0)?.ai && request.context.playerId !== 0 &&
        (request.context.kind !== "domain" || !["trade", "strategy"].includes(request.context.owner)),
      identity:request=>({playerId:request.context.playerId ?? 0,
        caller:request.context.kind === "domain" ? request.context.owner : request.context.kind}),
      prepare:(request,budget,rays)=>{
        const task=request.context;
        if(task.kind!=="navigation")return {work:1,failed:true};
        const squad=this.squad(task.squadId),target=this.squad(task.targetId??-1);
        if(!squad || !target || !task.firing)return {work:1,failed:true};
        const search=new FiringPositions(map,this.paths,request.start,squad.kind,target,task.firing.range,task.firing),forts=this.expansion?.fortifications;
        const used=search.step(budget,rays,this.obstacleTest(squad.playerId),forts?(from,to)=>forts.clear(from,to,squad.playerId):undefined,
          forts?point=>forts.clearMovement(point,point,squad.playerId,squadRadius(squad.kind)):undefined);
        if(!search.state.done)return used;
        const goals=search.state.candidates.map(c=>c.tile);
        return {...used,failed:!goals.length,goal:goals[0],alternatives:goals.slice(1)};
      },
      valid: request => {
        const task=request.context;
        if(task.kind==="domain")return this.domainConsumer(task.owner)?.validRoute(task) ?? false;
        if(task.kind==="ship-admission")return this.shipAdmission.valid(task.admissionId,task.shipId);
        const squad=this.squad(task.squadId);
        if(task.kind==="admission")return this.movementAdmission.valid(task.admissionId,task.squadId);
        return !!squad && squad.embarkedOn===null && !squad.refit &&
          (task.generation===undefined || task.generation===this.aiGeneration(squad.playerId)) &&
          (this.orderRevisions.get(squad.id)??0)===task.revision &&
          (task.operation==="pursuit"
            ? squad.order.type==="attack" && squad.order.targetId===task.targetId && !!this.squad(task.targetId??-1) && this.squad(task.targetId!)!.embarkedOn===null && this.hostile(squad.playerId,this.squad(task.targetId!)!.playerId) && this.tileOf(this.squad(task.targetId!)!)===task.targetTile
            : (squad.order.type==="move" || squad.order.type==="board") && squad.order.tile===request.goal);
      },
      obstacleRevision:request=>request.water ? "water" : request.context.kind === "domain" ? this.domainRoutePorts.revision(request.context.playerId, request.context.owner) : this.routingObstacleRevision(request.context.playerId),
      blocked:request=>{if(request.water)return undefined;if(request.context.kind==="domain"){const task=request.context;if(task.owner==="trade")return this.expansion?.trade.routeBlocked(task);return this.obstacleTest(task.playerId);}if(request.context.kind==="ship-admission")return undefined;const squad=this.squad(request.context.squadId);return squad ? this.obstacleTest(squad.playerId) : undefined;},
      completed:(request,outcome,path)=>{
        if (request.context.kind === "domain") { this.domainConsumer(request.context.owner)?.completedRoute(request.context,outcome,path); return; }
        if(request.context.kind==="ship-admission") {
          this.shipAdmission.completed(request.context.admissionId,request.context.shipId,outcome,path,this.tick);return;
        }
        if(request.context.kind==="admission"){
          this.movementAdmission.completed(request.context.admissionId,request.context.squadId,outcome,path,this.tick);return;
        }
        const squad=this.squad(request.context.squadId);
        if (!squad) return;
        if(request.context.kind==="navigation"&&request.context.operation==="pursuit"&&outcome==="unreachable"&&!this.player(squad.playerId)?.ai){
          const target=this.squad(request.context.targetId??-1);
          if(target)this.playerAttacks.failed(squad,target,this.tick,this.tileOf(target));
        }
        const queued = this.queuedLegs.get(squad.id);
        if (queued && outcome === "unreachable") {
          this.queuedLegs.delete(squad.id); this.finishOrder(squad); return;
        }
        if (queued && outcome === "limited") {
          const retry = limitedRouteRetry(queued.attempts, this.tick, this.routePlanner.pausesCommittedLimits);
          queued.attempts = retry.attempts; queued.retryAt = retry.retryAt;
          if (retry.exhausted) { queued.paused = true; this.squadEntities.updateOwned(squad.id, { planningPaused: true }); }
        }
        if(outcome!=="complete" || this.tileOf(squad)!==request.start)return;
        this.queuedLegs.delete(squad.id);
        this.squadEntities.updateOwned(squad.id, { path: path });this.squadEntities.updateOwned(squad.id, { nextPathIndex: 0 });this.squadEntities.updateOwned(squad.id, { lastPlanTick: this.tick });
        if(request.context.targetTile!==undefined)this.squadEntities.updateOwned(squad.id, { plannedTile: request.context.targetTile });
        this.advanceNavigation(squad);
      },
    });
    this.shipAdmission = new ShipMovementAdmission(map,this.waterPaths,{
      priority: id => !this.player(id)?.ai,
      ship:id=>this.ship(id), tileOf:ship=>this.tileOf(ship),generation:id=>this.aiGeneration(id),
      available:ship=>(!ship.shoreTransfer || ["landing","afloat"].includes(ship.shoreTransfer.phase) ||
        (!this.player(ship.playerId)?.ai && ship.shoreTransfer.phase!=="boarding")) &&
        (!this.player(ship.playerId)?.ai || (!ship.boarding && !["returning-to-dock","waiting-for-dock","repairing","returning-to-patrol"].includes(ship.repairState??""))),
      request:(id,playerId,shipId,start,goal)=>this.routePlanner.request({key:`ship-admission:${id}:${shipId}`,start,goal,water:true,createdTick:this.tick,
        obstacleRevision:"water",context:{kind:"ship-admission",admissionId:id,playerId,shipId}}),
      cancel:(id,shipId)=>this.routePlanner.cancel(`ship-admission:${id}:${shipId}`),
      paused:(ship,paused)=>{ if (paused || ship.planningPaused !== undefined) this.shipEntities.updateOwned(ship.id, { planningPaused: paused ? true : undefined }); },
      commit:(ship,goal,path,index,append,recovery)=>{
        if(ship.shoreTransfer)this.shipEntities.updateOwned(ship.id,{shoreTransfer:{...ship.shoreTransfer,phase:"afloat"}});
        if (ship.planningPaused !== undefined) this.shipEntities.updateOwned(ship.id, { planningPaused: undefined });
        if(recovery){this.shipEntities.updateOwned(ship.id, { destination: goal });this.shipEntities.updateOwned(ship.id, { path: path });this.shipEntities.updateOwned(ship.id, { nextPathIndex: index });this.shipEntities.updateOwned(ship.id, { waypoints: append });}
        else this.setShipVoyage(ship,goal,path,index,append);
      },
      queue:(ship,goal)=>{this.shipEntities.updateOwned(ship.id, { attackTargetId: null });this.cancelBoarding(ship);this.shipEntities.updateOwned(ship.id, { waypoints: [...ship.waypoints, goal] });},
    });
    this.formations = new Formations(map, this.paths, this.collisionHostile);
    this.movementAdmission = new MovementAdmission(map,this.paths,{
      hostile: this.collisionHostile,
      squads:()=>this.squads,priority:id=>!this.player(id)?.ai,squad:id=>this.squad(id),generation:id=>this.aiGeneration(id),revision:id=>this.routingObstacleRevision(id),
      blocked:id=>this.obstacleTest(id),
      request:(id,playerId,squadId,start,goal)=>this.routePlanner.request({key:`admission:${id}:${squadId}`,start,goal,water:false,createdTick:this.tick,
        obstacleRevision:this.routingObstacleRevision(playerId),context:{kind:"admission",admissionId:id,playerId,squadId}}),
      cancel:(id,squadId)=>this.routePlanner.cancel(`admission:${id}:${squadId}`),
      queue:(squad,order)=>{
        if (squad.order.type === "hold" && order.type === "move") {
          this.movementAdmission.startQueued(squad,order,this.tick);
        } else {
          this.squadEntities.updateOwned(squad.id, { queuedOrders: [...squad.queuedOrders, structuredClone(order)] });
          if (squad.order.type === "hold") this.finishOrder(squad);
          else this.formations.refresh(squad);
        }
      },
      clear:(squad,end)=>traversable(map,squad,end,squadRadius(squad.kind)) &&
        (!this.expansion || this.expansion.fortifications.clearMovement(squad,end,squad.playerId,squadRadius(squad.kind))),
      destinationValid:(squad,point,selected,structureTarget)=>{
        if(!this.aiFootprintAllowed(squad.playerId, pointTile(map,point)) || !standable(map,point,squadRadius(squad.kind)) || (this.expansion && !this.expansion.fortifications.clearMovement(point,point,squad.playerId,squadRadius(squad.kind))))return false;
        if (structureTarget && this.expansion) {
          const building = structureTarget.buildingId === undefined ? undefined : this.building(structureTarget.buildingId),
            wall = structureTarget.barrierId === undefined ? undefined : this.expansion.fortifications.barrier(structureTarget.barrierId), target = building ?? wall;
          if (!target || (target.health ?? 1) <= 0 || !this.hostile(squad.playerId, target.playerId) ||
            !structureAim(point, building ? [building.tile] : wall!.tiles, this.expansion.unit(squad).attack.range,
              squad.playerId, map.width(), this.expansion.fortifications)) return false;
        }
        const nearby:Squad[]=[];this.spatial.query(point.x,point.y,2*FIXED,nearby);
        return nearby.every(other=>selected.has(other.id) || distanceSquared(point,other)>=squadSeparation(squad, other, this.collisionHostile)**2);
      },
      commit:(squad,point,path,index,append,structureTarget)=>{
        this.activateOrder(squad,this.formationMove(point));
        this.squadEntities.updateOwned(squad.id, { path: path });this.squadEntities.updateOwned(squad.id, { nextPathIndex: index });this.squadEntities.updateOwned(squad.id, { lastPlanTick: this.tick });
        this.squadEntities.updateOwned(squad.id, { queuedOrders: append.map(order=>({...order})) });this.squadEntities.updateOwned(squad.id, { charge: null });this.squadEntities.updateOwned(squad.id, { structureTarget: structureTarget ?? null });
      },
    });
    this.movementAdmission.onEvent = event => this.commandApplications.observe("land", event);
    this.shipAdmission.onEvent = event => {this.commandApplications.observe("water", event);this.shoreTransport?.observeSailing(event);};
    this.avoidance = new LocalAvoidance(map, this.collisionHostile);
    this.passageTraffic = new PassageTraffic(map, this.paths);
    this.spatial = new SpatialGrid(
      map.width() * FIXED,
      map.height() * FIXED,
      2 * FIXED,
      squad=>squad.playerId,
    );
    this.heldSpatial = new SpatialGrid(
      map.width() * FIXED,
      map.height() * FIXED,
      2 * FIXED,
      squad=>squad.playerId,
    );
    this.localDetours = new LocalDetours(map, this.spatial, this.collisionHostile);
    this.homeTerritory = new HomeTerritory(map);
    this.navalSpatial = new SpatialGrid(
      map.width() * FIXED,
      map.height() * FIXED,
      4 * FIXED,
    );
    this.buildingIndex = new BuildingIndex(map);
    this.coast = new CoastIndex(map, this.paths, this.waterPaths);
    const transportSquads = () => this.squads;
    const transportShips = () => this.ships;
    this.shoreTransport = new ShoreTransport({
      map, paths: this.paths, domainRoutes:this.domainRoutes,
      squad:id=>this.squad(id),ship:id=>this.ship(id),capacity:ship=>this.expansion?this.expansion.vessel(ship).capacity:SHIP_RULES.transport.capacity,
      owned:(tile,owner)=>this.owners[tile]===owner,
      boardCandidates:(ship,members)=>{
        const land=this.paths.component[this.tileOf(members[0])];
        if(members.some(s=>this.paths.component[this.tileOf(s)]!==land))return [];
        return this.coast.candidates(land,this.waterPaths.component[this.tileOf(ship)]);
      },
      commitBoard:(ship,meeting,seaPath,index,members)=>{
        this.shipAdmission.cancel([ship.id],this.tick);this.cancelBoarding(ship);
        this.shipEntities.updateOwned(ship.id,{boarding:meeting,destination:meeting.waterTile,waypoints:[],path:seaPath,nextPathIndex:index});
        for(const member of members){this.squadEntities.updateOwned(member.squad.id,{queuedOrders:[]});this.activateOrder(member.squad,{type:"board",shipId:ship.id,tile:pointTile(map,member.point)},member.path);this.squadEntities.updateOwned(member.squad.id,{nextPathIndex:member.index});}
      },
      get squads() { return transportSquads(); },
      get ships() { return transportShips(); },
      removeShip: id => this.removeShip(id),
      updateSquad: (id, changes) => this.squadEntities.updateOwned(id, changes),
      updateShip: (id, changes) => this.shipEntities.updateOwned(id, changes),
      cargo: id => this.squadIndex.cargo(id),
      blocked: (tile, playerId) => this.armyBlocked(tile, playerId),
      hasObstacles: () => !!this.options.aiWarPolicy || (this.expansion?.fortifications.hasObstacles ?? false),
      slots: (tile, squads, reserved, radius, blocked) => this.formations.plan(tile,
        squads.map(squad => ({squad,origin:squad})),reserved,radius,undefined,blocked),
      activate: (squad, order, path) => this.activateOrder(squad, order, path),
      launch: (playerId, definition, tile) => {
        const ship: Ship = {id:this.nextId++,playerId,kind:"transport",...tilePoint(map,tile),
          health:definition.health,definitionId:definition.id,destination:null,waypoints:[],path:[],
          nextPathIndex:0,fighting:false,boarding:null};
        return this.addShip(ship);
      },
      landingAllowed:(id,tile)=>this.aiFootprintAllowed(id,tile) &&
        (!this.expansion?.operations.enabled(this.player(id)) || this.expansion.operations.state(id)?.phase!=="recovery" || this.owners[tile]===id),
      unload: (ship,tile) => this.unload(this.player(ship.playerId)!,ship.id,tile),
      unloadPrepared:(ship,members,tile)=>this.unloadPrepared(ship,members,tile),
      sailForLanding:(ship,tile)=>{
        if(this.options.deferredPlanning){
          const rejection=this.shipAdmission.command(this.player(ship.playerId)!,[ship],tile,false,this.tick);
          return {rejection,admissionId:rejection===null?this.shipAdmission.replacement(ship.id):undefined};
        }
        const path=this.waterPaths.find(this.tileOf(ship),tile);
        if(path===null)return {rejection:"That coast cannot be reached by this transport"};
        this.setShipVoyage(ship,tile,[this.tileOf(ship),...path],0,[]);
        return {rejection:null};
      },
      sailingPending:ship=>this.shipAdmission.replacement(ship.id)!==undefined||this.shipAdmission.executing(ship.id),
      resume: (squad,tile) => {
        if(this.options.deferredPlanning&&this.paths.connected(this.tileOf(squad),tile)){this.movementAdmission.start(squad.playerId,[squad],tile,this.tick,undefined,this.player(squad.playerId)?.ai);return;}
        const completed = this.expansion?.progression.states[squad.playerId]?.completed ?? [];
        const definition = shoreTransportDefinition(completed);
        if (!this.paths.connected(this.tileOf(squad),tile) || (definition && this.shoreTransport.useful(squad,tile,definition))) {
          if (definition && this.shoreTransport.start(squad.playerId,[squad],tile,definition,shoreTransportCapacity(completed),true) === null) return;
        } else {
          const blocked = (t:number) => this.expansion?.fortifications.blocked(t,squad.playerId) ?? false;
          const slots = this.formations.plan(tile,[{squad,origin:squad}],this.squads,undefined,undefined,blocked);
          const point = slots?.get(squad.id);
          const path = point ? this.paths.find(this.tileOf(squad),pointTile(map,point),this.obstacleTest(squad.playerId)) : null;
          if (point && path !== null) {
            this.activateOrder(squad,{type:"move",tile:pointTile(map,point),...point},path); return;
          }
        }
        this.activateOrder(squad,{type:"hold"});
      },
    }, new ShoreRoutes(map,this.paths,this.waterPaths,this.coast));
    if (options.ruleset === "ages-v1")
      this.expansion = new Expansion(
        this,
        options.seed,
        options.victoryMode,
        options.technologySpeed,
        options.startingAge ?? "StoneAge",
      );
    this.createPlayers();
    this.expansion?.supply.ensureStartingResources(
      this.players, this.owners, this.paths, this.buildings,
    );
    // Crossing trees are built a few per tick instead of all at construction
    // (about 5 s on a 1000 x 1000 map); queries build any they need first.
  }

  private createPlayers(): void {
    const roster = new FactionRoster(this.options.seed, FACTIONS);
    const humanNames = this.options.humanNames ?? ["You"];
    const placement = new SpawnSelection(this.map, this.options, this.paths);
    const bases = placement.resolve();
    const regularCount = this.options.aiCount + humanNames.length;
    bases.slice(0, regularCount).forEach((base, index) => {
      const faction = index < humanNames.length ? null : roster.take("regular");
      this.deployPlayer(
        base,
        index + 1,
        "regular",
        humanNames[index] ?? faction!.identity.name,
        faction?.identity.id,
        faction?.personalityId,
      );
    });
    if (this.options.tribes) {
      const count = matchTribeCount(
        this.options,
        this.map.width(),
        this.map.height(),
      );
      for (let index = 0; index < count; index++) {
        const faction = roster.take("tribe");
        this.deployPlayer(
          bases[regularCount + index],
          regularCount + index + 1,
          "tribe",
          faction.identity.name,
          faction.identity.id,
          faction.personalityId,
        );
      }
    }
  }

  private deployPlayer(
    base: number,
    id: number,
    kind: Player["kind"],
    name: string,
    factionId?: string,
    personalityId?: AiPersonalityId,
  ): void {
    const opening = this.expansion ? startingEconomy(this.expansion.startingAge, kind === "tribe") : undefined;
    const player: Player = {
      id,
      name,
      ...(this.options.humanColors?.[id - 1] != null ? { colorIndex: this.options.humanColors[id - 1]! } : {}),
      ...(factionId ? { factionId, personalityId } : {}),
      ai: id > (this.options.humanNames?.length ?? 1),
      kind,
      colorKind: kind,
      base,
      reserves: opening?.reserves ?? (
        kind === "tribe"
          ? TRIBE_STARTING_RESERVES
          : this.expansion && kind === "regular"
            ? STARTING_AGE_TROOPS
            : STARTING_TROOPS),
      ...(this.options.infiniteGoldForPlayers && id <= (this.options.humanNames?.length ?? 1) ? { infiniteGold: true } : {}),
      gold: opening?.gold ?? (kind === "tribe" ? TRIBE_STARTING_GOLD : STARTING_GOLD),
      land: 0,
      losses: 0,
      kills: 0,
      recruited: 0,
      eliminated: false,
    };
    this.players.push(player);
    this.expansion?.add(player);
    this.eachInRadius(
      base,
      kind === "tribe" ? TRIBE_BASE_RADIUS : BASE_RADIUS,
      (tile) => {
        if (this.paths.component[tile] === this.paths.component[base])
          this.changeOwner(tile, player.id);
      },
    );
    if (this.expansion && kind === "regular") {
      this.deployStartingSquads(player, 3, this.expansion.startingAge);
      return;
    }
    const age = this.expansion && kind === "tribe" ? this.expansion.startingAge : undefined;
    const barracks = this.addBuilding({
      id: this.nextId++, playerId: player.id, type: "barracks", tile: base, remainingTicks: 0,
      ...(age ? { age, maxHealth: buildingIntegrity("barracks", age), health: buildingIntegrity("barracks", age) } : {}),
    });
    forestOf(this.map)?.occupy(this.map, base, "barracks");
    if (age) {
      this.deployStartingSquads(player, TRIBE_STARTING_SQUADS, age);
      return;
    }
    for (let i = 0; i < (kind === "tribe" ? TRIBE_STARTING_SQUADS : 4); i++)
      this.recruit(player, barracks.id, undefined, kind === "tribe" ? "complete" : "instant");
    if (kind === "tribe") {
      player.reserves = TRIBE_STARTING_RESERVES;
      player.gold = TRIBE_STARTING_GOLD;
    }
  }

  private deployStartingSquads(player: Player, count: number, startingAge: Age): void {
      const positions: number[] = [];
      this.eachInRadius(player.base, 4, (tile) => {
        if (
          this.paths.connected(player.base, tile) &&
          standable(
            this.map,
            tilePoint(this.map, tile),
            squadRadius("infantry"),
          )
        )
          positions.push(tile);
      });
      positions.sort(
        (a, b) =>
          this.map.euclideanDistSquared(a, player.base) -
            this.map.euclideanDistSquared(b, player.base) || a - b,
      );
      for (const tile of positions) {
        const point = tilePoint(this.map, tile);
        if (
          this.squads.some(
            (s) =>
              s.playerId === player.id && distanceSquared(s, point) < FIXED ** 2 * 2,
          )
        )
          continue;
        this.spawnSquad(
          player,
          "infantry",
          tile,
          defaultUnit("infantry", startingAge).id,
          false,
        );
        if (this.squadIndex.byOwner(player.id).length === count) break;
      }
  }

  player(id: number): Player | undefined {
    if (this.players[id - 1]?.id === id) return this.players[id - 1];
    return this.players.find((p) => p.id === id);
  }
  squadCapacity(player: Player): number {
    return squadCap(player, this.expansion?.progression.states[player.id]?.age);
  }
  squad(id: number): Squad | undefined { return this.squadEntities.get(id); }
  ship(id: number): Ship | undefined { return this.shipEntities.get(id); }
  addSquad(squad: Squad): Squad { return this.squadEntities.add(squad); }
  addShip(ship: Ship): Ship { return this.shipEntities.add(ship); }
  updateSquad(id: number, changes: Partial<Omit<Squad, "id">>): Squad | undefined { return this.squadEntities.update(id, changes); }
  updateShip(id: number, changes: Partial<Omit<Ship, "id">>): Ship | undefined { return this.shipEntities.update(id, changes); }
  /** @internal Transfer a finalized domain path; the caller releases writable aliases. */
  installSquadPath(id: number, path: readonly number[]): void { this.squadEntities.updateOwned(id, { path }); }
  removeSquad(id: number): boolean { this.playerAttacks.forget(id);return this.squadEntities.remove(id); }
  removeShip(id: number): boolean { return this.shipEntities.remove(id); }
  squadFacts(): UnitQueries<Squad> { if (this.compareUnitIndexes) this.verifyUnitIndexes(); return this.squadIndex; }
  shipFacts(): UnitQueries<Ship> { if (this.compareUnitIndexes) this.verifyUnitIndexes(); return this.shipIndex; }
  verifyUnitIndexes(): void { this.squadIndex.verify(this.squads); this.shipIndex.verify(this.ships); }
  building(id: number): Building | undefined { return this.buildingEntities.get(id); }
  buildingFacts(): BuildingQueries {
    if (this.compareBuildingIndexes) this.verifyBuildingIndexes();
    return this.buildingIndex;
  }
  addBuilding(building: Building): Building { return this.buildingEntities.add(building); }
  updateBuilding(id: number, changes: Partial<Omit<Building, "id">>): Building | undefined { return this.buildingEntities.update(id, changes); }
  removeBuilding(id: number): boolean { return this.buildingEntities.remove(id); }
  verifyBuildingIndexes(): void { this.buildingIndex.verify(this.buildings); }
  tileOf(squad: Pick<Squad, "x" | "y">): number {
    return this.map.ref(
      Math.floor(squad.x / FIXED),
      Math.floor(squad.y / FIXED),
    );
  }

  applyCommand(command: Command): string | null {
    const invalid = commandRejection(command);
    if (invalid) return invalid;
    const player = this.player(command.playerId);
    if (!player || player.eliminated || this.winner !== null)
      return "This player cannot issue orders";
    if (command.type === "delete-building") {
      if (player.ai) return "AI factions cannot delete buildings";
      const building = this.building(command.buildingId);
      if (!building || building.playerId !== player.id || this.owners[building.tile] !== player.id)
        return "Select a building on your own territory";
      this.removeBuilding(building.id);
      this.expansion?.supply.forgetProducer(building.id);
      this.expansion?.fortifications.forgetBuilding(building, this.buildings);
      while (this.recruitment.cancel(player.id, {buildingIds: new Set([building.id])},
        job => this.refundRecruitment(job))) { /* Apply the ordinary paid-job cancellation policy. */ }
      return null;
    }
    const shipIds = "shipIds" in command ? command.shipIds : "shipId" in command ? [command.shipId] : [];
    const landingControl = command.type === "sail" ||
      command.type === "stop-ships" || command.type === "unload";
    if (shipIds.some(id => this.ships.some(s =>
      s.id === id && s.shoreTransfer &&
      !(landingControl && (["landing", "afloat"].includes(s.shoreTransfer.phase) || (!player.ai && s.shoreTransfer.phase!=="boarding"))))))
      return "Shore transports complete their crossing automatically";
    if (player.kind === "tribe" && this.expansion && command.type === "build") {
      const limit = tribeBuildingLimit(command.buildingType, this.expansion.startingAge);
      if (!limit) return "Tribes cannot build this structure in their starting age";
      const count = this.buildingIndex.countOfType(player.id, command.buildingType);
      if (count >= limit) return `Tribes can only build ${limit} ${command.buildingType}`;
    }
    if (player.kind === "tribe" && !this.expansion) {
      if (command.type === "recruit-ship")
        return "Tribes defend their camp without building an economy or navy";
      if (command.type === "build") {
        if (command.buildingType !== "city" && command.buildingType !== "barracks")
          return "Tribes can only build 1 city and 1 extra barracks";
        const own = this.buildingIndex.byOwner(player.id);
        if (command.buildingType === "city" && own.some((b) => b.type === "city"))
          return "Tribes can only build 1 city";
        if (
          command.buildingType === "barracks" &&
          own.filter((b) => b.type === "barracks").length >= 2
        )
          return "Tribes can only build 1 extra barracks";
      }
    }
    const extended = this.expansion?.command(player, command);
    if (extended !== undefined) {
      if (
        extended === null &&
        (command.type === "charge" || command.type === "attack-structure")
      )
        this.expansion!.armies.observeOrder(command.squadIds);
      return extended;
    }
    if (command.type === "repair")
      return "Repairs are only available in ages mode";
    if (command.type === "cancel-recruitment") {
      const buildingIds = command.buildingIds ??
        (command.buildingId === undefined ? undefined : [command.buildingId]);
      const cancelled = this.recruitment.cancel(player.id, {
        category: command.category,
        definitionId: command.definitionId,
        kind: command.kind,
        buildingIds: buildingIds ? new Set(buildingIds) : undefined,
      }, job => this.refundRecruitment(job));
      return cancelled ? null : "No matching recruitment to cancel";
    }
    if (command.type === "recruit")
      return this.recruit(player, command.buildingId, command.definitionId, "queue", command.autoRecruit === true, command.buildingIds);
    if (command.type === "build")
      return this.build(
        player,
        command.buildingType,
        command.tile,
        command.age,
      );
    if (command.type === "recruit-ship")
      return this.recruitShip(
        player,
        command.buildingId,
        command.shipType,
        command.definitionId,
        false,
        command.autoRecruit === true,
        command.buildingIds,
      );
    if (command.type === "sail")
      return this.sail(
        player,
        command.shipIds,
        command.tile,
        command.append === true,
      );
    if (command.type === "stop-ships") {
      if (!Array.isArray(command.shipIds) || !command.shipIds.length)
        return "Select your ships";
      const ships = [...new Set(command.shipIds)].map((id) =>
        this.ship(id),
      );
      if (ships.some((s) => !s || s.playerId !== player.id))
        return "Select your own ships";
      this.shipAdmission.cancel(command.shipIds,this.tick);
      for (const ship of ships as Ship[]) {
        this.shoreTransport.cancelShip(ship.id);
        this.cancelBoarding(ship);
        this.shipEntities.updateOwned(ship.id, { destination: null });
        this.shipEntities.updateOwned(ship.id, { attackTargetId: null });
        this.shipEntities.updateOwned(ship.id, { waypoints: [] });
        this.shipEntities.updateOwned(ship.id, { path: [] });
        this.shipEntities.updateOwned(ship.id, { nextPathIndex: 0 });
        if(ship.shoreTransfer)this.shipEntities.updateOwned(ship.id,{shoreTransfer:{...ship.shoreTransfer,phase:"afloat"}});
        if (ship.kind === "warship") {
          this.shipEntities.updateOwned(ship.id, { patrolTile: null });
          this.shipEntities.updateOwned(ship.id, { repairPortId: null });
          this.shipEntities.updateOwned(ship.id, { repairState: "idle" });
          this.shipEntities.updateOwned(ship.id, { patrolDwellTicks: 0 });
        }
      }
      return null;
    }
    if (command.type === "load")
      return this.load(player, command.shipId, command.squadIds);
    if (command.type === "board")
      return this.board(player, command.shipId, command.squadIds);
    if (command.type === "unload") {
      const candidate = this.ship(command.shipId);
      const ship = candidate?.playerId === player.id ? candidate : undefined;
      const result=ship?.shoreTransfer
        ? this.shoreTransport.land(ship, command.tile, true)
        : this.unload(player, command.shipId, command.tile);
      if(result===null && ship)this.shoreTransport.cancelVoyage(ship.id,"Manual unloading");
      return result;
    }
    if (
      command.type !== "order" ||
      !Array.isArray(command.squadIds) ||
      !command.order
    )
      return "Invalid order";
    const byId = this.squadEntities;
    const selected = [...new Set(command.squadIds)].map((id) => byId.get(id));
    if (
      selected.length === 0 ||
      selected.some(
        (s) =>
          !s || s.playerId !== player.id || s.embarkedOn !== null || !!s.refit,
      )
    )
      return "You can only command your own squads";
    const order = command.order;
    const append = command.append === true && order.type !== "hold";
    if (
      append &&
      selected.some((s) => s!.queuedOrders.length >= MAX_QUEUED_ORDERS)
    )
      return "A squad can queue up to 32 additional orders";
    if (
      order.type !== "hold" &&
      order.type !== "replenish" &&
      order.type !== "move" &&
      order.type !== "attack"
    )
      return "Invalid order";
    if (order.type === "attack") {
      const target = this.squad(order.targetId);
      if (
        !target ||
        !this.hostile(player.id, target.playerId) ||
        target.embarkedOn !== null
      )
        return "Choose an enemy squad";
    }
    if (order.type === "move" && !this.paths.walkable(order.tile)) {
      if (!this.waterPaths.walkable(order.tile)) return "Choose passable land or navigable water";
      const completed = this.expansion?.progression.states[player.id]?.completed ?? [], definition = shoreTransportDefinition(completed);
      if (!definition) return "Research Cargo Canoes to embark on water";
      if (append && selected.some(s => s!.order.type !== "hold")) {
        for (const squad of selected as Squad[]) this.squadEntities.updateOwned(squad.id, { queuedOrders: [...squad.queuedOrders, {...order}] });
        return null;
      }
      const result = this.shoreTransport.start(player.id, selected as Squad[], order.tile, definition, shoreTransportCapacity(completed));
      if (result === null) this.expansion?.armies.observeOrder(command.squadIds);
      return result;
    }
    if(this.options.deferredPlanning && append && this.movementAdmission.queued(command.squadIds)>=MAX_QUEUED_ORDERS)
      return "A squad can queue up to 32 additional orders";
    if(this.options.deferredPlanning && append && this.movementAdmission.append(command.squadIds,order,this.tick)) {
      this.expansion?.armies.observeOrder(command.squadIds,order,true);
      return null;
    }
    if(this.options.deferredPlanning && !append && order.type==="move" &&
      selected.every(s=>!this.expansion?.armies.armyOf(s!.id) && this.paths.connected(this.tileOf(s!),order.tile))) {
      this.movementAdmission.start(player.id,selected as Squad[],order.tile,this.tick,undefined,player.ai);return null;
    }
    // An appended leg is intent, not an executable route from today's position.
    // Admission preserves every deliberate Shift order without constructing
    // paths that would immediately be discarded.
    if (append && selected.every(s=>s!.order.type!=="hold")) {
      const grouped=this.expansion?.armies.groupOrder(command.squadIds,order,true);
      if(grouped!==undefined)return grouped;
      let slots:Map<number,WorldPoint>|null=null;
      if(order.type==="move") {
        const members=(selected as Squad[]).map(squad=>{
          const last=squad.queuedOrders[squad.queuedOrders.length-1]??squad.order;
          return {squad,origin:last.type==="move" ? this.moveDestination(last) : squad};
        });
        slots=this.formations.plan(order.tile,members,this.squads);
        if(!slots)return "There is no room for this formation at that destination";
      }
      for(const squad of selected as Squad[]){
        const point=slots?.get(squad.id);
        this.squadEntities.updateOwned(squad.id, { queuedOrders: [...squad.queuedOrders, order.type==="move" && point ? this.formationMove(point) : {...order}] });
        this.formations.refresh(squad);
      }
      this.expansion?.armies.observeOrder(command.squadIds,order,true);return null;
    }
    const transportCompleted = this.expansion?.progression.states[player.id]?.completed ?? [];
    const transportDefinition = shoreTransportDefinition(transportCompleted);
    if (order.type === "move" && selected.some(s => !this.paths.connected(this.tileOf(s!),order.tile) ||
      (!this.options.deferredPlanning && transportDefinition && this.shoreTransport.useful(s!,order.tile,transportDefinition)))) {
      const completed = this.expansion?.progression.states[player.id]?.completed ?? [];
      const definition = shoreTransportDefinition(completed);
      if (!definition) return "Research Cargo Canoes to cross water automatically";
      if (append && selected.some(s => s!.order.type !== "hold")) {
        for (const squad of selected as Squad[]) this.squadEntities.updateOwned(squad.id, { queuedOrders: [...squad.queuedOrders, {...order}] });
        return null;
      }
      const result = this.shoreTransport.start(player.id,selected as Squad[],order.tile,definition,shoreTransportCapacity(completed));
      if (result === null) this.expansion?.armies.observeOrder(command.squadIds);
      return result;
    }
    if (
      order.type === "replenish" &&
      selected.some((s) => this.owners[this.tileOf(s!)] !== player.id)
    )
      return "Move every selected squad onto friendly territory before replenishing";
    const armyOrder = this.expansion?.armies.groupOrder(
      command.squadIds,
      order,
      append,
    );
    if (armyOrder !== undefined) {
      if(armyOrder===null && !append)this.movementAdmission.cancel(command.squadIds,this.tick);
      return armyOrder;
    }
    const orders: { squad: Squad; order: Order; path: number[] }[] = [];
    let destinations: Map<number, WorldPoint> | null = null;
    let groupPaths: (number[] | null)[] = [];
    if (order.type === "move") {
      const members = (selected as Squad[]).map((squad) => {
        const last = append
          ? (squad.queuedOrders[squad.queuedOrders.length - 1] ?? squad.order)
          : squad.order;
        const origin =
          append && last.type === "move"
            ? this.moveDestination(last)
            : { x: squad.x, y: squad.y };
        return { squad, origin };
      });
      if (
        members.some(
          ({ origin }) =>
            !this.paths.connected(pointTile(this.map, origin), order.tile),
        )
      )
        return "That destination cannot be reached by land";
      destinations = this.formations.plan(order.tile, members, this.squads);
      if (!destinations)
        return "There is no room for this formation at that destination";
      groupPaths = this.paths.findGroup(
        members.map(({ origin }) => pointTile(this.map, origin)),
        members.map(({ squad }) =>
          pointTile(this.map, destinations!.get(squad.id)!),
        ),
        order.tile,
        this.obstacleTest(player.id),
      );
    }
    for (let i = 0; i < selected.length; i++) {
      const squad = selected[i]!;
      let nextOrder: Order = { ...order };
      let path: number[] = [];
      if (order.type === "move") {
        const destination = destinations!.get(squad.id)!;
        const tile = pointTile(this.map, destination);
        const found = groupPaths[i];
        if (found === null) return "That destination cannot be reached by land";
        path = found;
        nextOrder = this.formationMove(destination);
      } else if (order.type === "attack") {
        const target = this.squad(order.targetId)!;
        if (!this.paths.connected(this.tileOf(squad), this.tileOf(target)))
          return "That enemy cannot be reached by land";
      }
      orders.push({ squad, order: nextOrder, path });
    }
    if(!append)this.movementAdmission.cancel(command.squadIds,this.tick);
    for (const entry of orders) {
      if (this.expansion && !append) {
        this.squadEntities.updateOwned(entry.squad.id, { charge: null });
        this.squadEntities.updateOwned(entry.squad.id, { structureTarget: null });
      }
      if (append && entry.squad.order.type !== "hold") {
        this.squadEntities.updateOwned(entry.squad.id, { queuedOrders: [...entry.squad.queuedOrders, entry.order] });
        this.formations.refresh(entry.squad);
      } else {
        this.squadEntities.updateOwned(entry.squad.id, { queuedOrders: [] });
        this.activateOrder(entry.squad, entry.order, entry.path);
      }
    }
    this.expansion?.armies.observeOrder(command.squadIds, order, append);
    return null;
  }

  private formationMove(destination:WorldPoint):Extract<Order,{type:"move"}> {
    const tile=pointTile(this.map,destination),center=tilePoint(this.map,tile);
    return destination.x===center.x && destination.y===center.y ? {type:"move",tile} : {type:"move",tile,...destination};
  }
  private activateOrder(squad: Squad, order: Order, path: number[] = [], continuingAttack=false): void {
    this.routePlanner.cancel(`navigation:${squad.id}`);
    this.queuedLegs.delete(squad.id);
    if (squad.planningPaused !== undefined) this.squadEntities.updateOwned(squad.id, { planningPaused: undefined });
    this.navigationProgress.delete(squad.id);
    this.detours.delete(squad.id);
    if(squad.movementStatus)this.squadEntities.updateOwned(squad.id,{movementStatus:undefined});
    this.squadEntities.updateOwned(squad.id, { order: structuredClone(order) });
    if(!continuingAttack&&!this.player(squad.playerId)?.ai)this.playerAttacks.observe(squad,order.type==="attack"?this.squad(order.targetId):undefined);
    this.orderRevisions.set(squad.id, (this.orderRevisions.get(squad.id) ?? 0) + 1);
    this.squadEntities.updateOwned(squad.id, { path: order.type === "move" ? [this.tileOf(squad), ...path] : path });
    this.squadEntities.updateOwned(squad.id, { nextPathIndex: 0 });
    this.squadEntities.updateOwned(squad.id, { plannedTile: -1 });
    this.squadEntities.updateOwned(squad.id, { lastPlanTick: -20 });
    this.formations.refresh(squad);
  }

  private finishOrder(squad: Squad): void {
    while (squad.queuedOrders.length) {
      const order = squad.queuedOrders[0];
      this.squadEntities.updateOwned(squad.id, { queuedOrders: squad.queuedOrders.slice(1) });
      if (order.type === "move") {
        if (this.options.deferredPlanning && this.paths.connected(this.tileOf(squad), order.tile)) {
          // The deliberate leg is already committed. Navigation constructs its
          // route through the bounded scheduler while retaining later Shift legs.
          this.activateOrder(squad, order);
          this.squadEntities.updateOwned(squad.id, { path: [] });
          this.queuedLegs.set(squad.id, { attempts: 0, retryAt: this.tick });
          this.requestNavigationRoute(squad, "blocked");
          return;
        }
        const path = this.paths.find(
          this.tileOf(squad),
          order.tile,
          this.obstacleTest(squad.playerId),
        );
        if (path === null) {
          const completed = this.expansion?.progression.states[squad.playerId]?.completed ?? [];
          const definition = shoreTransportDefinition(completed);
          if (definition && this.shoreTransport.start(squad.playerId,[squad],order.tile,definition,shoreTransportCapacity(completed),true) === null) return;
          continue;
        }
        this.activateOrder(squad, order, path);
        return;
      }
      if (order.type === "attack" && !this.squad(order.targetId)) continue;
      this.activateOrder(squad, order);
      return;
    }
    this.activateOrder(squad, { type: "hold" });
  }

  private recruit(
    player: Player,
    buildingId: number,
    definitionId?: string,
    mode: "queue" | "instant" | "complete" = "queue",
    automatic = false,
    buildingIds?: readonly number[],
  ): string | null {
    let building = this.building(buildingId);
    if (buildingIds) {
      const definition = UNIT.get(definitionId ?? "");
      building = this.automaticRecruitmentBuilding(player.id, building?.tile ?? player.base, definition?.building ?? building?.type ?? "barracks", definition?.age ?? "StoneAge", buildingIds);
    }
    if (
      !building ||
      building.playerId !== player.id ||
      this.owners[building.tile] !== player.id ||
      building.remainingTicks > 0
    )
      return "Select a completed friendly military building";
    const definition = this.expansion
      ? UNIT.get(
          definitionId ??
            defaultUnit(BUILDING_RULES[building.type].squad ?? "infantry").id,
        )
      : undefined;
    if (automatic && definition && !buildingIds) building = this.automaticRecruitmentBuilding(player.id, building.tile, definition.building, definition.age) ?? building;
    if (
      this.expansion &&
      (!definition ||
        !this.expansion.progression.has(player.id, definition.technologyId) ||
        definition.building !== building.type ||
        AGES.indexOf(building.age ?? "StoneAge") < AGES.indexOf(definition.age))
    )
      return "Needs the researched definition and its matching building tier";
    if (definition && mode !== "complete") {
      const rejection = costRejection(
        player,
        this.expansion!.supply.inventories[player.id],
        definition.cost,
      );
      if (rejection) return rejection;
    }
    const kind = definition?.line ?? BUILDING_RULES[building.type].squad;
    if (!kind) return "This building does not recruit land squads";
    if (mode !== "complete" && player.reserves < SQUAD_TROOPS)
      return "Recruitment needs 1,000 reserve troops";
    if (
      mode !== "complete" && this.squadIndex.byOwner(player.id).length + this.recruitment.count(player.id, "land") >=
      this.squadCapacity(player)
    )
      return `You have reached the ${this.squadCapacity(player)}-squad limit for this faction`;
    if (this.expansion && mode === "queue") {
      const cost = { ...definition!.cost, reserves: SQUAD_TROOPS };
      spend(player, this.expansion.supply.inventories[player.id], cost);
      const seconds = definition!.tags.includes("vehicle") ? RECRUITMENT_SECONDS.vehicle
        : definition!.tags.includes("siege") ? RECRUITMENT_SECONDS.siege : RECRUITMENT_SECONDS[kind];
      this.recruitment.enqueue({ playerId: player.id, buildingId: building.id, category: "land", kind,
        definitionId: definition!.id, cost: paidCost(player, cost), totalTicks: seconds * TICKS_PER_SECOND });
      return null;
    }
    const candidates: number[] = [];
    this.eachInRadius(building.tile, BASE_RADIUS - 1, (tile) => {
      if (
        this.owners[tile] === player.id &&
        this.paths.connected(tile, building.tile)
      )
        candidates.push(tile);
    });
    let best = -1,
      score = -Infinity;
    const landSquads = this.squads.filter((s) => s.embarkedOn === null);
    const ownSquads = landSquads.filter((s) => s.playerId === player.id);
    const recruitGeometry = { kind, playerId: player.id };
    for (const tile of candidates) {
      const point = tilePoint(this.map, tile),
        radius = squadRadius(kind);
      if (
        !standable(this.map, point, radius) ||
        landSquads.some(
          (s) =>
            distanceSquared(point, s) <
            squadSeparation(recruitGeometry, s, this.collisionHostile) ** 2,
        )
      )
        continue;
      const separation = ownSquads.length
        ? Math.min(
            ...ownSquads.map((s) =>
              this.map.euclideanDistSquared(tile, this.tileOf(s)),
            ),
          )
        : 0;
      const candidateScore =
        separation * 100 - this.map.euclideanDistSquared(tile, building.tile);
      if (candidateScore > score) {
        best = tile;
        score = candidateScore;
      }
    }
    if (best < 0) return "Clear room around the building before recruiting";
    if (definition && mode !== "complete")
      spend(player, this.expansion!.supply.inventories[player.id], {
        ...definition.cost,
        reserves: 0,
      });
    this.spawnSquad(player, kind, best, definition?.id, mode !== "complete");
    return null;
  }

  allocateId(): number {
    return this.nextId++;
  }
  ownedLand(playerId: number): Iterable<number> {
    return this.ownedTiles.get(playerId) ?? [];
  }
  // Ownership sets are derived from `owners`; checkpoints omit them and restore
  // rebuilds them. Every consumer is therefore independent of insertion order.
  private rebuildOwnedTiles(): void {
    this.ownedTiles.clear();
    this.ownedWater.clear();
    for (let tile = 0; tile < this.owners.length; tile++) {
      const id = this.owners[tile];
      if (!id) continue;
      const index = this.map.isLand(tile) ? this.ownedTiles : this.ownedWater;
      let tiles = index.get(id);
      if (!tiles) index.set(id, (tiles = new Set()));
      tiles.add(tile);
    }
  }
  ownedLandNearest(playerId: number, anchor: number, limit: number, after?: number): number[] {
    // Bounded max-heap of (distance, tile): O(n log limit), no full sort.
    const distances: number[] = [],
      tiles: number[] = [];
    const afterDistance = after === undefined ? -1 : this.map.euclideanDistSquared(after, anchor);
    const worse = (a: number, b: number) =>
      distances[a] > distances[b] ||
      (distances[a] === distances[b] && tiles[a] > tiles[b]);
    const swap = (a: number, b: number) => {
      [distances[a], distances[b]] = [distances[b], distances[a]];
      [tiles[a], tiles[b]] = [tiles[b], tiles[a]];
    };
    const down = (at: number) => {
      for (;;) {
        let top = at;
        const left = 2 * at + 1,
          right = left + 1;
        if (left < tiles.length && worse(left, top)) top = left;
        if (right < tiles.length && worse(right, top)) top = right;
        if (top === at) return;
        swap(at, top);
        at = top;
      }
    };
    for (const tile of this.ownedTiles.get(playerId) ?? []) {
      const d = this.map.euclideanDistSquared(tile, anchor);
      if (d < afterDistance || (d === afterDistance && tile <= after!)) continue;
      if (tiles.length < limit) {
        distances.push(d);
        tiles.push(tile);
        for (let at = tiles.length - 1; at > 0; ) {
          const parent = (at - 1) >> 1;
          if (!worse(at, parent)) break;
          swap(at, parent);
          at = parent;
        }
      } else if (d < distances[0] || (d === distances[0] && tile < tiles[0])) {
        distances[0] = d;
        tiles[0] = tile;
        down(0);
      }
    }
    return tiles
      .map((tile, i) => ({ tile, d: distances[i] }))
      .sort((a, b) => a.d - b.d || a.tile - b.tile)
      .map(({ tile }) => tile);
  }
  hostile(a: number, b: number): boolean {
    return this.expansion ? this.expansion.diplomacy.hostile(a, b) : a !== b;
  }
  recordMilitaryLosses(
    victims: { id: number; playerId: number }[],
    damage: DamageLedger,
  ): void {
    this.conquest.losses(victims, damage);
  }
  recordNavalLosses(victims: Ship[], damage: DamageLedger): void {
    this.conquest.losses(victims, damage);
  }
  private spawnSquad(
    player: Player,
    kind: Squad["kind"],
    tile: number,
    definitionId?: string,
    consumeReserves = true,
  ): void {
    if (consumeReserves) player.reserves -= SQUAD_TROOPS;
    const recruited = this.addSquad({
      id: this.nextId++,
      playerId: player.id,
      x: this.map.x(tile) * FIXED + FIXED / 2,
      y: this.map.y(tile) * FIXED + FIXED / 2,
      troops: SQUAD_TROOPS,
      kind,
      ...(this.expansion
        ? {
            definitionId: definitionId ?? defaultUnit(kind).id,
            xp: 0,
            nextAttackTick: 0,
            refit: null,
            charge: null,
            chargeReadyTick: 0,
            structureTarget: null,
          }
        : {}),
      embarkedOn: null,
      lastCombatTick: -REPLENISH_DELAY,
      moved: false,
      firingCharge: 0,
      order: { type: "hold" },
      queuedOrders: [],
      path: [],
      nextPathIndex: 0,
      plannedTile: -1,
      lastPlanTick: -20,
      fighting: false,
      combatTargetId: null,
    });
    this.spatial.insert(recruited);
    this.formations.refresh(recruited);
  }

  buildingSite(playerId: number, type: BuildingType, tile: number, age?: Age): string | null {
    const player = this.player(playerId);
    if (!player) return "Unknown player";
    const rejection = this.expansion?.buildRejection(player, type, tile,
      age ?? this.expansion.progression.states[playerId].age, true);
    if (rejection) return rejection;
    return constructionRejection(this.map, this.owners, this.buildingIndex, player, type, tile, false);
  }
  towersNear(tile:number,radius:number):Iterable<Building> {
    return this.buildingIndex.towersNearby(tile,radius);
  }
  buildingPlacement(
    playerId: number,
    type: BuildingType,
    tile: number,
    age?: Age,
  ): string | null {
    if (this.expansion) {
      const player = this.player(playerId);
      if (!player) return "Unknown player";
      const rejection = this.expansion.buildRejection(
        player,
        type,
        tile,
        age ?? this.expansion.progression.states[playerId].age,
      );
      if (rejection) return rejection;
    }
    return constructionRejection(
      this.map,
      this.owners,
      this.buildingIndex,
      this.player(playerId),
      type,
      tile,
    );
  }
  private build(
    player: Player,
    type: BuildingType,
    tile: number,
    age?: Age,
  ): string | null {
    const rejection = this.buildingPlacement(player.id, type, tile, age);
    if (rejection) return rejection;
    const existingCount = this.buildingIndex.countOfType(player.id, type);
    if (!this.expansion) {
      spendGold(player, Math.round(
        BUILDING_RULES[type].cost * buildingCostMultiplier(existingCount),
      ));
    }
    const ticks = buildingTicks(type, existingCount);
    const building = this.addBuilding({
      id: this.nextId++,
      playerId: player.id,
      type,
      tile,
      remainingTicks: ticks,
      buildTicks: ticks,
      ...(this.expansion
        ? { age: age ?? this.expansion.progression.states[player.id].age }
        : {}),
    });
    this.expansion?.built(player, building);
    forestOf(this.map)?.occupy(this.map, tile, type);
    return null;
  }

  private automaticRecruitmentBuilding(playerId: number, anchorTile: number, type: BuildingType, age: Age, buildingIds?: readonly number[]): Building | undefined {
    return this.recruitment.chooseProducer(this.buildingIndex.byType(playerId, type).filter(b => (!buildingIds || buildingIds.includes(b.id))
      && this.owners[b.tile] === playerId && !b.remainingTicks && (b.health ?? 1) > 0
      && AGES.indexOf(b.age ?? "StoneAge") >= AGES.indexOf(age)
      && (type !== "port" || this.map.neighbors(b.tile).some(t => this.waterPaths.walkable(t)))),
      tile => this.map.euclideanDistSquared(tile, anchorTile));
  }

  private stepRecruitment(): void {
    this.recruitment.step(this.buildings, this.owners, (job) => {
      const player = this.player(job.playerId)!;
      if (job.category === "land")
        return this.recruit(player, job.buildingId, job.definitionId, "complete") === null;
      if (job.category === "ship")
        return this.recruitShip(player, job.buildingId, job.kind as ShipType, job.definitionId, true) === null;
      return this.expansion!.completeAircraft(job);
    }, job => this.refundRecruitment(job), id => this.building(id));
  }

  private refundRecruitment(job: RecruitmentJob): void {
    const player = this.player(job.playerId);
    if (!player) return;
    player.gold += job.cost.gold ?? 0;
    player.reserves += job.cost.reserves ?? 0;
    const inventory = this.expansion?.supply.inventories[player.id];
    if (inventory)
      for (const [item, quantity] of Object.entries(job.cost.items ?? {}))
        inventory[item] = (inventory[item] ?? 0) + quantity;
  }

  private replenish(): void {
    if (this.tick % TICKS_PER_SECOND !== 0) return;
    for (const squad of this.squads) {
      if (
        squad.embarkedOn !== null ||
        squad.order.type !== "replenish" ||
        this.owners[this.tileOf(squad)] !== squad.playerId ||
        this.tick - squad.lastCombatTick < REPLENISH_DELAY ||
        squad.fighting
      )
        continue;
      const player = this.player(squad.playerId)!;
      const amount = Math.min(
        REPLENISH_PER_SECOND,
        SQUAD_TROOPS - squad.troops,
        player.reserves,
      );
      this.squadEntities.updateOwned(squad.id, { troops: squad.troops + (amount) });
      player.reserves -= amount;
      if (squad.troops === SQUAD_TROOPS) this.finishOrder(squad);
    }
  }

  private recruitShip(
    player: Player,
    buildingId: number,
    kind: ShipType,
    definitionId?: string,
    completing = false,
    automatic = false,
    buildingIds?: readonly number[],
  ): string | null {
    if (!Object.prototype.hasOwnProperty.call(SHIP_RULES, kind))
      return "Unknown ship type";
    let port = this.building(buildingId);
    if (buildingIds) port = this.automaticRecruitmentBuilding(player.id, port?.tile ?? player.base, "port", VESSEL.get(definitionId ?? `stoneage-${kind}`)?.age ?? "StoneAge", buildingIds);
    if (
      !port ||
      port.type !== "port" ||
      port.playerId !== player.id ||
      this.owners[port.tile] !== player.id ||
      port.remainingTicks > 0
    )
      return "Select a completed friendly port";
    const vessel = this.expansion
      ? VESSEL.get(definitionId ?? `stoneage-${kind}`)
      : undefined;
    if (automatic && vessel && !buildingIds) port = this.automaticRecruitmentBuilding(player.id, port.tile, "port", vessel.age) ?? port;
    if (
      this.expansion &&
      (!vessel ||
        vessel.kind !== kind ||
        !this.expansion.progression.has(player.id, vessel.technologyId) ||
        AGES.indexOf(port.age ?? "StoneAge") < AGES.indexOf(vessel.age))
    )
      return "Research this vessel and build its port tier";
    if (vessel && !completing) {
      const rejection = costRejection(
        player,
        this.expansion!.supply.inventories[player.id],
        vessel.cost,
      );
      if (rejection) return rejection;
    }
    const rules = vessel
      ? { ...vessel, cost: vessel.cost.gold ?? 0 }
      : SHIP_RULES[kind];
    if (!completing && availableGold(player) < rules.cost) return "Not enough gold for this ship";
    if (!completing && this.shipIndex.byOwner(player.id).length + this.recruitment.count(player.id, "ship") >= MAX_SHIPS)
      return `This skirmish allows ${MAX_SHIPS} ships per player`;
    const tile = this.map
      .neighbors(port.tile)
      .find((n) => this.waterPaths.walkable(n));
    if (tile === undefined) return "This port has no navigable water";
    if (this.expansion && !completing) {
      spend(player, this.expansion.supply.inventories[player.id], vessel!.cost);
      this.recruitment.enqueue({ playerId: player.id, buildingId: port.id, category: "ship", kind,
        definitionId: vessel!.id, cost: paidCost(player, vessel!.cost), totalTicks: RECRUITMENT_SECONDS[kind] * TICKS_PER_SECOND });
      return null;
    }
    if (vessel && !completing)
      spend(player, this.expansion!.supply.inventories[player.id], vessel.cost);
    else if (!completing) spendGold(player, rules.cost);
    const completedShip = this.addShip({
      id: this.nextId++,
      playerId: player.id,
      kind,
      x: this.map.x(tile) * FIXED + FIXED / 2,
      y: this.map.y(tile) * FIXED + FIXED / 2,
      health: rules.health,
      ...(vessel ? { definitionId: vessel.id, nextAttackTick: 0 } : {}),
      destination: null,
      waypoints: [],
      path: [],
      nextPathIndex: 0,
      fighting: false,
      boarding: null,
      ...(kind === "warship"
        ? {
            patrolTile: tile,
            repairState: "patrolling" as const,
            patrolDwellTicks: 100,
          }
        : {}),
    });
    this.expansion?.economy.navalFacts.observeShip(completedShip);
    return null;
  }

  private sail(
    player: Player,
    ids: number[],
    tile: number,
    append: boolean,
  ): string | null {
    if (!Array.isArray(ids)) return "Invalid ship selection";
    const ships = [...new Set(ids)].map((id) =>
      this.ship(id),
    );
    if (
      !ships.length ||
      ships.some((s) => !s || s.playerId !== player.id || s.refit)
    )
      return "Select your own ships";
    if (!this.waterPaths.walkable(tile)){
      if(player.ai)return "Ships sail on water; use Unload to land troops";
      // Validate the complete landing selection before canceling any current route.
      const result=this.shoreTransport.moveToLand(ships as Ship[],tile,append);
      if(result===null&&!append)this.shipAdmission.cancel(ids,this.tick);
      return result;
    }
    if(this.options.deferredPlanning && (ships as Ship[]).every(s=>!s.shoreTransfer || ["landing", "afloat"].includes(s.shoreTransfer.phase) || (!player.ai && s.shoreTransfer.phase!=="boarding"))){
      const result=this.shipAdmission.command(player,ships as Ship[],tile,append,this.tick);
      if(result===null&&!append)for(const ship of ships as Ship[])this.shoreTransport.cancelShip(ship.id);
      return result;
    }
    const planned: { ship: Ship; path: number[] }[] = [];
    for (const ship of ships as Ship[]) {
      if (append && ship.waypoints.length >= MAX_QUEUED_ORDERS)
        return "A ship can queue 32 waypoints";
      const origin = append
        ? (ship.waypoints[ship.waypoints.length - 1] ??
          ship.destination ??
          this.tileOf(ship))
        : this.tileOf(ship);
      const path = append && ship.destination!==null
        ? (this.waterPaths.connected(origin,tile) ? [] : null)
        : this.waterPaths.find(origin, tile);
      if (path === null) return "That water cannot be reached by this ship";
      planned.push({ ship, path });
    }
    if(!append){this.shipAdmission.cancel(ids,this.tick);for(const ship of ships as Ship[])this.shoreTransport.cancelShip(ship.id);}
    for (const { ship, path } of planned) {
      this.shipEntities.updateOwned(ship.id, { attackTargetId: null });
      this.cancelBoarding(ship);
      if (append && ship.destination !== null) {
        this.shipEntities.updateOwned(ship.id, { waypoints: [...ship.waypoints, tile] });
        if (ship.kind === "warship" && ship.patrolTile === null) {
          this.shipEntities.updateOwned(ship.id, { patrolTile: tile });
        }
      } else {
        this.setShipVoyage(ship,tile,[this.tileOf(ship),...path],0,[]);
      }
    }
    return null;
  }

  private setShipVoyage(ship: Ship, tile: number, path: number[], index: number, append: number[]): void {
    this.shipEntities.updateOwned(ship.id, { attackTargetId: null });
    this.cancelBoarding(ship);
    if(ship.shoreTransfer)this.shipEntities.updateOwned(ship.id,{shoreTransfer:{...ship.shoreTransfer,phase:"afloat"}});
    this.shipEntities.updateOwned(ship.id, { destination: tile });
    this.shipEntities.updateOwned(ship.id, { waypoints: append });
    this.shipEntities.updateOwned(ship.id, { path: path });
    this.shipEntities.updateOwned(ship.id, { nextPathIndex: index });
    this.shoreTransport?.voyageCommitted(ship,tile);
    if (ship.kind === "warship") {
      this.shipEntities.updateOwned(ship.id, { patrolTile: tile });
      this.shipEntities.updateOwned(ship.id, { repairPortId: null });
      this.shipEntities.updateOwned(ship.id, { repairState: "patrolling" });
      this.shipEntities.updateOwned(ship.id, { patrolDwellTicks: 100 });
    }
  }

  private cancelBoarding(ship: Ship): void {
    if (!ship.boarding) return;
    for (const squad of this.squads) {
      if (squad.order.type !== "board" || squad.order.shipId !== ship.id)
        continue;
      this.squadEntities.updateOwned(squad.id, { queuedOrders: [] });
      this.activateOrder(squad, { type: "hold" });
    }
    this.shipEntities.updateOwned(ship.id, { boarding: null });
  }

  private board(player: Player, shipId: number, ids: number[]): string | null {
    const candidate = this.ship(shipId);
    const ship = candidate?.playerId === player.id && candidate.kind === "transport" ? candidate : undefined;
    if (!ship) return "Choose your transport";
    if (ship.refit) return "Your transport is refitting";
    if (!Array.isArray(ids)) return "Invalid squad selection";
    const selected = [...new Set(ids)].map((id) => this.squad(id));
    if (
      !selected.length ||
      selected.some(
        (s) => !s || s.playerId !== player.id || s.embarkedOn !== null,
      )
    )
      return "Select your land squads to board";
    if(this.options.deferredPlanning)return this.shoreTransport.board(player.id,ship,selected as Squad[]);
    const meeting = boardingMeeting(
      this.map,
      this.paths,
      this.waterPaths,
      this.owners,
      ship,
      selected as Squad[],
      this.coast,
    );
    if (!meeting)
      return "The transport and selected squads have no shared reachable coast";
    const seaPath = this.waterPaths.find(this.tileOf(ship), meeting.waterTile);
    if (seaPath === null) return "The transport cannot reach that coast";
    const waitingTiles: number[] = [];
    this.eachInRadius(meeting.landTile, 3, (tile) => {
      if (
        this.paths.connected(tile, meeting.landTile) &&
        this.map.euclideanDistSquared(tile, meeting.waterTile) <= 9
      )
        waitingTiles.push(tile);
    });
    waitingTiles.sort(
      (a, b) =>
        this.map.euclideanDistSquared(a, meeting.waterTile) -
          this.map.euclideanDistSquared(b, meeting.waterTile) || a - b,
    );
    if (!waitingTiles.length)
      return "There is no passable boarding area at that coast";
    const reserved = this.squads.filter(
      (s) => s.embarkedOn === null && !ids.includes(s.id),
    );
    const planned: { squad: Squad; tile: number; path: number[] | null }[] = [];
    for (const squad of (selected as Squad[]).sort(
      (a, b) =>
        this.distanceSquared(a, ship) - this.distanceSquared(b, ship) ||
        a.id - b.id,
    )) {
      const radius = squadRadius(squad.kind);
      const tile = waitingTiles.find((t) => {
        const point = tilePoint(this.map, t);
        return (
          standable(this.map, point, radius) &&
          reserved.every(
            (other) =>
              distanceSquared(point, other) >=
              squadSeparation(squad, other, this.collisionHostile) ** 2,
          )
        );
      });
      if (tile === undefined)
        return "There is no room for every selected squad at that coast";
      reserved.push({ ...squad, ...tilePoint(this.map, tile) });
      planned.push({
        squad,
        tile,
        path: this.paths.find(
          this.tileOf(squad),
          tile,
          this.obstacleTest(squad.playerId),
        ),
      });
    }
    if (planned.some((p) => p.path === null))
      return "A squad cannot reach the meeting coast";
    // Commit both sides only after every route has been validated.
    this.shipAdmission.cancel([ship.id],this.tick);
    this.cancelBoarding(ship);
    this.shipEntities.updateOwned(ship.id, { boarding: meeting });
    this.shipEntities.updateOwned(ship.id, { destination: meeting.waterTile });
    this.shipEntities.updateOwned(ship.id, { waypoints: [] });
    this.shipEntities.updateOwned(ship.id, { path: [this.tileOf(ship), ...seaPath] });
    this.shipEntities.updateOwned(ship.id, { nextPathIndex: 0 });
    for (const { squad, tile, path } of planned) {
      this.squadEntities.updateOwned(squad.id, { queuedOrders: [] });
      this.activateOrder(squad, { type: "board", shipId: ship.id, tile }, [
        this.tileOf(squad),
        ...path!,
      ]);
    }
    return null;
  }

  private processBoarding(): void {
    for (const ship of this.ships) {
      const meeting = ship.boarding;
      if (!meeting) continue;
      const pending = meeting.squadIds
        .map((id) => this.squad(id))
        .filter(
          (s): s is Squad =>
            !!s &&
            s.embarkedOn === null &&
            s.order.type === "board" &&
            s.order.shipId === ship.id,
        );
      this.shipEntities.updateOwned(ship.id, { boarding: { ...meeting, squadIds: pending.map(s => s.id) } });
      if (!pending.length) {
        this.shipEntities.updateOwned(ship.id, { boarding: null });
        this.shipEntities.updateOwned(ship.id, { destination: null });
        this.shipEntities.updateOwned(ship.id, { path: [] });
        this.shipEntities.updateOwned(ship.id, { nextPathIndex: 0 });
        continue;
      }
      if (ship.destination !== null || this.tileOf(ship) !== meeting.waterTile)
        continue;
      const ready = pending
        // Use the same embarkation reach as manual loading. The meeting slots
        // stage the army; entering a valid loading area is sufficient to board.
        .filter((s) => this.distanceSquared(s, ship) <= (3 * FIXED) ** 2)
        .sort(
          (a, b) =>
            this.distanceSquared(a, ship) - this.distanceSquared(b, ship) ||
            a.id - b.id,
        );
      let free =
        (ship.shoreTransfer?.capacity ?? (this.expansion
          ? this.expansion.vessel(ship).capacity
          : SHIP_RULES.transport.capacity)) -
        this.squadIndex.cargo(ship.id).length;
      for (const squad of ready) {
        if (free > 0) {
          if (
            !this.paths.connected(meeting.landTile,this.tileOf(squad)) ||
            this.expansion?.fortifications.blocked(this.tileOf(squad),ship.playerId) ||
            (!ship.shoreTransfer && (this.owners[meeting.landTile] !== ship.playerId ||
            this.owners[this.tileOf(squad)] !== ship.playerId))
          )
            continue;
          this.embark(squad, ship);
          free--;
        } else {
          this.squadEntities.updateOwned(squad.id, { queuedOrders: [] });
          this.activateOrder(squad, { type: "hold" });
        }
      }
      const squadIds = pending.filter(s => s.order.type === "board").map(s => s.id);
      this.shipEntities.updateOwned(ship.id, { boarding: squadIds.length ? { ...meeting, squadIds } : null });
    }
    for (const squad of this.squads)
      if (squad.order.type === "board") {
        const shipId = squad.order.shipId;
        if (!this.ships.some((s) => s.id === shipId)) {
          this.squadEntities.updateOwned(squad.id, { queuedOrders: [] });
          this.activateOrder(squad, { type: "hold" });
        }
      }
  }

  private embark(squad: Squad, ship: Ship): void {
    const queued = ship.shoreTransfer?.queued.find(q => q.squadId === squad.id);
    if (queued && squad.queuedOrders.length)
      this.shipEntities.updateOwned(ship.id, { shoreTransfer: { ...ship.shoreTransfer!,
        queued: ship.shoreTransfer!.queued.map(entry => entry === queued
          ? { ...entry, orders: [...entry.orders, ...squad.queuedOrders] } : entry),
      } });
    this.squadEntities.updateOwned(squad.id, { embarkedOn: ship.id });
    this.squadEntities.updateOwned(squad.id, { queuedOrders: [] });
    this.squadEntities.updateOwned(squad.id, { firingCharge: 0 });
    this.activateOrder(squad, { type: "hold" });
    this.squadEntities.updateOwned(squad.id, { x: ship.x });
    this.squadEntities.updateOwned(squad.id, { y: ship.y });
  }

  private load(player: Player, shipId: number, ids: number[]): string | null {
    const candidate = this.ship(shipId);
    const ship = candidate?.playerId === player.id ? candidate : undefined;
    if (!ship || ship.kind !== "transport") return "Choose your transport";
    if (ship.destination !== null)
      return "Stop the transport at a coast before loading";
    const shore = this.map
      .neighbors(this.tileOf(ship))
      .filter((t) => this.paths.walkable(t) && this.owners[t] === player.id);
    if (!shore.length)
      return "Loading needs a transport beside a friendly coast";
    if (!Array.isArray(ids)) return "Invalid squad selection";
    const selected = [...new Set(ids)].map((id) => this.squad(id));
    if (
      !selected.length ||
      selected.some(
        (s) => !s || s.playerId !== player.id || s.embarkedOn !== null,
      )
    )
      return "Select your land squads to embark";
    const cargo = this.squadIndex.cargo(ship.id);
    if (
      cargo.length + selected.length >
      (this.expansion
        ? this.expansion.vessel(ship).capacity
        : SHIP_RULES.transport.capacity)
    )
      return `This transport carries up to ${this.expansion ? this.expansion.vessel(ship).capacity : SHIP_RULES.transport.capacity} squads`;
    if (
      selected.some(
        (s) =>
          this.distanceSquared(s!, ship) > (3 * FIXED) ** 2 ||
          this.owners[this.tileOf(s!)] !== player.id ||
          !shore.some((t) => this.paths.connected(t, this.tileOf(s!))),
      )
    )
      return "Move selected squads within three tiles of the transport on friendly land";
    this.shipAdmission.cancel([ship.id],this.tick);
    for (const squad of selected as Squad[]) {
      this.embark(squad, ship);
    }
    return null;
  }

  private unloadPrepared(ship:Ship,members:readonly {squad:Squad;point:WorldPoint}[],tile:number):string|null {
    const cargo=this.squadIndex.cargo(ship.id),selected=new Set(members.map(m=>m.squad.id));
    if(!this.ship(ship.id)||ship.kind!=="transport"||ship.destination!==null||!this.paths.walkable(tile)||this.map.manhattanDist(this.tileOf(ship),tile)!==1 || !this.aiFootprintAllowed(ship.playerId,tile))return "Landing coast or transport changed";
    if(cargo.length!==members.length || cargo.some(s=>!selected.has(s.id)) || members.some(m=>m.squad.embarkedOn!==ship.id || distanceSquared(m.point,tilePoint(this.map,tile))>(3*FIXED)**2 || !this.domainRoutePorts.destinationValid(m.squad,m.point,selected)))return "Landing cargo or footprint changed";
    this.shipAdmission.cancel([ship.id],this.tick);
    for(const member of members)this.squadEntities.updateOwned(member.squad.id,{embarkedOn:null,x:member.point.x,y:member.point.y});
    return null;
  }
  private unload(player: Player, shipId: number, tile: number): string | null {
    if (!this.aiFootprintAllowed(player.id, tile) || (this.expansion?.operations.enabled(player) &&
      this.expansion.operations.state(player.id)?.phase === "recovery" && this.owners[tile] !== player.id))
      return "AI landing requires a declared operation or local defensive response";
    const candidate = this.ship(shipId);
    const ship = candidate?.playerId === player.id ? candidate : undefined;
    if (!ship || ship.kind !== "transport") return "Choose your transport";
    if (ship.destination !== null)
      return "Stop beside the landing coast before unloading";
    if (
      !this.paths.walkable(tile) ||
      this.map.manhattanDist(this.tileOf(ship), tile) !== 1
    )
      return "Choose passable coastal land directly beside the transport";
    const cargo = this.squadIndex.cargo(ship.id);
    if (!cargo.length) return "This transport has no squads aboard";
    if(this.options.deferredPlanning)return this.shoreTransport.land(ship,tile,true);
    let slots = this.formations.plan(
      tile,
      cargo.map((squad) => ({ squad, origin: ship })),
      this.squads,
      3 * FIXED,
      undefined,
      this.obstacleTest(ship.playerId),
    );
    if (!slots) {
      // Reserve each accepted footprint before considering the next squad.
      // Planning remains atomic; squads that cannot fit stay aboard.
      slots = new Map();
      const reserved = [...this.squads];
      for (const squad of [...cargo].sort((a, b) => a.id - b.id)) {
        const placement = this.formations.plan(
          tile, [{ squad, origin: ship }], reserved, 3 * FIXED, undefined,
          this.obstacleTest(ship.playerId),
        );
        const destination = placement?.get(squad.id);
        if (!destination) continue;
        slots.set(squad.id, destination);
        reserved.push({ ...squad, ...destination, embarkedOn: null,
          order: { type: "hold" }, queuedOrders: [] });
      }
    }
    if (!slots.size) return "There is no room for the squads on this landing coast";
    this.shipAdmission.cancel([ship.id],this.tick);
    cargo.forEach((squad) => {
      const destination = slots.get(squad.id);
      if (!destination) return;
      this.squadEntities.updateOwned(squad.id, { embarkedOn: null });
      this.squadEntities.updateOwned(squad.id, { x: destination.x });
      this.squadEntities.updateOwned(squad.id, { y: destination.y });
    });
    return null;
  }

  private moveShip(ship: Ship, cargo: readonly Squad[]): void {
    if (ship.refit) return;
    let budget = this.expansion
      ? this.expansion.vessel(ship).speed
      : SHIP_RULES[ship.kind].speed;
    while (budget > 0 && ship.nextPathIndex < ship.path.length) {
      const tile = ship.path[ship.nextPathIndex];
      // Coastal ownership does not obstruct navigable water. Naval attacks
      // and physical landings retain their separate live war-policy checks.
      const dx = this.map.x(tile) * FIXED + FIXED / 2 - ship.x;
      const dy = this.map.y(tile) * FIXED + FIXED / 2 - ship.y;
      const distance = Math.abs(dx) + Math.abs(dy);
      if (distance <= budget) {
        this.shipEntities.updateOwned(ship.id, { x: ship.x + (dx) });
        this.shipEntities.updateOwned(ship.id, { y: ship.y + (dy) });
        budget -= distance;
        this.shipEntities.updateOwned(ship.id, { nextPathIndex: ship.nextPathIndex + 1 });
      } else {
        const sx = Math.sign(dx) * Math.min(Math.abs(dx), budget);
        this.shipEntities.updateOwned(ship.id, { x: ship.x + (sx) });
        budget -= Math.abs(sx);
        this.shipEntities.updateOwned(ship.id, { y: ship.y + (Math.sign(dy) * Math.min(Math.abs(dy), budget)) });
        budget = 0;
      }
    }
    if (ship.destination !== null && ship.nextPathIndex >= ship.path.length && !this.shipAdmission.executing(ship.id)) {
      this.shipEntities.updateOwned(ship.id, { destination: ship.waypoints[0] ?? null, waypoints: ship.waypoints.slice(1) });
      if (ship.destination !== null && this.options.deferredPlanning && (!ship.shoreTransfer || ["landing", "afloat"].includes(ship.shoreTransfer.phase))) {
        this.shipEntities.updateOwned(ship.id, { path: [] });
        this.shipAdmission.resume(ship,ship.destination);
      } else this.shipEntities.updateOwned(ship.id, { path: ship.destination === null ? [] :
        (this.waterPaths.find(this.tileOf(ship), ship.destination) ?? []) });
      this.shipEntities.updateOwned(ship.id, { nextPathIndex: 0 });
    }
    for (const squad of cargo) {
      this.squadEntities.updateOwned(squad.id, { x: ship.x });
      this.squadEntities.updateOwned(squad.id, { y: ship.y });
    }
  }

  private fightShips(): void {
    const hits = new DamageLedger();
    const contributions = new Map<number, { id: string; damage: number }[]>();
    const hitShip = (source: Ship, target: Ship, amount: number) => {
      hits.add(target.id, source.playerId, amount);
      const list = contributions.get(target.id) ?? [];
      list.push({ id: `ship:${source.id}`, damage: amount });
      contributions.set(target.id, list);
    };
    this.navalSpatial.rebuild(this.ships);
    const nearby: Ship[] = [];
    for (const ship of this.ships) {
      this.shipEntities.updateOwned(ship.id, { fighting: false });
      if (ship.refit || ship.health <= 0 || ship.boarding || ship.shoreTransfer) continue;
      const vessel = this.expansion?.vessel(ship);
      const profile = vessel?.attack;
      const effectiveAttack = profile
        ? scaledAttack(profile, ship.health, vessel!.health, ship.xp)
        : undefined;
      const scaledDamage = effectiveAttack?.damage ?? 0;
      const navalDamage = () =>
        profile
          ? damageAmount(
              profile,
              {
                tags: ["ship"],
                meleeArmour: 1000,
                rangedArmour: 2000,
                bonusResistance: {},
              },
              Math.round((1000 * ship.health) / vessel!.health),
              ship.xp,
            )
          : Math.max(
              1,
              Math.ceil(
                (SHIP_RULES[ship.kind].damage * ship.health) /
                  SHIP_RULES[ship.kind].health,
              ),
            );
      const rules = vessel
        ? {
            ...vessel,
            range: vessel.attack?.range ?? 0,
            damage: vessel.attack?.damage ?? 0,
          }
        : SHIP_RULES[ship.kind];
      if (!rules.damage) continue;
      let target: Ship | undefined,
        nearest = rules.range ** 2 + 1;
      this.navalSpatial.query(ship.x, ship.y, rules.range, nearby);
      for (const enemy of nearby) {
        if (
          enemy.health<=0 || (profile && !profile.targets.includes("ship")) ||
          !this.hostile(enemy.playerId, ship.playerId) ||
          (this.expansion && !this.expansion.fortifications.clear(ship,enemy,ship.playerId)) ||
          !this.waterPaths.connected(this.tileOf(ship), this.tileOf(enemy))
        )
          continue;
        const distance = this.distanceSquared(ship, enemy);
        if (
          distance < nearest ||
          (distance === nearest && target && enemy.id < target.id)
        ) {
          target = enemy;
          nearest = distance;
        }
      }
      const explicit = ship.attackTargetId
        ? (this.ship(ship.attackTargetId) ??
          this.building(ship.attackTargetId!))
        : undefined;
      if (
        explicit && (explicit.health??1)>0 && profile?.targets.includes("tile" in explicit ? "structure" : "ship") &&
        this.hostile(ship.playerId, explicit.playerId) &&
        this.expansion
      ) {
        const p =
            "tile" in explicit ? tilePoint(this.map, explicit.tile) : explicit,
          range = rules.range;
        const legalShot="tile" in explicit ? !!structureAim(ship,[explicit.tile],range,ship.playerId,this.map.width(),this.expansion.fortifications) : this.expansion.fortifications.clear(ship,p,ship.playerId);
        if (this.distanceSquared(ship, p) > range ** 2 || !legalShot) {
          if (this.tick - (ship.lastPlanTick ?? -60) >= 60) {
            this.shipEntities.updateOwned(ship.id, { lastPlanTick: this.tick });
            const tile = this.tileOf(p),
              extent = Math.ceil((range / FIXED) * 0.85);
            let goal: number | undefined,
              best = Infinity;
            for (
              let y = Math.max(0, this.map.y(tile) - extent);
              y <= Math.min(this.map.height() - 1, this.map.y(tile) + extent);
              y++
            )
              for (
                let x = Math.max(0, this.map.x(tile) - extent);
                x <= Math.min(this.map.width() - 1, this.map.x(tile) + extent);
                x++
              ) {
                const t = this.map.ref(x, y),
                  distance = this.map.euclideanDistSquared(
                    this.tileOf(ship),
                    t,
                  );
                if (
                  distance < best &&
                  this.map.euclideanDistSquared(tile, t) <= extent ** 2 &&
                  this.waterPaths.connected(this.tileOf(ship), t) &&
                  ("tile" in explicit ? !!structureAim(tilePoint(this.map,t),[explicit.tile],range,ship.playerId,this.map.width(),this.expansion.fortifications) : this.expansion.fortifications.clear(tilePoint(this.map,t),p,ship.playerId))
                ) {
                  goal = t;
                  best = distance;
                }
              }
            if (goal !== undefined) {
              this.shipEntities.updateOwned(ship.id, { path: this.waterPaths.find(this.tileOf(ship), goal, undefined, 4096) ?? [] });
              this.shipEntities.updateOwned(ship.id, { nextPathIndex: 0 });
              this.shipEntities.updateOwned(ship.id, { destination: goal });
              this.shipEntities.updateOwned(ship.id, { waypoints: [] });
            }
          }
          continue;
        }
        this.shipEntities.updateOwned(ship.id, { fighting: true });
        this.shipEntities.updateOwned(ship.id, { lastCombatTick: this.tick });
        this.shipEntities.updateOwned(ship.id, { destination: null });
        this.shipEntities.updateOwned(ship.id, { path: [] });
        if (this.tick < (ship.nextAttackTick ?? 0)) continue;
        this.shipEntities.updateOwned(ship.id, { nextAttackTick: this.tick + vessel!.attack!.reloadTicks });
        if (vessel!.attack!.projectile) {
          this.expansion.battle.fire(
            { ...ship, domain: "ship" },
            p,
            effectiveAttack!,
            scaledDamage,
          );
          continue;
        }
        if ("tile" in explicit) {
          this.expansion.battle.hitBuilding(
            explicit,
            ship.playerId,
            ship.id,
            damageAmount(
              vessel!.attack!,
              {
                tags: ["structure"],
                meleeArmour: 2000,
                rangedArmour: 6500,
                bonusResistance: {},
              },
              Math.round((1000 * ship.health) / vessel!.health),
              ship.xp,
            ),
            "ship",
          );
          continue;
        }
        hitShip(ship, explicit, navalDamage());
        continue;
      } else if (ship.attackTargetId) this.shipEntities.updateOwned(ship.id, { attackTargetId: null });
      if (!target) continue;
      this.shipEntities.updateOwned(ship.id, { fighting: true });
      this.shipEntities.updateOwned(ship.id, { lastCombatTick: this.tick });
      if (vessel) {
        if (this.tick < (ship.nextAttackTick ?? 0)) continue;
        this.shipEntities.updateOwned(ship.id, { nextAttackTick: this.tick + vessel.attack!.reloadTicks });
      }
      if (vessel?.attack?.projectile) {
        this.expansion!.battle.fire(
          { ...ship, domain: "ship" },
          target,
          effectiveAttack!,
          Math.max(1, scaledDamage),
        );
        continue;
      }
      hitShip(ship, target, navalDamage());
    }
    this.expansion?.battle.awardDamage(hits, contributions);
    this.resolveNavalDamage(hits);
  }

  resolveNavalDamage(hits: DamageLedger): void {
    if (hits.size) this.combatTicks++;
    for (const ship of this.ships) {
      const damage = hits.damage(ship.id);
      this.shipEntities.updateOwned(ship.id, { health: Math.max(0, ship.health - damage) });
      if (damage) {
        for (const [attacker, amount] of hits.contributions(ship.id))
          if (amount > 0) this.notifyHostileAction(ship.playerId, attacker, this.tileOf(ship));
        this.shipEntities.updateOwned(ship.id, { fighting: true });
        this.shipEntities.updateOwned(ship.id, { lastCombatTick: this.tick });
      }
    }
    const sunk = new Set(
      this.ships.filter((s) => s.health === 0).map((s) => s.id),
    );
    this.conquest.losses(
      this.ships.filter((s) => sunk.has(s.id)),
      hits,
    );
    for (const squad of [...this.squads].reverse())
      if (squad.embarkedOn !== null && sunk.has(squad.embarkedOn)) {
        this.recordSoldierCasualties(squad.playerId, squad.troops, squad.embarkedOn, hits);
        this.removeSquad(squad.id);
      }
    for (const ship of [...this.ships].reverse())
      if (sunk.has(ship.id)) this.removeShip(ship.id);
  }

  shipMaxHealth(ship: Ship): number {
    const vessel =
      this.expansion?.vessel(ship) ??
      (ship.definitionId ? VESSEL.get(ship.definitionId) : undefined);
    return vessel?.health ?? SHIP_RULES[ship.kind]?.health ?? 1000;
  }

  private findNearestDockWithCapacity(
    ship: Ship,
    occupiedPorts: Set<number>,
  ): { port: Building; berth: number } | null {
    const shipTile = this.tileOf(ship);
    if (!this.waterPaths.walkable(shipTile)) return null;
    const shipComp = this.waterPaths.component[shipTile];

    const friendlyPorts = this.buildings.filter(
      (b) =>
        b.type === "port" &&
        b.playerId === ship.playerId &&
        b.remainingTicks === 0 &&
        (b.health ?? 1) > 0,
    );
    if (!friendlyPorts.length) return null;

    const stacks = new Map<number, Building[]>();
    for (const port of friendlyPorts) {
      const list = stacks.get(port.tile) ?? [];
      list.push(port);
      stacks.set(port.tile, list);
    }

    let best: { port: Building; berth: number; dist: number } | null = null;

    for (const [tile, portStack] of stacks) {
      const freePort = portStack.find((p) => !occupiedPorts.has(p.id));
      if (!freePort) continue;

      const waterNeighbors = this.map.neighbors(tile).filter(
        (n) => this.waterPaths.walkable(n) && this.waterPaths.component[n] === shipComp,
      );
      if (!waterNeighbors.length) continue;

      const occupiedInStack = portStack.filter((p) => occupiedPorts.has(p.id)).length;
      const berth = waterNeighbors[occupiedInStack % waterNeighbors.length];
      const dist = this.map.euclideanDistSquared(shipTile, berth);

      if (!best || dist < best.dist) {
        best = { port: freePort, berth, dist };
      }
    }

    return best ? { port: best.port, berth: best.berth } : null;
  }

  private findNearestPortBerth(
    ship: Ship,
  ): { port: Building; berth: number } | null {
    const shipTile = this.tileOf(ship);
    if (!this.waterPaths.walkable(shipTile)) return null;
    const shipComp = this.waterPaths.component[shipTile];

    const friendlyPorts = this.buildings.filter(
      (b) =>
        b.type === "port" &&
        b.playerId === ship.playerId &&
        b.remainingTicks === 0 &&
        (b.health ?? 1) > 0,
    );
    if (!friendlyPorts.length) return null;

    let best: { port: Building; berth: number; dist: number } | null = null;
    for (const port of friendlyPorts) {
      const waterNeighbors = this.map.neighbors(port.tile).filter(
        (n) => this.waterPaths.walkable(n) && this.waterPaths.component[n] === shipComp,
      );
      if (!waterNeighbors.length) continue;
      const berth = waterNeighbors[0];
      const dist = this.map.euclideanDistSquared(shipTile, berth);
      if (!best || dist < best.dist) {
        best = { port, berth, dist };
      }
    }
    return best ? { port: best.port, berth: best.berth } : null;
  }

  private pickPatrolWanderTile(anchor: number, current: number): number | null {
    const ax = this.map.x(anchor);
    const ay = this.map.y(anchor);
    const comp = this.waterPaths.component[anchor];
    const candidates: number[] = [];

    for (let dy = -WARSHIP_PATROL_RADIUS; dy <= WARSHIP_PATROL_RADIUS; dy++) {
      const y = ay + dy;
      if (y < 0 || y >= this.map.height()) continue;
      for (let dx = -WARSHIP_PATROL_RADIUS; dx <= WARSHIP_PATROL_RADIUS; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = ax + dx;
        if (x < 0 || x >= this.map.width()) continue;
        const tile = this.map.ref(x, y);
        if (
          this.waterPaths.walkable(tile) &&
          this.waterPaths.component[tile] === comp &&
          tile !== current
        ) {
          candidates.push(tile);
        }
      }
    }

    if (!candidates.length) return null;
    const index = (this.tick + current) % candidates.length;
    return candidates[index];
  }

  private startRecoveryVoyage(ship: Ship, goal: number): void {
    this.shipEntities.updateOwned(ship.id, { destination: goal });
    this.shipEntities.updateOwned(ship.id, { waypoints: [] });
    this.shipEntities.updateOwned(ship.id, { nextPathIndex: 0 });
    if (this.options.deferredPlanning && !ship.shoreTransfer) {
      this.shipEntities.updateOwned(ship.id, { path: [] });
      this.shipAdmission.recover(ship, goal, this.tick);
    } else {
      this.shipEntities.updateOwned(ship.id, { path: [this.tileOf(ship), ...(this.waterPaths.find(this.tileOf(ship), goal) ?? [])] });
    }
  }

  private stepWarships(): void {
    const occupiedPorts = new Set<number>();
    for (const s of this.ships) {
      if (s.repairPortId !== null && s.repairPortId !== undefined) {
        occupiedPorts.add(s.repairPortId);
      }
    }

    for (const ship of this.ships) {
      if (ship.kind !== "warship" || ship.refit || ship.boarding) continue;

      const maxHealth = this.shipMaxHealth(ship);
      const isDamaged = ship.health < maxHealth;
      const shipTile = this.tileOf(ship);

      if (ship.patrolTile === undefined || ship.patrolTile === null) {
        this.shipEntities.updateOwned(ship.id, { patrolTile: shipTile });
        this.shipEntities.updateOwned(ship.id, { repairState: "patrolling" });
      }

      // 1. Repairing state
      if (ship.repairState === "repairing") {
        const port = this.buildings.find(
          (b) =>
            b.id === ship.repairPortId &&
            b.type === "port" &&
            b.playerId === ship.playerId &&
            (b.health ?? 1) > 0,
        );
        if (!port) {
          this.shipEntities.updateOwned(ship.id, { repairPortId: null });
          this.shipEntities.updateOwned(ship.id, { repairState: "patrolling" });
          continue;
        }

        const distToPort = this.map.euclideanDistSquared(shipTile, port.tile);
        if (distToPort > 8) {
          this.shipEntities.updateOwned(ship.id, { repairState: "returning-to-dock" });
          continue;
        }

        if (this.tick % TICKS_PER_SECOND === 0 && !ship.fighting) {
          const healRate = Math.max(50, Math.ceil(maxHealth * WARSHIP_REPAIR_FRACTION));
          this.shipEntities.updateOwned(ship.id, { health: Math.min(maxHealth, ship.health + healRate) });
        }

        if (ship.health >= maxHealth) {
          occupiedPorts.delete(ship.repairPortId!);
          this.shipEntities.updateOwned(ship.id, { repairPortId: null });

          if (
            ship.patrolTile !== null &&
            ship.patrolTile !== undefined &&
            this.waterPaths.walkable(ship.patrolTile) &&
            this.waterPaths.connected(shipTile, ship.patrolTile)
          ) {
            this.shipEntities.updateOwned(ship.id, { repairState: "returning-to-patrol" });
            this.startRecoveryVoyage(ship, ship.patrolTile);
          } else {
            this.shipEntities.updateOwned(ship.id, { repairState: "patrolling" });
            this.shipEntities.updateOwned(ship.id, { patrolTile: shipTile });
            this.shipEntities.updateOwned(ship.id, { destination: null });
            this.shipEntities.updateOwned(ship.id, { path: [] });
          }
        }
        continue;
      }

      // 2. Returning to dock state
      if (ship.repairState === "returning-to-dock") {
        const port = this.buildings.find(
          (b) =>
            b.id === ship.repairPortId &&
            b.type === "port" &&
            b.playerId === ship.playerId &&
            (b.health ?? 1) > 0,
        );
        if (!port) {
          this.shipEntities.updateOwned(ship.id, { repairPortId: null });
          this.shipEntities.updateOwned(ship.id, { repairState: "patrolling" });
          continue;
        }

        const distToPort = this.map.euclideanDistSquared(shipTile, port.tile);
        if (this.shipAdmission.executing(ship.id)) continue;
        if (
          distToPort <= 8 ||
          ship.destination === null ||
          ship.nextPathIndex >= ship.path.length
        ) {
          this.shipEntities.updateOwned(ship.id, { repairState: "repairing" });
          this.shipEntities.updateOwned(ship.id, { destination: null });
          this.shipEntities.updateOwned(ship.id, { path: [] });
          this.shipEntities.updateOwned(ship.id, { nextPathIndex: 0 });
        }
        continue;
      }

      // 3. Waiting for dock slot state
      if (ship.repairState === "waiting-for-dock") {
        const dock = this.findNearestDockWithCapacity(ship, occupiedPorts);
        if (dock) {
          this.shipEntities.updateOwned(ship.id, { repairPortId: dock.port.id });
          occupiedPorts.add(dock.port.id);
          this.shipEntities.updateOwned(ship.id, { repairState: "returning-to-dock" });
          this.startRecoveryVoyage(ship, dock.berth);
        }
        continue;
      }

      // 4. Returning to patrol state
      if (ship.repairState === "returning-to-patrol") {
        if (this.shipAdmission.executing(ship.id)) continue;
        if (
          ship.destination === null ||
          ship.nextPathIndex >= ship.path.length ||
          (ship.patrolTile !== null && shipTile === ship.patrolTile)
        ) {
          this.shipEntities.updateOwned(ship.id, { repairState: "patrolling" });
          this.shipEntities.updateOwned(ship.id, { patrolDwellTicks: 60 + (ship.id % 40) });
          this.shipEntities.updateOwned(ship.id, { destination: null });
          this.shipEntities.updateOwned(ship.id, { path: [] });
        }
        continue;
      }

      // 5. Damaged warship retreats to dock when out of combat
      const outOfCombat =
        !ship.fighting &&
        !ship.attackTargetId &&
        this.tick - (ship.lastCombatTick ?? -WARSHIP_COMBAT_COOLDOWN) >= WARSHIP_COMBAT_COOLDOWN;

      if (isDamaged && outOfCombat && (this.tick + ship.id) % 10 === 0) {
        const dock = this.findNearestDockWithCapacity(ship, occupiedPorts);
        if (dock) {
          this.shipEntities.updateOwned(ship.id, { repairPortId: dock.port.id });
          occupiedPorts.add(dock.port.id);
          this.shipEntities.updateOwned(ship.id, { repairState: "returning-to-dock" });
          this.startRecoveryVoyage(ship, dock.berth);
          continue;
        } else {
          const staging = this.findNearestPortBerth(ship);
          if (staging) {
            this.shipEntities.updateOwned(ship.id, { repairState: "waiting-for-dock" });
            this.startRecoveryVoyage(ship, staging.berth);
            continue;
          }
        }
      }

      // A mission owns its healthy ship's stable anchor; normal recovery above
      // remains authoritative and is never cleared by the strategic planner.
      if (this.expansion?.economy.assets.held(`ship:${ship.id}`)) continue;
      // 6. Patrolling around patrolTile ("Move around a bit")
      if (
        ship.repairState === "patrolling" &&
        ship.destination === null &&
        !ship.fighting &&
        !ship.attackTargetId &&
        !isDamaged &&
        ship.patrolTile !== null &&
        ship.patrolTile !== undefined
      ) {
        if ((ship.patrolDwellTicks ?? 0) > 0) {
          this.shipEntities.updateOwned(ship.id, { patrolDwellTicks: ship.patrolDwellTicks! - 1 });
        } else {
          const wanderTile = this.pickPatrolWanderTile(ship.patrolTile, shipTile);
          if (wanderTile !== null && wanderTile !== shipTile) {
            this.startRecoveryVoyage(ship, wanderTile);
          }
          this.shipEntities.updateOwned(ship.id, { patrolDwellTicks: 120 + ((ship.id * 17) % 80) });
        }
      }
    }
  }

  step(): void {
    // Derived permissions are shared across this tick only. Ownership writes
    // and operation/diplomacy/threat revisions invalidate them immediately.
    this.routeFootprints = new Map();
    this.routeEntries = new Map();
    try { this.performTick(); }
    finally { this.routeFootprints = undefined; this.routeEntries = undefined; }
  }

  private performTick(): void {
    if (this.winner !== null) return;
    this.playerAttacks.beginTick();
    const tickStart = this.onPhase ? performance.now() : 0;
    let phaseStart = tickStart;
    this.tick++;
    if (!this.pathsWarm)
      this.pathsWarm =
        this.paths.warm(PATH_WARM_TREES) &&
        this.waterPaths.warm(PATH_WARM_TREES);
    while (
      this.volleys.length &&
      this.tick - this.volleys[0].tick > ARCHER_ARROW_TICKS
    )
      this.volleys.shift();
    const activeTiles = new Set<number>();
    for (const building of this.buildings) {
      if (building.remainingTicks > 0) {
        if (!activeTiles.has(building.tile)) {
          activeTiles.add(building.tile);
          this.updateBuilding(building.id, { remainingTicks: building.remainingTicks - 1 });
        }
      }
    }
    this.promoteTribes();
    phaseStart = this.diagnosticPhase("setup", phaseStart);
    this.expansion?.beforeStep();
    this.produceReserves();
    phaseStart = this.diagnosticPhase("economy", phaseStart);
    if (this.options.runAi !== false) {
      this.spatial.rebuild(
        this.squads
          .filter((s) => s.embarkedOn === null)
          .sort((a, b) => a.id - b.id),
      );
      this.formations.beginBatch(this.squads);
      try {
        this.thinkAi();
      } finally {
        this.formations.endBatch();
      }
    }
    phaseStart = this.diagnosticPhase("ai", phaseStart);
    this.processBoarding();
    for (const ship of this.ships) {
      this.moveShip(ship, this.squadIndex.cargo(ship.id));
      if (this.options.aiNaval && this.options.aiEconomy && this.options.deferredPlanning)
        this.expansion?.economy.navalFacts.observeShip(ship);
    }
    phaseStart = this.diagnosticPhase("ships", phaseStart);
    const land = this.squads
      .filter((s) => s.embarkedOn === null)
      .sort((a, b) => a.id - b.id);
    this.spatial.rebuild(land);
    // At most 24 squad route jobs per fixed tick. Requests retain FIFO priority
    // while their targets refresh; queued units keep following their old path.
    // Army slots and their connector jobs share one occupancy index for this
    // batch, rather than rebuilding a whole-world grid for every army/member.
    if (this.expansion?.armies.armies.length) {
      this.formations.beginBatch(this.squads);
      try {
        this.expansion.armies.step();
        this.drainRoutes();
      } finally {
        this.formations.endBatch();
      }
    } else this.drainRoutes();
    phaseStart = this.diagnosticPhase("routing", phaseStart);
    this.heldSpatial.rebuild(land.filter((s) => this.holding(s)));
    const intents: MovementIntent[] = [];
    for (const squad of land) {
      const intent = this.navigation(squad);
      if (intent) intents.push({...intent,revision:this.orderRevisions.get(squad.id)??0});
      else {
        const slot=this.expansion?.armies.yieldSlot(squad);
        if(slot)intents.push({squad,goal:slot,speed:this.movementSpeed(squad),yieldOnly:true,revision:this.orderRevisions.get(squad.id)??0});
      }
    }
    // Friendly overlap removes the need for single-file passage reservations.
    // Enemy swept collisions remain enforced by LocalAvoidance.
    const previous = this.expansion
      ? new Map(land.map((s) => [s.id, { x: s.x, y: s.y }]))
      : undefined;
    this.avoidance.step(land, intents, this.spatial, (id, changes) => this.squadEntities.updateOwned(id, changes),
      this.tick, (squad,end) => !this.expansion || (this.expansion.fortifications.clearMovement(squad,end,squad.playerId,squadRadius(squad.kind)) &&
        (this.aiFootprintAllowed(squad.playerId,this.tileOf(end)) || (!this.aiFootprintAllowed(squad.playerId,this.tileOf(squad)) &&
          distanceSquared(end,tilePoint(this.map,this.player(squad.playerId)!.base)) < distanceSquared(squad,tilePoint(this.map,this.player(squad.playerId)!.base))))),
      squad => this.movementAdmission.hasPending(squad.id) || this.queuedLegs.has(squad.id) || this.routePlanner.has(`navigation:${squad.id}`) ? "planning" : "blocked");
    if (this.expansion)
      for (const squad of land)
        if (
          (!this.expansion.fortifications.clearMovement(
            previous!.get(squad.id)!,
            squad,
            squad.playerId,
            squadRadius(squad.kind),
          ) || (!this.aiFootprintAllowed(squad.playerId, this.tileOf(squad)) &&
            (this.aiFootprintAllowed(squad.playerId, this.tileOf(previous!.get(squad.id)!)) ||
             distanceSquared(squad, tilePoint(this.map, this.player(squad.playerId)!.base)) >=
             distanceSquared(previous!.get(squad.id)!, tilePoint(this.map, this.player(squad.playerId)!.base)))))
        ) {
          const old = previous!.get(squad.id)!;
          this.squadEntities.updateOwned(squad.id, { x: old.x });
          this.squadEntities.updateOwned(squad.id, { y: old.y });
          this.squadEntities.updateOwned(squad.id, { moved: false });
          this.squadEntities.updateOwned(squad.id, { path: [] });
          this.squadEntities.updateOwned(squad.id, { plannedTile: -1 });
          this.squadEntities.updateOwned(squad.id, { lastPlanTick: -20 });
        }
    for (const squad of this.squads) {
      if (squad.embarkedOn !== null) {
        this.squadEntities.updateOwned(squad.id, { moved: false });
        if(squad.movementStatus)this.squadEntities.updateOwned(squad.id,{movementStatus:undefined});
        continue;
      }
      this.advanceNavigation(squad);
    }
    this.spatial.rebuild(land);
    phaseStart = this.diagnosticPhase("movement", phaseStart);
    this.fight();
    this.fightShips();
    this.expansion?.afterMovement();
    // Live removals clean their navigation state immediately. Legacy/imported
    // orphan rows retain the old first-step cleanup boundary.
    if (this.navigationCleanupNeeded) {
      this.navigationCleanupNeeded = false;
      for (const id of this.navigationProgress.keys())
        if (!this.squad(id)) this.navigationProgress.delete(id);
      for (const id of this.detours.keys())
        if (!this.squad(id)) this.detours.delete(id);
      for (const id of this.orderRevisions.keys())
        if (!this.squad(id)) {
          this.orderRevisions.delete(id);
          this.queuedLegs.delete(id);
          this.routeWork.cancel(`navigation:${id}`);
          this.routePlanner.cancel(`navigation:${id}`);
        }
    }
    this.replenish();
    phaseStart = this.diagnosticPhase("combat", phaseStart);
    this.capture();
    for (const claim of this.coastalTerritory.step(this.tick, this.owners, this.ships))
      this.changeOwner(claim.tile, claim.owner);
    for (const pocket of this.territoryAbsorption.step(
      this.tick, this.owners,
      (tile) => this.buildingsAt(tile).length > 0,
      (owner, recipient) => this.hostile(owner, recipient),
      owner => this.player(owner)?.land ?? 0,
    )) {
      for (const tile of pocket.tiles) {
        this.changeOwner(tile, pocket.recipient);
        this.progress[tile] = 0;
        this.claims[tile] = 0;
        this.activeClaims.delete(tile);
      }
    }
    phaseStart = this.diagnosticPhase("capture", phaseStart);
    this.processBoarding();
    this.shoreTransport.step();
    this.stepWarships();
    this.stepRecruitment();
    phaseStart = this.diagnosticPhase("transport", phaseStart);
    this.checkWinner();
    this.expansion?.armies.reconcile();
    if (this.compareUnitIndexes) this.verifyUnitIndexes();
    if (this.compareBuildingIndexes) this.verifyBuildingIndexes();
    this.diagnosticPhase("cleanup", phaseStart);
    this.diagnosticPhase("tick", tickStart);
  }

  private produceReserves(): void {
    if (this.tick % TICKS_PER_SECOND !== 0) return;
    if (this.expansion) {
      for (const player of this.players) {
        if (player.eliminated) continue;
        const cities = this.buildingIndex.byType(player.id, "city").filter(b => !b.remainingTicks);
        const amount = Math.max(
          0,
          Math.min(
            200000 - player.reserves,
            (player.kind === "tribe" ? 40 : baseReserveIncome(this.expansion.progression.states[player.id].age)) +
              cities.reduce(
                (n, b) => n + cityReserveIncome(b.age ?? "StoneAge"),
                0,
              ),
          ),
        );
        player.reserves += amount;
        player.recruited += amount;
        this.producedTroops += amount;
        player.gold +=
          20 +
          Math.floor(
            player.land / (40 * (this.options.territoryIncomeScale ?? 1)),
          );
      }
      return;
    }
    for (const player of this.players) {
      if (player.eliminated) continue;
      const income = this.buildingIndex.production(player.id);
      const campOwned = this.owners[player.base] === player.id;
      const amount = Math.min(
        20_000 - player.reserves,
        (campOwned
          ? 40 +
            Math.floor(
              player.land / (20 * (this.options.territoryIncomeScale ?? 1)),
            )
          : 0) + income.reserves,
      );
      player.reserves += amount;
      player.recruited += amount;
      this.producedTroops += amount;
      player.gold +=
        (campOwned
          ? 10 +
            Math.floor(
              player.land / (40 * (this.options.territoryIncomeScale ?? 1)),
            )
          : 0) + income.gold;
    }
  }

  movementSpeed(squad: Squad): number {
    const ordinary = this.ordinarySpeed(squad);
    return this.expansion?.armies.speed(squad, ordinary) ?? ordinary;
  }
  ordinarySpeed(squad: Squad): number {
    if (squad.refit || squad.charge?.phase === "recovery") return 0;
    let speed = Math.floor(
      (terrainSpeed(this.map, this.tileOf(squad)) *
        (squad.charge?.phase === "committed"
          ? this.expansion!.unit(squad).charge!.speedPercent
          : (this.expansion?.unit(squad).speedPercent ??
            SQUAD_RULES[squad.kind].speedPercent))) /
        100,
    );
    for (const zone of this.defenseZones) {
      if (
        zone.playerId !== squad.playerId &&
        this.owners[zone.tile] === zone.playerId &&
        this.map.euclideanDistSquared(this.tileOf(squad), zone.tile) <=
          zone.radius ** 2
      ) {
        speed = Math.max(
          1,
          Math.floor(
            (speed * Math.max(1, Math.min(100, zone.speedPercent))) / 100,
          ),
        );
      }
    }
    return speed;
  }

  unit(squad: Squad) {
    return this.expansion!.unit(squad);
  }
  armyBlocked(tile: number, playerId: number): boolean {
    return (this.expansion?.fortifications.blocked(tile, playerId) ?? false) || !this.aiFootprintAllowed(playerId, tile);
  }
  nearbyArmyEnemies(
    point: WorldPoint,
    radius: number,
    playerId: number,
  ): Squad[] {
    const nearby: Squad[] = [];
    this.spatial.query(point.x, point.y, radius, nearby, playerId);
    return nearby.filter(
      (s) =>
        s.embarkedOn === null && !s.refit && this.hostile(playerId, s.playerId),
    );
  }
  armySlots(
    tile: number,
    members: Squad[],
    ideals: Map<number, WorldPoint>,
    reserved: WorldPoint[] = [],
  ): Map<number, WorldPoint> | null {
    return this.formations.plan(
      tile,
      members.map((squad) => ({ squad, origin: squad })),
      this.squads,
      40 * FIXED,
      ideals,
      (t) =>
        this.armyBlocked(t, members[0].playerId) ||
        reserved.some(
          (p) =>
            distanceSquared(tilePoint(this.map, t), p) < (FIXED * 1.2) ** 2,
        ),
    );
  }
  queueArmyRoute(key: string, work: ArmyRouteRequest): void {
    this.routeWork.request(key, 1, {kind:"army",request:work});
  }
  cancelArmyRoute(key: string): void {
    this.routeWork.cancel(key);
  }
  setArmyMove(
    squad: Squad,
    point: WorldPoint,
    path: number[],
    via: WorldPoint[] = [],
  ): void {
    const destination = via[0] ?? point;
    this.activateOrder(
      squad,
      { type: "move", tile: pointTile(this.map, destination), ...destination },
      path,
    );
    if (via.length)
      this.squadEntities.updateOwned(squad.id, { queuedOrders: [...via.slice(1), point].map((p) => ({
        type: "move",
        tile: pointTile(this.map, p),
        ...p,
      })) });
  }
  setArmyAttack(squad: Squad, targetId: number): void {
    if (squad.order.type !== "attack" || squad.order.targetId !== targetId)
      this.activateOrder(squad, { type: "attack", targetId });
  }
  setArmyHold(squad: Squad): void {
    if (squad.order.type !== "hold")
      this.activateOrder(squad, { type: "hold" });
  }
  transportArmy(squads: Squad[], tile: number): string | null {
    const playerId = squads[0].playerId;
    const completed = this.expansion?.progression.states[playerId]?.completed ?? [];
    const definition = shoreTransportDefinition(completed);
    if (!definition) return "Research Cargo Canoes to cross water automatically";
    return this.shoreTransport.start(playerId,squads,tile,definition,shoreTransportCapacity(completed));
  }
  preferArmyTransport(squads: Squad[], tile: number): boolean {
    // Connected army moves stay on bounded land admission; disconnected moves
    // enter the resumable shore planner through transportArmy.
    if (this.options.deferredPlanning) return false;
    const completed = this.expansion?.progression.states[squads[0].playerId]?.completed ?? [];
    const definition = shoreTransportDefinition(completed);
    return !!definition && squads.some(squad=>this.shoreTransport.useful(squad,tile,definition));
  }

  private moveDestination(order: Extract<Order, { type: "move" }>): WorldPoint {
    return order.x === undefined
      ? tilePoint(this.map, order.tile)
      : { x: order.x, y: order.y! };
  }

  private navigationGoal(squad: Squad, index: number): WorldPoint {
    if (squad.order.type === "move" && index === squad.path.length - 1)
      return this.moveDestination(squad.order);
    return tilePoint(this.map, squad.path[index]);
  }

  private advanceNavigation(squad: Squad): void {
    if (this.queuedLegs.has(squad.id)) return;
    if (
      squad.order.type === "move" &&
      distanceSquared(squad, this.moveDestination(squad.order)) === 0
    ) {
      this.finishOrder(squad);
      return;
    }
    if (
      squad.order.type === "board" &&
      distanceSquared(squad, tilePoint(this.map, squad.order.tile)) === 0
    ) {
      this.squadEntities.updateOwned(squad.id, { nextPathIndex: squad.path.length });
      return;
    }
    while (squad.nextPathIndex < squad.path.length) {
      const final =
        squad.order.type === "move" &&
        squad.nextPathIndex === squad.path.length - 1;
      const tolerance = final ? 0 : ARRIVAL_TOLERANCE;
      if (
        distanceSquared(
          squad,
          this.navigationGoal(squad, squad.nextPathIndex),
        ) >
        tolerance ** 2
      )
        break;
      this.squadEntities.updateOwned(squad.id, { nextPathIndex: squad.nextPathIndex + 1 });
    }
    if (squad.order.type === "move" && squad.nextPathIndex >= squad.path.length)
      this.finishOrder(squad);
  }

  private holding(squad: Squad): boolean {
    return (
      squad.order.type === "hold" ||
      squad.order.type === "replenish" ||
      (squad.order.type === "board" && squad.nextPathIndex >= squad.path.length)
    );
  }

  private clearCorridor(squad: Squad, end: WorldPoint): boolean {
    if (
      this.expansion &&
      !this.expansion.fortifications.clearMovement(squad, end, squad.playerId, squadRadius(squad.kind))
    )
      return false;
    if (!traversable(this.map, squad, end, squadRadius(squad.kind)))
      return false;
    const dx = end.x - squad.x,
      dy = end.y - squad.y,
      lengthSquared = dx * dx + dy * dy;
    const nearby: Squad[] = [];
    this.heldSpatial.query(
      (squad.x + end.x) / 2,
      (squad.y + end.y) / 2,
      Math.sqrt(lengthSquared) / 2 + FIXED,
      nearby,
    );
    return nearby.every((other) => {
      if (other.id === squad.id || !this.holding(other) || !this.hostile(squad.playerId, other.playerId)) return true;
      const along = lengthSquared
        ? Math.max(
            0,
            Math.min(
              1,
              ((other.x - squad.x) * dx + (other.y - squad.y) * dy) /
                lengthSquared,
            ),
          )
        : 0;
      return (
        distanceSquared(other, {
          x: squad.x + along * dx,
          y: squad.y + along * dy,
        }) >=
        squadSeparation(squad, other, this.collisionHostile) ** 2
      );
    });
  }

  private recoverNavigation(squad: Squad): void {
    if (squad.order.type !== "move" && squad.order.type !== "board") return;
    const progress = this.navigationProgress.get(squad.id) ?? {
      x: squad.x,
      y: squad.y,
      tick: this.tick,
      recovery: -20,
    };
    this.navigationProgress.set(squad.id, progress);
    if (distanceSquared(squad, progress) > (FIXED / 4) ** 2) {
      progress.x = squad.x;
      progress.y = squad.y;
      progress.tick = this.tick;
    }
    if (this.tick - progress.tick < 20 || this.tick - progress.recovery < 20)
      return;
    progress.recovery = this.tick;
    if (this.options.deferredPlanning && squad.order.type === "move" &&
        !this.expansion?.armies.armyOf(squad.id) && !this.movementAdmission.hasPending(squad.id)) {
      const goal = this.moveDestination(squad.order), nearby: Squad[] = [];
      this.spatial.query(goal.x, goal.y, 2 * FIXED, nearby);
      // A later arrival can occupy an earlier reserved destination. Admit a
      // fresh nearby slot instead of repairing a corridor to an occupied point.
      if (nearby.some(other => other.id !== squad.id && other.embarkedOn === null &&
          distanceSquared(other, goal) < squadSeparation(squad, other, this.collisionHostile) ** 2)) {
        this.movementAdmission.recoverDestination(squad, squad.order.tile, this.tick);
        return;
      }
    }
    // Repeating the same route repair cannot resolve active friendly blockers.
    // Yield legs finish before requesting another repair; blocked members still
    // retain the bounded local route fallback and occupied-slot admission above.
    if(squad.movementStatus?.reason === "yielding")return;
    this.queueNavigation(squad, "repair");
  }

  private queueNavigation(squad: Squad, operation: Extract<MatchRouteTask, {kind:"navigation"}>["operation"], targetId?: number): void {
    this.routeWork.request(`navigation:${squad.id}`, 1, {kind:"navigation", operation, squadId:squad.id, revision:this.orderRevisions.get(squad.id) ?? 0, targetId});
  }

  private executeRouteTask(task: Exclude<MatchRouteTask,{kind:"admission"|"ship-admission"}>): void {
    if (task.kind === "domain") return;
    if (task.kind === "army") { this.expansion?.armies.resolveRoute(task.request); return; }
    if (task.kind === "ai-move") {
      const player = this.player(task.playerId);
      if (!player?.ai || player.eliminated || (task.generation ?? 0) !== (this.controlGenerations.get(task.playerId) ?? 0)) return;
      if (!this.aiFootprintAllowed(task.playerId, task.tile) || (this.expansion?.operations.enabled(player) &&
        this.expansion.operations.state(player.id)?.phase === "recovery" && task.tile !== player.base)) return;
      const ready = task.squadIds.map(id => this.squad(id)).filter((s):s is Squad => Boolean(s && s.playerId === task.playerId && s.order.type === "hold" && s.embarkedOn === null));
      if (ready.length) this.applyCommand({type:"order",playerId:task.playerId,squadIds:ready.map(s => s.id),order:{type:"move",tile:task.tile}});
      return;
    }
    const squad = this.squad(task.squadId);
    if (!squad || squad.embarkedOn !== null || (this.orderRevisions.get(squad.id) ?? 0) !== task.revision) return;
    switch (task.operation) {
      case "repair": this.repairNavigation(squad); break;
      case "pursuit": { const target = this.squad(task.targetId ?? -1); if (target) this.routePursuit(squad,target); break; }
      case "blocked": this.routeBlocked(squad); break;
      case "smooth": this.routeSmooth(squad); break;
    }
  }

  private repairNavigation(squad: Squad): void {
    if (squad.order.type !== "move" && squad.order.type !== "board") return;
    const destination =
      squad.order.type === "move"
        ? this.moveDestination(squad.order)
        : tilePoint(this.map, squad.order.tile);
    // A smaller friendly clearance lets units share a coarse terrain cell.
    // Repair from the actual position to a nearby corridor join, rather than
    // asking the coarse search to start at an occupied cell centre.
    const join = Math.min(squad.path.length - 1, squad.nextPathIndex + 7),
      localGoal = distanceSquared(squad, destination) > (8 * FIXED) ** 2 && join >= 0
        ? tilePoint(this.map, squad.path[join]) : destination;
    const detour = this.localDetours.find(squad, localGoal, (other) =>
      this.holding(other),
    );
    if (detour) {
      this.detours.set(squad.id, detour);
      if (localGoal !== destination) this.updateSquad(squad.id, { nextPathIndex: join + 1 });
      return;
    }
    const nearby: Squad[] = [];
    const heldTiles = new Map<number, boolean>();
    // Repair toward a nearby point on the existing corridor. Moving units are
    // local obstacles, not a reason to search the entire continent again.
    const goal = squad.path[join] ?? squad.order.tile;
    const path = this.paths.findExact(
      this.tileOf(squad),
      goal,
      (tile) => {
        // Nothing moves during one search; each tile is tested several times
        // (as a neighbour and as a diagonal side), so remember the answer.
        const known = heldTiles.get(tile);
        if (known !== undefined) return known;
        const point = tilePoint(this.map, tile);
        this.spatial.query(point.x, point.y, 2 * FIXED, nearby);
        const held = nearby.some(
          (other) =>
            other.id !== squad.id &&
            this.holding(other) &&
            distanceSquared(other, point) < squadSeparation(squad, other, this.collisionHostile) ** 2,
        );
        heldTiles.set(tile, held);
        return held;
      },
      2048,
    );
    if (path !== null) {
      this.squadEntities.updateOwned(squad.id, { path: [this.tileOf(squad), ...path, ...squad.path.slice(join + 1)] });
      this.squadEntities.updateOwned(squad.id, { nextPathIndex: 0 });
    }
  }

  // Navigation produces intent. Only the avoidance solver commits positions.
  private navigation(squad: Squad): MovementIntent | null {
    const queued = this.queuedLegs.get(squad.id);
    if (queued) {
      if (!queued.paused && this.tick >= queued.retryAt) this.requestNavigationRoute(squad, "blocked");
      return null;
    }
    if (squad.refit || squad.charge?.phase === "recovery") return null;
    if (squad.order.type === "hold" || squad.order.type === "replenish")
      return null;
    if (squad.order.type === "attack") {
      let target = this.squad(squad.order.targetId);
      const human=!this.player(squad.playerId)?.ai;
      if (
        !target ||
        target.embarkedOn !== null ||
        !this.hostile(squad.playerId, target.playerId) ||
        (human&&(this.playerAttacks.blocked(squad,target,this.tick,this.tileOf(target))||this.playerAttacks.outside(squad,target)))
      ) {
        // A queued explicit order takes precedence over attack continuation.
        if(!human||squad.queuedOrders.length){this.finishOrder(squad);return null;}
        const nearby:Squad[]=[];
        target=this.playerAttacks.choose(squad,this.tick,()=>{this.spatial.query(squad.x,squad.y,12*FIXED,nearby,squad.playerId);return nearby;},enemy=>
          enemy.troops>0&&enemy.embarkedOn===null&&this.hostile(squad.playerId,enemy.playerId)&&
          this.paths.connected(this.tileOf(squad),this.tileOf(enemy))&&
          (!this.expansion||this.expansion.unit(squad).attack.targets.some(tag=>this.expansion!.unit(enemy).tags.includes(tag))),enemy=>this.tileOf(enemy));
        if(!target){if(this.playerAttacks.expired(squad,this.tick))this.finishOrder(squad);return null;}
        this.activateOrder(squad,{type:"attack",targetId:target.id},[],true);
      }
      const ranged = this.expansion
        ? this.expansion.unit(squad).attack.channel === "ranged"
        : squad.kind === "archer";
      const stopDistance = ranged
        ? (this.expansion?.unit(squad).attack.range ?? SQUAD_RULES.archer.range)
        : meleeContact(squad.kind, target.kind);
      const distance = Math.sqrt(distanceSquared(squad, target));
      const forts = this.expansion?.fortifications;
      const legalShot = !forts || forts.clear(squad, target, squad.playerId);
      if (distance <= stopDistance && legalShot) return null;
      if(human&&!squad.fighting&&this.playerAttacks.stagnant(squad,this.tick)&&!this.routePlanner.has(`navigation:${squad.id}`)){
        const previous=target,nearby:Squad[]=[];
        const replacement=this.playerAttacks.choose(squad,this.tick,()=>{this.spatial.query(squad.x,squad.y,12*FIXED,nearby,squad.playerId);return nearby;},enemy=>
          enemy.id!==previous.id&&enemy.troops>0&&enemy.embarkedOn===null&&this.hostile(squad.playerId,enemy.playerId)&&
          this.paths.connected(this.tileOf(squad),this.tileOf(enemy))&&
          (!this.expansion||this.expansion.unit(squad).attack.targets.some(tag=>this.expansion!.unit(enemy).tags.includes(tag))),enemy=>this.tileOf(enemy),false);
        if(replacement){this.activateOrder(squad,{type:"attack",targetId:replacement.id},[],true);return null;}
      }
      const stopPoint = {
        x: target.x + ((squad.x - target.x) * stopDistance) / distance,
        y: target.y + ((squad.y - target.y) * stopDistance) / distance,
      };
      // Direct pursuit keeps melee in contact and ranged squads at the outer edge.
      if (
        distance <= 8 * FIXED &&
        legalShot &&
        (!forts || forts.clearMovement(squad, stopPoint, squad.playerId, squadRadius(squad.kind))) &&
        traversable(this.map, squad, stopPoint, squadRadius(squad.kind))
      )
        return {
          squad,
          goal: target,
          speed: this.movementSpeed(squad),
          // Integer velocity rounding can otherwise stop less than one fixed
          // unit outside the exact firing range forever. Aim just inside it;
          // the range check above still keeps already-in-range squads still.
          stopDistance: ranged ? Math.max(0, stopDistance - 1) : stopDistance,
        };
      const targetTile = this.tileOf(target);
      if (
        this.tick - squad.lastPlanTick >= 10 &&
        (targetTile !== squad.plannedTile ||
          squad.nextPathIndex >= squad.path.length)
      ) {
        this.queueNavigation(squad, "pursuit", target.id);
      }
    }
    if (
      this.expansion &&
      squad.path[squad.nextPathIndex] !== undefined &&
      this.expansion.fortifications.blocked(
        squad.path[squad.nextPathIndex],
        squad.playerId,
      )
    ) {
      this.queueNavigation(squad, "blocked");
    }
    this.recoverNavigation(squad);
    this.advanceNavigation(squad);
    const detour = this.detours.get(squad.id);
    if (detour) {
      while (
        detour.length &&
        distanceSquared(squad, detour[0]) <=
          (detour.length === 1 ? 0 : ARRIVAL_TOLERANCE) ** 2
      )
        detour.shift();
      if (detour.length)
        return { squad, goal: detour[0], speed: this.movementSpeed(squad) };
      this.detours.delete(squad.id);
    }
    if (squad.nextPathIndex >= squad.path.length) return null;
    // Avoidance can displace a squad out of sight of a smoothed waypoint.
    // Recover its terrain corridor at a bounded rate instead of steering into a wall.
    if (
      squad.order.type !== "attack" &&
      this.tick - squad.lastPlanTick >= 10 &&
      !traversable(
        this.map,
        squad,
        this.navigationGoal(squad, squad.nextPathIndex),
        squadRadius(squad.kind),
      )
    ) {
      this.queueNavigation(squad, "smooth");
    }
    if (squad.nextPathIndex >= squad.path.length) return null;
    // Bounded line-of-sight smoothing avoids rigid tile-center marching.
    for (
      let index = Math.min(squad.path.length - 1, squad.nextPathIndex + 8);
      index > squad.nextPathIndex;
      index--
    ) {
      const goal = this.navigationGoal(squad, index);
      if (
        distanceSquared(squad, goal) <= (8 * FIXED) ** 2 &&
        this.clearCorridor(squad, goal)
      ) {
        this.squadEntities.updateOwned(squad.id, { nextPathIndex: index });
        break;
      }
    }
    return {
      squad,
      goal: this.navigationGoal(squad, squad.nextPathIndex),
      speed: this.movementSpeed(squad),
    };
  }

  private routePursuit(squad: Squad, target: Squad): void {
    if(this.squad(target.id)!==target || target.embarkedOn!==null)return;
    if (!this.options.deferredPlanning) {
      const targetTile = this.tileOf(target);
      const ranged = this.expansion ? this.expansion.unit(squad).attack.channel === "ranged" : squad.kind === "archer";
      const goal = ranged ? firingPosition(this.map, this.paths, squad, target,
        this.expansion?.unit(squad).attack.range ?? SQUAD_RULES.archer.range,
        this.obstacleTest(squad.playerId), this.expansion ? (from, to) =>
          this.expansion!.fortifications.clear(from, to, squad.playerId) : undefined) : targetTile;
      const path = goal === null ? null : this.paths.find(this.tileOf(squad), goal, this.obstacleTest(squad.playerId));
      if(path===null&&!this.player(squad.playerId)?.ai)this.playerAttacks.failed(squad,target,this.tick,targetTile);
      this.squadEntities.updateOwned(squad.id, { path: path === null ? [] : [this.tileOf(squad), ...path] });
      this.squadEntities.updateOwned(squad.id, { nextPathIndex: 0 });
      this.squadEntities.updateOwned(squad.id, { plannedTile: targetTile });
      this.squadEntities.updateOwned(squad.id, { lastPlanTick: this.tick });
      return;
    }
    const key=`navigation:${squad.id}`;
    if(this.routePlanner.has(key))return;
    const ranged=this.expansion?this.expansion.unit(squad).attack.channel==="ranged":squad.kind==="archer",
      current=this.tileOf(squad),targetTile=this.tileOf(target),firing=ranged?new FiringPositions(this.map,this.paths,current,squad.kind,target,
        this.expansion?.unit(squad).attack.range??SQUAD_RULES.archer.range).state:undefined;
    this.routePlanner.request({key,start:current,goal:targetTile,water:false,prepare:ranged,createdTick:this.tick,
      obstacleRevision:this.routingObstacleRevision(squad.playerId),context:{kind:"navigation",operation:"pursuit",squadId:squad.id,
        revision:this.orderRevisions.get(squad.id)??0,targetId:target.id,targetTile,firing,
        playerId:squad.playerId,generation:this.player(squad.playerId)?.ai?this.aiGeneration(squad.playerId):undefined}});
    this.squadEntities.updateOwned(squad.id, { lastPlanTick: this.tick });
  }
  private routeBlocked(squad: Squad): void {
        if (squad.order.type !== "move" && squad.order.type !== "board") return;
        if (!this.options.deferredPlanning) {
          this.squadEntities.updateOwned(squad.id, { path: this.paths.find(this.tileOf(squad), squad.order.tile, this.obstacleTest(squad.playerId)) ?? [] });
          this.squadEntities.updateOwned(squad.id, { nextPathIndex: 0 });
          this.squadEntities.updateOwned(squad.id, { lastPlanTick: this.tick });
          return;
        }
        this.requestNavigationRoute(squad,"blocked");
        this.squadEntities.updateOwned(squad.id, { lastPlanTick: this.tick });
  }
  private routeSmooth(squad: Squad): void {
        if (squad.order.type !== "move" && squad.order.type !== "board") return;
        if (!this.options.deferredPlanning) {
          const path = this.paths.find(this.tileOf(squad), squad.order.tile, this.obstacleTest(squad.playerId));
          if (path !== null) {
            this.squadEntities.updateOwned(squad.id, { path: [this.tileOf(squad), ...path] });
            this.squadEntities.updateOwned(squad.id, { nextPathIndex: 0 });
            this.squadEntities.updateOwned(squad.id, { lastPlanTick: this.tick });
            this.advanceNavigation(squad);
          }
          return;
        }
        this.requestNavigationRoute(squad,"smooth");
        this.squadEntities.updateOwned(squad.id, { lastPlanTick: this.tick });
  }
  private requestNavigationRoute(squad:Squad,operation:"blocked"|"smooth"):void {
    if(squad.order.type!=="move" && squad.order.type!=="board")return;
    const key=`navigation:${squad.id}`;
    if(this.routePlanner.has(key))return;
    this.routePlanner.request({key,start:this.tileOf(squad),goal:squad.order.tile,water:false,createdTick:this.tick,
      obstacleRevision:this.routingObstacleRevision(squad.playerId),context:{kind:"navigation",squadId:squad.id,operation,revision:this.orderRevisions.get(squad.id)??0,
        playerId:squad.playerId,generation:this.player(squad.playerId)?.ai?this.aiGeneration(squad.playerId):undefined}});
  }

  private fight(): void {
    if (this.expansion) {
      this.expansion.battle.fight(this.expansion.aircraft);
      return;
    }
    const damage = new DamageLedger();
    const nearby: Squad[] = [];
    const byId = new Map(this.squads.map((squad) => [squad.id, squad]));
    for (const squad of [...this.squads].sort((a, b) => a.id - b.id)) {
      this.squadEntities.updateOwned(squad.id, { fighting: false });
      this.squadEntities.updateOwned(squad.id, { combatTargetId: null });
      if (squad.embarkedOn !== null) continue;
      const rules = SQUAD_RULES[squad.kind];
      let target: Squad | undefined;
      let nearest = rules.range ** 2 + 1;
      this.spatial.query(squad.x, squad.y, rules.range, nearby);
      for (const enemy of nearby) {
        if (enemy.playerId === squad.playerId || enemy.embarkedOn !== null)
          continue;
        const distance = this.distanceSquared(squad, enemy);
        if (
          distance < nearest ||
          (distance === nearest && target && enemy.id < target.id)
        ) {
          nearest = distance;
          target = enemy;
        }
      }
      if (squad.order.type === "attack") {
        const ordered = byId.get(squad.order.targetId);
        if (
          ordered &&
          ordered.embarkedOn === null &&
          this.distanceSquared(squad, ordered) <= rules.range ** 2
        )
          target = ordered;
      }
      if (!target) {
        this.squadEntities.updateOwned(squad.id, { firingCharge: 0 });
        continue;
      }
      this.squadEntities.updateOwned(squad.id, { fighting: true });
      this.squadEntities.updateOwned(squad.id, { combatTargetId: target.id });
      this.squadEntities.updateOwned(squad.id, { lastCombatTick: this.tick });
      this.squadEntities.updateOwned(target.id, { lastCombatTick: this.tick });
      if (squad.kind === "archer") {
        this.squadEntities.updateOwned(squad.id, { firingCharge: squad.firingCharge + (squad.moved
          ? ARCHER_MOVING_CHARGE
          : ARCHER_STATIONARY_CHARGE) });
        if (squad.firingCharge < ARCHER_CHARGE_REQUIRED) continue;
        this.squadEntities.updateOwned(squad.id, { firingCharge: squad.firingCharge - (ARCHER_CHARGE_REQUIRED) });
        this.volleys.push({
          id: this.nextVolleyId++,
          tick: this.tick,
          squadId: squad.id,
          playerId: squad.playerId,
          fromX: squad.x,
          fromY: squad.y,
          toX: target.x,
          toY: target.y,
        });
      }
      const strength =
        this.distanceSquared(squad, target) <= MELEE_RANGE ** 2
          ? rules.closeDamage
          : rules.damage;
      damage.add(
        target.id,
        squad.playerId,
        Math.max(1, Math.ceil((squad.troops * strength) / SQUAD_TROOPS)),
      );
    }
    this.resolveLandDamage(damage);
  }

  private recordSoldierCasualties(
    victimId: number,
    deaths: number,
    targetId: number,
    damage: DamageLedger,
  ): void {
    if (deaths <= 0) return;
    this.player(victimId)!.losses += deaths;
    const shares = effectiveDamageShares(
      deaths,
      [...damage.contributions(targetId)].map(([id, amount]) => ({
        id, damage: amount,
      })),
    );
    for (const [id, count] of shares) {
      const attacker = this.player(id);
      if (attacker && id !== victimId)
        attacker.kills = (attacker.kills ?? 0) + count;
    }
  }

  resolveLandDamage(damage: DamageLedger): void {
    if (damage.size) this.combatTicks++;
    // Apply all hits simultaneously. Dead squads still deliver the hit they
    // earned at the start of this combat step; iteration order cannot win a duel.
    for (const squad of this.squads) {
      const losses = Math.min(squad.troops, damage.damage(squad.id));
      this.squadEntities.updateOwned(squad.id, { troops: squad.troops - (losses) });
      if (losses > 0) {
        this.squadEntities.updateOwned(squad.id, { fighting: true });
        for (const [attacker, amount] of damage.contributions(squad.id))
          if (amount > 0) this.notifyHostileAction(squad.playerId, attacker, this.tileOf(squad));
      }
      this.recordSoldierCasualties(squad.playerId, losses, squad.id, damage);
    }
    this.conquest.losses(
      this.squads.filter((s) => s.troops <= 0),
      damage,
    );
    for (const squad of [...this.squads].reverse())
      if (squad.troops <= 0) this.removeSquad(squad.id);
  }

  private capture(): void {
    this.pressure.begin();
    const accelerated = new Map<number, number>();
    for (const squad of this.squads) {
      if (squad.embarkedOn !== null) continue;
      const definition = this.expansion?.unit(squad);
      if (definition && !definition.canCapture) continue;
      const position = this.tileOf(squad),
        component = this.paths.component[position];
      const canCapture = this.expansion?.captureQuery(squad, CAPTURE_RADIUS);
      const captureTicks =
        definition?.undefendedCaptureTicks &&
        !this.occupation.resisted(
          squad,
          position,
          this.map,
          this.spatial,
          this.buildingIndex,
          this.expansion!.diplomacy,
        )
          ? definition.undefendedCaptureTicks
          : undefined;
      this.eachInRadius(position, CAPTURE_RADIUS, (tile) => {
        if (
          this.paths.component[tile] !== component ||
          (canCapture && !canCapture(tile))
        )
          return;
        if (this.owners[tile] && this.hostile(this.owners[tile], squad.playerId))
          this.notifyHostileAction(this.owners[tile], squad.playerId, tile);
        this.pressure.add(tile, squad.playerId);
        if (captureTicks)
          accelerated.set(
            tile,
            Math.min(accelerated.get(tile) ?? Infinity, captureTicks),
          );
        if (squad.playerId !== this.owners[tile]) this.activeClaims.add(tile);
      });
    }
    for (const tile of this.activeClaims) {
      this.tileChanges.record(tile);
      const claimant = this.pressure.at(tile);
      if (
        claimant === 0 ||
        claimant === 255 ||
        claimant === this.owners[tile]
      ) {
        this.progress[tile] = 0;
        this.claims[tile] = 0;
        this.activeClaims.delete(tile);
        continue;
      }
      if (this.claims[tile] !== claimant) {
        this.claims[tile] = claimant;
        this.progress[tile] = 0;
      }
      this.progress[tile]++;
      if (
        this.progress[tile] >=
        (accelerated.get(tile) ??
          (this.expansion?.diplomacy.state.betrayal[this.owners[tile]]
            ? Math.ceil(CAPTURE_TICKS * 0.8)
            : CAPTURE_TICKS))
      ) {
        this.changeOwner(tile, claimant);
        this.progress[tile] = 0;
        this.claims[tile] = 0;
        this.activeClaims.delete(tile);
      }
    }
  }

  buildingsAt(tile: number): readonly Building[] {
    return this.buildingIndex.at(tile);
  }

  private changeOwner(tile: number, id: number): void {
    const old = this.owners[tile];
    if (old === id) return;
    const land = this.map.isLand(tile);
    const index = land ? this.ownedTiles : this.ownedWater;
    if (old) index.get(old)?.delete(tile);
    if (id) {
      let tiles = index.get(id);
      if (!tiles) index.set(id, (tiles = new Set()));
      tiles.add(tile);
    }
    if (old && land) this.player(old)!.land--;
    this.owners[tile] = id;
    this.routeFootprints?.clear();
    this.routeEntries?.clear();
    this.expansion?.supply.territoryChanged(tile, id);
    this.expansion?.operations.territoryChanged(old,id);
    for(const owner of new Set(this.map.neighbors(tile).map(t=>this.owners[t])))if(owner!==old&&owner!==id)this.expansion?.operations.territoryChanged(owner,owner);
    this.tileChanges.record(tile);
    this.adjacency.changed(tile, old);
    this.expansion?.economy.boundaries?.changed(tile, old, this.tick);
    this.territoryAbsorption.changed(tile);
    this.coastalTerritory.changed(tile);
    this.expansion?.economy.placements.changed(tile, id);
    if (id && land) this.player(id)!.land++;
    const buildings = this.buildingIndex.at(tile);
    const captured = buildings.some(
      (building) => building.playerId === old && old !== 0,
    );
    for (const building of buildings) {
      this.updateBuilding(building.id, { playerId: id });
    }
    if (captured && this.expansion && id && this.hostile(old, id)) {
      const captor = this.squads
        .filter((s) => s.playerId === id && s.embarkedOn === null)
        .sort(
          (a, b) =>
            this.distanceSquared(a, tilePoint(this.map, tile)) -
              this.distanceSquared(b, tilePoint(this.map, tile)) || a.id - b.id,
        )[0];
      if (captor) this.squadEntities.updateOwned(captor.id, { xp: Math.min(20000, (captor.xp ?? 0) + 50) });
    }
    if (
      captured &&
      !this.buildings.some((building) => building.playerId === old && !building.remainingTicks && (building.health??1)>0)
    )
      this.conquest.capture(old, id);
  }

  private thinkAi(): void {
    const armies = new Map<number, Squad[]>();
    for (const squad of this.squads) {
      if (squad.embarkedOn !== null) continue;
      let army = armies.get(squad.playerId);
      if (!army) armies.set(squad.playerId, (army = []));
      army.push(squad);
    }
    if (this.options.aiWarPolicy) this.expansion?.operations.step(new Map([...armies].map(([id, army]) => [id, army.filter(s => s.troops >= SQUAD_TROOPS / 2 && !s.refit).length])));
    const nearby: Squad[] = [];
    for (const player of this.players) {
      if (!player.ai || player.eliminated) continue;
      const personality = personalityOf(player);
      const develop = this.tick % 60 === player.id % 60;
      if (develop) {
        if (player.kind === "regular") this.developAi(player);
        else if (player.kind === "tribe" && !this.expansion) this.developTribeAi(player);
      }
      let own = armies.get(player.id) ?? [];
      if (
        develop &&
        !this.expansion?.economy.enabled(player) &&
        this.squadIndex.byOwner(player.id).length <
          this.squadCapacity(player) &&
        player.reserves >= SQUAD_TROOPS &&
        own.length < this.squadCapacity(player)
      ) {
        const lines = recruitmentOrder(personality, this.expansion
          ? new AiForceInventory(player.id, this.squadIndex.byOwner(player.id), this.recruitment.byOwner(player.id)).core
          : {
          infantry: own.filter((s) => s.kind === "infantry").length,
          archer: own.filter((s) => s.kind === "archer").length,
          cavalry: own.filter((s) => s.kind === "cavalry").length,
        });
        if (this.expansion) {
          for (const line of lines) {
            const choice = this.expansion.recruitment(player, line);
            if (
              choice &&
              this.applyCommand({
                type: "recruit",
                autoRecruit: true,
                playerId: player.id,
                buildingId: choice.building.id,
                definitionId: choice.unit.id,
              }) === null
            )
              break;
          }
        } else {
          const recruiters = this.buildings.filter(
            (b) =>
              b.playerId === player.id &&
              !b.remainingTicks &&
              BUILDING_RULES[b.type].squad,
          );
          const recruiter = lines
            .map((line) =>
              recruiters.find((b) => BUILDING_RULES[b.type].squad === line),
            )
            .find(Boolean);
          if (recruiter)
            this.applyCommand({
              type: "recruit",
                autoRecruit: true,
              playerId: player.id,
              buildingId: recruiter.id,
            });
        }
        own = this.squadIndex.byOwner(player.id).filter(s => s.embarkedOn === null);
      }
      // No offensive candidate/formation work while this operation sleeps.
      const policy = this.expansion?.operations.enabled(player);
      if (policy && !develop && !own.some(s => (this.tick + s.id) % 15 === 1)) continue;
      const recovering = policy && this.expansion!.operations.state(player.id)?.phase === "recovery";
      const target = policy ? this.expansion!.operations.offensiveTarget(player.id) : undefined;
      const enemyPlayers = policy
        ? this.players.filter(p => p.id === target && !p.eliminated)
        : this.players.filter(p => this.hostile(p.id, player.id) && !p.eliminated);
      const frontier = this.homeTerritory.frontier(
          player.id,
          player.base,
          this.owners,
          this.tick,
        ),
        homeRadius = Math.round(
          (Math.max(
            18,
            Math.round(Math.min(this.map.width(), this.map.height()) * 0.06),
          ) * personality.homeRadiusPercent) / 100,
        ),
        homeNeedsLand = frontier.some(
          (tile) =>
            this.owners[tile] !== player.id &&
            (!this.owners[tile] || this.hostile(player.id, this.owners[tile])) &&
            this.aiFootprintAllowed(player.id, tile) &&
            this.map.euclideanDistSquared(player.base, tile) <= homeRadius ** 2,
        ),
        reserved = new Set(
          own.flatMap((s) => (s.order.type === "move" ? [s.order.tile] : [])),
        );
      const raids = new Map<number, Squad[]>();
      const marches=new Map<string,Squad[]>();
      for (let i = 0; i < own.length; i++) {
        const squad = own[i];
        // Every squad thinks once per 15 ticks; IDs spread the work evenly.
        if ((this.tick + squad.id) % 15 !== 1) continue;
        if (
          squad.refit ||
          this.expansion?.modernization.holds(squad.id) ||
          this.expansion?.economy.assets.held(`squad:${squad.id}`) ||
          squad.charge ||
          squad.structureTarget ||
          (squad.definitionId &&
            UNIT.get(squad.definitionId)?.role === "launcher")
        )
          continue;
        if (squad.order.type === "board") continue;
        const current = this.tileOf(squad);
        if (policy && ((squad.order.type === "attack" && (!this.squad(squad.order.targetId) || !this.aiCanPursue(player.id, this.squad(squad.order.targetId)!.playerId, this.tileOf(this.squad(squad.order.targetId)!)))) ||
          (squad.order.type === "move" && ((!this.aiFootprintAllowed(player.id, squad.order.tile)) || (recovering && squad.order.tile !== player.base)))))
          this.applyCommand({ type: "order", playerId: player.id, squadIds: [squad.id], order: { type: "hold" } });
        if (player.kind === "tribe" && squad.order.type === "attack") {
          const target = this.squad(squad.order.targetId);
          if (
            !target ||
            (this.owners[this.tileOf(target)] !== player.id &&
              this.distanceSquared(squad, target) >
                (Math.round(
                  (TRIBE_PURSUIT_RANGE * personality.interceptRange) / 20,
                ) * FIXED) ** 2)
          )
            this.applyCommand({
              type: "order",
              playerId: player.id,
              squadIds: [squad.id],
              order: { type: "hold" },
            });
        }
        let nearest: Squad | undefined,
          distance = Number.MAX_SAFE_INTEGER,
          threatDistance = Number.MAX_SAFE_INTEGER;
        this.spatial.query(squad.x, squad.y, 20 * FIXED, nearby, player.id);
        for (const enemy of nearby) {
          if (!this.hostile(enemy.playerId, player.id)) continue;
          if (enemy.embarkedOn !== null || enemy.troops <= 0) continue;
          const enemyTile = this.tileOf(enemy);
          const d = this.distanceSquared(squad, enemy);
          if (
            player.kind === "tribe" &&
            this.owners[enemyTile] !== player.id &&
            d >
              (Math.round(
                (TRIBE_INTERCEPT_RANGE * personality.interceptRange) / 20,
              ) * FIXED) ** 2
          )
            continue;
          threatDistance = Math.min(threatDistance, d);
          if (!this.aiCanPursue(player.id, enemy.playerId, enemyTile) || !this.aiCanEnter(player.id, enemyTile)) continue;
          if (this.expansion && !this.expansion.unit(squad).attack.targets.some(
            tag => this.expansion!.unit(enemy).tags.includes(tag))) continue;
          if (d < distance || (d === distance && enemy.id < nearest!.id)) {
            distance = d;
            nearest = enemy;
          }
        }
        if (
          this.owners[current] === player.id &&
          squad.troops < personality.replenishBelow &&
          threatDistance > (12 * FIXED) ** 2
        ) {
          if (squad.order.type !== "replenish")
            this.applyCommand({
              type: "order",
              playerId: player.id,
              squadIds: [squad.id],
              order: { type: "replenish" },
            });
          continue;
        }
        // Meet nearby invaders with actual squads, using the same attack order.
        if (nearest && distance < (personality.interceptRange * FIXED) ** 2) {
          if (
            squad.order.type !== "attack" ||
            squad.order.targetId !== nearest.id
          )
            this.applyCommand({
              type: "order",
              playerId: player.id,
              squadIds: [squad.id],
              order: { type: "attack", targetId: nearest.id },
            });
          continue;
        }
        if (squad.order.type !== "hold" || this.shoreTransport.pending(squad.id)) continue;
        if (recovering) {
          if (this.map.euclideanDistSquared(current, player.base) > 8 ** 2)
            this.routeWork.request(`ai:${squad.id}`, 1, {kind:"ai-move",playerId:player.id,generation:this.aiGeneration(player.id),squadIds:[squad.id],tile:player.base});
          continue;
        }
        const campLost = this.owners[player.base] !== player.id;
        let goal: number;
        let raidCenter: number | null = campLost ? player.base : null;
        if (campLost) goal = player.base;
        else if (
          player.kind === "regular" &&
          enemyPlayers.length &&
          !homeNeedsLand &&
          own.length >= personality.minimumRaidSquads &&
          i % 8 < personality.raidSlots &&
          this.tick > personality.raidAfterTicks
        ) {
          const enemy = enemyPlayers.reduce((a, b) =>
            this.map.euclideanDistSquared(current, a.base) <
            this.map.euclideanDistSquared(current, b.base)
              ? a
              : b,
          );
          goal = this.formationTile(
            enemy.base,
            Math.floor(i / 8) * personality.raidSlots + i % 8,
            Math.ceil(own.length / 8) * personality.raidSlots,
          );
          raidCenter = enemy.base;
          // Do not sit forever on captured enemy camps.
          if (this.owners[goal] === player.id) {
            nearest ??= this.spatial.nearest(squad.x, squad.y, (enemy) =>
              this.hostile(enemy.playerId, player.id) && this.aiCanPursue(player.id, enemy.playerId, this.tileOf(enemy)) &&
              this.aiCanEnter(player.id, this.tileOf(enemy)) && enemy.embarkedOn === null &&
              (!this.expansion || this.expansion.unit(squad).attack.targets.some(
                tag => this.expansion!.unit(enemy).tags.includes(tag))),
            );
          }
          if (this.owners[goal] === player.id && nearest) {
            this.applyCommand({
              type: "order",
              playerId: player.id,
              squadIds: [squad.id],
              order: { type: "attack", targetId: nearest.id },
            });
            continue;
          }
        } else {
          // Strategic expansion uses local control groups, independent of the
          // Armies technology. Combat and replenishment remain per squad.
          const key=`${this.paths.component[current]}:${Math.floor(squad.x/(16*FIXED))}:${Math.floor(squad.y/(16*FIXED))}`;
          const march=marches.get(key)??[];march.push(squad);marches.set(key,march);
          continue;
        }
        if (raidCenter !== null) {
          let raid = raids.get(raidCenter);
          if (!raid) raids.set(raidCenter, (raid = []));
          raid.push(squad);
          continue;
        }
        this.routeWork.request(`ai:${squad.id}`, 1, {kind:"ai-move",playerId:player.id,generation:this.controlGenerations.get(player.id) ?? 0,squadIds:[squad.id],tile:goal});
      }
      for(const march of marches.values())for(let at=0;at<march.length;at+=16){
        const cohort=march.slice(at,at+16),leader=cohort[0];
        const goal=this.homeTerritory.goal(player.id,player.base,this.tileOf(leader),this.owners,frontier,reserved,
          tile=>(!this.owners[tile]||this.hostile(player.id,this.owners[tile]))&&this.aiFootprintAllowed(player.id,tile));
        if(goal===undefined)continue;
        this.routeWork.request(`march:${player.id}:${leader.id}`,cohort.length,{kind:"ai-move",playerId:player.id,
          generation:this.aiGeneration(player.id),squadIds:cohort.map(s=>s.id),tile:goal});
      }
      // Cohorts share one long HPA corridor and only refine local connectors.
      // Group size also bounds the route-work charge of any queued command.
      for (const [tile, raid] of raids)
        for (let at = 0; at < raid.length; at += 16) {
          const cohort = raid.slice(at, at + 16);
          this.routeWork.request(
            `raid:${player.id}:${tile}:${cohort[0].id}`,
            cohort.length,
            {kind:"ai-move",playerId:player.id,generation:this.controlGenerations.get(player.id) ?? 0,squadIds:cohort.map(s => s.id),tile},
          );
        }
      if (develop && player.kind === "regular" && !this.expansion?.economy.naval.enabled(player)) this.thinkNavy(player);
    }
  }

  private developAi(player: Player): void {
    if (this.expansion) return;
    const own = this.buildingIndex.byOwner(player.id);
    for (const type of buildingPriority(personalityOf(player), [
      "archery",
      "stables",
      "city",
      "factory",
      "port",
      "barracks",
    ])) {
      if (own.some((b) => b.type === type)) continue;
      let tile: number | undefined,
        distance = Infinity;
      for (const t of this.ownedTiles.get(player.id) ?? []) {
        if (
          this.owners[t] !== player.id ||
          this.buildingPlacement(player.id, type, t)
        )
          continue;
        const d = this.map.euclideanDistSquared(player.base, t);
        if (d < distance || (d === distance && t < (tile ?? Infinity))) {
          tile = t;
          distance = d;
        }
      }
      if (tile !== undefined) {
        this.applyCommand({
          type: "build",
          playerId: player.id,
          buildingType: type,
          tile,
        });
        break;
      }
    }
    const port = own.find((b) => b.type === "port" && b.remainingTicks === 0);
    if (!port) return;
    for (const kind of ["transport", "warship"] as ShipType[]) {
      if (
        !this.ships.some((s) => s.playerId === player.id && s.kind === kind)
      ) {
        this.applyCommand({
          type: "recruit-ship",
                autoRecruit: true,
          playerId: player.id,
          buildingId: port.id,
          shipType: kind,
        });
        break;
      }
    }
  }

  private developTribeAi(player: Player): void {
    const own = this.buildingIndex.byOwner(player.id);
    const targets: BuildingType[] = [];
    if (!own.some((b) => b.type === "city")) targets.push("city");
    if (own.filter((b) => b.type === "barracks").length < 2) targets.push("barracks");
    for (const type of targets) {
      const existing = own.filter((b) => b.type === type).length;
      const cost = Math.round(
        BUILDING_RULES[type].cost * buildingCostMultiplier(existing),
      );
      if (availableGold(player) < cost) continue;
      let tile: number | undefined,
        distance = Infinity;
      for (const t of this.ownedTiles.get(player.id) ?? []) {
        if (
          this.owners[t] !== player.id ||
          this.buildingPlacement(player.id, type, t)
        )
          continue;
        const d = this.map.euclideanDistSquared(player.base, t);
        if (d < distance || (d === distance && t < (tile ?? Infinity))) {
          tile = t;
          distance = d;
        }
      }
      if (tile !== undefined) {
        this.applyCommand({
          type: "build",
          playerId: player.id,
          buildingType: type,
          tile,
        });
        break;
      }
    }
  }

  private coastalDestination(
    ship: Ship,
    player: Player,
  ): { land: number; water: number } | undefined {
    const shipTile = this.tileOf(ship);
    const recovering = this.expansion?.operations.enabled(player) && this.expansion.operations.state(player.id)?.phase === "recovery";
    if (!this.waterPaths.walkable(shipTile)) return undefined;
    let best: { land: number; water: number } | undefined,
      distance = Infinity;
    // Static coast edges for this sea, in ascending land-tile order. Ownership is
    // read here, so captures never invalidate the index.
    for (const { landTile: land, waterTile: water } of this.coast.waterEdges(
      this.waterPaths.component[shipTile],
    )) {
      if (recovering ? this.owners[land] !== player.id : (this.owners[land] && !this.hostile(this.owners[land],player.id))) continue;
      if (!this.aiFootprintAllowed(player.id, land)) continue;
      // Prefer enemy shores; neutral land is useful on a different island.
      if (!this.owners[land] && this.paths.connected(player.base, land))
        continue;
      const d =
        this.map.euclideanDistSquared(shipTile, water) +
        (this.owners[land] ? 0 : 10000);
      if (d < distance) {
        best = { land, water };
        distance = d;
      }
    }
    return best;
  }

  private thinkNavy(player: Player): void {
    for (const ship of this.shipIndex.byOwner(player.id)) {
      if (ship.boarding || ship.refit || ship.shoreTransfer || (ship.repairState &&
        !["idle","patrolling"].includes(ship.repairState))) continue;
      if (ship.kind === "warship") {
        const enemies = this.ships
          .filter(
            (s) =>
              this.hostile(s.playerId, player.id) && this.aiCanPursue(player.id, s.playerId, this.tileOf(s)) &&
              this.waterPaths.connected(this.tileOf(ship), this.tileOf(s)),
          )
          .sort(
            (a, b) =>
              this.distanceSquared(ship, a) - this.distanceSquared(ship, b),
          );
        const enemy = enemies[0];
        if (
          enemy &&
          this.distanceSquared(ship, enemy) > SHIP_RULES.warship.range ** 2
        )
          this.applyCommand({
            type: "sail",
            playerId: player.id,
            shipIds: [ship.id],
            tile: this.tileOf(enemy),
          });
        else if (!enemy && ship.destination === null) {
          const coast = this.coastalDestination(ship, player);
          if (coast)
            this.applyCommand({
              type: "sail",
              playerId: player.id,
              shipIds: [ship.id],
              tile: coast.water,
            });
        }
        continue;
      }
      if (ship.destination !== null) continue;
      const cargo = this.squadIndex.cargo(ship.id);
      if (cargo.length) {
        const land = this.map
          .neighbors(this.tileOf(ship))
          .find((t) => this.paths.walkable(t) && (!this.owners[t] || this.hostile(this.owners[t],player.id)) && this.aiFootprintAllowed(player.id, t));
        if (land !== undefined) {
          this.applyCommand({
            type: "unload",
            playerId: player.id,
            shipId: ship.id,
            tile: land,
          });
          continue;
        }
        const coast = this.coastalDestination(ship, player);
        if (coast)
          this.applyCommand({
            type: "sail",
            playerId: player.id,
            shipIds: [ship.id],
            tile: coast.water,
          });
      } else {
        const shore = this.map
          .neighbors(this.tileOf(ship))
          .find((t) => this.paths.walkable(t) && this.owners[t] === player.id);
        if (shore === undefined) continue;
        const nearby = this.squads
          .filter(
            (s) =>
              s.playerId === player.id &&
              s.embarkedOn === null &&
              this.owners[this.tileOf(s)] === player.id &&
              this.paths.connected(this.tileOf(s), shore),
          )
          .sort(
            (a, b) =>
              this.distanceSquared(a, ship) - this.distanceSquared(b, ship),
          )
          .slice(0, 2);
        const ready = nearby.filter(
          (s) => this.distanceSquared(s, ship) <= (3 * FIXED) ** 2,
        );
        if (ready.length)
          this.applyCommand({
            type: "load",
            playerId: player.id,
            shipId: ship.id,
            squadIds: ready.map((s) => s.id),
          });
        else if (nearby.length)
          this.applyCommand({
            type: "order",
            playerId: player.id,
            squadIds: nearby.map((s) => s.id),
            order: { type: "move", tile: shore },
          });
      }
    }
  }

  private promoteTribes(): void {
    for (const player of this.players) {
      if (!canPromoteTribe(player, this.map.numLandTiles())) continue;
      // Progression already exists for every faction. Reclassify in place so
      // all authoritative AI policies activate without replacing any state.
      player.kind = "regular";
      this.expansion?.announce({ kind: "promotion", actorId: player.id });
    }
  }

  private checkWinner(): void {
    const armies = new Set([
        ...this.squads.filter(s=>s.troops>0).map((s) => s.playerId),
        ...(this.expansion
          ? [
              ...this.ships.filter(s=>s.health>0).map((s) => s.playerId),
              ...this.expansion.aircraft
                .filter((a) => a.health > 0)
                .map((a) => a.playerId),
            ]
          : []),
      ]),
      buildings = new Set(this.buildings.filter(b =>
        !b.remainingTicks && (b.health ?? 1) > 0 &&
        (!this.players.find(p => p.id === b.playerId)?.ai || !DEFENSIVE_BUILDINGS.includes(b.type))
      ).map(b => b.playerId)),
      defeated = this.players.filter(
        (p) => !p.eliminated && !armies.has(p.id) && !buildings.has(p.id),
      );
    // Mark the whole terminal batch before resolving credit, so simultaneous
    // defeats cannot award territory to another newly eliminated faction.
    for (const player of defeated) player.eliminated = true;
    const eliminated = new Set(
      this.players.filter((p) => p.eliminated).map((p) => p.id),
    );
    const inheritors = new Map<number, number>();
    for (const player of defeated) {
      const beneficiary = this.conquest.beneficiary(player.id, eliminated);
      if (
        player.ai && player.kind === "regular" &&
        this.player(beneficiary)?.kind === "tribe" && this.expansion
      ) {
        this.expansion.progression.inheritCompleted(beneficiary, player.id);
        inheritors.set(beneficiary, player.id);
      }
      if (
        player.kind === "regular" &&
        this.player(beneficiary)?.kind === "regular"
      )
        this.expansion?.announce({
          kind: "conquest",
          actorId: beneficiary,
          otherId: player.id,
        });
      // Foundations disappear before territory transfer can change their owner.
      for (const building of [...this.buildingIndex.byOwner(player.id)])
        if (building.remainingTicks > 0) this.removeBuilding(building.id);
      for (const tile of [...(this.ownedTiles.get(player.id) ?? []), ...(this.ownedWater.get(player.id) ?? [])].sort(
        (a, b) => a - b,
      )) {
        if (this.owners[tile] !== player.id) continue;
        this.changeOwner(tile, beneficiary);
        this.progress[tile] = 0;
        this.claims[tile] = 0;
        this.activeClaims.delete(tile);
      }
      // Dead vessels are cleaned after terminal ownership resolution.
      for (const ship of [...this.shipIndex.byOwner(player.id)].reverse()) this.removeShip(ship.id);
      for (let i = this.defenseZones.length - 1; i >= 0; i--)
        if (this.defenseZones[i].playerId === player.id)
          this.defenseZones.splice(i, 1);
    }
    for (const [id, donorId] of inheritors) {
      this.player(id)!.kind = "regular";
      this.expansion!.announce({
        kind: "promotion", actorId: id, otherId: donorId,
        age: this.expansion!.progression.states[id].age,
      });
    }
    this.promoteTribes();
    const survivors = this.players.filter((p) => !p.eliminated);
    if (survivors.length === 1) this.winner = survivors[0].id;
    else if (survivors.length === 0) this.winner = 0;
    const coalition = this.expansion?.coalition();
    if (coalition?.length) {
      this.expansion!.winners.push(...coalition);
      this.winner = -1;
    } else if (
      this.expansion &&
      this.winner !== null &&
      this.winner > 0 &&
      !this.expansion.winners.length
    )
      this.expansion.winners.push(this.winner);
  }

  private formationTile(center: number, index: number, count: number): number {
    if (count <= 1) return center;
    const columns = Math.ceil(Math.sqrt(count));
    // AI camp approach goals are whole tiles; use the shared formation spacing
    // before quantizing, rather than retaining a separate three-cell layout.
    const spacing = FORMATION_SPACING / FIXED;
    const dx = Math.round(((index % columns) - (columns - 1) / 2) * spacing);
    const dy = Math.round(
      (Math.floor(index / columns) - (Math.ceil(count / columns) - 1) / 2) *
        spacing,
    );
    const x = this.map.x(center) + dx,
      y = this.map.y(center) + dy;
    if (this.map.isValidCoord(x, y)) {
      const tile = this.map.ref(x, y);
      if (this.paths.connected(center, tile)) return tile;
    }
    return center;
  }

  private eachInRadius(
    center: number,
    radius: number,
    fn: (tile: number) => void,
  ): void {
    const cx = this.map.x(center),
      cy = this.map.y(center),
      maxX = this.map.width() - 1,
      lastY = Math.min(this.map.height() - 1, cy + radius),
      spans = RADIAL_SPANS[radius];
    for (
      let y = Math.max(0, cy - radius);
      y <= lastY;
      y++
    ) {
      const span = spans?.[y - cy + radius] ??
        Math.floor(Math.sqrt(radius * radius - (y - cy) ** 2));
      const lastX = Math.min(maxX, cx + span);
      for (let x = Math.max(0, cx - span); x <= lastX; x++) {
        const tile = this.map.ref(x, y);
        if (this.paths.walkable(tile)) fn(tile);
      }
    }
  }

  private distanceSquared(
    a: Pick<Squad, "x" | "y">,
    b: Pick<Squad, "x" | "y">,
  ): number {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  }

  replicationFacts(): ReplicatedEntities {
    const supply = this.expansion?.supply;
    return {
      metadata:this.expansion?.replicationMetadata(),
      squads: {journal: this.squadChanges, byId: id => this.squad(id)},
      ships: {journal: this.shipChanges, byId: id => this.ship(id)},
      buildings: {journal: this.buildingChanges, byId: id => this.building(id)},
      resources: supply ? {geometryRevision: supply.geometryRevision, ownershipRevision: supply.ownershipRevision,
        journal: supply.resourceChanges, byId: id => supply.deposit(id)} : undefined,
    };
  }
  /** Borrow only until synchronous encoding/postMessage. Public snapshot() keeps
   * its DTO projection; this path avoids projecting every unchanged entity. */
  replicationSource(): SnapshotSource {
    return {tick: this.tick, width: this.map.width(), height: this.map.height(),
      owners: this.owners, claims: this.claims, progress: this.progress,
      players: this.players, buildings: this.buildings, ships: this.ships, squads: this.squads,
      winner: this.winner, combatTicks: this.combatTicks, volleys: this.volleys,
      expansion: this.expansion?.snapshot()};
  }

  snapshot(copyTiles = true): Snapshot {
    return {
      tick: this.tick,
      width: this.map.width(),
      height: this.map.height(),
      owners: copyTiles ? this.owners.slice() : this.owners,
      claims: copyTiles ? this.claims.slice() : this.claims,
      progress: copyTiles ? this.progress.slice() : this.progress,
      players: this.players.map((p) => ({ ...p })),
      buildings: this.buildings.map((b) => ({ ...b })),
      ships: this.ships.map(({ path: _path, nextPathIndex: _index, ...s }) => ({
        ...s,
        waypoints: [...s.waypoints],
        boarding: s.boarding
          ? { ...s.boarding, squadIds: [...s.boarding.squadIds] }
          : null,
        shoreTransfer: s.shoreTransfer ? {
          capacity:s.shoreTransfer.capacity,phase:s.shoreTransfer.phase,
          destinationTile:s.shoreTransfer.destinationTile,landingTile:s.shoreTransfer.landingTile,
        } : undefined,
      })),
      squads: this.squads.map(
        ({
          path: _path,
          nextPathIndex: _index,
          plannedTile: _tile,
          lastPlanTick: _tick,
          ...s
        }) => ({
          ...s,
          order: { ...s.order },
          queuedOrders: s.queuedOrders.map((o) => ({ ...o })),
        }),
      ),
      winner: this.winner,
      combatTicks: this.combatTicks,
      volleys: this.volleys.map((v) => ({ ...v })),
      expansion: this.expansion?.snapshot(),
    };
  }
}
