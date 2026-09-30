import type { GameMap } from "../../core/game/GameMap";
import { VESSELS } from "../content/Units";
import type { LandPaths, WaterPaths } from "../Pathfinding";
import type { Building, Player, Ship, Squad } from "../Protocol";
import { FIXED } from "../Protocol";
import { SpatialGrid } from "../SpatialGrid";
import { AGES, type TradeActor } from "./Definitions";
import type { Diplomacy } from "./Diplomacy";
import type { Fortifications } from "./Fortifications";
import type { Progression } from "./Progression";
import { cargoHandlingPercent, logisticsTier } from "./ResearchEffects";
import type { Roads } from "./Roads";
import type { Supply } from "./Supply";
export interface TradeWorld {
  map: GameMap;
  paths: LandPaths;
  waterPaths: WaterPaths;
  buildings: Building[];
  players: Player[];
  squads: Squad[];
  ships: Ship[];
  tick: number;
  allocateId(): number;
}
export class Trade {
  readonly actors: TradeActor[] = [];
  readonly deliveredGold: Record<number, number> = {};
  private nextShipment = 1;
  private readonly retired = new Set<number>();
  private readonly land: SpatialGrid<Squad>;
  private readonly sea: SpatialGrid<Ship>;
  private readonly nearby: (Squad | Ship)[] = [];
  constructor(
    private readonly world: TradeWorld,
    private readonly supply: Supply,
    private readonly progression: Progression,
    private readonly diplomacy: Diplomacy,
    private readonly fortifications: Fortifications,
    private readonly roads?: Roads,
  ) {
    this.land = new SpatialGrid(
      world.map.width() * FIXED,
      world.map.height() * FIXED,
      4 * FIXED,
    );
    this.sea = new SpatialGrid(
      world.map.width() * FIXED,
      world.map.height() * FIXED,
      4 * FIXED,
    );
  }
  private tile(actor: TradeActor): number {
    return this.world.map.ref(
      Math.floor(actor.x / FIXED),
      Math.floor(actor.y / FIXED),
    );
  }
  private route(actor: TradeActor, destination: Building): number[] | null {
    const { map, paths, waterPaths } = this.world,
      start = this.tile(actor);
    if (!actor.naval)
      return paths.find(start, destination.tile, (tile) =>
        this.fortifications.blocked(tile, actor.playerId),
      );
    for (const tile of map.neighbors(destination.tile))
      if (waterPaths.connected(start, tile)) {
        const path = waterPaths.find(start, tile);
        if (path) return path;
      }
    return null;
  }
  private destinations(
    actor: TradeActor,
    prize = false,
  ): { building: Building; path: number[] }[] {
    return this.world.buildings
      .filter(
        (b) =>
          !b.remainingTicks &&
          (actor.naval
            ? b.type === "port"
            : b.type === "city" || (!prize && b.type === "port")) &&
          (!prize || b.playerId === actor.playerId) &&
          !actor.visited.includes(b.id),
      )
      .sort(
        (a, b) =>
          this.world.map.euclideanDistSquared(a.tile, this.tile(actor)) -
            this.world.map.euclideanDistSquared(b.tile, this.tile(actor)) ||
          a.id - b.id,
      )
      .slice(0, 64)
      .flatMap((building) => {
        const path = this.route(actor, building);
        return path ? [{ building, path }] : [];
      })
      .sort(
        (a, b) =>
          a.path.length - b.path.length || a.building.id - b.building.id,
      );
  }
  private select(actor: TradeActor): void {
    // Removed stops cannot hold a finite shipment open forever.
    actor.stops = actor.stops.filter((id) =>
      this.world.buildings.some((b) => b.id === id && !b.remainingTicks),
    );
    let next: { building: Building; path: number[] } | undefined;
    if (actor.state === "prize") next = this.destinations(actor, true)[0];
    else if (!actor.cargo) {
      const factory = this.world.buildings.find(
        (b) => b.id === actor.factoryId && b.playerId === actor.playerId,
      );
      if (!factory) {
        this.retired.add(actor.id);
        actor.destination = null;
        return;
      }
      if (actor.naval) {
        const port = this.world.buildings.find(
          (b) =>
            b.id === actor.originPortId &&
            b.playerId === actor.playerId &&
            !b.remainingTicks,
        );
        const path = port && this.route(actor, port);
        if (port && path) next = { building: port, path };
      } else {
        const path = this.world.paths.find(
          this.tile(actor),
          factory.tile,
          (tile) => this.fortifications.blocked(tile, actor.playerId),
        );
        if (path) next = { building: factory, path };
      }
      actor.state = "returning";
    } else if (actor.stops.every((id) => actor.visited.includes(id))) {
      const factory = this.world.buildings.find(
        (b) => b.id === actor.factoryId && b.playerId === actor.playerId,
      );
      if (!factory) {
        actor.lost += actor.cargo;
        actor.cargo = 0;
        this.retired.add(actor.id);
        actor.destination = null;
        return;
      }
      const destination = actor.naval
        ? this.world.buildings.find(
            (b) => b.id === actor.originPortId && b.playerId === actor.playerId,
          )
        : factory;
      const path = destination && this.route(actor, destination);
      if (path && destination) next = { building: destination, path };
      actor.state = "returning";
    } else {
      const candidates = this.destinations(actor).filter((d) =>
        actor.stops.includes(d.building.id),
      );
      next = candidates[0];
      actor.state = "outbound";
    }
    actor.destination = next?.building.id ?? null;
    actor.path = next?.path ?? [];
    actor.nextPathIndex = 0;
    if (next && !actor.naval)
      this.roads?.add(
        next.path,
        AGES[logisticsTier(this.progression.states[actor.playerId].completed)],
      );
    if (!next && actor.state !== "prize") actor.state = "waiting";
  }
  private load(actor: TradeActor): void {
    const source = this.world.buildings.find(
      (b) =>
        b.id === actor.factoryId &&
        b.playerId === actor.playerId &&
        !b.remainingTicks,
    );
    if (!source) {
      actor.lost += actor.cargo;
      actor.cargo = 0;
      this.retired.add(actor.id);
      return;
    }
    if (actor.naval) {
      const port = this.world.buildings.find(
        (b) =>
          b.id === actor.originPortId &&
          b.playerId === actor.playerId &&
          !b.remainingTicks,
      );
      if (
        !port ||
        !this.world.paths.find(source.tile, port.tile, (t) =>
          this.fortifications.blocked(t, actor.playerId),
        )
      ) {
        actor.state = "waiting";
        return;
      }
    }
    const goods = this.supply.goods.get(source.id) ?? 0;
    if (goods < 10) {
      actor.state = "loading";
      return;
    }
    actor.cargo = Math.min(goods, actor.capacity);
    actor.loaded = actor.cargo;
    actor.delivered = 0;
    actor.lost = 0;
    actor.returned = 0;
    actor.valuePerGood = 50 * (AGES.indexOf(source.age ?? "StoneAge") + 1);
    actor.originTile = source.tile;
    actor.shipmentId = this.nextShipment++;
    actor.visited = [];
    this.supply.goods.set(source.id, goods - actor.cargo);
    const maxStops = [2, 3, 4, 5, 6, 8, 12][
      logisticsTier(this.progression.states[actor.playerId].completed)
    ];
    const eligible = this.destinations(actor).filter((d) => d.path.length > 1);
    actor.stops = eligible
      .slice(0, Math.min(maxStops, Math.ceil(actor.cargo / 10)))
      .map((d) => d.building.id);
    actor.quoteAllies = this.world.players
      .filter(
        (p) =>
          p.id !== actor.playerId &&
          this.diplomacy.allied(actor.playerId, p.id),
      )
      .map((p) => p.id);
    actor.waitTicks = 20;
    this.select(actor);
  }
  step(): void {
    const { map, tick, players, buildings } = this.world;
    this.land.rebuild(this.world.squads.filter((s) => s.embarkedOn === null));
    this.sea.rebuild(this.world.ships.filter((s) => s.kind === "warship"));
    if (tick % 20 === 0)
      for (const factory of buildings) {
        if (
          factory.type !== "factory" ||
          factory.remainingTicks ||
          players.find((p) => p.id === factory.playerId)?.eliminated ||
          this.actors.some(
            (a) =>
              a.factoryId === factory.id &&
              a.playerId === factory.playerId &&
              a.state !== "prize",
          )
        )
          continue;
        if (
          this.actors.filter((a) => a.playerId === factory.playerId).length >=
          64
        )
          continue;
        const index = logisticsTier(
            this.progression.states[factory.playerId].completed,
          ),
          age = AGES[index];
        const merchant = VESSELS.filter(
          (v) =>
            v.kind === "trade" &&
            this.progression.has(factory.playerId, v.technologyId),
        ).slice(-1)[0];
        const port = merchant
          ? buildings
              .filter(
                (b) =>
                  b.playerId === factory.playerId &&
                  b.type === "port" &&
                  !b.remainingTicks &&
                  map.euclideanDistSquared(b.tile, factory.tile) <= 400 &&
                  this.world.paths.find(factory.tile, b.tile, (tile) =>
                    this.fortifications.blocked(tile, factory.playerId),
                  ) !== null,
              )
              .sort(
                (a, b) =>
                  map.euclideanDistSquared(a.tile, factory.tile) -
                    map.euclideanDistSquared(b.tile, factory.tile) ||
                  a.id - b.id,
              )[0]
          : undefined;
        const water =
          port &&
          map
            .neighbors(port.tile)
            .find((t) => this.world.waterPaths.walkable(t));
        const naval = water !== undefined,
          origin = naval ? water : factory.tile;
        const actor: TradeActor = {
          id: this.world.allocateId(),
          playerId: factory.playerId,
          factoryId: factory.id,
          originPortId: naval ? port?.id : undefined,
          definitionId: naval ? merchant!.id : `${age.toLowerCase()}-trader`,
          naval,
          x: (map.x(origin!) + 0.5) * FIXED,
          y: (map.y(origin!) + 0.5) * FIXED,
          cargo: 0,
          loaded: 0,
          delivered: 0,
          lost: 0,
          returned: 0,
          valuePerGood: 50 * (index + 1),
          originTile: factory.tile,
          capacity: Math.floor(
            ((naval
              ? merchant!.capacity
              : [20, 30, 40, 50, 60, 80, 120][index]) *
              cargoHandlingPercent(
                this.progression.states[factory.playerId].completed,
              )) /
              100,
          ),
          shipmentId: 0,
          stops: [],
          visited: [],
          destination: null,
          state: "loading",
          path: [],
          nextPathIndex: 0,
          waitTicks: 0,
          quoteAllies: [],
        };
        // A port's loading leg is bounded by a reachable factory association.
        // Cargo moves once from that factory; the origin port pays no export gold.
        this.actors.push(actor);
      }
    for (const actor of this.actors) {
      const player = players.find((p) => p.id === actor.playerId);
      if (!player || player.eliminated) {
        actor.lost += actor.cargo;
        actor.cargo = 0;
        continue;
      }
      if (actor.waitTicks > 0) {
        actor.waitTicks--;
        continue;
      }
      if (actor.naval)
        this.sea.query(actor.x, actor.y, 1.2 * FIXED, this.nearby as Ship[]);
      else
        this.land.query(actor.x, actor.y, 1.2 * FIXED, this.nearby as Squad[]);
      const captors = this.nearby;
      const captor = captors
        .filter(
          (s) =>
            this.diplomacy.hostile(actor.playerId, s.playerId) &&
            (s.x - actor.x) ** 2 + (s.y - actor.y) ** 2 <= (1.2 * FIXED) ** 2 &&
            this.fortifications.clear(actor, s, s.playerId),
        )
        .sort((a, b) => a.id - b.id)[0];
      if (captor && actor.cargo > 0) {
        actor.playerId = captor.playerId;
        actor.stops = [];
        actor.visited = [];
        actor.quoteAllies = [];
        actor.state = "prize";
        actor.waitTicks = 20;
        this.select(actor);
        continue;
      }
      if (actor.state === "loading") {
        this.load(actor);
        continue;
      }
      if (actor.destination === null) {
        if (tick % 20 === 0) this.select(actor);
        continue;
      }
      const destination = buildings.find(
        (b) => b.id === actor.destination && !b.remainingTicks,
      );
      if (!destination) {
        this.select(actor);
        continue;
      }
      const next = actor.path[actor.nextPathIndex];
      if (next !== undefined) {
        const goal = {
          x: (map.x(next) + 0.5) * FIXED,
          y: (map.y(next) + 0.5) * FIXED,
        };
        if (
          !actor.naval &&
          !this.fortifications.clear(actor, goal, actor.playerId)
        ) {
          if (tick % 20 === 0) this.select(actor);
          continue;
        }
        const dx = goal.x - actor.x,
          dy = goal.y - actor.y,
          distance = Math.hypot(dx, dy),
          speed = actor.naval ? 55 : 50;
        if (distance <= speed) {
          actor.x = goal.x;
          actor.y = goal.y;
          actor.nextPathIndex++;
        } else {
          actor.x += Math.round((dx * speed) / distance);
          actor.y += Math.round((dy * speed) / distance);
        }
        continue;
      }
      if (actor.state === "returning") {
        if (actor.cargo) {
          const source = buildings.find(
            (b) =>
              b.id === actor.factoryId &&
              b.playerId === actor.playerId &&
              !b.remainingTicks,
          );
          if (source) {
            this.supply.goods.set(
              actor.factoryId,
              (this.supply.goods.get(actor.factoryId) ?? 0) + actor.cargo,
            );
            actor.returned += actor.cargo;
          } else actor.lost += actor.cargo;
          actor.cargo = 0;
        }
        actor.state = "loading";
        actor.destination = null;
        actor.waitTicks = 20;
        continue;
      }
      if (actor.state === "prize") {
        if (destination.playerId !== player.id) {
          this.select(actor);
          continue;
        }
        const gold = actor.cargo * actor.valuePerGood;
        player.gold += gold;
        this.deliveredGold[player.id] =
          (this.deliveredGold[player.id] ?? 0) + gold;
        actor.delivered += actor.cargo;
        actor.cargo = 0;
        actor.destination = null;
        this.retired.add(actor.id);
        continue;
      }
      if (actor.visited.includes(destination.id)) {
        this.select(actor);
        continue;
      }
      const quantity = Math.min(10, actor.cargo);
      const foreign = destination.playerId !== player.id,
        allied =
          foreign &&
          actor.quoteAllies.includes(destination.playerId) &&
          this.diplomacy.allied(player.id, destination.playerId);
      const percent = allied ? 350 : foreign ? 250 : 100;
      const distanceFactor =
        100 +
        Math.min(
          100,
          Math.floor(
            Math.sqrt(
              map.euclideanDistSquared(destination.tile, actor.originTile),
            ),
          ),
        );
      const gold = Math.floor(
        (quantity * actor.valuePerGood * percent * distanceFactor) / 10000,
      );
      actor.cargo -= quantity;
      actor.delivered += quantity;
      actor.visited.push(destination.id);
      player.gold += gold;
      this.deliveredGold[player.id] =
        (this.deliveredGold[player.id] ?? 0) + gold;
      actor.waitTicks = 20;
      this.select(actor);
    }
    for (let i = this.actors.length - 1; i >= 0; i--)
      if (
        this.retired.has(this.actors[i].id) ||
        players.find((p) => p.id === this.actors[i].playerId)?.eliminated
      ) {
        this.retired.delete(this.actors[i].id);
        this.actors.splice(i, 1);
      }
  }
}
