import type { GameMap } from "../../core/game/GameMap";
import type { LandPaths } from "../Pathfinding";
import { FIXED, type Order, type Ship, type Squad } from "../Protocol";
import type { WorldPoint } from "../SpatialGrid";
import { pointTile } from "../SquadGeometry";
import { terrainSpeed } from "../Terrain";
import type { VesselDefinition } from "./Definitions";
import type { ShoreLeg, ShoreRoutes } from "./ShoreRoutes";

export interface ShoreTransportWorld {
  map: GameMap;
  paths: LandPaths;
  squads: Squad[];
  ships: Ship[];
  blocked(tile: number, playerId: number): boolean;
  /** False when no tower or wall exists, so unobstructed (cached) routes apply. */
  hasObstacles?(): boolean;
  slots(
    tile: number,
    squads: Squad[],
    reserved: Squad[],
    radius?: number,
    blocked?: (tile: number) => boolean,
  ): Map<number, WorldPoint> | null;
  activate(squad: Squad, order: Order, path?: number[]): void;
  launch(playerId: number, definition: VesselDefinition, tile: number): Ship;
  unload(ship: Ship, tile: number): string | null;
  resume(squad: Squad, tile: number): void;
}
interface Plan {
  members: Squad[];
  leg?: ShoreLeg;
  slots: Map<number, WorldPoint>;
  paths: number[][];
}

// Application/domain coordinator: intent -> shore approach -> physical voyage
// -> landing -> remaining move. Rendering never owns transfer state.
export class ShoreTransport {
  constructor(
    private readonly world: ShoreTransportWorld,
    private readonly routes: ShoreRoutes,
  ) {}

  // Without obstacles the test is always false, and the unobstructed search
  // returns the identical route while benefiting from the route cache.
  private obstacleTest(playerId: number) {
    const w = this.world;
    return w.hasObstacles?.() === false
      ? undefined
      : (tile: number) => w.blocked(tile, playerId);
  }
  private preferredLeg(
    squad: Squad,
    destination: number,
    definition: VesselDefinition,
  ): ShoreLeg | null {
    const w = this.world,
      origin = pointTile(w.map, squad),
      blocked = this.obstacleTest(squad.playerId);
    const leg = this.routes.firstLeg(origin, destination, blocked);
    if (!leg || !w.paths.connected(origin, destination)) return leg;
    const land = w.paths.find(origin, destination, blocked);
    const approach = w.paths.find(origin, leg.departure.landTile, blocked);
    const departure = w.paths.find(leg.arrival.landTile, destination, blocked);
    const ticks = (path: number[]) =>
      path.reduce((sum, tile) => sum + FIXED / terrainSpeed(w.map, tile), 0);
    if (approach === null || departure === null || leg.waterPath.length === 0)
      return null;
    // HPA supplies valid candidate corridors; this compares their actual travel
    // cost, not straight-line distance. It does not claim global optimality.
    return land === null ||
      ticks(approach) +
        ticks(departure) +
        (leg.waterPath.length * FIXED) / definition.speed +
        20 <
        ticks(land)
      ? leg
      : null;
  }
  useful(
    squad: Squad,
    destination: number,
    definition: VesselDefinition,
  ): boolean {
    const w = this.world,
      origin = pointTile(w.map, squad);
    if (!w.paths.connected(origin, destination)) return true;
    const ax = w.map.x(origin),
      ay = w.map.y(origin),
      bx = w.map.x(destination),
      by = w.map.y(destination);
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    let crosses = false;
    for (let i = 1; i < steps; i++)
      if (
        w.map.isWater(
          w.map.ref(
            Math.round(ax + ((bx - ax) * i) / steps),
            Math.round(ay + ((by - ay) * i) / steps),
          ),
        )
      ) {
        crosses = true;
        break;
      }
    return (
      crosses && this.preferredLeg(squad, destination, definition) !== null
    );
  }

  start(
    playerId: number,
    members: Squad[],
    destination: number,
    definition: VesselDefinition,
    capacity: number,
    preserveQueue = false,
  ): string | null {
    const w = this.world;
    const grouped = new Map<number, Squad[]>();
    for (const squad of [...members].sort((a, b) => a.id - b.id)) {
      const component = w.paths.component[pointTile(w.map, squad)];
      const group = grouped.get(component) ?? [];
      group.push(squad);
      grouped.set(component, group);
    }
    const plans: Plan[] = [],
      reserved = [...w.squads];
    const blocked = (tile: number) => w.blocked(tile, playerId);
    const search = this.obstacleTest(playerId);
    for (const group of grouped.values())
      for (let offset = 0; offset < group.length; offset += capacity) {
        const batch = group.slice(offset, offset + capacity);
        const origin = pointTile(w.map, batch[0]);
        const leg =
          this.preferredLeg(batch[0], destination, definition) ?? undefined;
        if (!leg && !w.paths.connected(origin, destination))
          return "No reachable water crossing leads to that destination";
        const shore = leg?.departure.landTile ?? destination;
        const stagingBlocked = (tile: number) =>
          blocked(tile) ||
          Boolean(
            leg &&
            w.map.euclideanDistSquared(tile, leg.departure.waterTile) > 9,
          );
        const slots = w.slots(
          shore,
          batch,
          reserved,
          leg ? 3 * FIXED : undefined,
          stagingBlocked,
        );
        if (!slots)
          return "There is not enough safe room at the departure shore";
        const paths = batch.map((s) =>
          w.paths.find(
            pointTile(w.map, s),
            pointTile(w.map, slots.get(s.id)!),
            search,
          ),
        );
        if (paths.some((p) => p === null))
          return "A squad cannot reach the departure shore";
        for (const squad of batch)
          reserved.push({ ...squad, ...slots.get(squad.id)! });
        plans.push({ members: batch, leg, slots, paths: paths as number[][] });
      }
    // No units, vessels or economy mutate before every group's route is valid.
    for (const plan of plans) {
      const ship = plan.leg
        ? w.launch(playerId, definition, plan.leg.departure.waterTile)
        : undefined;
      if (ship) {
        ship.shoreTransfer = {
          destinationTile: destination,
          landingTile: plan.leg!.arrival.landTile,
          waterPath: plan.leg!.waterPath,
          capacity,
          phase: "boarding",
          queued: plan.members.map((s) => ({
            squadId: s.id,
            orders: preserveQueue ? [...s.queuedOrders] : [],
          })),
        };
        ship.boarding = {
          ...plan.leg!.departure,
          squadIds: plan.members.map((s) => s.id),
        };
      }
      plan.members.forEach((s, index) => {
        s.queuedOrders = [];
        s.charge = null;
        s.structureTarget = null;
        const point = plan.slots.get(s.id)!,
          tile = pointTile(w.map, point);
        w.activate(
          s,
          ship
            ? { type: "board", shipId: ship.id, tile }
            : { type: "move", tile, ...point },
          ship
            ? [pointTile(w.map, s), ...plan.paths[index]]
            : plan.paths[index],
        );
      });
    }
    return null;
  }

  land(ship: Ship, tile: number, redirected = false): string | null {
    const w = this.world;
    const transfer = ship.shoreTransfer!;
    const cargo = w.squads.filter((s) => s.embarkedOn === ship.id);
    const result = w.unload(ship, tile);
    if (result !== null) return result;
    if (redirected) {
      transfer.landingTile = tile;
      transfer.destinationTile = tile;
      transfer.queued = [];
    }
    for (const squad of cargo) {
      if (squad.embarkedOn === ship.id) continue;
      squad.queuedOrders = redirected
        ? []
        : (transfer.queued.find((q) => q.squadId === squad.id)?.orders ?? []);
      w.resume(squad, transfer.destinationTile);
    }
    if (!w.squads.some((s) => s.embarkedOn === ship.id))
      w.ships.splice(w.ships.indexOf(ship), 1);
    return null;
  }

  step(): void {
    const w = this.world;
    for (const ship of [...w.ships]) {
      const transfer = ship.shoreTransfer;
      if (!transfer) continue;
      const cargo = w.squads.filter((s) => s.embarkedOn === ship.id);
      if (transfer.phase !== "boarding" && !cargo.length) {
        w.ships.splice(w.ships.indexOf(ship), 1);
        continue;
      }
      if (transfer.phase === "boarding" && !ship.boarding) {
        if (!cargo.length) {
          w.ships.splice(w.ships.indexOf(ship), 1);
          continue;
        }
        transfer.phase = "sailing";
        const end =
          transfer.waterPath[transfer.waterPath.length - 1] ??
          pointTile(w.map, ship);
        ship.destination = end;
        ship.path = [pointTile(w.map, ship), ...transfer.waterPath];
        ship.nextPathIndex = 0;
      }
      if (transfer.phase === "sailing" && ship.destination === null)
        transfer.phase = "landing";
      if (transfer.phase !== "landing" || ship.destination !== null) continue;
      // A newly occupied landing is retried; never force units into blockers.
      if (
        w.blocked(transfer.landingTile, ship.playerId) ||
        this.land(ship, transfer.landingTile) !== null
      )
        continue;
    }
  }
}
