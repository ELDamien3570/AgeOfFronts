import { ShorePlanning } from "./ShorePlanning";
import type { DomainRoutePorts } from "./DomainRoutePorts";
import type { GameMap } from "../../core/game/GameMap";
import type { Coast, CoastIndex } from "../CoastIndex";
import type { LandPaths, WaterPaths } from "../Pathfinding";

export interface ShoreLeg {
  departure: Coast;
  arrival?: Coast;
  waterPath: number[];
  approachPath?:number[];
  arrivalPath?:number[];
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
    private readonly coast: CoastIndex,
  ) {
    this.connections = coast.connections();
  }

  createPlanner(ports:DomainRoutePorts,blocked:(tile:number,owner:number)=>boolean):ShorePlanning {
    return new ShorePlanning(this.map,this.land,this.water,this.connections,ports,blocked);
  }
  canLand(origin: number, destination: number): boolean {
    return this.land.walkable(destination) && this.water.walkable(origin) &&
      this.coast.candidates(this.land.component[destination], this.water.component[origin]).length > 0;
  }
  /** Legacy synchronous policy; multiplayer uses the shared resumable planner. */
  nearestLanding(origin: number, destination: number, blocked: (tile: number) => boolean): Coast | undefined {
    const edges = this.coast.candidates(this.land.component[destination], this.water.component[origin]);
    const candidates = [...edges].sort((a, b) =>
      this.map.manhattanDist(a.landTile, destination) - this.map.manhattanDist(b.landTile, destination) ||
      a.landTile - b.landTile || a.waterTile - b.waterTile);
    return candidates.find(edge => !blocked(edge.landTile) && this.land.find(edge.landTile, destination, blocked) !== null);
  }
  firstLeg(
    origin: number,
    destination: number,
    blocked?: (tile: number) => boolean,
  ): ShoreLeg | null {
    const from = this.land.component[origin],
      to = this.land.component[destination];
    if (this.water.walkable(destination)) {
      const link = this.connections.find(c => c.landComponent === from && c.waterComponent === this.water.component[destination]);
      if (!link) return null;
      const departures = [...link.edges].sort((a,b) =>
        this.map.manhattanDist(origin,a.landTile)+this.map.manhattanDist(a.waterTile,destination) -
        this.map.manhattanDist(origin,b.landTile)-this.map.manhattanDist(b.waterTile,destination) || a.landTile-b.landTile);
      for (const departure of departures) {
        if (blocked?.(departure.landTile)) continue;
        const approachPath = this.land.find(origin,departure.landTile,blocked);
        if (approachPath === null) continue;
        const waterPath = this.water.find(departure.waterTile,destination);
        if (waterPath !== null) return {departure,waterPath,approachPath};
      }
      return null;
    }
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
            this.map.manhattanDist(leg.arrival!.landTile, destination);
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
    // Sort keys are computed once per edge, not inside the comparator. Order is
    // identical: by combined distance, then land tile.
    const departures = departuresInput
      .map((edge) => ({
        edge,
        key:
          this.map.manhattanDist(origin, edge.landTile) +
          this.map.manhattanDist(edge.waterTile, destination),
      }))
      .sort((a, b) => a.key - b.key || a.edge.landTile - b.edge.landTile)
      .map(({ edge }) => edge);
    const arrivals = arrivalsInput
      .map((edge) => ({
        edge,
        key: this.map.manhattanDist(edge.landTile, destination),
      }))
      .sort((a, b) => a.key - b.key || a.edge.landTile - b.edge.landTile)
      .map(({ edge }) => edge);
    // With no obstacle a land route exists exactly when the tiles share a
    // component, so reachability needs no search. Obstructed searches are
    // remembered per arrival: they do not depend on the departure.
    const reaches = (from: number, to: number) =>
      blocked
        ? this.land.find(from, to, blocked) !== null
        : this.land.connected(from, to);
    const arrivalReaches = new Map<number, boolean>();
    for (const start of departures) {
      if (blocked?.(start.landTile) || !reaches(origin, start.landTile))
        continue;
      for (const end of arrivals) {
        if (blocked?.(end.landTile)) continue;
        if (reachesDestination) {
          let ok = arrivalReaches.get(end.landTile);
          if (ok === undefined)
            arrivalReaches.set(
              end.landTile,
              (ok = reaches(end.landTile, destination)),
            );
          if (!ok) continue;
        }
        const path = this.water.find(start.waterTile, end.waterTile);
        if (path !== null)
          return { departure: start, arrival: end, waterPath: path };
      }
    }
    return null;
  }
}
