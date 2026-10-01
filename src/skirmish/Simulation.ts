import type { GameMap } from "../core/game/GameMap";
import { PseudoRandom } from "../core/PseudoRandom";
import { BuildingIndex } from "./BuildingIndex";
import { CoastIndex } from "./CoastIndex";
import { shoreTransportCapacity, shoreTransportDefinition } from "./content/ShoreTransport";
import { ShoreRoutes } from "./domain/ShoreRoutes";
import { ShoreTransport } from "./domain/ShoreTransport";
import { ConquestCredit, DamageLedger } from "./Conquest";
import { constructionRejection } from "./Construction";
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
import { canPromoteTribe } from "./FactionRules";
import { damageAmount, scaledAttack } from "./domain/Combat";
import { commandRejection } from "./domain/CommandPolicy";
import { AGES, type Age } from "./domain/Definitions";
import { Expansion } from "./domain/Expansion";
import { Occupation } from "./domain/Occupation";
import { TerritoryAbsorption } from "./domain/TerritoryAbsorption";
import { costRejection, spend } from "./domain/Supply";
import {
  squadCap,
  TRIBE_BASE_RADIUS,
  TRIBE_INTERCEPT_RANGE,
  TRIBE_PURSUIT_RANGE,
  TRIBE_STARTING_SQUADS,
  tribeCountFor,
} from "./FactionRules";
import { forestOf } from "./Forest";
import { Formations } from "./Formations";
import { HomeTerritory } from "./HomeTerritory";
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
import { StartingPositions } from "./StartingPositions";
import { boardingMeeting, firingPosition } from "./TacticalRoutes";
import { terrainSpeed } from "./Terrain";

const STARTING_TROOPS = 12_000;
const BASE_RADIUS = 6;

// Fixed-step, integer-position simulation. Browser timing and rendering never
// determine gameplay. Human and AI players enter through applyCommand().
export class Skirmish {
  readonly expansion?: Expansion;
  readonly owners: Uint8Array;
  readonly claims: Uint8Array;
  readonly progress: Uint8Array;
  readonly players: Player[] = [];
  readonly squads: Squad[] = [];
  readonly buildings: Building[] = [];
  readonly ships: Ship[] = [];
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
  private tickSquads?: Map<number, Squad>;
  private readonly random: PseudoRandom;
  private readonly pressure: Uint8Array;
  private readonly activeClaims = new Set<number>();
  private readonly occupation = new Occupation();
  private readonly territoryAbsorption: TerritoryAbsorption;
  private readonly ownedTiles = new Map<number, Set<number>>();
  private readonly formations: Formations;
  private readonly avoidance: LocalAvoidance;
  private readonly passageTraffic: PassageTraffic;
  private readonly spatial: SpatialGrid<Squad>;
  private readonly navalSpatial: SpatialGrid<Ship>;
  private readonly heldSpatial: SpatialGrid<Squad>;
  private readonly buildingIndex: BuildingIndex;
  private readonly coast: CoastIndex;
  private readonly shoreTransport: ShoreTransport;
  private readonly routeWork = new RouteWork();
  private readonly localDetours: LocalDetours;
  private readonly homeTerritory: HomeTerritory;
  private readonly conquest = new ConquestCredit();
  private readonly detours = new Map<number, WorldPoint[]>();
  private readonly navigationProgress = new Map<
    number,
    { x: number; y: number; tick: number; recovery: number }
  >();

  constructor(
    readonly map: GameMap,
    readonly options: MatchOptions,
  ) {
    this.territoryAbsorption = new TerritoryAbsorption(map);
    if (
      !Number.isInteger(options.aiCount) ||
      options.aiCount < 1 ||
      options.aiCount >= MAX_FACTIONS
    )
      throw new Error(
        `Choose between one and ${MAX_FACTIONS - 1} AI opponents`,
      );
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
    this.owners = new Uint8Array(size);
    this.claims = new Uint8Array(size);
    this.progress = new Uint8Array(size);
    this.pressure = new Uint8Array(size);
    this.paths = new LandPaths(map, false);
    this.waterPaths = new WaterPaths(map);
    this.formations = new Formations(map, this.paths);
    this.avoidance = new LocalAvoidance(map);
    this.passageTraffic = new PassageTraffic(map, this.paths);
    this.spatial = new SpatialGrid(
      map.width() * FIXED,
      map.height() * FIXED,
      2 * FIXED,
    );
    this.heldSpatial = new SpatialGrid(
      map.width() * FIXED,
      map.height() * FIXED,
      2 * FIXED,
    );
    this.localDetours = new LocalDetours(map, this.spatial);
    this.homeTerritory = new HomeTerritory(map);
    this.navalSpatial = new SpatialGrid(
      map.width() * FIXED,
      map.height() * FIXED,
      4 * FIXED,
    );
    this.buildingIndex = new BuildingIndex(map);
    this.coast = new CoastIndex(map, this.paths, this.waterPaths);
    this.shoreTransport = new ShoreTransport({
      map, paths: this.paths, squads: this.squads, ships: this.ships,
      blocked: (tile, playerId) => this.expansion?.fortifications.blocked(tile, playerId) ?? false,
      slots: (tile, squads, reserved, radius, blocked) => this.formations.plan(tile,
        squads.map(squad => ({squad,origin:squad})),reserved,radius,undefined,blocked),
      activate: (squad, order, path) => this.activateOrder(squad, order, path),
      launch: (playerId, definition, tile) => {
        const ship: Ship = {id:this.nextId++,playerId,kind:"transport",...tilePoint(map,tile),
          health:definition.health,definitionId:definition.id,destination:null,waypoints:[],path:[],
          nextPathIndex:0,fighting:false,boarding:null};
        this.ships.push(ship); return ship;
      },
      unload: (ship,tile) => this.unload(this.player(ship.playerId)!,ship.id,tile),
      resume: (squad,tile) => {
        const completed = this.expansion?.progression.states[squad.playerId]?.completed ?? [];
        const definition = shoreTransportDefinition(completed);
        if (!this.paths.connected(this.tileOf(squad),tile) || (definition && this.shoreTransport.useful(squad,tile,definition))) {
          if (definition && this.shoreTransport.start(squad.playerId,[squad],tile,definition,shoreTransportCapacity(completed),true) === null) return;
        } else {
          const blocked = (t:number) => this.expansion?.fortifications.blocked(t,squad.playerId) ?? false;
          const slots = this.formations.plan(tile,[{squad,origin:squad}],this.squads,undefined,undefined,blocked);
          const point = slots?.get(squad.id);
          const path = point ? this.paths.find(this.tileOf(squad),pointTile(map,point),blocked) : null;
          if (point && path !== null) {
            this.activateOrder(squad,{type:"move",tile:pointTile(map,point),...point},path); return;
          }
        }
        this.activateOrder(squad,{type:"hold"});
      },
    }, new ShoreRoutes(map,this.paths,this.waterPaths,this.coast));
    if (this.paths.largestLand.length < (options.aiCount + 1) * 80)
      throw new Error("This map does not have enough connected land");
    if (options.ruleset === "ages-v1")
      this.expansion = new Expansion(
        this,
        options.seed,
        options.victoryMode,
        options.technologySpeed,
      );
    this.createPlayers();
    this.paths.prepare();
  }

  private createPlayers(): void {
    const roster = new FactionRoster(this.options.seed, FACTIONS);
    const candidates = this.paths.largestLand.filter((tile) => {
      const x = this.map.x(tile),
        y = this.map.y(tile);
      return (
        x >= BASE_RADIUS &&
        y >= BASE_RADIUS &&
        x < this.map.width() - BASE_RADIUS &&
        y < this.map.height() - BASE_RADIUS
      );
    });
    if (candidates.length === 0) throw new Error("No valid starting camp");
    // Farthest-point placement keeps every opponent reachable by land.
    const placement = new StartingPositions(this.map, candidates),
      bases: number[] = [candidates[this.random.nextInt(0, candidates.length)]];
    placement.add(bases[0], BASE_RADIUS);
    for (let i = 1; i <= this.options.aiCount; i++) {
      bases.push(placement.next(BASE_RADIUS));
    }
    bases.forEach((base, index) => {
      const faction = index === 0 ? null : roster.take("regular");
      this.deployPlayer(
        base,
        index + 1,
        "regular",
        faction?.identity.name ?? "You",
        faction?.identity.id,
        faction?.personalityId,
      );
    });
    if (this.options.tribes) {
      const count = tribeCountFor(this.map.width(), this.map.height());
      for (let index = 0; index < count; index++) {
        const faction = roster.take("tribe");
        this.deployPlayer(
          placement.next(TRIBE_BASE_RADIUS),
          bases.length + index + 1,
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
    const player: Player = {
      id,
      name,
      ...(factionId ? { factionId, personalityId } : {}),
      ai: id !== 1,
      kind,
      base,
      reserves: this.expansion && kind === "regular" ? STARTING_AGE_TROOPS : STARTING_TROOPS,
      gold: STARTING_GOLD,
      land: 0,
      losses: 0,
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
      const positions: number[] = [];
      this.eachInRadius(base, 4, (tile) => {
        if (
          this.paths.connected(base, tile) &&
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
          this.map.euclideanDistSquared(a, base) -
            this.map.euclideanDistSquared(b, base) || a - b,
      );
      for (const tile of positions) {
        const point = tilePoint(this.map, tile);
        if (
          this.squads.some(
            (s) =>
              s.playerId === id && distanceSquared(s, point) < FIXED ** 2 * 2,
          )
        )
          continue;
        this.spawnSquad(player, "infantry", tile, defaultUnit("infantry").id);
        if (this.squads.filter((s) => s.playerId === id).length === 3) break;
      }
      return;
    }
    const barracks: Building = {
      id: this.nextId++,
      playerId: player.id,
      type: "barracks",
      tile: base,
      remainingTicks: 0,
    };
    this.buildings.push(barracks);
    this.buildingIndex.add(barracks);
    forestOf(this.map)?.occupy(this.map, base, "barracks");
    for (let i = 0; i < (kind === "tribe" ? TRIBE_STARTING_SQUADS : 4); i++)
      this.applyCommand({
        type: "recruit",
        playerId: player.id,
        buildingId: barracks.id,
      });
  }

  player(id: number): Player | undefined {
    if (this.players[id - 1]?.id === id) return this.players[id - 1];
    return this.players.find((p) => p.id === id);
  }
  squadCapacity(player: Player): number {
    return squadCap(player, this.expansion?.progression.states[player.id]?.age);
  }
  squad(id: number): Squad | undefined {
    if (this.tickSquads) return this.tickSquads.get(id);
    return this.squads.find((s) => s.id === id);
  }
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
    const shipIds = "shipIds" in command ? command.shipIds : "shipId" in command ? [command.shipId] : [];
    if (shipIds.some(id => this.ships.some(s => s.id === id && s.shoreTransfer)))
      return "Shore transports complete their crossing automatically";
    if (
      player.kind === "tribe" &&
      (command.type === "build" || command.type === "recruit-ship")
    )
      return "Tribes defend their camp without building an economy or navy";
    const extended = this.expansion?.command(player, command);
    if (extended !== undefined) {
      if (
        extended === null &&
        (command.type === "charge" || command.type === "attack-structure")
      )
        this.expansion!.armies.observeOrder(command.squadIds);
      return extended;
    }
    if (command.type === "recruit")
      return this.recruit(player, command.buildingId, command.definitionId);
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
        this.ships.find((s) => s.id === id),
      );
      if (ships.some((s) => !s || s.playerId !== player.id))
        return "Select your own ships";
      for (const ship of ships as Ship[]) {
        this.cancelBoarding(ship);
        ship.destination = null;
        ship.attackTargetId = null;
        ship.waypoints = [];
        ship.path = [];
        ship.nextPathIndex = 0;
      }
      return null;
    }
    if (command.type === "load")
      return this.load(player, command.shipId, command.squadIds);
    if (command.type === "board")
      return this.board(player, command.shipId, command.squadIds);
    if (command.type === "unload")
      return this.unload(player, command.shipId, command.tile);
    if (
      command.type !== "order" ||
      !Array.isArray(command.squadIds) ||
      !command.order
    )
      return "Invalid order";
    const byId = this.tickSquads ?? new Map(this.squads.map((s) => [s.id, s]));
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
    if (order.type === "move" && !this.paths.walkable(order.tile))
      return "Choose passable land. Use a transport to cross water.";
    const transportCompleted = this.expansion?.progression.states[player.id]?.completed ?? [];
    const transportDefinition = shoreTransportDefinition(transportCompleted);
    if (order.type === "move" && selected.some(s => !this.paths.connected(this.tileOf(s!),order.tile) ||
      (transportDefinition && this.shoreTransport.useful(s!,order.tile,transportDefinition)))) {
      const completed = this.expansion?.progression.states[player.id]?.completed ?? [];
      const definition = shoreTransportDefinition(completed);
      if (!definition) return "Research Cargo Canoes to cross water automatically";
      if (append && selected.some(s => s!.order.type !== "hold")) {
        for (const squad of selected as Squad[]) squad.queuedOrders.push({...order});
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
    if (armyOrder !== undefined) return armyOrder;
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
        this.expansion
          ? (t) => this.expansion!.fortifications.blocked(t, player.id)
          : undefined,
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
        const center = tilePoint(this.map, tile);
        nextOrder =
          destination.x === center.x && destination.y === center.y
            ? { type: "move", tile }
            : { type: "move", tile, ...destination };
      } else if (order.type === "attack") {
        const target = this.squad(order.targetId)!;
        if (!this.paths.connected(this.tileOf(squad), this.tileOf(target)))
          return "That enemy cannot be reached by land";
      }
      orders.push({ squad, order: nextOrder, path });
    }
    for (const entry of orders) {
      if (this.expansion && !append) {
        entry.squad.charge = null;
        entry.squad.structureTarget = null;
      }
      if (append && entry.squad.order.type !== "hold") {
        entry.squad.queuedOrders.push(entry.order);
        this.formations.refresh(entry.squad);
      } else {
        entry.squad.queuedOrders = [];
        this.activateOrder(entry.squad, entry.order, entry.path);
      }
    }
    this.expansion?.armies.observeOrder(command.squadIds, order, append);
    return null;
  }

  private activateOrder(squad: Squad, order: Order, path: number[] = []): void {
    this.navigationProgress.delete(squad.id);
    this.detours.delete(squad.id);
    squad.order = order;
    squad.path = order.type === "move" ? [this.tileOf(squad), ...path] : path;
    squad.nextPathIndex = 0;
    squad.plannedTile = -1;
    squad.lastPlanTick = -20;
    this.formations.refresh(squad);
  }

  private finishOrder(squad: Squad): void {
    while (squad.queuedOrders.length) {
      const order = squad.queuedOrders.shift()!;
      if (order.type === "move") {
        const path = this.paths.find(
          this.tileOf(squad),
          order.tile,
          this.expansion
            ? (t) => this.expansion!.fortifications.blocked(t, squad.playerId)
            : undefined,
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
  ): string | null {
    const building = this.buildings.find((b) => b.id === buildingId);
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
    if (
      this.expansion &&
      (!definition ||
        !this.expansion.progression.has(player.id, definition.technologyId) ||
        definition.building !== building.type ||
        AGES.indexOf(building.age ?? "StoneAge") < AGES.indexOf(definition.age))
    )
      return "Needs the researched definition and its matching building tier";
    if (definition) {
      const rejection = costRejection(
        player,
        this.expansion!.supply.inventories[player.id],
        definition.cost,
      );
      if (rejection) return rejection;
    }
    const kind = definition?.line ?? BUILDING_RULES[building.type].squad;
    if (!kind) return "This building does not recruit land squads";
    if (player.reserves < SQUAD_TROOPS)
      return "Recruitment needs 1,000 reserve troops";
    if (
      this.squads.filter((s) => s.playerId === player.id).length >=
      this.squadCapacity(player)
    )
      return `You have reached the ${this.squadCapacity(player)}-squad limit for this faction`;
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
            squadSeparation(recruitGeometry, s) ** 2,
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
    if (definition)
      spend(player, this.expansion!.supply.inventories[player.id], {
        ...definition.cost,
        reserves: 0,
      });
    this.spawnSquad(player, kind, best, definition?.id);
    return null;
  }

  allocateId(): number {
    return this.nextId++;
  }
  ownedLand(playerId: number): Iterable<number> {
    return this.ownedTiles.get(playerId) ?? [];
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
  ): void {
    player.reserves -= SQUAD_TROOPS;
    this.squads.push({
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
    const recruited = this.squads[this.squads.length - 1];
    this.tickSquads?.set(recruited.id, recruited);
    this.spatial.insert(recruited);
    this.formations.refresh(recruited);
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
    this.buildingIndex.ensure(this.buildings);
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
    if (!this.expansion) player.gold -= BUILDING_RULES[type].cost;
    this.buildings.push({
      id: this.nextId++,
      playerId: player.id,
      type,
      tile,
      remainingTicks: BUILDING_RULES[type].ticks,
      ...(this.expansion
        ? { age: age ?? this.expansion.progression.states[player.id].age }
        : {}),
    });
    this.expansion?.built(player, this.buildings[this.buildings.length - 1]);
    this.buildingIndex.add(this.buildings[this.buildings.length - 1]);
    forestOf(this.map)?.occupy(this.map, tile, type);
    return null;
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
      squad.troops += amount;
      player.reserves -= amount;
      if (squad.troops === SQUAD_TROOPS) this.finishOrder(squad);
    }
  }

  private recruitShip(
    player: Player,
    buildingId: number,
    kind: ShipType,
    definitionId?: string,
  ): string | null {
    if (!Object.prototype.hasOwnProperty.call(SHIP_RULES, kind))
      return "Unknown ship type";
    const port = this.buildings.find((b) => b.id === buildingId);
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
    if (
      this.expansion &&
      (!vessel ||
        vessel.kind !== kind ||
        !this.expansion.progression.has(player.id, vessel.technologyId) ||
        AGES.indexOf(port.age ?? "StoneAge") < AGES.indexOf(vessel.age))
    )
      return "Research this vessel and build its port tier";
    if (vessel) {
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
    if (player.gold < rules.cost) return "Not enough gold for this ship";
    if (this.ships.filter((s) => s.playerId === player.id).length >= MAX_SHIPS)
      return `This skirmish allows ${MAX_SHIPS} ships per player`;
    const tile = this.map
      .neighbors(port.tile)
      .find((n) => this.waterPaths.walkable(n));
    if (tile === undefined) return "This port has no navigable water";
    if (vessel)
      spend(player, this.expansion!.supply.inventories[player.id], vessel.cost);
    else player.gold -= rules.cost;
    this.ships.push({
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
    });
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
      this.ships.find((s) => s.id === id),
    );
    if (
      !ships.length ||
      ships.some((s) => !s || s.playerId !== player.id || s.refit)
    )
      return "Select your own ships";
    if (!this.waterPaths.walkable(tile))
      return "Ships sail on water; use Unload to land troops";
    const planned: { ship: Ship; path: number[] }[] = [];
    for (const ship of ships as Ship[]) {
      if (append && ship.waypoints.length >= MAX_QUEUED_ORDERS)
        return "A ship can queue 32 waypoints";
      const origin = append
        ? (ship.waypoints[ship.waypoints.length - 1] ??
          ship.destination ??
          this.tileOf(ship))
        : this.tileOf(ship);
      const path = this.waterPaths.find(origin, tile);
      if (path === null) return "That water cannot be reached by this ship";
      planned.push({ ship, path });
    }
    for (const { ship, path } of planned) {
      ship.attackTargetId = null;
      this.cancelBoarding(ship);
      if (append && ship.destination !== null) ship.waypoints.push(tile);
      else {
        ship.destination = tile;
        ship.waypoints = [];
        ship.path = [this.tileOf(ship), ...path];
        ship.nextPathIndex = 0;
      }
    }
    return null;
  }

  private cancelBoarding(ship: Ship): void {
    if (!ship.boarding) return;
    for (const squad of this.squads) {
      if (squad.order.type !== "board" || squad.order.shipId !== ship.id)
        continue;
      squad.queuedOrders = [];
      this.activateOrder(squad, { type: "hold" });
    }
    ship.boarding = null;
  }

  private board(player: Player, shipId: number, ids: number[]): string | null {
    const ship = this.ships.find(
      (s) =>
        s.id === shipId && s.playerId === player.id && s.kind === "transport",
    );
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
              squadSeparation(squad, other) ** 2,
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
          this.expansion
            ? (t) => this.expansion!.fortifications.blocked(t, squad.playerId)
            : undefined,
        ),
      });
    }
    if (planned.some((p) => p.path === null))
      return "A squad cannot reach the meeting coast";
    // Commit both sides only after every route has been validated.
    this.cancelBoarding(ship);
    ship.boarding = meeting;
    ship.destination = meeting.waterTile;
    ship.waypoints = [];
    ship.path = [this.tileOf(ship), ...seaPath];
    ship.nextPathIndex = 0;
    for (const { squad, tile, path } of planned) {
      squad.queuedOrders = [];
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
      meeting.squadIds = pending.map((s) => s.id);
      if (!pending.length) {
        ship.boarding = null;
        ship.destination = null;
        ship.path = [];
        ship.nextPathIndex = 0;
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
        this.squads.filter((s) => s.embarkedOn === ship.id).length;
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
          squad.queuedOrders = [];
          this.activateOrder(squad, { type: "hold" });
        }
      }
      meeting.squadIds = pending
        .filter((s) => s.order.type === "board")
        .map((s) => s.id);
      if (!meeting.squadIds.length) ship.boarding = null;
    }
    for (const squad of this.squads)
      if (squad.order.type === "board") {
        const shipId = squad.order.shipId;
        if (!this.ships.some((s) => s.id === shipId)) {
          squad.queuedOrders = [];
          this.activateOrder(squad, { type: "hold" });
        }
      }
  }

  private embark(squad: Squad, ship: Ship): void {
    const queued = ship.shoreTransfer?.queued.find(q => q.squadId === squad.id);
    if (queued && squad.queuedOrders.length) queued.orders.push(...squad.queuedOrders);
    squad.embarkedOn = ship.id;
    squad.queuedOrders = [];
    squad.firingCharge = 0;
    this.activateOrder(squad, { type: "hold" });
    squad.x = ship.x;
    squad.y = ship.y;
  }

  private load(player: Player, shipId: number, ids: number[]): string | null {
    const ship = this.ships.find(
      (s) => s.id === shipId && s.playerId === player.id,
    );
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
    const cargo = this.squads.filter((s) => s.embarkedOn === ship.id);
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
    for (const squad of selected as Squad[]) {
      this.embark(squad, ship);
    }
    return null;
  }

  private unload(player: Player, shipId: number, tile: number): string | null {
    const ship = this.ships.find(
      (s) => s.id === shipId && s.playerId === player.id,
    );
    if (!ship || ship.kind !== "transport") return "Choose your transport";
    if (ship.destination !== null)
      return "Stop beside the landing coast before unloading";
    if (
      !this.paths.walkable(tile) ||
      this.map.manhattanDist(this.tileOf(ship), tile) !== 1
    )
      return "Choose passable coastal land directly beside the transport";
    const cargo = this.squads.filter((s) => s.embarkedOn === ship.id);
    if (!cargo.length) return "This transport has no squads aboard";
    const slots = this.formations.plan(
      tile,
      cargo.map((squad) => ({ squad, origin: ship })),
      this.squads,
      3 * FIXED,
      undefined,
      this.expansion ? (t) => this.expansion!.fortifications.blocked(t,ship.playerId) : undefined,
    );
    if (!slots) return "There is no room for the squads on this landing coast";
    cargo.forEach((squad) => {
      const destination = slots.get(squad.id)!;
      squad.embarkedOn = null;
      squad.x = destination.x;
      squad.y = destination.y;
    });
    return null;
  }

  private moveShip(ship: Ship): void {
    if (ship.refit) return;
    let budget = this.expansion
      ? this.expansion.vessel(ship).speed
      : SHIP_RULES[ship.kind].speed;
    while (budget > 0 && ship.nextPathIndex < ship.path.length) {
      const tile = ship.path[ship.nextPathIndex];
      const dx = this.map.x(tile) * FIXED + FIXED / 2 - ship.x;
      const dy = this.map.y(tile) * FIXED + FIXED / 2 - ship.y;
      const distance = Math.abs(dx) + Math.abs(dy);
      if (distance <= budget) {
        ship.x += dx;
        ship.y += dy;
        budget -= distance;
        ship.nextPathIndex++;
      } else {
        const sx = Math.sign(dx) * Math.min(Math.abs(dx), budget);
        ship.x += sx;
        budget -= Math.abs(sx);
        ship.y += Math.sign(dy) * Math.min(Math.abs(dy), budget);
        budget = 0;
      }
    }
    if (ship.destination !== null && ship.nextPathIndex >= ship.path.length) {
      ship.destination = ship.waypoints.shift() ?? null;
      ship.path =
        ship.destination === null
          ? []
          : (this.waterPaths.find(this.tileOf(ship), ship.destination) ?? []);
      ship.nextPathIndex = 0;
    }
    for (const squad of this.squads)
      if (squad.embarkedOn === ship.id) {
        squad.x = ship.x;
        squad.y = ship.y;
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
      ship.fighting = false;
      if (ship.refit) continue;
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
          !this.hostile(enemy.playerId, ship.playerId) ||
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
        ? (this.ships.find((s) => s.id === ship.attackTargetId) ??
          this.buildings.find((b) => b.id === ship.attackTargetId))
        : undefined;
      if (
        explicit &&
        this.hostile(ship.playerId, explicit.playerId) &&
        this.expansion
      ) {
        const p =
            "tile" in explicit ? tilePoint(this.map, explicit.tile) : explicit,
          range = rules.range;
        if (this.distanceSquared(ship, p) > range ** 2) {
          if (this.tick - (ship.lastPlanTick ?? -60) >= 60) {
            ship.lastPlanTick = this.tick;
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
                  this.waterPaths.connected(this.tileOf(ship), t)
                ) {
                  goal = t;
                  best = distance;
                }
              }
            if (goal !== undefined) {
              ship.path = this.waterPaths.find(this.tileOf(ship), goal) ?? [];
              ship.nextPathIndex = 0;
              ship.destination = goal;
              ship.waypoints = [];
            }
          }
          continue;
        }
        ship.fighting = true;
        ship.destination = null;
        ship.path = [];
        if (this.tick < (ship.nextAttackTick ?? 0)) continue;
        ship.nextAttackTick = this.tick + vessel!.attack!.reloadTicks;
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
      } else if (ship.attackTargetId) ship.attackTargetId = null;
      if (!target) continue;
      ship.fighting = true;
      if (vessel) {
        if (this.tick < (ship.nextAttackTick ?? 0)) continue;
        ship.nextAttackTick = this.tick + vessel.attack!.reloadTicks;
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
      ship.health = Math.max(0, ship.health - damage);
      if (damage) ship.fighting = true;
    }
    const sunk = new Set(
      this.ships.filter((s) => s.health === 0).map((s) => s.id),
    );
    this.conquest.losses(
      this.ships.filter((s) => sunk.has(s.id)),
      hits,
    );
    for (let i = this.squads.length - 1; i >= 0; i--) {
      const squad = this.squads[i];
      if (squad.embarkedOn !== null && sunk.has(squad.embarkedOn)) {
        this.player(squad.playerId)!.losses += squad.troops;
        this.tickSquads?.delete(squad.id);
        this.squads.splice(i, 1);
      }
    }
    for (let i = this.ships.length - 1; i >= 0; i--)
      if (sunk.has(this.ships[i].id)) this.ships.splice(i, 1);
  }

  step(): void {
    if (this.winner !== null) return;
    this.tick++;
    this.tickSquads = new Map(this.squads.map((s) => [s.id, s]));
    while (
      this.volleys.length &&
      this.tick - this.volleys[0].tick > ARCHER_ARROW_TICKS
    )
      this.volleys.shift();
    for (const building of this.buildings)
      if (building.remainingTicks > 0) building.remainingTicks--;
    this.buildingIndex.rebuild(this.buildings);
    this.promoteTribes();
    this.expansion?.beforeStep();
    this.produceReserves();
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
    this.processBoarding();
    for (const ship of this.ships) this.moveShip(ship);
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
        this.routeWork.drain(24);
      } finally {
        this.formations.endBatch();
      }
    } else this.routeWork.drain(24);
    this.heldSpatial.rebuild(land.filter((s) => this.holding(s)));
    const intents: MovementIntent[] = [];
    for (const squad of land) {
      const intent = this.navigation(squad);
      if (intent) intents.push(intent);
    }
    this.passageTraffic.coordinate(intents);
    const previous = this.expansion
      ? new Map(land.map((s) => [s.id, { x: s.x, y: s.y }]))
      : undefined;
    this.avoidance.step(land, intents, this.spatial);
    if (this.expansion)
      for (const squad of land)
        if (
          !this.expansion.fortifications.clear(
            previous!.get(squad.id)!,
            squad,
            squad.playerId,
          )
        ) {
          const old = previous!.get(squad.id)!;
          squad.x = old.x;
          squad.y = old.y;
          squad.moved = false;
          squad.path = [];
          squad.plannedTile = -1;
          squad.lastPlanTick = -20;
        }
    for (const squad of this.squads) {
      if (squad.embarkedOn !== null) {
        squad.moved = false;
        continue;
      }
      this.advanceNavigation(squad);
    }
    this.spatial.rebuild(land);
    this.fight();
    this.fightShips();
    this.expansion?.afterMovement();
    const liveIds = new Set(this.squads.map((s) => s.id));
    for (const id of this.navigationProgress.keys())
      if (!liveIds.has(id)) {
        this.navigationProgress.delete(id);
        this.detours.delete(id);
      }
    this.replenish();
    this.capture();
    for (const pocket of this.territoryAbsorption.step(
      this.tick, this.owners,
      (tile) => this.buildingsAt(tile).length > 0,
      (owner, recipient) => this.hostile(owner, recipient),
    )) {
      for (const tile of pocket.tiles) {
        this.changeOwner(tile, pocket.recipient);
        this.progress[tile] = 0;
        this.claims[tile] = 0;
        this.activeClaims.delete(tile);
      }
    }
    this.processBoarding();
    this.shoreTransport.step();
    this.checkWinner();
    this.expansion?.armies.reconcile();
    this.tickSquads = undefined;
  }

  private produceReserves(): void {
    if (this.tick % TICKS_PER_SECOND !== 0) return;
    if (this.expansion) {
      for (const player of this.players) {
        if (player.eliminated) continue;
        const cities = this.buildings.filter(
          (b) =>
            b.playerId === player.id && b.type === "city" && !b.remainingTicks,
        );
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
    return this.expansion?.fortifications.blocked(tile, playerId) ?? false;
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
  queueArmyRoute(key: string, work: () => void): void {
    this.routeWork.request(key, 1, work);
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
      squad.queuedOrders = [...via.slice(1), point].map((p) => ({
        type: "move",
        tile: pointTile(this.map, p),
        ...p,
      }));
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
      squad.nextPathIndex = squad.path.length;
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
      squad.nextPathIndex++;
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
      !this.expansion.fortifications.clear(squad, end, squad.playerId)
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
      if (other.id === squad.id || !this.holding(other)) return true;
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
        squadSeparation(squad, other) ** 2
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
    this.queueNavigation(squad, () => this.repairNavigation(squad));
  }

  private queueNavigation(squad: Squad, run: () => void): void {
    const order = squad.order;
    this.routeWork.request(`navigation:${squad.id}`, 1, () => {
      if (
        this.squad(squad.id) === squad &&
        squad.order === order &&
        squad.embarkedOn === null
      )
        run();
    });
  }

  private repairNavigation(squad: Squad): void {
    if (squad.order.type !== "move" && squad.order.type !== "board") return;
    const destination =
      squad.order.type === "move"
        ? this.moveDestination(squad.order)
        : tilePoint(this.map, squad.order.tile);
    const detour = this.localDetours.find(squad, destination, (other) =>
      this.holding(other),
    );
    if (detour) {
      this.detours.set(squad.id, detour);
      return;
    }
    const nearby: Squad[] = [];
    // Repair toward a nearby point on the existing corridor. Moving units are
    // local obstacles, not a reason to search the entire continent again.
    const join = Math.min(squad.path.length - 1, squad.nextPathIndex + 8);
    const goal = squad.path[join] ?? squad.order.tile;
    const path = this.paths.findExact(
      this.tileOf(squad),
      goal,
      (tile) => {
        const point = tilePoint(this.map, tile);
        this.spatial.query(point.x, point.y, 2 * FIXED, nearby);
        return nearby.some(
          (other) =>
            other.id !== squad.id &&
            this.holding(other) &&
            distanceSquared(other, point) < squadSeparation(squad, other) ** 2,
        );
      },
      2048,
    );
    if (path !== null) {
      squad.path = [this.tileOf(squad), ...path, ...squad.path.slice(join + 1)];
      squad.nextPathIndex = 0;
    }
  }

  // Navigation produces intent. Only the avoidance solver commits positions.
  private navigation(squad: Squad): MovementIntent | null {
    if (squad.refit || squad.charge?.phase === "recovery") return null;
    if (squad.order.type === "hold" || squad.order.type === "replenish")
      return null;
    if (squad.order.type === "attack") {
      const target = this.squad(squad.order.targetId);
      if (
        !target ||
        target.embarkedOn !== null ||
        !this.hostile(squad.playerId, target.playerId)
      ) {
        this.finishOrder(squad);
        return null;
      }
      const stopDistance = (
        this.expansion
          ? this.expansion.unit(squad).attack.channel === "ranged"
          : squad.kind === "archer"
      )
        ? (this.expansion?.unit(squad).attack.range ?? SQUAD_RULES.archer.range)
        : meleeContact(squad.kind, target.kind);
      const distance = Math.sqrt(distanceSquared(squad, target));
      if (distance <= stopDistance) return null;
      const stopPoint = {
        x: target.x + ((squad.x - target.x) * stopDistance) / distance,
        y: target.y + ((squad.y - target.y) * stopDistance) / distance,
      };
      // Direct pursuit keeps melee in contact and ranged squads at the outer edge.
      if (
        distance <= 8 * FIXED &&
        traversable(this.map, squad, stopPoint, squadRadius(squad.kind))
      )
        return {
          squad,
          goal: target,
          speed: this.movementSpeed(squad),
          stopDistance,
        };
      const targetTile = this.tileOf(target);
      if (
        this.tick - squad.lastPlanTick >= 10 &&
        (targetTile !== squad.plannedTile ||
          squad.nextPathIndex >= squad.path.length)
      ) {
        this.queueNavigation(squad, () => {
          if (this.squad(target.id) !== target || target.embarkedOn !== null)
            return;
          const currentTargetTile = this.tileOf(target);
          const goal = (
            this.expansion
              ? this.expansion.unit(squad).attack.channel === "ranged"
              : squad.kind === "archer"
          )
            ? firingPosition(
                this.map,
                this.paths,
                squad,
                target,
                this.expansion?.unit(squad).attack.range ??
                  SQUAD_RULES.archer.range,
              )
            : currentTargetTile;
          const path =
            goal === null
              ? null
              : this.paths.find(
                  this.tileOf(squad),
                  goal,
                  this.expansion
                    ? (t) =>
                        this.expansion!.fortifications.blocked(
                          t,
                          squad.playerId,
                        )
                    : undefined,
                );
          squad.path = path === null ? [] : [this.tileOf(squad), ...path];
          squad.nextPathIndex = 0;
          squad.plannedTile = currentTargetTile;
          squad.lastPlanTick = this.tick;
        });
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
      this.queueNavigation(squad, () => {
        if (squad.order.type !== "move" && squad.order.type !== "board") return;
        const path = this.paths.find(
          this.tileOf(squad),
          squad.order.tile,
          (t) => this.expansion!.fortifications.blocked(t, squad.playerId),
        );
        squad.path = path ?? [];
        squad.nextPathIndex = 0;
        squad.lastPlanTick = this.tick;
      });
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
      this.queueNavigation(squad, () => {
        if (squad.order.type !== "move" && squad.order.type !== "board") return;
        const path = this.paths.find(
          this.tileOf(squad),
          squad.order.tile,
          this.expansion
            ? (t) => this.expansion!.fortifications.blocked(t, squad.playerId)
            : undefined,
        );
        if (path !== null) {
          squad.path = [this.tileOf(squad), ...path];
          squad.nextPathIndex = 0;
          squad.lastPlanTick = this.tick;
          this.advanceNavigation(squad);
        }
      });
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
        squad.nextPathIndex = index;
        break;
      }
    }
    return {
      squad,
      goal: this.navigationGoal(squad, squad.nextPathIndex),
      speed: this.movementSpeed(squad),
    };
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
      squad.fighting = false;
      squad.combatTargetId = null;
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
        squad.firingCharge = 0;
        continue;
      }
      squad.fighting = true;
      squad.combatTargetId = target.id;
      squad.lastCombatTick = this.tick;
      target.lastCombatTick = this.tick;
      if (squad.kind === "archer") {
        squad.firingCharge += squad.moved
          ? ARCHER_MOVING_CHARGE
          : ARCHER_STATIONARY_CHARGE;
        if (squad.firingCharge < ARCHER_CHARGE_REQUIRED) continue;
        squad.firingCharge -= ARCHER_CHARGE_REQUIRED;
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

  resolveLandDamage(damage: DamageLedger): void {
    if (damage.size) this.combatTicks++;
    // Apply all hits simultaneously. Dead squads still deliver the hit they
    // earned at the start of this combat step; iteration order cannot win a duel.
    for (const squad of this.squads) {
      const losses = Math.min(squad.troops, damage.damage(squad.id));
      squad.troops -= losses;
      if (losses > 0) squad.fighting = true;
      this.player(squad.playerId)!.losses += losses;
    }
    this.conquest.losses(
      this.squads.filter((s) => s.troops <= 0),
      damage,
    );
    for (let i = this.squads.length - 1; i >= 0; i--)
      if (this.squads[i].troops <= 0) {
        this.tickSquads?.delete(this.squads[i].id);
        this.squads.splice(i, 1);
      }
  }

  private capture(): void {
    this.pressure.fill(0);
    const accelerated = new Map<number, number>();
    this.buildingIndex.ensure(this.buildings);
    for (const squad of this.squads) {
      if (squad.embarkedOn !== null) continue;
      const definition = this.expansion?.unit(squad);
      if (definition && !definition.canCapture) continue;
      const position = this.tileOf(squad),
        component = this.paths.component[position];
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
          (this.expansion && !this.expansion.canCaptureTile(squad, tile))
        )
          return;
        const previous = this.pressure[tile];
        this.pressure[tile] =
          previous === 0 || previous === squad.playerId ? squad.playerId : 255;
        if (captureTicks)
          accelerated.set(
            tile,
            Math.min(accelerated.get(tile) ?? Infinity, captureTicks),
          );
        if (squad.playerId !== this.owners[tile]) this.activeClaims.add(tile);
      });
    }
    for (const tile of this.activeClaims) {
      const claimant = this.pressure[tile];
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
    if (old) this.ownedTiles.get(old)?.delete(tile);
    if (id) {
      let tiles = this.ownedTiles.get(id);
      if (!tiles) this.ownedTiles.set(id, (tiles = new Set()));
      tiles.add(tile);
    }
    if (old) this.player(old)!.land--;
    this.owners[tile] = id;
    this.territoryAbsorption.changed(tile);
    if (id) this.player(id)!.land++;
    this.buildingIndex.ensure(this.buildings);
    const buildings = this.buildingIndex.at(tile);
    const captured = buildings.some(
      (building) => building.playerId === old && old !== 0,
    );
    for (const building of buildings) building.playerId = id;
    if (captured && this.expansion && id && this.hostile(old, id)) {
      const captor = this.squads
        .filter((s) => s.playerId === id && s.embarkedOn === null)
        .sort(
          (a, b) =>
            this.distanceSquared(a, tilePoint(this.map, tile)) -
              this.distanceSquared(b, tilePoint(this.map, tile)) || a.id - b.id,
        )[0];
      if (captor) captor.xp = Math.min(20000, (captor.xp ?? 0) + 50);
    }
    if (
      captured &&
      !this.buildings.some((building) => building.playerId === old)
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
    const nearby: Squad[] = [];
    for (const player of this.players) {
      if (!player.ai || player.eliminated) continue;
      const personality = personalityOf(player);
      const develop = this.tick % 60 === player.id % 60;
      if (develop && player.kind === "regular") this.developAi(player);
      let own = armies.get(player.id) ?? [];
      if (
        develop &&
        this.squads.filter((s) => s.playerId === player.id).length <
          this.squadCapacity(player) &&
        player.reserves >= SQUAD_TROOPS &&
        own.length < this.squadCapacity(player)
      ) {
        const lines = recruitmentOrder(personality, {
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
              playerId: player.id,
              buildingId: recruiter.id,
            });
        }
        own = this.squads.filter(
          (s) => s.playerId === player.id && s.embarkedOn === null,
        );
      }
      const enemyPlayers = this.players.filter(
        (p) => this.hostile(p.id, player.id) && !p.eliminated,
      );
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
            this.map.euclideanDistSquared(player.base, tile) <= homeRadius ** 2,
        ),
        reserved = new Set(
          own.flatMap((s) => (s.order.type === "move" ? [s.order.tile] : [])),
        );
      const raids = new Map<number, Squad[]>();
      for (let i = 0; i < own.length; i++) {
        const squad = own[i];
        // Every squad thinks once per 15 ticks; IDs spread the work evenly.
        if ((this.tick + squad.id) % 15 !== 1) continue;
        if (
          squad.refit ||
          this.expansion?.modernization.holds(squad.id) ||
          squad.charge ||
          squad.structureTarget ||
          (squad.definitionId &&
            UNIT.get(squad.definitionId)?.role === "launcher")
        )
          continue;
        if (squad.order.type === "board") continue;
        const current = this.tileOf(squad);
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
          distance = Number.MAX_SAFE_INTEGER;
        this.spatial.query(squad.x, squad.y, 20 * FIXED, nearby);
        for (const enemy of nearby) {
          if (!this.hostile(enemy.playerId, player.id)) continue;
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
          if (d < distance || (d === distance && enemy.id < nearest!.id)) {
            distance = d;
            nearest = enemy;
          }
        }
        if (
          this.owners[current] === player.id &&
          squad.troops < personality.replenishBelow &&
          (!nearest || distance > (12 * FIXED) ** 2)
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
        if (squad.order.type !== "hold") continue;
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
              this.hostile(enemy.playerId, player.id),
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
          const expansion = this.homeTerritory.goal(
            player.id,
            player.base,
            current,
            this.owners,
            frontier,
            reserved,
          );
          if (expansion === undefined) continue;
          goal = expansion;
        }
        if (raidCenter !== null) {
          let raid = raids.get(raidCenter);
          if (!raid) raids.set(raidCenter, (raid = []));
          raid.push(squad);
          continue;
        }
        this.routeWork.request(`ai:${squad.id}`, 1, () => {
          if (
            this.squad(squad.id) !== squad ||
            squad.order.type !== "hold" ||
            squad.embarkedOn !== null
          )
            return;
          this.applyCommand({
            type: "order",
            playerId: player.id,
            squadIds: [squad.id],
            order: { type: "move", tile: goal },
          });
        });
      }
      // Cohorts share one long HPA corridor and only refine local connectors.
      // Group size also bounds the route-work charge of any queued command.
      for (const [tile, raid] of raids)
        for (let at = 0; at < raid.length; at += 16) {
          const cohort = raid.slice(at, at + 16);
          this.routeWork.request(
            `raid:${player.id}:${tile}:${cohort[0].id}`,
            cohort.length,
            () => {
              const ready = cohort.filter(
                (s) =>
                  this.squad(s.id) === s &&
                  s.order.type === "hold" &&
                  s.embarkedOn === null,
              );
              if (ready.length)
                this.applyCommand({
                  type: "order",
                  playerId: player.id,
                  squadIds: ready.map((s) => s.id),
                  order: { type: "move", tile },
                });
            },
          );
        }
      if (develop && player.kind === "regular") this.thinkNavy(player);
    }
  }

  private developAi(player: Player): void {
    if (this.expansion) return;
    const own = this.buildings.filter((b) => b.playerId === player.id);
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
        if (d < distance) {
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
          playerId: player.id,
          buildingId: port.id,
          shipType: kind,
        });
        break;
      }
    }
  }

  private coastalDestination(
    ship: Ship,
    player: Player,
  ): { land: number; water: number } | undefined {
    let best: { land: number; water: number } | undefined,
      distance = Infinity;
    for (let land = 0; land < this.owners.length; land++) {
      if (!this.paths.walkable(land) || this.owners[land] === player.id)
        continue;
      // Prefer enemy shores; neutral land is useful on a different island.
      if (!this.owners[land] && this.paths.connected(player.base, land))
        continue;
      for (const water of this.map.neighbors(land)) {
        if (!this.waterPaths.connected(this.tileOf(ship), water)) continue;
        const d =
          this.map.euclideanDistSquared(this.tileOf(ship), water) +
          (this.owners[land] ? 0 : 10000);
        if (d < distance) {
          best = { land, water };
          distance = d;
        }
      }
    }
    return best;
  }

  private thinkNavy(player: Player): void {
    for (const ship of this.ships.filter((s) => s.playerId === player.id)) {
      if (ship.boarding) continue;
      if (ship.kind === "warship") {
        const enemies = this.ships
          .filter(
            (s) =>
              this.hostile(s.playerId, player.id) &&
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
      const cargo = this.squads.filter((s) => s.embarkedOn === ship.id);
      if (cargo.length) {
        const land = this.map
          .neighbors(this.tileOf(ship))
          .find((t) => this.paths.walkable(t) && this.owners[t] !== player.id);
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
        ...this.squads.map((s) => s.playerId),
        ...(this.expansion
          ? [
              ...this.ships.map((s) => s.playerId),
              ...this.expansion.aircraft
                .filter((a) => a.health > 0)
                .map((a) => a.playerId),
            ]
          : []),
      ]),
      buildings = new Set(this.buildings.map((b) => b.playerId)),
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
      for (const tile of this.ownedTiles.get(player.id) ?? []) {
        if (this.owners[tile] !== player.id) continue;
        this.changeOwner(tile, beneficiary);
        this.progress[tile] = 0;
        this.claims[tile] = 0;
        this.activeClaims.delete(tile);
      }
      // Empty ships cannot keep a defeated land faction in the match.
      for (let i = this.ships.length - 1; i >= 0; i--)
        if (this.ships[i].playerId === player.id) this.ships.splice(i, 1);
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
      cy = this.map.y(center);
    for (
      let y = Math.max(0, cy - radius);
      y <= Math.min(this.map.height() - 1, cy + radius);
      y++
    ) {
      for (
        let x = Math.max(0, cx - radius);
        x <= Math.min(this.map.width() - 1, cx + radius);
        x++
      ) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
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

  snapshot(): Snapshot {
    return {
      tick: this.tick,
      width: this.map.width(),
      height: this.map.height(),
      owners: this.owners.slice(),
      claims: this.claims.slice(),
      progress: this.progress.slice(),
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
