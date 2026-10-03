import type { GameMap } from "../../core/game/GameMap";
import type { Coast } from "../CoastIndex";
import type { LandPaths, WaterPaths } from "../Pathfinding";
import { ranking, rankStep, type RankingState } from "../RankedWork";
import type { ExactRouteOutcome } from "../RoutePlanner";
import { limitedRouteRetry, ROUTE_CAPACITY_REASON } from "../RouteRetryPolicy";
import type { DomainRoutePorts, DomainRouteTask } from "./DomainRoutePorts";
import type { ShoreLeg } from "./ShoreRoutes";
interface Link {
  landComponent: number;
  waterComponent: number;
  edges: readonly Coast[];
}
interface RankedEdge {
  edge: Coast;
  key: number;
  ordinal: number;
}
interface Crossing {
  id: number;
  key: string;
  playerId: number;
  generation: number;
  revision: string;
  origin: number;
  destination: number;
  from: number;
  to: number;
  queue: number[];
  visited: Set<number>;
  seenWater: Set<number>;
  previous: Map<number, { land: number; water: number }>;
  head: number;
  link: number;
  next: number;
  water?: number;
  backtrack?: number;
  departureLink?: number;
  arrivalLink?: number;
  reachesDestination: boolean;
  departures: RankingState<RankedEdge>;
  arrivals: RankingState<RankedEdge>;
  edge: number;
  departure: number;
  arrival: number;
  phase:
    | "graph"
    | "backtrack"
    | "links"
    | "departures"
    | "arrivals"
    | "approach"
    | "arrival"
    | "water"
    | "done";
  waiting?: string;
  outcome?: ExactRouteOutcome;
  path?: number[];
  attempts: number;
  retryAt: number;
  approachPath?: number[];
  arrivalPaths?: Map<number, number[]>;
  arrivalReaches: Map<number, boolean>;
  best?: ShoreLeg;
  cost?: number;
  failure?: string;
  clients: Set<string>;
}
export interface CrossingResult {
  status: "pending" | "complete" | "unreachable" | "limited" | "superseded";
  leg?: ShoreLeg;
  reason?: string;
}
/** Shared immutable coast graph/rankings with per-owner dynamic permission
 * fences. Subscriber cancellation never cancels another cohort's search. */
export class ShorePlanning {
  private readonly jobs = new Map<number, Crossing>();
  private readonly keys = new Map<string, number>();
  private readonly landLinks = new Map<number, number[]>();
  private readonly waterLinks = new Map<number, number[]>();
  private readonly pairLinks = new Map<string, number>();
  private nextId = 1;
  readonly diagnostics = {
    work: 0,
    shared: 0,
    rankedEdges: 0,
    routeRequests: 0,
  };
  constructor(
    private readonly map: GameMap,
    private readonly land: LandPaths,
    private readonly water: WaterPaths,
    private readonly links: readonly Link[],
    private readonly ports: DomainRoutePorts,
    private readonly blocked: (tile: number, owner: number) => boolean,
  ) {
    links.forEach((link, i) => {
      this.pairLinks.set(`${link.landComponent}:${link.waterComponent}`, i);
      const land = this.landLinks.get(link.landComponent) ?? [];
      land.push(i);
      this.landLinks.set(link.landComponent, land);
      const water = this.waterLinks.get(link.waterComponent) ?? [];
      water.push(i);
      this.waterLinks.set(link.waterComponent, water);
    });
  }
  hasCoast(tile: number): boolean {
    return this.landLinks.has(this.land.component[tile]);
  }
  request(
    client: string,
    playerId: number,
    origin: number,
    destination: number,
  ): CrossingResult {
    const generation = this.ports.generation(playerId),
      revision = this.ports.revision(),
      key = `${playerId}:${generation}:${revision}:${origin}:${destination}`;
    for (const s of [...this.jobs.values()])
      if (s.key !== key && s.clients.has(client)) {
        s.clients.delete(client);
        if (!s.clients.size) {
          this.cancelSearch(s);
          this.jobs.delete(s.id);
          this.keys.delete(s.key);
        }
      }
    let id = this.keys.get(key),
      s = id === undefined ? undefined : this.jobs.get(id);
    if (s) {
      if (!s.clients.has(client)) {
        if (s.clients.size >= 256)
          return {
            status: "limited",
            reason: "Crossing subscriber envelope reached",
          };
        s.clients.add(client);
        this.diagnostics.shared++;
      }
      return this.result(s);
    }
    if (this.jobs.size >= 128)
      return { status: "limited", reason: "Crossing admission is full" };
    const from = this.land.component[origin],
      to = this.land.component[destination];
    id = this.nextId++;
    s = {
      id,
      key,
      playerId,
      generation,
      revision,
      origin,
      destination,
      from,
      to,
      queue: [from],
      visited: new Set([from]),
      seenWater: new Set(),
      previous: new Map(),
      head: 0,
      link: 0,
      next: 0,
      reachesDestination: false,
      departures: ranking([]),
      arrivals: ranking([]),
      edge: 0,
      departure: 0,
      arrival: 0,
      phase: from === to ? "links" : "graph",
      attempts: 0,
      retryAt: 0,
      arrivalReaches: new Map(),
      clients: new Set([client]),
    };
    if (from < 0 || to < 0) {
      s.phase = "done";
      s.failure = "unreachable";
    }
    this.jobs.set(id, s);
    this.keys.set(key, id);
    return this.result(s);
  }
  private result(s: Crossing): CrossingResult {
    if (s.phase !== "done") return { status: "pending" };
    return s.best
      ? { status: "complete", leg: s.best }
      : {
          status: (s.failure ?? "unreachable") as CrossingResult["status"],
          reason: s.failure === "limited" ? ROUTE_CAPACITY_REASON : undefined,
        };
  }
  release(client: string): void {
    for (const [id, s] of this.jobs)
      if (s.clients.delete(client) && !s.clients.size) {
        this.cancelSearch(s);
        this.jobs.delete(id);
        this.keys.delete(s.key);
      }
  }
  private task(s: Crossing, stage: string): DomainRouteTask {
    return {
      kind: "domain",
      owner: "shore",
      admissionId: s.id,
      memberId: 0,
      stage: `crossing:${stage}`,
      playerId: s.playerId,
      generation: s.generation,
    };
  }
  private cancelSearch(s: Crossing): void {
    if (s.waiting) this.ports.cancel(this.task(s, s.waiting));
    s.waiting = undefined;
  }
  validRoute(task: DomainRouteTask): boolean {
    const s = this.jobs.get(task.admissionId);
    return (
      !!s &&
      task.stage === `crossing:${s.waiting}` &&
      s.generation === this.ports.generation(s.playerId) &&
      s.revision === this.ports.revision()
    );
  }
  completedRoute(
    task: DomainRouteTask,
    outcome: ExactRouteOutcome,
    path: number[],
  ): void {
    const s = this.jobs.get(task.admissionId);
    if (!s || task.stage !== `crossing:${s.waiting}`) return;
    s.waiting = undefined;
    s.outcome = outcome;
    s.path = path;
    if (outcome === "limited") {
      const retry = limitedRouteRetry(s.attempts, this.ports.tick(), true);
      s.attempts = retry.attempts;
      s.retryAt = retry.retryAt;
      if (retry.exhausted) {
        s.phase = "done";
        s.failure = "limited";
      }
    }
  }
  private route(
    s: Crossing,
    stage: string,
    start: number,
    goal: number,
    water = false,
  ): boolean | undefined {
    if (s.waiting) return undefined;
    if (s.outcome !== undefined) {
      const outcome = s.outcome;
      s.outcome = undefined;
      if (outcome === "limited") return undefined;
      if (outcome === "superseded") {
        s.phase = "done";
        s.failure = "superseded";
        return undefined;
      }
      return outcome === "complete";
    }
    if (s.retryAt > this.ports.tick()) return undefined;
    if (
      !water &&
      !this.blocked(start, s.playerId) &&
      !this.blocked(goal, s.playerId) &&
      start === goal
    ) {
      s.path = [];
      return true;
    }
    if (this.ports.request(this.task(s, stage), start, goal, water)) {
      s.waiting = stage;
      this.diagnostics.routeRequests++;
    }
    return undefined;
  }
  private beginBetween(
    s: Crossing,
    departure: number,
    arrival: number,
    reaches: boolean,
  ): void {
    s.departureLink = departure;
    s.arrivalLink = arrival;
    s.reachesDestination = reaches;
    s.departures = ranking([]);
    s.arrivals = ranking([]);
    s.edge = 0;
    s.departure = 0;
    s.arrival = 0;
    s.arrivalReaches.clear();
    s.arrivalPaths?.clear();
    s.approachPath = undefined;
    s.phase = "departures";
  }
  private compare(a: RankedEdge, b: RankedEdge): number {
    return (
      a.key - b.key ||
      a.edge.landTile - b.edge.landTile ||
      a.ordinal - b.ordinal
    );
  }
  private nextPair(s: Crossing): void {
    s.arrival++;
    s.outcome = undefined;
    s.path = undefined;
    s.phase = "arrival";
  }
  step(budget: number): number {
    let work = 0,
      idle = 0;
    while (work < budget && this.jobs.size) {
      const [id, s] = this.jobs.entries().next().value!;
      this.jobs.delete(id);
      this.jobs.set(id, s);
      if (s.phase === "done") {
        if (++idle >= this.jobs.size) break;
        continue;
      }
      if (
        s.generation !== this.ports.generation(s.playerId) ||
        s.revision !== this.ports.revision()
      ) {
        this.cancelSearch(s);
        s.phase = "done";
        s.failure = "superseded";
        work++;
        continue;
      }
      if (s.waiting || s.retryAt > this.ports.tick()) {
        if (++idle >= this.jobs.size) break;
        continue;
      }
      idle = 0;
      work++;
      if (s.phase === "graph") {
        if (s.visited.has(s.to)) {
          s.backtrack = s.to;
          s.phase = "backtrack";
          continue;
        }
        const current = s.queue[s.head];
        if (current === undefined) {
          s.phase = "done";
          s.failure = "unreachable";
          continue;
        }
        if (s.water !== undefined) {
          const next = this.waterLinks.get(s.water)?.[s.next++];
          if (next === undefined) {
            s.water = undefined;
            s.next = 0;
            continue;
          }
          const nextLand = this.links[next].landComponent;
          if (!s.visited.has(nextLand)) {
            s.visited.add(nextLand);
            s.previous.set(nextLand, { land: current, water: s.water });
            s.queue.push(nextLand);
          }
        } else {
          const link = this.landLinks.get(current)?.[s.link++];
          if (link === undefined) {
            s.head++;
            s.link = 0;
            continue;
          }
          const sea = this.links[link].waterComponent;
          if (!s.seenWater.has(sea)) {
            s.seenWater.add(sea);
            s.water = sea;
            s.next = 0;
          }
        }
      } else if (s.phase === "backtrack") {
        const previous = s.previous.get(s.backtrack!)!;
        if (previous.land !== s.from) {
          s.backtrack = previous.land;
          continue;
        }
        const departure = this.pairLinks.get(`${s.from}:${previous.water}`)!;
        const arrival = this.pairLinks.get(
          `${s.backtrack!}:${previous.water}`,
        )!;
        this.beginBetween(s, departure, arrival, s.backtrack === s.to);
      } else if (s.phase === "links") {
        const link = this.landLinks.get(s.from)?.[s.link++];
        if (link === undefined) {
          s.phase = "done";
          continue;
        }
        this.beginBetween(s, link, link, true);
      } else if (s.phase === "departures" || s.phase === "arrivals") {
        const departure = s.phase === "departures",
          edges =
            this.links[departure ? s.departureLink! : s.arrivalLink!].edges,
          ranked = departure ? s.departures : s.arrivals;
        if (s.edge < edges.length) {
          const edge = edges[s.edge];
          ranked.rows.push({
            edge,
            key: departure
              ? this.map.manhattanDist(s.origin, edge.landTile) +
                this.map.manhattanDist(edge.waterTile, s.destination)
              : this.map.manhattanDist(edge.landTile, s.destination),
            ordinal: s.edge++,
          });
          this.diagnostics.rankedEdges++;
          ranked.done = false;
          continue;
        }
        if (ranked.rows.length < 2) ranked.done = true;
        if (!ranked.done) {
          work += rankStep(
            ranked,
            (a, b) => this.compare(a, b),
            Math.min(16, budget - work),
          );
          continue;
        }
        s.edge = 0;
        s.phase = departure ? "arrivals" : "approach";
      } else if (s.phase === "approach") {
        const edge = s.departures.rows[s.departure]?.edge;
        if (!edge) {
          s.phase = s.from === s.to ? "links" : "done";
          continue;
        }
        if (this.blocked(edge.landTile, s.playerId)) {
          s.departure++;
          continue;
        }
        const ok = this.route(s, "approach", s.origin, edge.landTile);
        if (ok === true) {
          s.approachPath = s.path;
          s.arrival = 0;
          s.phase = "arrival";
          s.path = undefined;
        } else if (ok === false) s.departure++;
      } else if (s.phase === "arrival") {
        const end = s.arrivals.rows[s.arrival]?.edge;
        if (!end) {
          s.departure++;
          s.phase = "approach";
          continue;
        }
        if (this.blocked(end.landTile, s.playerId)) {
          s.arrival++;
          continue;
        }
        if (s.reachesDestination) {
          let ok = s.arrivalReaches.get(end.landTile);
          if (ok === undefined) {
            ok = this.route(s, "arrival", end.landTile, s.destination);
            if (ok !== undefined) {
              s.arrivalReaches.set(end.landTile, ok);
              if (ok) (s.arrivalPaths ??= new Map()).set(end.landTile, s.path!);
            }
          }
          if (ok === undefined) continue;
          if (!ok) {
            s.arrival++;
            continue;
          }
        }
        s.phase = "water";
        s.outcome = undefined;
        s.path = undefined;
      } else {
        const start = s.departures.rows[s.departure].edge,
          end = s.arrivals.rows[s.arrival].edge,
          ok = this.route(s, "water", start.waterTile, end.waterTile, true);
        if (ok === undefined) continue;
        if (!ok) {
          this.nextPair(s);
          continue;
        }
        const leg = {
            departure: start,
            arrival: end,
            waterPath: s.path!,
            approachPath: s.approachPath,
            arrivalPath: s.arrivalPaths?.get(end.landTile),
          },
          cost =
            this.map.manhattanDist(s.origin, start.landTile) +
            leg.waterPath.length +
            this.map.manhattanDist(end.landTile, s.destination);
        if (s.cost === undefined || cost < s.cost) {
          s.best = leg;
          s.cost = cost;
        }
        s.path = undefined;
        s.phase = s.from === s.to ? "links" : "done";
      }
    }
    this.diagnostics.work += work;
    return work;
  }
  checkpoint() {
    return structuredClone({ jobs: [...this.jobs], nextId: this.nextId });
  }
  restore(saved?: ReturnType<ShorePlanning["checkpoint"]>): void {
    this.jobs.clear();
    this.keys.clear();
    this.nextId = saved?.nextId ?? 1;
    if (saved && saved.jobs.length > 128)
      throw new Error("Crossing checkpoint exceeds envelope");
    for (const [id, s] of structuredClone(saved?.jobs ?? [])) {
      this.jobs.set(id, s);
      this.keys.set(s.key, id);
    }
  }
}
