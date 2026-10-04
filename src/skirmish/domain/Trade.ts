import type { GameMap } from "../../core/game/GameMap";
import type { BuildingQueries } from "../BuildingIndex";
import { stackCargoPercent, TRADE_RULES } from "../content/Economy";
import { technologyAt } from "../content/Technology";
import { VESSELS } from "../content/Units";
import type { LandPaths, WaterPaths } from "../Pathfinding";
import {
  FIXED,
  type Building,
  type Player,
  type Ship,
  type Squad,
} from "../Protocol";
import type { ExactRouteOutcome } from "../RoutePlanner";
import { SpatialGrid } from "../SpatialGrid";
import { restoreArray, restoreRecord, restoreSet } from "../StateTransfer";
import { AGES, type TradeActor } from "./Definitions";
import type { Diplomacy } from "./Diplomacy";
import type { DomainRoutePorts, DomainRouteTask } from "./DomainRoutePorts";
import type { Fortifications } from "./Fortifications";
import type { Progression } from "./Progression";
import { cargoHandlingPercent, logisticsTier } from "./ResearchEffects";
import type { Roads } from "./Roads";
import type { Supply } from "./Supply";
import type { PhaseSpatialFacts, SpatialPhase, SpatialQueries } from "../PhaseSpatialViews";
import {
  tradeCycleQuote,
  tradePayout,
  type TradeCycleQuote,
} from "./TradeQuote";

export interface TradeWorld {
  spatialFacts?(phase: SpatialPhase): PhaseSpatialFacts;
  readonly domainRoutes?: DomainRoutePorts;
  building?(id: number): Building | undefined;
  buildingFacts?(): BuildingQueries;
  factionAdjacent?(a: number, b: number): boolean;
  owners?: Uint8Array;
  map: GameMap;
  paths: LandPaths;
  waterPaths: WaterPaths;
  buildings: readonly Building[];
  players: Player[];
  squads: readonly Squad[];
  ships: readonly Ship[];
  tick: number;
  allocateId(): number;
}
export interface TradeControls {
  landPaused: boolean;
  seaPaused: boolean;
  blocked: number[];
}
interface Site {
  source: Building;
  buildings: readonly Building[];
  naval: boolean;
  water?: number;
}
interface OwnerMarkets {
  factories: readonly Building[];
  ports: readonly Building[];
  cities: readonly Building[];
  sites: Site[];
  markets: Building[];
}
interface Admission {
  id: number;
  epoch: number;
  playerId: number;
  generation: number;
  revision: string;
  shipmentId: number;
  start: number;
  naval: boolean;
  loading: boolean;
  state: TradeActor["state"];
  candidates: number[];
  index: number;
  requested: boolean;
  attempts: number;
  retryAt: number;
  goal?: number;
  outcome?: ExactRouteOutcome;
  path?: number[];
}

/** Single-destination couriers. Markets share lifecycle indexes, route pairs
 * share bounded corridors, and cargo changes hands only at authoritative commits. */
export class Trade {
  readonly actors: TradeActor[] = [];
  readonly deliveredGold: Record<number, number> = {};
  readonly capturedValue: Record<number, number> = {};
  readonly lostValue: Record<number, number> = {};
  readonly controls: Record<number, TradeControls> = {};
  readonly cycleQuotes = new Map<number, TradeCycleQuote>();
  controlRevision = 0;
  readonly diagnostics = {
    marketReads: 0,
    routeRequests: 0,
    routeHits: 0,
    spawned: 0,
    spawnActorReads: 0,
    playerReads: 0,
    quotaActorReads: 0,
  };
  private readonly markets = new Map<number, OwnerMarkets>();
  private marketGeometry = -1;
  private readonly seaMarkets = new Map<number, Building[]>();
  private readonly admissions = new Map<number, Admission>();
  private readonly retries = new Map<
    number,
    { attempts: number; retryAt: number }
  >();
  private readonly siteNext = new Map<string, number>();
  private readonly corridors = new Map<string, number[]>();
  private readonly routeFailures = new Map<string, { attempts: number; retryAt: number }>();
  private readonly retired = new Set<number>();
  private nextShipment = 1;
  private nextEpoch = 1;
  private corridorTiles = 0;
  private tickStartWork = 0;
  private land: SpatialQueries<Squad>;
  private sea: SpatialQueries<Ship>;
  private localLand?: SpatialGrid<Squad>;
  private localSea?: SpatialGrid<Ship>;
  private readonly nearby: (Squad | Ship)[] = [];
  constructor(
    private readonly world: TradeWorld,
    private readonly supply: Supply,
    private readonly progression: Progression,
    private readonly diplomacy: Diplomacy,
    private readonly fortifications: Fortifications,
    private readonly roads?: Roads,
    private readonly enemy: (a: number, b: number) => boolean = (a, b) =>
      diplomacy.hostile(a, b),
  ) {
    this.land = new SpatialGrid<Squad>(0, 0, 4 * FIXED);
    this.sea = new SpatialGrid<Ship>(0, 0, 4 * FIXED);
  }
  checkpoint() {
    return structuredClone({
      actors: this.actors,
      deliveredGold: this.deliveredGold,
      capturedValue: this.capturedValue,
      lostValue: this.lostValue,
      controls: this.controls,
      controlRevision: this.controlRevision,
      cycleQuotes: [...this.cycleQuotes],
      retired: this.retired,
      nextShipment: this.nextShipment,
      nextEpoch: this.nextEpoch,
      admissions: [...this.admissions],
      retries: [...this.retries],
      siteNext: [...this.siteNext],
      corridors: [...this.corridors],
      routeFailures: [...this.routeFailures],
    });
  }
  restore(saved: ReturnType<Trade["checkpoint"]>): void {
    const s = structuredClone(saved);
    restoreArray(this.actors, s.actors);
    restoreRecord(this.deliveredGold, s.deliveredGold);
    restoreRecord(this.capturedValue, s.capturedValue ?? {});
    restoreRecord(this.lostValue, s.lostValue ?? {});
    restoreRecord(this.controls, s.controls ?? {});
    this.controlRevision = s.controlRevision ?? 0;
    restoreSet(this.retired, s.retired);
    this.nextShipment = s.nextShipment;
    this.nextEpoch = s.nextEpoch ?? 1;
    this.cycleQuotes.clear();
    for (const [id, q] of s.cycleQuotes ?? []) this.cycleQuotes.set(id, q);
    this.admissions.clear();
    for (const [id, a] of s.admissions ?? []) this.admissions.set(id, a);
    this.retries.clear();
    for (const [id, r] of s.retries ?? []) this.retries.set(id, r);
    this.siteNext.clear();
    for (const [key, tick] of s.siteNext ?? []) this.siteNext.set(key, tick);
    this.corridors.clear();
    this.routeFailures.clear();
    for (const [key, failure] of s.routeFailures ?? []) this.routeFailures.set(key, failure);
    this.corridorTiles = 0;
    for (const [key, path] of s.corridors ?? []) {
      this.corridors.set(key, path);
      this.corridorTiles += path.length;
    }
    this.markets.clear();
    this.seaMarkets.clear();
    this.marketGeometry = -1;
  }
  setPaused(playerId: number, naval: boolean, paused: boolean): void {
    const c = this.control(playerId);
    if ((naval ? c.seaPaused : c.landPaused) === paused) return;
    if (naval) c.seaPaused = paused;
    else c.landPaused = paused;
    this.controlRevision++;
    if (paused) this.redirect(playerId, naval);
  }
  setBlocked(playerId: number, other: number, blocked: boolean): void {
    const c = this.control(playerId);
    if (c.blocked.includes(other) === blocked) return;
    c.blocked = blocked
      ? [...c.blocked, other].sort((a, b) => a - b)
      : c.blocked.filter((id) => id !== other);
    this.controlRevision++;
    if (blocked) {
      this.redirect(playerId, undefined, other);
      this.redirect(other, undefined, playerId);
    }
  }
  private control(id: number): TradeControls {
    return (this.controls[id] ??= {
      landPaused: false,
      seaPaused: false,
      blocked: [],
    });
  }
  private paused(id: number, naval: boolean): boolean {
    const c = this.controls[id];
    return !!(naval ? c?.seaPaused : c?.landPaused);
  }
  permitted(a: number, b: number): boolean {
    return (
      !this.controls[a]?.blocked.includes(b) &&
      !this.controls[b]?.blocked.includes(a)
    );
  }
  private redirect(owner: number, naval?: boolean, other?: number): void {
    for (const a of this.actors)
      if (
        a.playerId === owner &&
        a.state !== "prize" &&
        (naval === undefined || a.naval === naval) &&
        (other === undefined ||
          this.building(a.destination ?? -1)?.playerId === other)
      ) {
        this.cancel(a.id);
        a.destination = null;
        a.path = [];
        if (a.cargo) a.state = "returning";
      }
  }
  private building(id: number): Building | undefined {
    return (
      this.world.building?.(id) ?? this.world.buildings.find((b) => b.id === id)
    );
  }
  private tile(a: TradeActor): number {
    return this.world.map.ref(Math.floor(a.x / FIXED), Math.floor(a.y / FIXED));
  }
  private ready(b: Building): boolean {
    return !b.remainingTicks && (b.health ?? 1) > 0;
  }
  private siteKey(owner: number, naval: boolean, tile: number): string {
    return `${owner}:${naval ? 1 : 0}:${tile}`;
  }
  private refreshMarkets(): void {
    const facts = this.world.buildingFacts?.(),
      geometryChanged =
        !!facts && facts.geometryRevision !== this.marketGeometry;
    let changed = false;
    for (const p of this.world.players) {
      const list = (type: Building["type"]) =>
        facts?.completed(p.id, type) ??
        this.world.buildings.filter(
          (b) => b.playerId === p.id && b.type === type && this.ready(b),
        );
      const factories = list("factory"),
        ports = list("port"),
        cities = list("city"),
        previous = this.markets.get(p.id);
      if (
        !geometryChanged &&
        previous &&
        previous.factories === factories &&
        previous.ports === ports &&
        previous.cities === cities
      )
        continue;
      const groups = new Map<string, Building[]>();
      for (const b of [...factories, ...ports]) {
        const key = `${b.type}:${b.tile}`,
          group = groups.get(key) ?? [];
        group.push(b);
        groups.set(key, group);
      }
      const sites: Site[] = [];
      for (const buildings of groups.values()) {
        buildings.sort((a, b) => a.id - b.id);
        const source = buildings[0],
          naval = source.type === "port",
          water = naval
            ? this.world.map
                .neighbors(source.tile)
                .find((t) => this.world.waterPaths.walkable(t))
            : undefined;
        if (!naval || water !== undefined)
          sites.push({ source, buildings, naval, water });
      }
      this.markets.set(p.id, {
        factories,
        ports,
        cities,
        sites,
        markets: [...cities, ...ports],
      });
      changed = true;
    }
    this.marketGeometry = facts?.geometryRevision ?? -1;
    if (!changed) return;
    this.seaMarkets.clear();
    for (const owner of this.markets.values())
      for (const port of owner.ports) {
        const seas = new Set(
          this.world.map
            .neighbors(port.tile)
            .map((t) => this.world.waterPaths.component[t])
            .filter((n) => n > 0),
        );
        for (const sea of seas) {
          const list = this.seaMarkets.get(sea) ?? [];
          list.push(port);
          this.seaMarkets.set(sea, list);
        }
      }
    const live = new Set(
      [...this.markets].flatMap(([id, owner]) =>
        owner.sites.map((s) => this.siteKey(id, s.naval, s.source.tile)),
      ),
    );
    for (const [key, next] of this.siteNext)
      if (!live.has(key) && next <= this.world.tick) this.siteNext.delete(key);
  }
  private source(a: TradeActor): Site | undefined {
    return this.markets
      .get(a.playerId)
      ?.sites.find(
        (s) => s.naval === a.naval && s.source.tile === a.originTile,
      );
  }
  private allowedMarket(
    a: TradeActor,
    b: Building,
    returning = false,
  ): boolean {
    if (
      !this.ready(b) ||
      this.world.players.find((p) => p.id === b.playerId)?.eliminated
    )
      return false;
    if (a.state === "prize" || returning) return b.playerId === a.playerId;
    if (
      !this.permitted(a.playerId, b.playerId) ||
      this.paused(a.playerId, a.naval)
    )
      return false;
    if (a.naval) return b.type === "port" && b.playerId !== a.playerId;
    if (b.type !== "city" && b.type !== "port") return false;
    if (b.playerId === a.playerId) return b.tile !== a.originTile;
    const radius = Math.max(
      TRADE_RULES.minimumLandMarketRadius,
      (this.world.map.width() * TRADE_RULES.landMarketWidthPercent) / 100,
    );
    return (
      !this.enemy(a.playerId, b.playerId) &&
      (this.world.factionAdjacent?.(a.playerId, b.playerId) ??
        this.diplomacy.allied(a.playerId, b.playerId)) &&
      this.world.map.euclideanDistSquared(a.originTile, b.tile) <= radius ** 2
    );
  }
  private candidates(a: TradeActor, returning = false): Building[] {
    const tile = this.tile(a),
      own = this.markets.get(a.playerId),
      source = this.source(a);
    if (returning && source) return (this.routeFailures.get(this.failureKey(a, source.source, true))?.retryAt ?? 0) <= this.world.tick ? [source.source] : [];
    const rows = a.naval
      ? (this.seaMarkets.get(this.world.waterPaths.component[tile]) ?? [])
      : [...this.markets.values()].flatMap((m) => m.markets);
    const rank = (b: Building) =>
      a.state === "prize" || returning
        ? 0
        : this.diplomacy.allied(a.playerId, b.playerId)
          ? 0
          : this.enemy(a.playerId, b.playerId)
            ? 2
            : 1;
    const result = rows
      .filter(
        (b) =>
          this.allowedMarket(a, b, returning) &&
          (this.routeFailures.get(this.failureKey(a, b, returning))?.retryAt ?? 0) <= this.world.tick &&
          (a.naval || this.world.paths.connected(tile, b.tile)),
      )
      .map((b) => ({
        b,
        rank: rank(b),
        distance: this.world.map.euclideanDistSquared(tile, b.tile),
      }));
    this.diagnostics.marketReads += rows.length;
    // Sea fleets prefer diplomacy tiers. Nearby foreign land markets can lure
    // couriers across a shared border, proportional to the payout premium.
    const landDistance = (r: (typeof result)[number]) =>
      r.distance /
      (r.b.playerId === a.playerId
        ? 1
        : this.diplomacy.allied(a.playerId, r.b.playerId)
          ? 4
          : 16);
    const naval = a.naval;
    result.sort(
      (a, b) =>
        (naval
          ? a.rank - b.rank || a.distance - b.distance
          : landDistance(a) - landDistance(b)) || a.b.id - b.b.id,
    );
    if (!a.naval && returning && !source && own?.factories.length)
      return own.factories.filter(b =>
        this.allowedMarket(a, b, true) &&
        (this.routeFailures.get(this.failureKey(a, b, true))?.retryAt ?? 0) <= this.world.tick,
      ).slice(0, 8) as Building[];
    return result.slice(0, 8).map((r) => r.b);
  }
  private failureKey(a: TradeActor, market: Building, returning: boolean): string {
    return `${a.playerId}:${a.naval ? 1 : 0}:${this.tile(a)}:${market.id}:${market.playerId}:${returning ? 1 : 0}:${a.naval ? this.controlRevision : this.revision(a.playerId)}`;
  }
  private deferMarket(a: TradeActor, market: Building, returning: boolean): void {
    const key = this.failureKey(a, market, returning), previous = this.routeFailures.get(key);
    const attempts = Math.min(5, (previous?.attempts ?? 0) + 1);
    // Capacity is not proof of impossibility. Try another market now, and
    // retain backoff across actor admissions so fleets do not repeat the same
    // expensive failed search every few seconds.
    this.routeFailures.delete(key);
    this.routeFailures.set(key, { attempts, retryAt: this.world.tick + Math.min(6000, 400 * 2 ** (attempts - 1)) });
    while (this.routeFailures.size > 512) this.routeFailures.delete(this.routeFailures.keys().next().value!);
  }
  routeBlocked(task: DomainRouteTask): ((tile: number) => boolean) | undefined {
    const plan = this.admissions.get(task.admissionId),
      b = this.building(task.memberId);
    if (!plan || plan.naval) return undefined;
    return this.landBlocked(
      plan.playerId,
      b?.playerId ?? plan.playerId,
      plan.state === "prize",
    );
  }
  private landBlocked(
    owner: number,
    destinationOwner: number,
    prize: boolean,
  ): (tile: number) => boolean {
    return (tile) => {
      if (this.fortifications.blocked(tile, owner)) return true;
      const territory = this.world.owners?.[tile] ?? owner;
      return (
        !prize &&
        territory !== owner &&
        territory !== destinationOwner &&
        (!territory || !this.diplomacy.allied(owner, territory))
      );
    };
  }
  private task(p: Admission): DomainRouteTask {
    return {
      kind: "domain",
      owner: "trade",
      admissionId: p.id,
      memberId: p.candidates[p.index] ?? 0,
      stage: "market",
      playerId: p.playerId,
      generation: p.generation,
      epoch: p.epoch,
    };
  }
  private revision(owner: number): string {
    return `${this.world.domainRoutes?.revision(owner, "trade") ?? this.fortifications.version}:${this.controlRevision}`;
  }
  private cancel(id: number): void {
    const p = this.admissions.get(id);
    if (!p) return;
    this.world.domainRoutes?.cancel(this.task(p));
    this.admissions.delete(id);
  }
  validRoute(task: DomainRouteTask): boolean {
    const p = this.admissions.get(task.admissionId),
      a = this.actors.find((a) => a.id === task.admissionId);
    return (
      !!p &&
      !!a &&
      task.epoch === p.epoch &&
      task.memberId === p.candidates[p.index] &&
      a.playerId === p.playerId &&
      a.shipmentId === p.shipmentId &&
      this.tile(a) === p.start &&
      (this.world.domainRoutes?.generation(p.playerId) ?? 0) === p.generation &&
      this.revision(p.playerId) === p.revision
    );
  }
  completedRoute(
    task: DomainRouteTask,
    outcome: ExactRouteOutcome,
    path: number[],
  ): void {
    if (!this.validRoute(task)) return;
    const p = this.admissions.get(task.admissionId)!;
    p.requested = false;
    p.outcome = outcome;
    p.path = path;
  }
  private begin(a: TradeActor, loading: boolean): void {
    if (
      this.admissions.has(a.id) ||
      (this.retries.get(a.id)?.retryAt ?? 0) > this.world.tick
    )
      return;
    const returning =
        !loading &&
        a.state !== "prize" &&
        (!a.cargo || a.state === "returning"),
      rows = this.candidates(a, returning);
    if (!rows.length) {
      a.destination = null;
      a.waitTicks = 100;
      return;
    }
    this.admissions.set(a.id, {
      id: a.id,
      epoch: this.nextEpoch++,
      playerId: a.playerId,
      generation: this.world.domainRoutes?.generation(a.playerId) ?? 0,
      revision: this.revision(a.playerId),
      shipmentId: a.shipmentId,
      start: this.tile(a),
      naval: a.naval,
      loading,
      state:
        a.state === "prize" ? "prize" : returning ? "returning" : "outbound",
      candidates: rows.map((b) => b.id),
      index: 0,
      requested: false,
      attempts: 0,
      retryAt: 0,
    });
  }
  private corridorKey(p: Admission, goal: number): string {
    return `${p.playerId}:${p.naval ? 1 : 0}:${p.start}:${goal}:${p.revision}`;
  }
  private remember(key: string, path: number[]): void {
    if (path.length > 4096 || this.corridors.has(key)) return;
    this.corridors.set(key, path);
    this.corridorTiles += path.length;
    while (this.corridors.size > 128 || this.corridorTiles > 65536) {
      const [old, value] = this.corridors.entries().next().value!;
      this.corridors.delete(old);
      this.corridorTiles -= value.length;
    }
  }
  stepPlanning(budget: number): number {
    let used = 0,
      idle = 0;
    while (this.admissions.size && used < budget) {
      const [id, p] = this.admissions.entries().next().value!;
      this.admissions.delete(id);
      this.admissions.set(id, p);
      const a = this.actors.find((a) => a.id === id);
      if (!a || !this.validRoute(this.task(p))) {
        this.cancel(id);
        used++;
        continue;
      }
      if (p.requested || p.retryAt > this.world.tick) {
        if (++idle >= this.admissions.size) break;
        continue;
      }
      used++;
      idle = 0;
      const b = this.building(p.candidates[p.index]);
      if (!b || !this.allowedMarket(a, b, p.state === "returning")) {
        p.index++;
        p.goal = undefined;
        p.path = undefined;
        p.outcome = undefined;
      }
      if (p.index >= p.candidates.length) {
        this.cancel(id);
        a.destination = null;
        a.waitTicks = 100;
        continue;
      }
      if (!b || b.id !== p.candidates[p.index]) continue;
      if (p.outcome === "complete") {
        this.routeFailures.delete(this.failureKey(a, b, p.state === "returning"));
        if (p.loading && !this.load(a)) {
          this.cancel(id);
          a.waitTicks = 20;
          continue;
        }
        a.destination = b.id;
        a.path = p.path!;
        a.nextPathIndex = 0;
        a.state = p.state;
        this.remember(this.corridorKey(p, p.goal!), p.path!);
        if (!a.naval)
          this.roads?.add(
            a.path,
            AGES[logisticsTier(this.progression.states[a.playerId].completed)],
          );
        this.retries.delete(id);
        this.admissions.delete(id);
        continue;
      }
      if (p.outcome !== undefined) {
        const outcome = p.outcome;
        p.outcome = undefined;
        p.path = undefined;
        if (outcome === "limited") {
          this.deferMarket(a, b, p.state === "returning");
          p.index++;
          p.goal = undefined;
        } else if (outcome === "superseded") this.cancel(id);
        else {
          this.deferMarket(a, b, p.state === "returning");
          p.index++;
          p.goal = undefined;
        }
        continue;
      }
      // Another merchant may have discovered this corridor's failure after
      // this admission was created. Share that result before starting work.
      if ((this.routeFailures.get(this.failureKey(a, b, p.state === "returning"))?.retryAt ?? 0) > this.world.tick) {
        p.index++;
        p.goal = undefined;
        continue;
      }
      p.goal ??= a.naval
        ? this.world.map
            .neighbors(b.tile)
            .find((t) => this.world.waterPaths.connected(p.start, t))
        : b.tile;
      if (p.goal === undefined) {
        p.index++;
        continue;
      }
      const cached = this.corridors.get(this.corridorKey(p, p.goal));
      if (cached) {
        p.path = cached;
        p.outcome = "complete";
        this.diagnostics.routeHits++;
        continue;
      }
      if (this.world.domainRoutes) {
        p.requested = this.world.domainRoutes.request(
          this.task(p),
          p.start,
          p.goal,
          p.naval,
        );
        if (p.requested) this.diagnostics.routeRequests++;
      } else {
        if (
          this.world.paths.work +
            this.world.waterPaths.work -
            this.tickStartWork >=
          4096
        )
          break;
        const paths = p.naval ? this.world.waterPaths : this.world.paths,
          path = paths.find(
            p.start,
            p.goal,
            p.naval
              ? undefined
              : this.landBlocked(p.playerId, b.playerId, p.state === "prize"),
            4096,
          );
        this.diagnostics.routeRequests++;
        p.path = path ?? undefined;
        p.outcome = path ? "complete" : "unreachable";
      }
    }
    return used;
  }
  private capacity(site: Site): { value: number; definition: string } {
    const research = this.progression.states[site.source.playerId].completed,
      tier = logisticsTier(research),
      vessel = site.naval
        ? VESSELS.filter(
            (v) => v.kind === "trade" && research.includes(v.technologyId),
          ).slice(-1)[0]
        : undefined;
    return {
      value: Math.floor(
        ((vessel?.capacity ?? [20, 30, 40, 50, 60, 80, 120][tier]) *
          cargoHandlingPercent(research) *
          stackCargoPercent(site.buildings.length)) /
          10000,
      ),
      definition: vessel?.id ?? `${AGES[tier].toLowerCase()}-trader`,
    };
  }
  private load(a: TradeActor): boolean {
    const site = this.source(a);
    if (
      !site ||
      site.source.playerId !== a.playerId ||
      !this.ready(site.source) ||
      this.paused(a.playerId, a.naval)
    )
      return false;
    const stock = site.buildings.reduce(
      (n, b) => n + (this.supply.goods.get(b.id) ?? 0),
      0,
    );
    if (stock < 10) return false;
    const capacity = this.capacity(site);
    a.capacity = capacity.value;
    a.definitionId = capacity.definition;
    a.factoryId = site.source.id;
    a.originPortId = a.naval ? site.source.id : undefined;
    a.cargo = Math.min(stock, a.capacity);
    a.loaded = a.cargo;
    a.delivered = 0;
    a.returned = 0;
    a.lost = 0;
    a.valuePerGood = TRADE_RULES.valuePerGood;
    a.shipmentId = this.nextShipment++;
    a.visited = [];
    let remaining = a.cargo;
    for (const b of site.buildings) {
      const goods = this.supply.goods.get(b.id) ?? 0,
        take = Math.min(goods, remaining);
      this.supply.goods.set(b.id, goods - take);
      remaining -= take;
    }
    const plan = this.admissions.get(a.id)!;
    a.stops = [plan.candidates[plan.index]];
    a.quoteAllies = this.world.players
      .filter(
        (p) => p.id !== a.playerId && this.diplomacy.allied(a.playerId, p.id),
      )
      .map((p) => p.id);
    a.waitTicks = 20;
    return true;
  }
  private quotas(owner: number): { land: number; sea: number } {
    const m = this.markets.get(owner),
      research = this.progression.states[owner]?.completed ?? [];
    const land =
        !this.paused(owner, false) &&
        research.includes(technologyAt("StoneAge", "economic", 4).id)
          ? (m?.factories.length ?? 0)
          : 0,
      sea =
        !this.paused(owner, true) &&
        VESSELS.some(
          (v) => v.kind === "trade" && research.includes(v.technologyId),
        )
          ? (m?.ports.length ?? 0)
          : 0;
    const total = Math.min(TRADE_RULES.actorCap, land + sea),
      targetLand = land + sea ? Math.round((total * land) / (land + sea)) : 0;
    return { land: targetLand, sea: total - targetLand };
  }
  private spawn(): void {
    // Prizes are transferred couriers, not new actors. Their brief arrival
    // overflow never lifts the world's total cap, including all prizes.
    const eligible = this.world.players.filter((p) => !p.eliminated),
      globalCap = eligible.length * TRADE_RULES.actorCap;
    // This pass-local tally avoids a persistent index over publicly mutable
    // actors. Prizes occupy the owner/global cap but not a mode quota.
    const tally = new Map<number, { total: number; land: number; sea: number }>();
    this.diagnostics.spawnActorReads = 0;
    for (const actor of this.actors) {
      this.diagnostics.spawnActorReads++;
      let counts = tally.get(actor.playerId);
      if (!counts) tally.set(actor.playerId, counts = { total: 0, land: 0, sea: 0 });
      counts.total++;
      if (actor.state !== "prize") counts[actor.naval ? "sea" : "land"]++;
    }
    for (const player of eligible) {
      const quotas = this.quotas(player.id),
        counts = tally.get(player.id) ?? { total: 0, land: 0, sea: 0 };
      for (const site of this.markets.get(player.id)?.sites ?? []) {
        const mode = site.naval ? "sea" : "land",
          key = this.siteKey(player.id, site.naval, site.source.tile);
        if (
          counts[mode] >= quotas[mode] ||
          counts.total >= TRADE_RULES.actorCap ||
          this.actors.length >= globalCap ||
          (this.siteNext.get(key) ?? 0) > this.world.tick ||
          (site.naval &&
            !(
              this.seaMarkets.get(
                this.world.waterPaths.component[site.water!],
              ) ?? []
            ).some(
              (b) =>
                b.playerId !== player.id &&
                this.permitted(player.id, b.playerId),
            ))
        )
          continue;
        const cargo = this.capacity(site),
          origin = site.water ?? site.source.tile,
          actor: TradeActor = {
            id: this.world.allocateId(),
            playerId: player.id,
            factoryId: site.source.id,
            originPortId: site.naval ? site.source.id : undefined,
            definitionId: cargo.definition,
            naval: site.naval,
            x: (this.world.map.x(origin) + 0.5) * FIXED,
            y: (this.world.map.y(origin) + 0.5) * FIXED,
            cargo: 0,
            loaded: 0,
            delivered: 0,
            lost: 0,
            returned: 0,
            valuePerGood: TRADE_RULES.valuePerGood,
            originTile: site.source.tile,
            capacity: cargo.value,
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
        this.actors.push(actor);
        counts.total++;
        counts[mode]++;
        this.siteNext.set(
          key,
          this.world.tick + TRADE_RULES.spawnCooldownTicks,
        );
        this.diagnostics.spawned++;
      }
    }
  }
  observedRouteRisk(
    playerId: number,
    naval: boolean,
    point: { x: number; y: number },
  ): number {
    return (naval ? this.sea : this.land).mayContain(
      point.x,
      point.y,
      2 * FIXED,
      playerId,
    )
      ? 1
      : 0;
  }
  hasForeignMarket(owner: number, water: number): boolean {
    this.refreshMarkets();
    return (
      this.seaMarkets.get(this.world.waterPaths.component[water]) ?? []
    ).some((b) => b.playerId !== owner && this.permitted(owner, b.playerId));
  }
  loadingPortFor(factory: Building): Building | undefined {
    this.refreshMarkets();
    return this.markets
      .get(factory.playerId)
      ?.ports.filter(
        (b) =>
          this.world.paths.connected(factory.tile, b.tile) &&
          this.world.map.euclideanDistSquared(factory.tile, b.tile) <= 400,
      )
      .sort(
        (a, b) =>
          this.world.map.euclideanDistSquared(factory.tile, a.tile) -
            this.world.map.euclideanDistSquared(factory.tile, b.tile) ||
          a.id - b.id,
      )[0];
  }
  seaQuote(
    owner: number,
    port: Building,
    foreign: Building,
    valuePerGood: number,
    capacity: number,
  ) {
    if (
      port.playerId !== owner ||
      foreign.playerId === owner ||
      !this.ready(port) ||
      !this.ready(foreign) ||
      !this.permitted(owner, foreign.playerId)
    )
      return null;
    for (const start of this.world.map.neighbors(port.tile))
      for (const goal of this.world.map.neighbors(foreign.tile)) {
        if (!this.world.waterPaths.connected(start, goal)) continue;
        const path = this.world.waterPaths.find(start, goal, undefined, 4096);
        if (!path) return null;
        return {
          portId: port.id,
          destinationId: foreign.id,
          waterComponent: this.world.waterPaths.component[start],
          routeTiles: path.length,
          payout: tradePayout({
            naval: true,
            quantity: capacity,
            valuePerGood,
            distance: Math.sqrt(
              this.world.map.euclideanDistSquared(port.tile, foreign.tile),
            ),
            foreign: true,
            allied: this.diplomacy.allied(owner, foreign.playerId),
            mapWidth: this.world.map.width(),
          }),
          quantity: capacity,
        };
      }
    return null;
  }
  private discard(a: TradeActor): void {
    this.lostValue[a.playerId] =
      (this.lostValue[a.playerId] ?? 0) + a.cargo * a.valuePerGood;
    a.lost += a.cargo;
    a.cargo = 0;
  }
  step(): void {
    const { map, tick } = this.world;
    // Rebuild at the tick boundary: promotion, control transfer and restore
    // can replace player records without changing their stable identities.
    const players = new Map<number, Player>();
    this.diagnostics.playerReads = 0;
    for (const player of this.world.players) {
      this.diagnostics.playerReads++;
      if (!players.has(player.id)) players.set(player.id, player);
    }
    this.refreshMarkets();
    this.tickStartWork = this.world.paths.work + this.world.waterPaths.work;
    if (tick % 20 === 0) this.spawn();
    const quotas = new Map<number, { land: { total: number; seen: number }; sea: { total: number; seen: number } }>();
    this.diagnostics.quotaActorReads = 0;
    for (const actor of this.actors) {
      this.diagnostics.quotaActorReads++;
      let owner = quotas.get(actor.playerId);
      if (!owner) quotas.set(actor.playerId, owner = { land: { total: 0, seen: 0 }, sea: { total: 0, seen: 0 } });
      if (actor.state !== "prize") owner[actor.naval ? "sea" : "land"].total++;
    }
    if (this.actors.length) {
      const facts = this.world.spatialFacts?.("trade");
      if (facts) { this.land = facts.groundAlive; this.sea = facts.warshipsAlive; }
      else {
        this.localLand ??= new SpatialGrid(this.world.map.width() * FIXED, this.world.map.height() * FIXED, 4 * FIXED, (s: Squad) => s.playerId);
        this.localSea ??= new SpatialGrid(this.world.map.width() * FIXED, this.world.map.height() * FIXED, 4 * FIXED, (s: Ship) => s.playerId);
        this.localLand.rebuild(this.world.squads.filter((s) => s.embarkedOn === null && s.troops > 0));
        this.localSea.rebuild(this.world.ships.filter((s) => s.kind === "warship" && s.health > 0));
        this.land = this.localLand; this.sea = this.localSea;
      }
    }
    for (const a of this.actors) {
      const quotaGroup = quotas.get(a.playerId)![a.naval ? "sea" : "land"];
      if (a.state !== "prize") quotaGroup.seen++;
      const player = players.get(a.playerId);
      if (!player || player.eliminated) {
        this.discard(a);
        this.retired.add(a.id);
        continue;
      }
      if (a.waitTicks > 0) {
        a.waitTicks--;
        continue;
      }
      if (a.naval) this.sea.query(a.x, a.y, 1.2 * FIXED, this.nearby as Ship[]);
      else this.land.query(a.x, a.y, 1.2 * FIXED, this.nearby as Squad[]);
      const captor = this.nearby
        .filter(
          (s) =>
            this.enemy(a.playerId, s.playerId) &&
            (s.x - a.x) ** 2 + (s.y - a.y) ** 2 <= (1.2 * FIXED) ** 2 &&
            this.fortifications.clear(a, s, s.playerId),
        )
        .sort((a, b) => a.id - b.id)[0];
      if (captor && a.cargo) {
        if (a.state !== "prize") { quotaGroup.total--; quotaGroup.seen--; }
        this.cancel(a.id);
        this.retries.delete(a.id);
        const value = a.cargo * a.valuePerGood;
        this.lostValue[a.playerId] = (this.lostValue[a.playerId] ?? 0) + value;
        this.capturedValue[captor.playerId] =
          (this.capturedValue[captor.playerId] ?? 0) + value;
        a.playerId = captor.playerId;
        a.state = "prize";
        a.stops = [];
        a.visited = [];
        a.quoteAllies = [];
        a.destination = null;
        a.path = [];
        a.waitTicks = 20;
        continue;
      }
      const site = this.source(a);
      if (!site && a.state !== "prize") {
        if (!a.cargo) {
          this.retired.add(a.id);
          continue;
        }
        // Losing the source does not kill its loaded merchant. Salvage its
        // cargo at an owned receiver, then leave service like a captured courier.
        this.cancel(a.id);
        quotaGroup.total--; quotaGroup.seen--;
        a.state = "prize";
        a.destination = null;
        a.path = [];
      }
      if (a.state === "loading") {
        const quota = this.quotas(a.playerId)[a.naval ? "sea" : "land"];
        if (
          quotaGroup.total > quota &&
          quotaGroup.seen - 1 >= quota &&
          !this.paused(a.playerId, a.naval)
        ) {
          this.retired.add(a.id);
          continue;
        }
        if (
          !this.paused(a.playerId, a.naval) &&
          site!.buildings.reduce(
            (n, b) => n + (this.supply.goods.get(b.id) ?? 0),
            0,
          ) >= 10
        )
          this.begin(a, true);
        continue;
      }
      if (this.admissions.has(a.id)) continue;
      if (a.destination === null) {
        this.begin(a, false);
        continue;
      }
      const b = this.building(a.destination);
      if (!b || !this.allowedMarket(a, b, a.state === "returning")) {
        a.destination = null;
        a.path = [];
        if (a.state !== "prize") a.state = "returning";
        this.begin(a, false);
        continue;
      }
      const tile = a.path[a.nextPathIndex];
      if (tile !== undefined) {
        const goal = {
          x: (map.x(tile) + 0.5) * FIXED,
          y: (map.y(tile) + 0.5) * FIXED,
        };
        if (
          !a.naval &&
          (this.landBlocked(
            a.playerId,
            b.playerId,
            a.state === "prize",
          )(tile) ||
            !this.fortifications.clear(a, goal, a.playerId))
        ) {
          // Territory can change without a fortification/treaty revision.
          // Evict this owner's reusable corridors before requesting a new one.
          for (const [key, path] of this.corridors)
            if (key.startsWith(`${a.playerId}:`)) {
              this.corridors.delete(key);
              this.corridorTiles -= path.length;
            }
          a.destination = null;
          a.path = [];
          a.waitTicks = 20;
          continue;
        }
        const dx = goal.x - a.x,
          dy = goal.y - a.y,
          distance = Math.hypot(dx, dy),
          speed = a.naval ? 55 : 50;
        if (distance <= speed) {
          a.x = goal.x;
          a.y = goal.y;
          a.nextPathIndex++;
        } else {
          a.x += Math.round((dx * speed) / distance);
          a.y += Math.round((dy * speed) / distance);
        }
        continue;
      }
      if (a.state === "returning") {
        if (a.cargo && site) {
          this.supply.goods.set(
            site.source.id,
            (this.supply.goods.get(site.source.id) ?? 0) + a.cargo,
          );
          a.returned += a.cargo;
          a.cargo = 0;
        }
        a.state = "loading";
        a.destination = null;
        a.waitTicks = 20;
        continue;
      }
      const quantity = a.cargo,
        distance = Math.sqrt(map.euclideanDistSquared(a.originTile, b.tile)),
        foreign = b.playerId !== a.playerId,
        allied =
          foreign &&
          a.quoteAllies.includes(b.playerId) &&
          this.diplomacy.allied(a.playerId, b.playerId);
      const gold =
        a.state === "prize"
          ? quantity * a.valuePerGood
          : tradePayout({
              naval: a.naval,
              quantity,
              valuePerGood: a.valuePerGood,
              distance,
              foreign,
              allied,
              mapWidth: map.width(),
            });
      if (a.state !== "prize")
        this.cycleQuotes.set(
          a.id,
          tradeCycleQuote({
            naval: a.naval,
            stock: a.loaded,
            capacity: a.capacity,
            valuePerGood: a.valuePerGood,
            supplyTicks: 0,
            legs: [
              {
                marketId: b.id,
                distance,
                foreign,
                allied,
                travelTicks: a.path.length * 5,
              },
            ],
            returnTicks: a.path.length * 5,
            observedRisk: 0,
            mapWidth: map.width(),
          }),
        );
      a.delivered += quantity;
      a.cargo = 0;
      a.visited.push(b.id);
      player.gold += gold;
      this.deliveredGold[a.playerId] =
        (this.deliveredGold[a.playerId] ?? 0) + gold;
      a.destination = null;
      a.path = [];
      a.waitTicks = 20;
      if (a.state === "prize") this.retired.add(a.id);
      else a.state = "returning";
    }
    if (!this.world.domainRoutes) this.stepPlanning(32);
    for (let i = this.actors.length - 1; i >= 0; i--)
      if (this.retired.has(this.actors[i].id)) {
        const id = this.actors[i].id;
        this.cancel(id);
        this.retries.delete(id);
        this.cycleQuotes.delete(id);
        this.retired.delete(id);
        this.actors.splice(i, 1);
      }
  }
}
