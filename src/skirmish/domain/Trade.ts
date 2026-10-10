import { portWaterTiles } from "../PortWaterAccess";
import type { GameMap } from "../../core/game/GameMap";
import { tradeActorCap } from "../FactionRules";
import { SpatialGrid } from "../SpatialGrid";
import type { BuildingQueries } from "../BuildingIndex";
import { LAND_TRADE_CAPACITIES, stackCargoPercent, TRADE_RULES } from "../content/Economy";
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
import { restoreArray, restoreRecord, restoreSet } from "../StateTransfer";
import { AGES, type TradeActor, type TradeReceipt } from "./Definitions";
import type { Diplomacy } from "./Diplomacy";
import type { DomainRoutePorts, DomainRouteTask } from "./DomainRoutePorts";
import type { Fortifications } from "./Fortifications";
import type { Progression } from "./Progression";
import { cargoHandlingPercent, logisticsTier, landTraderTier, portCargoPercent, roadsUnlocked, vesselEffects } from "./ResearchEffects";
import { TradeReceiving } from "./TradeReceiving";
import type { Roads } from "./Roads";
import type { Supply } from "./Supply";
import type { PhaseSpatialFacts, SpatialPhase, SpatialQueries } from "../PhaseSpatialViews";
import {
  tradePayout,
  type TradeCycleQuote,
} from "./TradeQuote";

export interface TradeWorld {
  spatialFacts(phase: SpatialPhase): PhaseSpatialFacts;
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
  landBlocked?: number[];
  seaBlocked?: number[];
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
  originTile?: number;
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

/** Bounded multi-stop couriers. Markets share lifecycle indexes, route pairs
 * share bounded corridors, and cargo changes hands only at authoritative commits. */
export class Trade {
  readonly receipts = new Map<string,TradeReceipt>();
  receiptRevision=0;
  private nextReceipt=1;
  readonly receiving = new TradeReceiving();
  private seaActorTick = -1;
  private readonly seaActorIds = new Map<number, TradeActor>();
  private readonly seaActors: SpatialGrid<TradeActor>;
  private blastActorTick = -1;
  private readonly blastActors: SpatialGrid<TradeActor>;
  private readonly blastNearby: TradeActor[] = [];
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
  private readonly landMarkets: Building[] = [];
  private readonly landComponents = new Map<number,Building[]>();
  private readonly landShortlists = new Map<string,{epoch:number;permission:string;rows:Building[]}>();
  private readonly routeLengths = new Map<string,{revision:string;tiles:number}>();
  private readonly admissions = new Map<number, Admission>();
  private readonly retries = new Map<
    number,
    { attempts: number; retryAt: number }
  >();
  private readonly spawnCursor = new Map<number, number>();
  private readonly corridors = new Map<string, number[]>();
  private readonly routeFailures = new Map<string, { attempts: number; retryAt: number }>();
  private readonly retired = new Set<number>();
  private nextShipment = 1;
  private nextEpoch = 1;
  private corridorTiles = 0;
  private tickStartWork = 0;
  private land: SpatialQueries<Squad>;
  private sea: SpatialQueries<Ship>;
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
    private readonly war: (a: number, b: number) => boolean = (a,b)=>diplomacy.declaredWar(a,b),
    private readonly relationRevision:(owner:number)=>string = ()=>String(diplomacy.revision),
  ) {
    this.seaActors = new SpatialGrid(world.map.width()*FIXED,world.map.height()*FIXED,8*FIXED,a=>a.playerId);
    this.blastActors = new SpatialGrid(world.map.width()*FIXED,world.map.height()*FIXED,8*FIXED,a=>a.playerId);
  }
  /** Build only on a blast tick, shared by all warheads. Cargo loss and actor
   * retirement use the existing lifecycle; wrecks cannot move, load or pay. */
  destroyInBlast(_attacker:number,x:number,y:number,radius:number):void {
    if (this.blastActorTick !== this.world.tick) {
      this.blastActorTick = this.world.tick;
      this.blastActors.rebuild(this.actors);
    }
    this.blastActors.query(x,y,radius,this.blastNearby);
    for (const actor of this.blastNearby.sort((a,b)=>a.id-b.id)) {
      if (this.retired.has(actor.id) ||
        (actor.x-x)**2+(actor.y-y)**2>radius**2) continue;
      this.discard(actor);
      this.cancel(actor.id);
      this.retired.add(actor.id);
    }
    this.seaActorTick = -1;
  }
  private indexSeaActors(): void {
    if (this.seaActorTick === this.world.tick) return;
    this.seaActorTick = this.world.tick; this.seaActorIds.clear();
    const rows = this.actors.filter(a=>a.naval && a.cargo>0);
    for (const actor of rows) this.seaActorIds.set(actor.id,actor);
    this.seaActors.rebuild(rows);
  }
  seaActor(id: number): TradeActor | undefined { this.indexSeaActors(); return this.seaActorIds.get(id); }
  raidTargets(x:number,y:number,radius:number,owner:number,result:TradeActor[]):void {
    this.indexSeaActors();
    this.seaActors.sample(x,y,radius,result,a=>this.diplomacy.hostile(owner,a.playerId),32,256,(Math.floor(this.world.tick/10)+owner)*256);
  }
  checkpoint() {
    return structuredClone({
      actors: this.actors,
      receipts: [...this.receipts],receiptRevision:this.receiptRevision,nextReceipt:this.nextReceipt,
      deliveredGold: this.deliveredGold,
      capturedValue: this.capturedValue,
      lostValue: this.lostValue,
      controls: this.controls,
      receiving: this.receiving.checkpoint(),
      controlRevision: this.controlRevision,
      cycleQuotes: [...this.cycleQuotes],
      retired: this.retired,
      nextShipment: this.nextShipment,
      nextEpoch: this.nextEpoch,
      admissions: [...this.admissions],
      retries: [...this.retries],
      spawnCursor: [...this.spawnCursor],
      routeLengths: [...this.routeLengths],
      corridors: [...this.corridors],
      routeFailures: [...this.routeFailures],
    });
  }
  restore(saved: ReturnType<Trade["checkpoint"]>): void {
    this.seaActorTick = -1;
    this.blastActorTick = -1;
    const s = structuredClone(saved);
    restoreArray(this.actors, s.actors);
    this.receipts.clear();for(const [key,receipt] of s.receipts??[])this.receipts.set(key,receipt);
    this.receiptRevision=s.receiptRevision??0;this.nextReceipt=s.nextReceipt??1;
    restoreRecord(this.deliveredGold, s.deliveredGold);
    restoreRecord(this.capturedValue, s.capturedValue ?? {});
    restoreRecord(this.lostValue, s.lostValue ?? {});
    restoreRecord(this.controls, s.controls ?? {});
    this.receiving.restore(s.receiving);
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
    this.spawnCursor.clear();
    for (const [owner, cursor] of s.spawnCursor ?? []) this.spawnCursor.set(owner, cursor);
    this.routeLengths.clear();for(const [key,row] of s.routeLengths??[])this.routeLengths.set(key,row);
    this.landComponents.clear();this.landShortlists.clear();
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
    this.landMarkets.length = 0;
    this.marketGeometry = -1;
  }
  setPaused(playerId: number, naval: boolean, paused: boolean): void {
    const c = this.control(playerId);
    if ((naval ? c.seaPaused : c.landPaused) === paused) return;
    if (naval) c.seaPaused = paused;
    else c.landPaused = paused;
    this.controlRevision++;
    if (paused) this.redirect(playerId, naval);
    const player = this.world.players.find(p => p.id === playerId);
    if (player) this.releaseIdleCouriers(new Map([[playerId, player]]), new Map([[playerId,
      this.actors.reduce((n, actor) => n + Number(actor.playerId === playerId && actor.naval), 0)]]));
  }
  setBlocked(playerId: number, other: number, blocked: boolean, naval?: boolean): void {
    const c = this.control(playerId);
    // Legacy commands still control both modes; new buttons preserve each mode.
    if (naval === undefined) {
      this.setBlocked(playerId, other, blocked, false);
      this.setBlocked(playerId, other, blocked, true);
      return;
    }
    const field = naval ? "seaBlocked" : "landBlocked";
    c.landBlocked ??= [...c.blocked]; c.seaBlocked ??= [...c.blocked];
    if (c[field]!.includes(other) === blocked) return;
    c[field] = blocked ? [...c[field]!, other].sort((a,b)=>a-b) : c[field]!.filter(id=>id!==other);
    c.blocked = c.landBlocked.filter(id=>c.seaBlocked!.includes(id));
    this.controlRevision++;
    if (blocked) {
      this.redirect(playerId, naval, other);
      this.redirect(other, naval, playerId);
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
  atWar(a: number, b: number): boolean { return a !== b && this.war(a, b); }
  permitted(a: number, b: number, naval = true): boolean {
    const field = naval ? "seaBlocked" : "landBlocked";
    return (
      !this.atWar(a, b) &&
      !(this.controls[a]?.[field] ?? this.controls[a]?.blocked)?.includes(b) &&
      !(this.controls[b]?.[field] ?? this.controls[b]?.blocked)?.includes(a)
    );
  }
  private redirect(owner: number, naval?: boolean, other?: number): void {
    for (const a of this.actors)
      if (
        a.playerId === owner &&
        a.state !== "prize" &&
        !(a.naval && a.destination !== null && (a.state === "outbound" || a.state === "returning")) &&
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
            ? portWaterTiles(this.world.map, source.tile)
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
    const receivers = new Map<string, number>();
    const receivingPercent=new Map<string,number>();
    for (const m of this.markets.values()) for (const b of m.markets) {
      const key = TradeReceiving.key(b.playerId, b.tile);
      receivers.set(key, (receivers.get(key) ?? 0) + 1);
      const research=this.progression.states[b.playerId].completed;
      receivingPercent.set(key,Math.max(receivingPercent.get(key)??100,100+AGES.indexOf(b.age??"StoneAge")*5));
    }
    for (const [key, stack] of receivers) this.receiving.configure(key, stack, this.world.tick,receivingPercent.get(key)??100);
    this.receiving.retain(new Set(receivers.keys()));
    this.landMarkets.length = 0;
    for (const m of this.markets.values()) {
      const tiles = new Set<number>();
      for (const b of m.markets) if (!tiles.has(b.tile)) { tiles.add(b.tile); this.landMarkets.push(b); }
    }
    this.landComponents.clear();this.landShortlists.clear();
    for(const b of this.landMarkets){
      const component=this.world.paths.component[b.tile];if(!component)continue;
      const rows=this.landComponents.get(component)??[];rows.push(b);this.landComponents.set(component,rows);
    }
    for(const rows of this.landComponents.values())rows.sort((a,b)=>a.id-b.id);
    this.seaMarkets.clear();
    for (const owner of this.markets.values()) {
      const tiles = new Set<number>();
      for (const port of owner.ports) {
        if (tiles.has(port.tile)) continue;
        tiles.add(port.tile);
        const seas = new Set(
          portWaterTiles(this.world.map, port.tile)
            .map((t) => this.world.waterPaths.component[t])
            .filter((n) => n > 0),
        );
        for (const sea of seas) {
          const list = this.seaMarkets.get(sea) ?? [];
          list.push(port);
          this.seaMarkets.set(sea, list);
        }
      }
    }
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
    const committedSeaLeg = a.naval && a.state === "outbound" && a.destination === b.id;
    if (!committedSeaLeg && (
      !this.permitted(a.playerId, b.playerId, a.naval) ||
      this.paused(a.playerId, a.naval)
    ))
      return false;
    if (a.state !== "loading" && ((a.visitedTiles ?? []).includes(b.tile) ||
      (a.visitedTiles?.length ?? 0) >= TRADE_RULES.maximumStops))
      return false;
    if (a.naval) return b.type === "port" && b.playerId !== a.playerId;
    if (b.type !== "city" && b.type !== "port") return false;
    if (b.playerId === a.playerId) return b.tile !== a.originTile;
    return !this.enemy(a.playerId, b.playerId);
  }
  /** Shared per physical source, with deterministic staggered exploration.
   * Near home/foreign options remain available; other markets rotate in. */
  private landCandidates(a:TradeActor):Building[] {
    const key=`${a.playerId}:${a.originTile}`,epoch=Math.floor((this.world.tick+a.originTile%200)/200),
      permission=`${this.relationRevision(a.playerId)}:${this.controlRevision}:${this.diplomacy.revision}`;
    const saved=this.landShortlists.get(key);
    if(saved?.epoch===epoch && saved.permission===permission)return saved.rows;
    const rows=(this.landComponents.get(this.world.paths.component[a.originTile])??[])
      .filter(b=>!this.world.players.find(p=>p.id===b.playerId)?.eliminated &&
        this.permitted(a.playerId,b.playerId,false) && !this.enemy(a.playerId,b.playerId));
    this.diagnostics.marketReads+=rows.length;
    const nearest=(foreign:boolean)=>rows.filter(b=>(b.playerId!==a.playerId)===foreign).sort((x,y)=>
      this.world.map.euclideanDistSquared(a.originTile,x.tile)-this.world.map.euclideanDistSquared(a.originTile,y.tile)||x.id-y.id).slice(0,8);
    const selected=new Map<number,Building>();
    for(const b of [...nearest(false),...nearest(true)])selected.set(b.id,b);
    for(let i=0;i<Math.min(16,rows.length);i++){
      const b=rows[(a.originTile+epoch*16+i)%rows.length];selected.set(b.id,b);
    }
    const result=[...selected.values()];
    if(this.landShortlists.size>=4096 && !this.landShortlists.has(key))this.landShortlists.delete(this.landShortlists.keys().next().value!);
    this.landShortlists.set(key,{epoch,permission,rows:result});return result;
  }
  private routeDistance(owner:number,start:number,goal:number):number {
    const row=this.routeLengths.get(`${owner}:${start}:${goal}`);
    return row?.revision===this.revision(owner)?row.tiles:Math.sqrt(this.world.map.euclideanDistSquared(start,goal));
  }
  private candidates(a: TradeActor, returning = false): Building[] {
    const tile = this.tile(a),
      own = this.markets.get(a.playerId),
      source = this.source(a);
    if (returning && source) return (this.routeFailures.get(this.failureKey(a, source.source, true))?.retryAt ?? 0) <= this.world.tick ? [source.source] : [];
    const rows = a.naval
      ? (this.seaMarkets.get(this.world.waterPaths.component[tile]) ?? [])
      : this.landCandidates(a);
    const seen = new Set<number>();
    const result = rows
      .filter(
        (b) =>
          this.allowedMarket(a, b, returning) &&
          !seen.has(b.tile) && !!seen.add(b.tile) &&
          (this.routeFailures.get(this.failureKey(a, b, returning))?.retryAt ?? 0) <= this.world.tick &&
          (a.naval || this.world.paths.connected(tile, b.tile)),
      )
      .map((b) => ({
        b,
        distance: this.world.map.euclideanDistSquared(tile, b.tile),
      }));
    this.diagnostics.marketReads += rows.length;
    // Score incremental gold against the extra travel needed before returning.
    // No path searches here: exact routes enter the existing bounded planner.
    const rates = new Map<number, number>();
    const speed = a.naval ? this.seaPricing(a.playerId).seaSpeed : 50;
    const originDistance = this.routeDistance(a.playerId,tile,a.originTile);
    const stock = a.cargo > 0 ? a.cargo : source?.buildings.reduce((n,b)=>n+(this.supply.goods.get(b.id) ?? 0),0) ?? 0;
    const availableCargo = Math.min(stock, a.cargo > 0 ? a.cargo : a.capacity);
    if (!returning && a.state !== "prize") for (const row of result) {
      const foreign = row.b.playerId !== a.playerId, allied = foreign && this.diplomacy.allied(a.playerId,row.b.playerId);
      const quantity = Math.min(availableCargo, this.receiving.available(TradeReceiving.key(row.b.playerId,row.b.tile),
        this.world.tick, a.naval, foreign, allied));
      const distance = Math.sqrt(this.world.map.euclideanDistSquared(a.originTile,row.b.tile));
      const extraTravel = Math.max(0, this.routeDistance(a.playerId,tile,row.b.tile) +
        this.routeDistance(a.playerId,row.b.tile,a.originTile) - originDistance);
      rates.set(row.b.id, tradePayout({ naval:a.naval,quantity,valuePerGood:a.valuePerGood,distance,foreign,allied,
        mapWidth:this.world.map.width() }) / (20 + extraTravel * FIXED / speed));
    }
    result.sort(
      (a, b) =>
        ((rates.get(b.b.id) ?? 0) - (rates.get(a.b.id) ?? 0)) || a.distance - b.distance || a.b.id - b.b.id,
    );
    if (!a.naval && returning && !source && own?.factories.length)
      return own.factories.filter(b =>
        this.allowedMarket(a, b, true) &&
        (this.routeFailures.get(this.failureKey(a, b, true))?.retryAt ?? 0) <= this.world.tick,
      ).slice(0, 8) as Building[];
    const minimumRate = a.state === "outbound" && a.visited.length ?
      (this.cycleQuotes.get(a.id)?.goldPer1000Ticks ?? 0) / 1000 : 0;
    return result.filter(r=>returning || a.state === "prize" ||
      ((rates.get(r.b.id) ?? 0)>0 && (rates.get(r.b.id) ?? 0)>=minimumRate))
      .slice(0, 8).map((r) => r.b);
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
    const plan = this.admissions.get(task.admissionId);
    if (!plan || plan.naval) return undefined;
    return this.landBlocked(plan.playerId, this.world.owners?.[plan.start] ?? plan.playerId);
  }
  /** Caravans never head for an enemy's market (see allowedMarket) and may
   * cross any land whose owner's trade rules admit them. A courier caught in
   * land that no longer does (war, a blocked or paused partner) may still
   * cross that land to leave it, toward a market outside it. Walls always
   * obstruct; enemy units can still seize a loaded courier they catch. */
  private landBlocked(owner: number, departureOwner = owner): (tile: number) => boolean {
    return (tile) => {
      if (this.fortifications.blocked(tile, owner)) return true;
      const territory = this.world.owners?.[tile] ?? owner;
      return territory !== 0 && territory !== owner && territory !== departureOwner &&
        !this.permitted(owner, territory, false);
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
  private revision(owner: number, naval = false): string {
    // Water navigation ignores land fortifications and military policy. Those
    // revisions can change every tick and starve longer sea-route admissions.
    if (naval) return `water:${this.controlRevision}`;
    return `${this.world.domainRoutes?.revision(owner, "trade") ?? this.fortifications.version}:${this.controlRevision}:${this.relationRevision(owner)}`;
  }
  private cancel(id: number): void {
    const p = this.admissions.get(id);
    if (!p) return;
    this.world.domainRoutes?.cancel(this.task(p));
    this.admissions.delete(id);
  }
  validRoute(task: DomainRouteTask): boolean {
    const p = this.admissions.get(task.admissionId),
      a = this.actors.find((a) => a.id === task.admissionId),
      market = this.building(task.memberId);
    return (
      !!p &&
      !!a &&
      !!market && this.allowedMarket(a, market, p.state === "returning") &&
      task.epoch === p.epoch &&
      task.memberId === p.candidates[p.index] &&
      a.playerId === p.playerId &&
      a.shipmentId === p.shipmentId &&
      this.tile(a) === p.start &&
      (this.world.domainRoutes?.generation(p.playerId) ?? 0) === p.generation &&
      this.revision(p.playerId, p.naval) === p.revision
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
    // Reserve one full-load admission per source. Other idle couriers reuse it
    // after commit instead of requesting routes for the same unspent stock.
    if (loading) for (const p of this.admissions.values())
      if (p.loading && p.playerId === a.playerId && p.naval === a.naval &&
        (p.originTile ?? this.actors.find(other => other.id === p.id)?.originTile) === a.originTile) return;
    let returning =
        !loading &&
        a.state !== "prize" &&
        (!a.cargo || a.state === "returning"),
      rows = this.candidates(a, returning);
    if (!rows.length && !loading && !returning && a.state !== "prize") {
      a.state = "returning"; returning = true; rows = this.candidates(a, true);
    }
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
      revision: this.revision(a.playerId, a.naval),
      shipmentId: a.shipmentId,
      start: this.tile(a),
      originTile: a.originTile,
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
    // Planning commits run before the movement/trade phase. Derived markets
    // must be available here after restore, and reflect current source changes.
    this.refreshMarkets();
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
        if (!p.loading && a.state === "outbound") a.state = "returning";
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
        if(!a.naval){
          const tiles=p.path!.reduce((n,t,i,path)=>n+Math.sqrt(this.world.map.euclideanDistSquared(i?path[i-1]:p.start,t)),0);
          for(const [start,end] of [[p.start,p.goal!],[p.goal!,p.start]]){
            const key=`${a.playerId}:${start}:${end}`;
            this.routeLengths.set(key,{revision:p.revision,tiles});
          }
          while(this.routeLengths.size>1024)this.routeLengths.delete(this.routeLengths.keys().next().value!);
        }
        a.destination = b.id;
        a.routeOriginOwner=this.world.owners?.[p.start]??a.playerId;
        a.path = p.path!;
        a.nextPathIndex = 0;
        a.state = p.state;
        this.remember(this.corridorKey(p, p.goal!), p.path!);
        if (!a.naval && roadsUnlocked(this.progression.states[a.playerId].completed))
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
        ? portWaterTiles(this.world.map, b.tile)
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
              : this.landBlocked(p.playerId, this.world.owners?.[p.start] ?? p.playerId),
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
      tier = landTraderTier(research),
      vessel = site.naval
        ? VESSELS.filter(
            (v) => v.kind === "trade" && research.includes(v.technologyId),
          ).slice(-1)[0]
        : undefined;
    return {
      value: Math.floor(
        ((vessel ? vesselEffects(vessel, research).capacity! : LAND_TRADE_CAPACITIES[tier]) *
          cargoHandlingPercent(research) * portCargoPercent(research) *
          stackCargoPercent(site.buildings.length)) /
          1000000,
      ),
      definition: vessel?.id ?? `${AGES[tier].toLowerCase()}-trader`,
    };
  }
  private seaPricing(owner:number) {
    const research=this.progression.states[owner].completed;
    const vessel=VESSELS.filter(v=>v.kind==="trade" && research.includes(v.technologyId)).slice(-1)[0];
    return {seaSpeed:vessel?.speed ?? 70};
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
    const capacity = this.capacity(site);
    if (stock < capacity.value) return false;
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
    a.visitedTiles = [];
    a.tripStartedTick = this.world.tick;
    a.tripGold = 0;
    a.tripSupplyTicks = (a.supplyWaitTicks ?? 0) + (a.supplyWaitStartedTick === undefined ? 0 : this.world.tick-a.supplyWaitStartedTick);
    a.supplyWaitTicks = 0;
    a.supplyWaitStartedTick = undefined;
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
  private actorCap(player: Player): number {
    return player.kind === "tribe" ? tradeActorCap(player, this.progression.states[player.id]?.age) : TRADE_RULES.actorCap;
  }
  private seaCap(player: Player): number {
    return Math.max(0, this.actorCap(player) -
      (this.paused(player.id, false) ? 0 : TRADE_RULES.reservedLandActors));
  }
  private releaseIdleCouriers(players: ReadonlyMap<number, Player>, seaTally: Map<number, number>,
    tally?: Map<number, number>, idleSites?: Set<string>): void {
    // Mode changes release empty pools immediately; loaded voyages retain their
    // slots until returning. The spawn pass reuses its existing owner counts.
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const actor = this.actors[i], player = players.get(actor.playerId);
      if (!player || actor.state !== "loading" || actor.cargo > 0 ||
        (!this.paused(player.id, actor.naval) &&
          !(actor.naval && (seaTally.get(player.id) ?? 0) > this.seaCap(player)))) continue;
      this.cancel(actor.id);
      this.retries.delete(actor.id);
      this.cycleQuotes.delete(actor.id);
      this.actors.splice(i, 1);
      if (tally) tally.set(player.id, (tally.get(player.id) ?? 0) - 1);
      if (actor.naval) seaTally.set(player.id, (seaTally.get(player.id) ?? 0) - 1);
      idleSites?.delete(this.siteKey(player.id, actor.naval, actor.originTile));
    }
  }
  private modeEnabled(owner: number, naval: boolean): boolean {
    const research = this.progression.states[owner]?.completed ?? [];
    return !this.paused(owner, naval) && (naval
      ? VESSELS.some(v => v.kind === "trade" && research.includes(v.technologyId))
      : (research.includes("rus-stoneage-roads") || research.includes("rus-stoneage-land-traders")));
  }
  /** Current source throughput facts, shared with AI investment decisions. */
  sourceStatus(sourceId: number) {
    this.refreshMarkets();
    const building = this.building(sourceId);
    const site = building && this.markets.get(building.playerId)?.sites.find(s => s.buildings.some(b => b.id === sourceId));
    if (!site) return undefined;
    return { stock: site.buildings.reduce((n,b) => n + (this.supply.goods.get(b.id) ?? 0),0),
      capacity: this.capacity(site).value };
  }
  siteSnapshot(): NonNullable<import("./Definitions").ExpansionSnapshot["tradeSites"]> {
    return [...this.markets.values()].flatMap(m => [...m.sites.map(site => ({
      playerId: site.source.playerId, tile: site.source.tile, naval: site.naval,
      cargo: site.buildings.reduce((n,b) => n + (this.supply.goods.get(b.id) ?? 0), 0),
      maxCargo: 1000 * site.buildings.length,
      shipmentCapacity: this.capacity(site).value,
      ...(site.naval ? { receiving: this.receiving.status(TradeReceiving.key(site.source.playerId, site.source.tile), this.world.tick) } : {}),
    })), ...m.cities.filter((b,i,all) => all.findIndex(other => other.tile === b.tile) === i).map(b => ({
      kind: "city" as const, playerId: b.playerId, tile: b.tile, naval: false,
      cargo: 0, maxCargo: 0, shipmentCapacity: 0,
      receiving: this.receiving.status(TradeReceiving.key(b.playerId,b.tile),this.world.tick),
    }))]);
  }
  private spawn(): void {
    // Prizes are transferred couriers, not new actors. Their brief arrival
    // overflow never lifts the world's total cap, including all prizes.
    const eligible = this.world.players.filter((p) => !p.eliminated),
      globalCap = eligible.reduce((sum, p) => sum + this.actorCap(p), 0);
    // This pass-local tally avoids a persistent index over publicly mutable
    // actors. Prizes occupy the owner/global cap but not a mode quota.
    const tally = new Map<number, number>();
    const seaTally = new Map<number, number>();
    const idleSites = new Set<string>();
    this.diagnostics.spawnActorReads = 0;
    for (const actor of this.actors) {
      this.diagnostics.spawnActorReads++;
      tally.set(actor.playerId, (tally.get(actor.playerId) ?? 0) + 1);
      if (actor.naval) seaTally.set(actor.playerId, (seaTally.get(actor.playerId) ?? 0) + 1);
      if (actor.state === "loading") idleSites.add(this.siteKey(actor.playerId,actor.naval,actor.originTile));
    }
    this.releaseIdleCouriers(new Map(eligible.map(player => [player.id, player])), seaTally, tally, idleSites);
    for (const player of eligible) {
      const cap = this.actorCap(player), sites = this.markets.get(player.id)?.sites ?? [];
      let count = tally.get(player.id) ?? 0;
      const cursor = this.spawnCursor.get(player.id) ?? 0;
      for (let offset=0; offset<sites.length; offset++) {
        const site = sites[(cursor+offset)%sites.length], key = this.siteKey(player.id,site.naval,site.source.tile);
        if (count >= cap || this.actors.length >= globalCap) break;
        if (site.naval && (seaTally.get(player.id) ?? 0) >= this.seaCap(player)) continue;
        if (!this.modeEnabled(player.id,site.naval) || idleSites.has(key) ||
          site.buildings.reduce((n,b)=>n+(this.supply.goods.get(b.id) ?? 0),0) < this.capacity(site).value) continue;
        const cargo = this.capacity(site),
          origin = site.water ?? site.source.tile,
          actor: TradeActor = {
            id: 0,
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
        // Cheap candidates first; exact reachability still uses the shared bounded planner.
        if (!this.candidates(actor).length) continue;
        actor.id = this.world.allocateId();
        this.actors.push(actor);
        count++;
        if (site.naval) seaTally.set(player.id,(seaTally.get(player.id) ?? 0)+1);
        idleSites.add(key);
        this.spawnCursor.set(player.id,(cursor+offset+1)%sites.length);
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
    this.refreshMarkets();
    if (
      port.playerId !== owner ||
      foreign.playerId === owner ||
      !this.ready(port) ||
      !this.ready(foreign) ||
      !this.permitted(owner, foreign.playerId)
    )
      return null;
    const quantity = Math.min(capacity, this.receiving.available(TradeReceiving.key(foreign.playerId,foreign.tile),
      this.world.tick,true,true,this.diplomacy.allied(owner,foreign.playerId)));
    if (!quantity) return null;
    for (const start of portWaterTiles(this.world.map, port.tile))
      for (const goal of portWaterTiles(this.world.map, foreign.tile)) {
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
            quantity,
            valuePerGood,
            distance: Math.sqrt(
              this.world.map.euclideanDistSquared(port.tile, foreign.tile),
            ),
            foreign: true,
            allied: this.diplomacy.allied(owner, foreign.playerId),
            mapWidth: this.world.map.width(),
            routeTiles: Math.max(0,path.length-1),
            ...this.seaPricing(owner),
          }),
          quantity,
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
  private creditDelivery(player: Player, tile: number, gold: number): void {
    if (gold <= 0) return;
    player.gold += gold;
    this.deliveredGold[player.id] = (this.deliveredGold[player.id] ?? 0) + gold;
    this.receipts.set(`${player.id}:${tile}`, { id: this.nextReceipt++, tick: this.world.tick,
      playerId: player.id, tile, gold });
    this.receiptRevision++;
  }
  step(): void {
    this.blastActorTick = -1;
    if(this.world.tick%20===0)for(const [key,receipt] of this.receipts)
      if(this.world.tick-receipt.tick>=100){this.receipts.delete(key);this.receiptRevision++;}
    const { map, tick } = this.world;
    this.seaActorTick = -1;
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
    this.diagnostics.quotaActorReads = 0;
    if (this.actors.length) {
      const facts = this.world.spatialFacts("trade");
      this.land = facts.groundAlive; this.sea = facts.warshipsAlive;
    }
    for (const a of this.actors) {
      if (this.retired.has(a.id)) continue;
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
        a.state = "prize";
        a.destination = null;
        a.path = [];
      }
      if (a.state === "loading") {
        if (this.modeEnabled(a.playerId,a.naval)) {
          const capacity = this.capacity(site!).value;
          if (site!.buildings.reduce((n,b)=>n+(this.supply.goods.get(b.id) ?? 0),0) >= capacity) {
            if (a.supplyWaitStartedTick !== undefined) {
              a.supplyWaitTicks = (a.supplyWaitTicks ?? 0) + this.world.tick-a.supplyWaitStartedTick;
              a.supplyWaitStartedTick = undefined;
            }
            this.begin(a,true);
          } else a.supplyWaitStartedTick ??= this.world.tick;
        } else { a.supplyWaitStartedTick=undefined; a.supplyWaitTicks=0; }
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
          (this.landBlocked(a.playerId, a.routeOriginOwner ?? a.playerId)(tile) ||
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
          speed = a.naval ? (VESSELS.find(v=>v.id===a.definitionId)?.speed ?? 70) : 50;
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
        const supplyTicks = a.tripSupplyTicks ?? 0;
        const cycleTicks = Math.max(1, this.world.tick - (a.tripStartedTick ?? this.world.tick) + supplyTicks);
        const handlingTicks = 40 + a.visited.length * 20;
        const goldPer1000Ticks = Math.floor((a.tripGold ?? 0) * 1000 / cycleTicks);
        this.cycleQuotes.set(a.id, { completedTick:this.world.tick,marketId:a.visited[0],sourceId:a.factoryId,quantity:a.loaded,delivered:a.delivered,returned:a.cargo,
          guaranteedGold:a.tripGold ?? 0,supplyTicks,handlingTicks,travelTicks:Math.max(0,cycleTicks-handlingTicks-supplyTicks),
          cycleTicks,goldPer1000Ticks,observedRisk:0,riskAdjustedGoldPer1000Ticks:goldPer1000Ticks });
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
      const distance = Math.sqrt(map.euclideanDistSquared(a.originTile, b.tile)),
        foreign = b.playerId !== a.playerId,
        allied =
          foreign &&
          a.quoteAllies.includes(b.playerId) &&
          this.diplomacy.allied(a.playerId, b.playerId);
      const quantity = a.state === "prize" ? a.cargo : this.receiving.take(
        TradeReceiving.key(b.playerId,b.tile), this.world.tick, a.cargo, a.naval, foreign, allied);
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
      a.delivered += quantity;
      a.cargo -= quantity;
      a.tripGold = (a.tripGold ?? 0) + gold;
      a.visited.push(b.id);
      (a.visitedTiles ??= []).push(b.tile);
      this.creditDelivery(player, b.tile, gold);
      // Foreign settlement rewards both participants equally. Prize unloading
      // is salvage, and a domestic delivery must never pay the same owner twice.
      const recipient = foreign && a.state !== "prize" ? players.get(b.playerId) : undefined;
      if (recipient && !recipient.eliminated) this.creditDelivery(recipient, b.tile, gold);
      a.destination = null;
      a.path = [];
      a.waitTicks = 20;
      if (a.state === "prize") this.retired.add(a.id);
      else a.state = a.cargo && a.visitedTiles.length < TRADE_RULES.maximumStops ? "outbound" : "returning";
    }
    if (!this.world.domainRoutes) this.stepPlanning(32);
    this.removeRetired();
  }
  /** One cleanup per phase, rather than an actor-array scan per warhead. */
  removeRetired(): void {
    if (!this.retired.size) return;
    this.blastActorTick = -1;
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
