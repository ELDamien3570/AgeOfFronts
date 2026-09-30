import type { GameMap } from "../core/game/GameMap";
import { PseudoRandom } from "../core/PseudoRandom";
import { BuildingIndex } from "./BuildingIndex";
import { CoastIndex } from "./CoastIndex";
import { constructionRejection } from "./Construction";
import { Formations } from "./Formations";
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
  MAX_SQUADS,
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
import { boardingMeeting, firingPosition } from "./TacticalRoutes";
import { terrainSpeed } from "./Terrain";

const STARTING_TROOPS = 12_000;
const BASE_RADIUS = 6;
const AI_NAMES = [
  "Red Stone",
  "Amber Vale",
  "Violet Reach",
  "Jade Coast",
  "Rose March",
  "Cobalt Ridge",
  "Copper Bay",
  "Pale Summit",
  "Azure Plain",
  "Scarlet Dunes",
  "Olive Reach",
  "Ivory Coast",
  "Blue River",
  "Coral Grove",
  "Gold Highlands",
  "Lilac Hills",
  "Silver Vale",
  "Orange Isles",
  "Deep Forest",
];

// Fixed-step, integer-position simulation. Browser timing and rendering never
// determine gameplay. Human and AI players enter through applyCommand().
export class Skirmish {
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
  private readonly ownedTiles = new Map<number, Set<number>>();
  private readonly formations: Formations;
  private readonly avoidance: LocalAvoidance;
  private readonly passageTraffic: PassageTraffic;
  private readonly spatial: SpatialGrid<Squad>;
  private readonly navalSpatial: SpatialGrid<Ship>;
  private readonly heldSpatial: SpatialGrid<Squad>;
  private readonly buildingIndex: BuildingIndex;
  private readonly coast: CoastIndex;
  private readonly routeWork = new RouteWork();
  private readonly localDetours: LocalDetours;
  private readonly detours = new Map<number, WorldPoint[]>();
  private readonly navigationProgress = new Map<
    number,
    { x: number; y: number; tick: number; recovery: number }
  >();

  constructor(
    readonly map: GameMap,
    readonly options: MatchOptions,
  ) {
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
    this.paths = new LandPaths(map);
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
    this.navalSpatial = new SpatialGrid(
      map.width() * FIXED,
      map.height() * FIXED,
      4 * FIXED,
    );
    this.buildingIndex = new BuildingIndex(map);
    this.coast = new CoastIndex(map, this.paths, this.waterPaths);
    if (this.paths.largestLand.length < (options.aiCount + 1) * 80)
      throw new Error("This map does not have enough connected land");
    this.createPlayers();
  }

  private createPlayers(): void {
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
    const bases: number[] = [
      candidates[this.random.nextInt(0, candidates.length)],
    ];
    for (let i = 1; i <= this.options.aiCount; i++) {
      let best = -1,
        score = -1;
      for (const tile of candidates) {
        const distance = Math.min(
          ...bases.map((base) => this.map.euclideanDistSquared(tile, base)),
        );
        if (distance > score) {
          score = distance;
          best = tile;
        }
      }
      if (best < 0 || score < (BASE_RADIUS * 2 + 4) ** 2)
        throw new Error(
          "Not enough room for these opponents on this map. Choose fewer opponents or a larger battlefield.",
        );
      bases.push(best);
    }
    bases.forEach((base, index) => {
      const player: Player = {
        id: index + 1,
        name: index === 0 ? "You" : AI_NAMES[index - 1],
        ai: index !== 0,
        base,
        reserves: STARTING_TROOPS,
        gold: STARTING_GOLD,
        land: 0,
        losses: 0,
        recruited: 0,
        eliminated: false,
      };
      this.players.push(player);
      this.eachInRadius(base, BASE_RADIUS, (tile) => {
        if (this.paths.component[tile] === this.paths.component[base])
          this.changeOwner(tile, player.id);
      });
      const barracks: Building = {
        id: this.nextId++,
        playerId: player.id,
        type: "barracks",
        tile: base,
        remainingTicks: 0,
      };
      this.buildings.push(barracks);
      this.buildingIndex.add(barracks);
      for (let i = 0; i < 4; i++)
        this.applyCommand({
          type: "recruit",
          playerId: player.id,
          buildingId: barracks.id,
        });
    });
  }

  player(id: number): Player | undefined {
    if (this.players[id - 1]?.id === id) return this.players[id - 1];
    return this.players.find((p) => p.id === id);
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
    const player = this.player(command.playerId);
    if (!player || player.eliminated || this.winner !== null)
      return "This player cannot issue orders";
    if (command.type === "recruit")
      return this.recruit(player, command.buildingId);
    if (command.type === "build")
      return this.build(player, command.buildingType, command.tile);
    if (command.type === "recruit-ship")
      return this.recruitShip(player, command.buildingId, command.shipType);
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
        (s) => !s || s.playerId !== player.id || s.embarkedOn !== null,
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
        target.playerId === player.id ||
        target.embarkedOn !== null
      )
        return "Choose an enemy squad";
    }
    if (order.type === "move" && !this.paths.walkable(order.tile))
      return "Choose passable land. Use a transport to cross water.";
    if (
      order.type === "replenish" &&
      selected.some((s) => this.owners[this.tileOf(s!)] !== player.id)
    )
      return "Move every selected squad onto friendly territory before replenishing";
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
      if (append && entry.squad.order.type !== "hold") {
        entry.squad.queuedOrders.push(entry.order);
        this.formations.refresh(entry.squad);
      } else {
        entry.squad.queuedOrders = [];
        this.activateOrder(entry.squad, entry.order, entry.path);
      }
    }
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
        const path = this.paths.find(this.tileOf(squad), order.tile);
        if (path === null) continue;
        this.activateOrder(squad, order, path);
        return;
      }
      if (order.type === "attack" && !this.squad(order.targetId)) continue;
      this.activateOrder(squad, order);
      return;
    }
    this.activateOrder(squad, { type: "hold" });
  }

  private recruit(player: Player, buildingId: number): string | null {
    const building = this.buildings.find((b) => b.id === buildingId);
    if (
      !building ||
      building.playerId !== player.id ||
      this.owners[building.tile] !== player.id ||
      building.remainingTicks > 0
    )
      return "Select a completed friendly military building";
    const kind = BUILDING_RULES[building.type].squad;
    if (!kind) return "This building does not recruit land squads";
    if (player.reserves < SQUAD_TROOPS)
      return "Recruitment needs 1,000 reserve troops";
    if (
      this.squads.filter((s) => s.playerId === player.id).length >= MAX_SQUADS
    )
      return "You have reached the 16-squad limit for this skirmish";
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
    player.reserves -= SQUAD_TROOPS;
    this.squads.push({
      id: this.nextId++,
      playerId: player.id,
      x: this.map.x(best) * FIXED + FIXED / 2,
      y: this.map.y(best) * FIXED + FIXED / 2,
      troops: SQUAD_TROOPS,
      kind,
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
    return null;
  }

  buildingPlacement(
    playerId: number,
    type: BuildingType,
    tile: number,
  ): string | null {
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
  ): string | null {
    const rejection = this.buildingPlacement(player.id, type, tile);
    if (rejection) return rejection;
    player.gold -= BUILDING_RULES[type].cost;
    this.buildings.push({
      id: this.nextId++,
      playerId: player.id,
      type,
      tile,
      remainingTicks: BUILDING_RULES[type].ticks,
    });
    this.buildingIndex.add(this.buildings[this.buildings.length - 1]);
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
    const rules = SHIP_RULES[kind];
    if (player.gold < rules.cost) return "Not enough gold for this ship";
    if (this.ships.filter((s) => s.playerId === player.id).length >= MAX_SHIPS)
      return `This skirmish allows ${MAX_SHIPS} ships per player`;
    const tile = this.map
      .neighbors(port.tile)
      .find((n) => this.waterPaths.walkable(n));
    if (tile === undefined) return "This port has no navigable water";
    player.gold -= rules.cost;
    this.ships.push({
      id: this.nextId++,
      playerId: player.id,
      kind,
      x: this.map.x(tile) * FIXED + FIXED / 2,
      y: this.map.y(tile) * FIXED + FIXED / 2,
      health: rules.health,
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
    if (!ships.length || ships.some((s) => !s || s.playerId !== player.id))
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
        path: this.paths.find(this.tileOf(squad), tile),
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
        SHIP_RULES.transport.capacity -
        this.squads.filter((s) => s.embarkedOn === ship.id).length;
      for (const squad of ready) {
        if (free > 0) {
          if (
            this.owners[meeting.landTile] !== ship.playerId ||
            this.owners[this.tileOf(squad)] !== ship.playerId
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
    if (cargo.length + selected.length > SHIP_RULES.transport.capacity)
      return "A transport carries up to four squads";
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
    let budget = SHIP_RULES[ship.kind].speed;
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
    const hits = new Map<number, number>();
    this.navalSpatial.rebuild(this.ships);
    const nearby: Ship[] = [];
    for (const ship of this.ships) {
      ship.fighting = false;
      const rules = SHIP_RULES[ship.kind];
      if (!rules.damage) continue;
      let target: Ship | undefined,
        nearest = rules.range ** 2 + 1;
      this.navalSpatial.query(ship.x, ship.y, rules.range, nearby);
      for (const enemy of nearby) {
        if (
          enemy.playerId === ship.playerId ||
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
      if (!target) continue;
      ship.fighting = true;
      hits.set(
        target.id,
        (hits.get(target.id) ?? 0) +
          Math.max(1, Math.ceil((rules.damage * ship.health) / rules.health)),
      );
    }
    if (hits.size) this.combatTicks++;
    for (const ship of this.ships) {
      const damage = hits.get(ship.id) ?? 0;
      ship.health = Math.max(0, ship.health - damage);
      if (damage) ship.fighting = true;
    }
    const sunk = new Set(
      this.ships.filter((s) => s.health === 0).map((s) => s.id),
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
    this.routeWork.drain(24);
    this.heldSpatial.rebuild(land.filter((s) => this.holding(s)));
    const intents: MovementIntent[] = [];
    for (const squad of land) {
      const intent = this.navigation(squad);
      if (intent) intents.push(intent);
    }
    this.passageTraffic.coordinate(intents);
    this.avoidance.step(land, intents, this.spatial);
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
    const liveIds = new Set(this.squads.map((s) => s.id));
    for (const id of this.navigationProgress.keys())
      if (!liveIds.has(id)) {
        this.navigationProgress.delete(id);
        this.detours.delete(id);
      }
    this.replenish();
    this.capture();
    this.processBoarding();
    this.checkWinner();
    this.tickSquads = undefined;
  }

  private produceReserves(): void {
    if (this.tick % TICKS_PER_SECOND !== 0) return;
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
    let speed = Math.floor(
      (terrainSpeed(this.map, this.tileOf(squad)) *
        SQUAD_RULES[squad.kind].speedPercent) /
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
    if (squad.order.type === "hold" || squad.order.type === "replenish")
      return null;
    if (squad.order.type === "attack") {
      const target = this.squad(squad.order.targetId);
      if (!target || target.embarkedOn !== null) {
        this.finishOrder(squad);
        return null;
      }
      const stopDistance =
        squad.kind === "archer"
          ? SQUAD_RULES.archer.range
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
          const goal =
            squad.kind === "archer"
              ? firingPosition(
                  this.map,
                  this.paths,
                  squad,
                  target,
                  SQUAD_RULES.archer.range,
                )
              : currentTargetTile;
          const path =
            goal === null ? null : this.paths.find(this.tileOf(squad), goal);
          squad.path = path === null ? [] : [this.tileOf(squad), ...path];
          squad.nextPathIndex = 0;
          squad.plannedTile = currentTargetTile;
          squad.lastPlanTick = this.tick;
        });
      }
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
        const path = this.paths.find(this.tileOf(squad), squad.order.tile);
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
    const damage = new Map<number, number>();
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
      damage.set(
        target.id,
        (damage.get(target.id) ?? 0) +
          Math.max(1, Math.ceil((squad.troops * strength) / SQUAD_TROOPS)),
      );
    }
    if (damage.size) this.combatTicks++;
    // Apply all hits simultaneously. Dead squads still deliver the hit they
    // earned at the start of this combat step; iteration order cannot win a duel.
    for (const squad of this.squads) {
      const losses = Math.min(squad.troops, damage.get(squad.id) ?? 0);
      squad.troops -= losses;
      if (losses > 0) squad.fighting = true;
      this.player(squad.playerId)!.losses += losses;
    }
    for (let i = this.squads.length - 1; i >= 0; i--)
      if (this.squads[i].troops <= 0) {
        this.tickSquads?.delete(this.squads[i].id);
        this.squads.splice(i, 1);
      }
  }

  private capture(): void {
    this.pressure.fill(0);
    for (const squad of this.squads) {
      if (squad.embarkedOn !== null) continue;
      const position = this.tileOf(squad),
        component = this.paths.component[position];
      this.eachInRadius(position, CAPTURE_RADIUS, (tile) => {
        if (this.paths.component[tile] !== component) return;
        const previous = this.pressure[tile];
        this.pressure[tile] =
          previous === 0 || previous === squad.playerId ? squad.playerId : 255;
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
      if (this.progress[tile] >= CAPTURE_TICKS) {
        this.changeOwner(tile, claimant);
        this.progress[tile] = 0;
        this.claims[tile] = 0;
        this.activeClaims.delete(tile);
      }
    }
  }

  private changeOwner(tile: number, id: number): void {
    const old = this.owners[tile];
    if (old === id) return;
    if (old) this.ownedTiles.get(old)?.delete(tile);
    let tiles = this.ownedTiles.get(id);
    if (!tiles) this.ownedTiles.set(id, (tiles = new Set()));
    tiles.add(tile);
    if (old) this.player(old)!.land--;
    this.owners[tile] = id;
    this.player(id)!.land++;
    this.buildingIndex.ensure(this.buildings);
    for (const building of this.buildingIndex.at(tile)) building.playerId = id;
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
      const develop = this.tick % 60 === player.id % 60;
      if (develop) this.developAi(player);
      let own = armies.get(player.id) ?? [];
      if (
        develop &&
        this.squads.filter((s) => s.playerId === player.id).length <
          MAX_SQUADS &&
        player.reserves >= SQUAD_TROOPS &&
        own.length < MAX_SQUADS
      ) {
        const recruiters = this.buildings.filter(
          (b) =>
            b.playerId === player.id &&
            b.remainingTicks === 0 &&
            BUILDING_RULES[b.type].squad,
        );
        if (recruiters.length)
          this.applyCommand({
            type: "recruit",
            playerId: player.id,
            buildingId:
              recruiters[this.random.nextInt(0, recruiters.length)].id,
          });
        own = this.squads.filter(
          (s) => s.playerId === player.id && s.embarkedOn === null,
        );
      }
      const enemyPlayers = this.players.filter(
        (p) => p.id !== player.id && !p.eliminated,
      );
      const raids = new Map<number, Squad[]>();
      for (let i = 0; i < own.length; i++) {
        const squad = own[i];
        // Every squad thinks once per 15 ticks; IDs spread the work evenly.
        if ((this.tick + squad.id) % 15 !== 1) continue;
        if (squad.order.type === "board") continue;
        const current = this.tileOf(squad);
        let nearest: Squad | undefined,
          distance = Number.MAX_SAFE_INTEGER;
        this.spatial.query(squad.x, squad.y, 20 * FIXED, nearby);
        for (const enemy of nearby) {
          if (enemy.playerId === player.id) continue;
          const d = this.distanceSquared(squad, enemy);
          if (d < distance || (d === distance && enemy.id < nearest!.id)) {
            distance = d;
            nearest = enemy;
          }
        }
        if (
          this.owners[current] === player.id &&
          squad.troops < 650 &&
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
        if (nearest && distance < (20 * FIXED) ** 2) {
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
        else if (i >= 2 && enemyPlayers.length && this.tick > 80) {
          const enemy = enemyPlayers.reduce((a, b) =>
            this.map.euclideanDistSquared(current, a.base) <
            this.map.euclideanDistSquared(current, b.base)
              ? a
              : b,
          );
          goal = this.formationTile(
            enemy.base,
            i - 2,
            Math.max(1, own.length - 2),
          );
          raidCenter = enemy.base;
          // Do not sit forever on captured enemy camps.
          if (this.owners[goal] === player.id) {
            nearest ??= this.spatial.nearest(
              squad.x,
              squad.y,
              (enemy) => enemy.playerId !== player.id,
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
          const candidates: number[] = [];
          this.eachInRadius(current, 14, (tile) => {
            if (
              this.owners[tile] !== player.id &&
              this.paths.connected(current, tile)
            )
              candidates.push(tile);
          });
          if (candidates.length === 0) continue;
          goal = candidates[this.random.nextInt(0, candidates.length)];
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
      if (develop) this.thinkNavy(player);
    }
  }

  private developAi(player: Player): void {
    const own = this.buildings.filter((b) => b.playerId === player.id);
    for (const type of [
      "archery",
      "stables",
      "city",
      "factory",
      "port",
      "barracks",
    ] as BuildingType[]) {
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
              s.playerId !== player.id &&
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

  private checkWinner(): void {
    for (const player of this.players) {
      const hasSquads = this.squads.some((s) => s.playerId === player.id);
      if (!hasSquads && this.owners[player.base] !== player.id) {
        player.eliminated = true;
        // Empty ships cannot keep a defeated land player in the match.
        for (let i = this.ships.length - 1; i >= 0; i--)
          if (this.ships[i].playerId === player.id) this.ships.splice(i, 1);
      }
    }
    const survivors = this.players.filter((p) => !p.eliminated);
    if (survivors.length === 1) this.winner = survivors[0].id;
    else if (survivors.length === 0) this.winner = 0;
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
    };
  }
}
