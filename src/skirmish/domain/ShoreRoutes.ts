import type { GameMap } from "../../core/game/GameMap";
import type { Coast, CoastIndex } from "../CoastIndex";
import type { LandPaths, WaterPaths } from "../Pathfinding";

export interface ShoreLeg {
  departure: Coast;
  arrival: Coast;
  waterPath: number[];
}

// Static component graph chooses the first voyage of a land/water itinerary.
// Each landing replans against current walls and occupancy; there is no
// invisible link through water in the ordinary land pathfinder.
export class ShoreRoutes {
  private readonly connections;
  constructor(
    private readonly map: GameMap,
    private readonly land: LandPaths,
    private readonly water: WaterPaths,
    coast: CoastIndex,
  ) {
    this.connections = coast.connections();
  }

  firstLeg(
    origin: number,
    destination: number,
    blocked?: (tile: number) => boolean,
  ): ShoreLeg | null {
    const from = this.land.component[origin],
      to = this.land.component[destination];
    if (from < 0 || to < 0) return null;
    if (from === to) {
      let best: ShoreLeg | null = null,
        cost = Infinity;
      for (const link of this.connections.filter(
        (c) => c.landComponent === from,
      )) {
        const leg = this.between(
          link.edges,
          link.edges,
          origin,
          destination,
          true,
          blocked,
        );
        if (leg) {
          const candidate =
            this.map.manhattanDist(origin, leg.departure.landTile) +
            leg.waterPath.length +
            this.map.manhattanDist(leg.arrival.landTile, destination);
          if (candidate < cost) {
            best = leg;
            cost = candidate;
          }
        }
      }
      return best;
    }
    const queue = [from],
      visited = new Set([from]);
    const previous = new Map<number, { land: number; water: number }>();
    const seenWater = new Set<number>();
    for (let i = 0; i < queue.length && !visited.has(to); i++) {
      const current = queue[i];
      for (const link of this.connections) {
        if (
          link.landComponent !== current ||
          seenWater.has(link.waterComponent)
        )
          continue;
        seenWater.add(link.waterComponent);
        for (const next of this.connections) {
          if (
            next.waterComponent !== link.waterComponent ||
            visited.has(next.landComponent)
          )
            continue;
          visited.add(next.landComponent);
          previous.set(next.landComponent, {
            land: current,
            water: link.waterComponent,
          });
          queue.push(next.landComponent);
        }
      }
    }
    if (!visited.has(to)) return null;
    let nextLand = to;
    while (previous.get(nextLand)!.land !== from)
      nextLand = previous.get(nextLand)!.land;
    const water = previous.get(nextLand)!.water;
    const departure = this.connections.find(
      (c) => c.landComponent === from && c.waterComponent === water,
    )!;
    const arrival = this.connections.find(
      (c) => c.landComponent === nextLand && c.waterComponent === water,
    )!;
    return this.between(
      departure.edges,
      arrival.edges,
      origin,
      destination,
      nextLand === to,
      blocked,
    );
  }
  private between(
    departuresInput: readonly Coast[],
    arrivalsInput: readonly Coast[],
    origin: number,
    destination: number,
    reachesDestination: boolean,
    blocked?: (tile: number) => boolean,
  ): ShoreLeg | null {
    const departures = [...departuresInput].sort(
      (a, b) =>
        this.map.manhattanDist(origin, a.landTile) +
          this.map.manhattanDist(a.waterTile, destination) -
          this.map.manhattanDist(origin, b.landTile) -
          this.map.manhattanDist(b.waterTile, destination) ||
        a.landTile - b.landTile,
    );
    const arrivals = [...arrivalsInput].sort(
      (a, b) =>
        this.map.manhattanDist(a.landTile, destination) -
          this.map.manhattanDist(b.landTile, destination) ||
        a.landTile - b.landTile,
    );
    for (const start of departures) {
      if (
        blocked?.(start.landTile) ||
        this.land.find(origin, start.landTile, blocked) === null
      )
        continue;
      for (const end of arrivals) {
        if (blocked?.(end.landTile)) continue;
        if (
          reachesDestination &&
          this.land.find(end.landTile, destination, blocked) === null
        )
          continue;
        const path = this.water.find(start.waterTile, end.waterTile);
        if (path !== null)
          return { departure: start, arrival: end, waterPath: path };
      }
    }
    return null;
  }
}
