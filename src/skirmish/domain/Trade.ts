import { ranking, rankStep, type RankingState } from "../RankedWork";
import { limitedRouteRetry } from "../RouteRetryPolicy";
import type { DomainRoutePorts, DomainRouteTask } from "./DomainRoutePorts";
import type { ExactRouteOutcome } from "../RoutePlanner";
import type { GameMap } from "../../core/game/GameMap";
import { tradePayout } from "./TradeQuote";
import { technologyAt } from "../content/Technology";
import { VESSELS } from "../content/Units";
import type { LandPaths, WaterPaths } from "../Pathfinding";
import type { Building, Player, Ship, Squad } from "../Protocol";
import { FIXED } from "../Protocol";
import { SpatialGrid } from "../SpatialGrid";
import { restoreArray, restoreRecord, restoreSet } from "../StateTransfer";
import { AGES, type TradeActor } from "./Definitions";
import type { Diplomacy } from "./Diplomacy";
import type { Fortifications } from "./Fortifications";
import type { Progression } from "./Progression";
import { cargoHandlingPercent, logisticsTier } from "./ResearchEffects";
import type { Roads } from "./Roads";
import type { Supply } from "./Supply";
export interface TradeWorld {
  readonly domainRoutes?: DomainRoutePorts;
  building?(id:number):Building|undefined;
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
// A route that must detour around towers or walls may need a long exact search.
// Past this many expansions the destination is treated as unreachable for now.
const OBSTACLE_SEARCH_LIMIT = 60_000;
// Deterministic routing effort (PathTopology work units, never wall time) the
// trade system may start in one tick. Further loads wait a few ticks.
const LOAD_WORK_BUDGET = 15_000;
interface TradeAdmission {
  id:number;epoch:number;playerId:number;generation:number;revision:string;shipmentId:number;naval:boolean;start:number;
  purpose:"load"|"select";phase:"supply"|"candidates"|"rank"|"routes"|"commit";sourceId:number;
  candidateCursor:number;candidateRows:{id:number;distance:number}[];ranked?:RankingState<{id:number;distance:number}>;
  index:number;waterIndex:number;requested:boolean;outcome?:ExactRouteOutcome;path?:number[];
  best:{id:number;path:number[]}[];targetState:TradeActor["state"];maxStops:number;attempts:number;retryAt:number;
}
interface Routed {
  building: Building;
  path: number[];
}
const byLength = (a: Routed, b: Routed) =>
  a.path.length - b.path.length || a.building.id - b.building.id;

export class Trade {
  private tickStartWork = 0;
  private admissionEpoch=1;
  private building(id:number):Building|undefined{return this.world.building?.(id)??this.world.buildings.find(b=>b.id===id);}
  private readonly admissions=new Map<number,TradeAdmission>();
  private readonly retryHistory=new Map<number,{attempts:number;retryAt:number}>();
  private tradeTask(plan:TradeAdmission,memberId:number,stage:string):DomainRouteTask{return {kind:"domain",owner:"trade",admissionId:plan.id,memberId,stage,playerId:plan.playerId,generation:plan.generation,epoch:plan.epoch};}
  private cancelTrade(id:number):void {
    const plan=this.admissions.get(id);if(!plan)return;
    this.world.domainRoutes!.cancel(this.tradeTask(plan,plan.phase==="supply"?plan.sourceId:(plan.candidateRows[plan.index]?.id??0),plan.phase==="supply"?"supply":"market"));
    this.admissions.delete(id);
  }
  private beginTrade(actor:TradeActor,purpose:"load"|"select"):void {
    const routes=this.world.domainRoutes!,previous=this.admissions.get(actor.id);
    if(previous && previous.playerId===actor.playerId && previous.shipmentId===actor.shipmentId && previous.purpose===purpose)return;
    this.cancelTrade(actor.id);
    const retry=this.retryHistory.get(actor.id);
    if(retry && retry.retryAt>this.world.tick)return;
    if(this.admissions.size>=128){actor.waitTicks=5;return;}
    const source=this.world.buildings.find(b=>b.id===actor.factoryId&&b.playerId===actor.playerId&&!b.remainingTicks&&(b.health??1)>0);
    if(!source && actor.state!=="prize"){this.discardCargo(actor);this.retired.add(actor.id);return;}
    const maxStops=[2,3,4,5,6,8,12][logisticsTier(this.progression.states[actor.playerId].completed)];
    const returning=actor.state!=="prize" && (!actor.cargo || actor.stops.every(id=>actor.visited.includes(id)));
    const targetState=actor.state==="prize"?"prize":purpose==="load"?"outbound":returning?"returning":"outbound";
    const plan:TradeAdmission={id:actor.id,epoch:this.admissionEpoch++,playerId:actor.playerId,generation:routes.generation(actor.playerId),revision:routes.revision(),shipmentId:actor.shipmentId,naval:actor.naval,start:this.tile(actor),purpose,
      phase:purpose==="load"&&actor.naval?"supply":"candidates",sourceId:source?.id??actor.factoryId,candidateCursor:0,candidateRows:[],index:0,waterIndex:0,requested:false,best:[],
      targetState,maxStops:purpose==="load"?Math.min(maxStops,Math.ceil(Math.min(actor.capacity,this.supply.goods.get(actor.factoryId)??0)/10)):1,attempts:retry?.attempts??0,retryAt:0};
    this.admissions.set(actor.id,plan);
  }
  validRoute(task:DomainRouteTask):boolean {
    const plan=this.admissions.get(task.admissionId),actor=this.actors.find(a=>a.id===task.admissionId),routes=this.world.domainRoutes;
    return !!plan && !!actor && !!routes && (task.stage==="check" || (task.stage===(plan.phase==="supply"?"supply":"market") && task.memberId===(plan.phase==="supply"?plan.sourceId:plan.candidateRows[plan.index]?.id))) && task.epoch===plan.epoch && actor.playerId===plan.playerId && actor.shipmentId===plan.shipmentId && actor.naval===plan.naval &&
      routes.generation(plan.playerId)===plan.generation && routes.revision()===plan.revision && this.tile(actor)===plan.start;
  }
  completedRoute(task:DomainRouteTask,outcome:ExactRouteOutcome,path:number[]):void {
    const plan=this.admissions.get(task.admissionId);if(!plan||!this.validRoute(task))return;
    plan.requested=false;plan.outcome=outcome;plan.path=path;
    if(outcome==="limited"){
      const retry=limitedRouteRetry(plan.attempts,this.world.tick,true);plan.attempts=retry.attempts;plan.retryAt=retry.retryAt;
      if(retry.exhausted){this.retryHistory.set(plan.id,{attempts:plan.attempts,retryAt:this.world.tick+200});this.cancelTrade(plan.id);}
    }
  }
  private tradeCandidate(actor:TradeActor,plan:TradeAdmission,b:Building):boolean {
    if(b.remainingTicks || (b.health??1)<=0 || actor.visited.includes(b.id))return false;
    if(plan.purpose==="select" && plan.targetState==="returning")return b.id===(actor.naval?actor.originPortId:actor.factoryId)&&b.playerId===actor.playerId;
    if(plan.purpose==="select" && plan.targetState!=="prize" && !actor.stops.includes(b.id))return false;
    return (actor.naval ? b.type==="port" : b.type==="city" || (plan.targetState!=="prize" && b.type==="port")) &&
      (plan.targetState==="prize"?b.playerId===actor.playerId:!actor.naval || b.playerId!==actor.playerId);
  }
  private queueTradeRoute(plan:TradeAdmission,id:number,start:number,goal:number,water:boolean,stage:string):void {
    if(!plan.requested && plan.retryAt<=this.world.tick)plan.requested=this.world.domainRoutes!.request(this.tradeTask(plan,id,stage),start,goal,water);
  }
  stepPlanning(budget:number):number {
    let used=0,idle=0;
    while(this.admissions.size && used<budget){
      const [id,plan]=this.admissions.entries().next().value!;this.admissions.delete(id);this.admissions.set(id,plan);
      const actor=this.actors.find(a=>a.id===id);
      if(!actor || !this.validRoute(this.tradeTask(plan,0,"check"))){this.cancelTrade(id);used++;continue;}
      if(plan.requested || plan.retryAt>this.world.tick){if(++idle>=this.admissions.size)break;continue;}
      idle=0;used++;
      if(plan.phase==="supply"){
        const source=this.world.buildings.find(b=>b.id===plan.sourceId&&b.playerId===plan.playerId&&!b.remainingTicks);
        const port=this.world.buildings.find(b=>b.id===actor.originPortId&&b.playerId===plan.playerId&&!b.remainingTicks);
        if(!source||!port){this.cancelTrade(id);actor.state="waiting";continue;}
        if(plan.outcome!==undefined){const outcome=plan.outcome;plan.outcome=undefined;plan.path=undefined;if(outcome==="complete")plan.phase="candidates";else if(outcome!=="limited"){this.cancelTrade(id);actor.waitTicks=20;}continue;}
        this.queueTradeRoute(plan,plan.sourceId,source.tile,port.tile,false,"supply");
      }else if(plan.phase==="candidates"){
        const b=this.world.buildings[plan.candidateCursor++];
        if(!b){plan.ranked=ranking(plan.candidateRows);plan.phase="rank";continue;}
        if(!this.tradeCandidate(actor,plan,b))continue;
        const row={id:b.id,distance:this.world.map.euclideanDistSquared(b.tile,plan.start)};
        let at=0;while(at<plan.candidateRows.length && (plan.candidateRows[at].distance<row.distance || plan.candidateRows[at].distance===row.distance&&plan.candidateRows[at].id<row.id))at++;
        if(at<64){plan.candidateRows.splice(at,0,row);if(plan.candidateRows.length>64)plan.candidateRows.pop();}
      }else if(plan.phase==="rank"){
        used+=rankStep(plan.ranked!,(a,b)=>a.distance-b.distance||a.id-b.id,Math.min(16,budget-used));
        if(plan.ranked!.done){plan.candidateRows=plan.ranked!.rows;plan.ranked=undefined;plan.phase="routes";}
      }else if(plan.phase==="routes"){
        const candidate=plan.candidateRows[plan.index],building=candidate&&this.world.buildings.find(b=>b.id===candidate.id);
        if(!candidate){plan.phase="commit";continue;}
        if(!building||!this.tradeCandidate(actor,plan,building)){plan.index++;plan.waterIndex=0;continue;}
        if(plan.outcome!==undefined){
          const outcome=plan.outcome;plan.outcome=undefined;
          if(outcome==="complete"){
            const path=plan.path!;
            if(plan.purpose==="select" || path.length>=2){plan.best.push({id:building.id,path});plan.best.sort((a,b)=>a.path.length-b.path.length||a.id-b.id);plan.best.length=Math.min(plan.best.length,plan.maxStops);}
            plan.path=undefined;plan.index++;plan.waterIndex=0;
          }else if(outcome==="unreachable"){if(plan.naval)plan.waterIndex++;else plan.index++;}
          else if(outcome==="superseded"){this.cancelTrade(id);actor.waitTicks=20;}
          continue;
        }
        if(plan.naval){
          const tile=this.world.map.neighbors(building.tile)[plan.waterIndex];
          if(tile===undefined){plan.index++;plan.waterIndex=0;continue;}
          if(!this.world.waterPaths.connected(plan.start,tile)){plan.waterIndex++;continue;}
          this.queueTradeRoute(plan,building.id,plan.start,tile,true,"market");
        }else this.queueTradeRoute(plan,building.id,plan.start,building.tile,false,"market");
      }else {
        const next=plan.best[0],destination=next&&this.world.buildings.find(b=>b.id===next.id);
        if(!destination || !this.tradeCandidate(actor,plan,destination)){this.cancelTrade(id);actor.waitTicks=20;continue;}
        if(plan.purpose==="load"){
          const source=this.world.buildings.find(b=>b.id===plan.sourceId&&b.playerId===plan.playerId&&!b.remainingTicks&&(b.health??1)>0);
          const goods=source?this.supply.goods.get(source.id)??0:0;
          if(!source || goods<10){this.cancelTrade(id);continue;}
          const port=actor.naval?this.building(actor.originPortId!):undefined;
          if(actor.naval&&(!port||port.type!=="port"||port.playerId!==actor.playerId||port.remainingTicks||(port.health??1)<=0||!this.world.map.neighbors(port.tile).some(t=>this.world.waterPaths.connected(plan.start,t)))){this.cancelTrade(id);actor.state="waiting";continue;}
          const quantity=Math.min(goods,actor.capacity);
          actor.cargo=quantity;actor.loaded=quantity;actor.delivered=0;actor.lost=0;actor.returned=0;
          actor.valuePerGood=50*(AGES.indexOf(source.age??"StoneAge")+1);
          actor.originTile=actor.naval?port!.tile:source.tile;
          actor.shipmentId=this.nextShipment++;actor.visited=[];actor.stops=plan.best.slice(0,Math.min(plan.maxStops,Math.ceil(quantity/10))).map(b=>b.id);
          actor.quoteAllies=this.world.players.filter(p=>p.id!==actor.playerId&&this.diplomacy.allied(actor.playerId,p.id)).map(p=>p.id);
          this.supply.goods.set(source.id,goods-quantity);actor.waitTicks=20;
        }
        actor.destination=destination.id;actor.path=next.path;actor.nextPathIndex=0;actor.state=plan.targetState;
        if(!actor.naval)this.roads?.add(next.path,AGES[logisticsTier(this.progression.states[actor.playerId].completed)]);
        this.retryHistory.delete(id);this.admissions.delete(id);
      }
    }
    return used;
  }

  checkpoint() {
    return structuredClone({
      actors: this.actors,
      deliveredGold: this.deliveredGold,
      capturedValue: this.capturedValue,
      lostValue: this.lostValue,
      nextShipment: this.nextShipment,
      retired: this.retired,
      admissionEpoch:this.admissionEpoch,admissions:[...this.admissions],retryHistory:[...this.retryHistory],
    });
  }
  restore(saved: ReturnType<Trade["checkpoint"]>): void {
    const state = structuredClone(saved);
    restoreArray(this.actors, state.actors);
    restoreRecord(this.deliveredGold, state.deliveredGold);
    restoreRecord(this.capturedValue, state.capturedValue ?? {});
    restoreRecord(this.lostValue, state.lostValue ?? {});
    this.nextShipment = state.nextShipment;
    restoreSet(this.retired, state.retired);
    this.admissions.clear();this.retryHistory.clear();this.admissionEpoch=state.admissionEpoch??1;
    for(const [id,plan] of state.admissions??[])this.admissions.set(id,plan);
    for(const [id,retry] of state.retryHistory??[])this.retryHistory.set(id,retry);
  }

  readonly actors: TradeActor[] = [];
  readonly deliveredGold: Record<number, number> = {};
  readonly capturedValue: Record<number, number> = {};
  readonly lostValue: Record<number, number> = {};

  private discardCargo(actor: TradeActor): void {
    this.lostValue[actor.playerId] =
      (this.lostValue[actor.playerId] ?? 0) + actor.cargo * actor.valuePerGood;
    actor.lost += actor.cargo;
    actor.cargo = 0;
  }
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
  hasForeignMarket(playerId:number, water:number): boolean {
    return this.world.buildings.some(b => b.type === "port" && b.playerId !== playerId && b.playerId !== 0 &&
      !b.remainingTicks && (b.health??1)>0 && this.world.map.neighbors(b.tile).some(t => this.world.waterPaths.connected(water,t)));
  }
  /** Bounded exact quote: null includes exhausted work, not proof of no route. */
  seaQuote(playerId:number, port:Building, foreign:Building, valuePerGood:number, capacity:number) {
    if (port.playerId !== playerId || foreign.playerId === playerId || foreign.type !== "port" ||
      port.remainingTicks || foreign.remainingTicks) return null;
    for (const start of this.world.map.neighbors(port.tile)) for (const end of this.world.map.neighbors(foreign.tile)) {
      if (!this.world.waterPaths.connected(start,end)) continue;
      const path = this.world.waterPaths.find(start,end,undefined,4096);
      if (!path) return null;
      const distance = Math.sqrt(this.world.map.euclideanDistSquared(port.tile,foreign.tile));
      const quantity = Math.min(10,capacity);
      return {portId:port.id,destinationId:foreign.id,waterComponent:this.world.waterPaths.component[start],
        routeTiles:path.length,payout:tradePayout({naval:true,quantity,valuePerGood,distance,foreign:true,
          allied:this.diplomacy.allied(playerId,foreign.playerId)}),quantity};
    }
    return null;
  }
  // Without obstacles the blocked test is always false, so the unobstructed
  // (cacheable) search returns exactly the same route.
  private landPath(
    start: number,
    goal: number,
    owner: number,
  ): number[] | null {
    if (!this.fortifications.hasObstacles)
      return this.world.paths.find(start, goal);
    return this.world.paths.find(
      start,
      goal,
      (tile) => this.fortifications.blocked(tile, owner),
      OBSTACLE_SEARCH_LIMIT,
    );
  }
  private route(actor: TradeActor, destination: Building): number[] | null {
    const { map, waterPaths } = this.world,
      start = this.tile(actor);
    if (!actor.naval)
      return this.landPath(start, destination.tile, actor.playerId);
    for (const tile of map.neighbors(destination.tile))
      if (waterPaths.connected(start, tile)) {
        const path = waterPaths.find(start, tile);
        if (path) return path;
      }
    return null;
  }
  // The 64 nearest eligible stops, ordered by distance then id. Routing is not
  // applied here so callers can route only what they need.
  private candidates(actor: TradeActor, prize: boolean): Building[] {
    const from = this.tile(actor),
      map = this.world.map;
    return this.world.buildings
      .filter(
        (b) =>
          !b.remainingTicks &&
          (actor.naval
            ? b.type === "port"
            : b.type === "city" || (!prize && b.type === "port")) &&
          (prize
            ? b.playerId === actor.playerId
            : !actor.naval || b.playerId !== actor.playerId) &&
          !actor.visited.includes(b.id),
      )
      .map((building) => ({
        building,
        distance: map.euclideanDistSquared(building.tile, from),
      }))
      .sort((a, b) => a.distance - b.distance || a.building.id - b.building.id)
      .slice(0, 64)
      .map(({ building }) => building);
  }
  private destinations(
    actor: TradeActor,
    prize = false,
    only?: readonly number[],
  ): Routed[] {
    return this.candidates(actor, prize)
      .filter((building) => !only || only.includes(building.id))
      .flatMap((building) => {
        const path = this.route(actor, building);
        return path ? [{ building, path }] : [];
      })
      .sort(byLength);
  }
  // The `count` shortest routes with at least `minLength` tiles, evaluated in
  // order of a lower bound (8-connected land paths are never shorter than the
  // Chebyshev distance) so distant candidates are skipped once the best are
  // proven. Identical result to routing every candidate and sorting.
  private shortest(
    actor: TradeActor,
    prize: boolean,
    count: number,
    minLength: number,
  ): { best: Routed[]; known: Routed[] } {
    if (actor.naval) {
      const known = this.destinations(actor, prize);
      return {
        best: known.filter((d) => d.path.length >= minLength).slice(0, count),
        known,
      };
    }
    const map = this.world.map,
      from = this.tile(actor),
      fx = map.x(from),
      fy = map.y(from);
    const ranked = this.candidates(actor, prize)
      .map((building) => ({
        building,
        bound: Math.max(
          Math.abs(map.x(building.tile) - fx),
          Math.abs(map.y(building.tile) - fy),
        ),
      }))
      .sort((a, b) => a.bound - b.bound);
    const known: Routed[] = [],
      best: Routed[] = [];
    for (const { building, bound } of ranked) {
      if (best.length >= count && bound > best[count - 1].path.length) break;
      const path = this.route(actor, building);
      if (!path) continue;
      const routed = { building, path };
      known.push(routed);
      if (path.length >= minLength) {
        best.push(routed);
        best.sort(byLength);
      }
    }
    return { best: best.slice(0, count), known: known.sort(byLength) };
  }
  private select(actor: TradeActor, known?: Routed[]): void {
    if(this.world.domainRoutes){this.beginTrade(actor,"select");return;}
    // Removed or newly captured domestic stops cannot hold a shipment open.
    actor.stops = actor.stops.filter((id) =>
      this.world.buildings.some(
        (b) =>
          b.id === id &&
          !b.remainingTicks &&
          (!actor.naval || b.playerId !== actor.playerId),
      ),
    );
    let next: { building: Building; path: number[] } | undefined;
    if (actor.state === "prize")
      next = this.shortest(actor, true, 1, 0).best[0];
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
        const path = this.landPath(
          this.tile(actor),
          factory.tile,
          actor.playerId,
        );
        if (path) next = { building: factory, path };
      }
      actor.state = "returning";
    } else if (actor.stops.every((id) => actor.visited.includes(id))) {
      const factory = this.world.buildings.find(
        (b) => b.id === actor.factoryId && b.playerId === actor.playerId,
      );
      if (!factory) {
        this.discardCargo(actor);
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
      const candidates = (
        known ?? this.destinations(actor, false, actor.stops)
      ).filter((d) => actor.stops.includes(d.building.id));
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
    if(this.world.domainRoutes){this.beginTrade(actor,"load");return;}
    // Loads route up to 64 candidates. Past the per-tick budget they wait a few
    // ticks (staggered by id) instead of stacking into one long tick.
    if (this.world.paths.work - this.tickStartWork >= LOAD_WORK_BUDGET) {
      actor.waitTicks = 1 + (actor.id % 5);
      return;
    }
    const source = this.world.buildings.find(
      (b) =>
        b.id === actor.factoryId &&
        b.playerId === actor.playerId &&
        !b.remainingTicks,
    );
    if (!source) {
      this.discardCargo(actor);
      this.retired.add(actor.id);
      return;
    }
    if (actor.cargo === 0 && this.world.tick%20===0) this.refreshEmptyMode(actor,source);
    if (actor.naval) {
      const port = this.world.buildings.find(
        (b) =>
          b.id === actor.originPortId &&
          b.playerId === actor.playerId &&
          !b.remainingTicks,
      );
      if (!port || !this.landPath(source.tile, port.tile, actor.playerId)) {
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
    // Quote sea distance from the loading port, never the inland factory.
    actor.originTile = actor.naval
      ? this.world.buildings.find((b) => b.id === actor.originPortId)!.tile
      : source.tile;
    actor.shipmentId = this.nextShipment++;
    actor.visited = [];
    this.supply.goods.set(source.id, goods - actor.cargo);
    const maxStops = [2, 3, 4, 5, 6, 8, 12][
      logisticsTier(this.progression.states[actor.playerId].completed)
    ];
    const { best, known } = this.shortest(
      actor,
      false,
      Math.min(maxStops, Math.ceil(actor.cargo / 10)),
      2,
    );
    actor.stops = best.map((d) => d.building.id);
    actor.quoteAllies = this.world.players
      .filter(
        (p) =>
          p.id !== actor.playerId &&
          this.diplomacy.allied(actor.playerId, p.id),
      )
      .map((p) => p.id);
    actor.waitTicks = 20;
    this.select(actor, known);
  }
  private loadingPort(factory:Building): {port:Building;water:number} | undefined {
    const {map,waterPaths} = this.world;
    const ports = this.world.buildings.filter(b => b.type === "port" && b.playerId === factory.playerId &&
      !b.remainingTicks && (b.health??1)>0 && map.euclideanDistSquared(b.tile,factory.tile)<=400)
      .sort((a,b) => map.euclideanDistSquared(a.tile,factory.tile)-map.euclideanDistSquared(b.tile,factory.tile)||a.id-b.id);
    for (const port of ports.slice(0,8)) {
      const water = map.neighbors(port.tile).find(t => waterPaths.walkable(t) && this.hasForeignMarket(factory.playerId,t));
      if (water !== undefined && (this.world.domainRoutes ? this.world.paths.connected(factory.tile,port.tile) : this.landPath(factory.tile,port.tile,factory.playerId))) return {port,water};
    }
    return undefined;
  }
  private refreshEmptyMode(actor:TradeActor, factory:Building): void {
    // Only the source loading boundary may switch transport. In-flight cargo,
    // captured prizes and shipment accounting remain owned by their lifecycle.
    if (actor.cargo || (actor.state !== "loading" && actor.state !== "waiting") || actor.playerId !== factory.playerId) return;
    const source = actor.naval
      ? this.world.buildings.find(b => b.id === actor.originPortId && b.playerId === actor.playerId && !b.remainingTicks && (b.health ?? 1) > 0)
      : factory;
    // A failed route can leave an empty actor waiting at a remote market.
    // Waiting describes its lifecycle, not proof that it reached the source.
    if (!source || (actor.naval
      ? !this.world.map.neighbors(source.tile).includes(this.tile(actor))
      : this.tile(actor) !== source.tile)) return;
    const research = this.progression.states[actor.playerId].completed;
    const merchant = VESSELS.filter(v => v.kind === "trade" && research.includes(v.technologyId)).slice(-1)[0];
    const origin = merchant && this.loadingPort(factory);
    if (!!origin === actor.naval && (!origin || actor.originPortId === origin.port.id)) return;
    if (!origin && !this.progression.has(actor.playerId,technologyAt("StoneAge","economic",4).id)) return;
    const index = logisticsTier(research), tile = origin ? origin.water : factory.tile;
    actor.naval = !!origin; actor.originPortId = origin?.port.id;
    actor.definitionId = origin ? merchant!.id : `${AGES[index].toLowerCase()}-trader`;
    actor.capacity = Math.floor((origin ? merchant!.capacity : [20,30,40,50,60,80,120][index])*cargoHandlingPercent(research)/100);
    actor.x = (this.world.map.x(tile)+0.5)*FIXED; actor.y = (this.world.map.y(tile)+0.5)*FIXED;
    actor.originTile = origin?.port.tile ?? factory.tile;
    actor.destination = null; actor.path = []; actor.nextPathIndex = 0; actor.stops = []; actor.visited = [];
  }
  step(): void {
    const { map, tick, players, buildings } = this.world;
    this.tickStartWork = this.world.paths.work;
    const rebuildGrids = () => {
      this.land.rebuild(this.world.squads.filter((s) => s.embarkedOn === null));
      this.sea.rebuild(this.world.ships.filter((s) => s.kind === "warship"));
    };
    // Nothing queries these grids without traders; rebuild from the first actor
    // onward (including actors created below this tick).
    const hadActors = this.actors.length > 0;
    if (hadActors) rebuildGrids();
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
        const overland = this.progression.has(
          factory.playerId,
          technologyAt("StoneAge", "economic", 4).id,
        );
        const merchant = VESSELS.filter(
          (v) =>
            v.kind === "trade" &&
            this.progression.has(factory.playerId, v.technologyId),
        ).slice(-1)[0];
        const loading = merchant ? this.loadingPort(factory) : undefined;
        const port = loading?.port, water = loading?.water;
        const naval = water !== undefined,
          origin = naval ? water : factory.tile;
        // Land and water trade have independent research gates. A researched
        // canoe without a reachable port must not silently create a land trader.
        if (!naval && !overland) continue;
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
    if (!hadActors && this.actors.length) rebuildGrids();
    for (const actor of this.actors) {
      const player = players.find((p) => p.id === actor.playerId);
      if (!player || player.eliminated) {
        this.discardCargo(actor);
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
        const value = actor.cargo * actor.valuePerGood;
        this.lostValue[actor.playerId] =
          (this.lostValue[actor.playerId] ?? 0) + value;
        this.capturedValue[captor.playerId] =
          (this.capturedValue[captor.playerId] ?? 0) + value;
        actor.playerId = captor.playerId;
        actor.stops = [];
        actor.visited = [];
        actor.quoteAllies = [];
        actor.state = "prize";
        actor.waitTicks = 20;
        this.select(actor);
        continue;
      }
      if (actor.cargo === 0 && tick % 20 === 0 && actor.state !== "prize") {
        const source = buildings.find(
          (b) =>
            b.id === actor.factoryId &&
            b.playerId === actor.playerId &&
            !b.remainingTicks,
        );
        if (source) this.refreshEmptyMode(actor, source);
      }
      if(this.world.domainRoutes && this.admissions.has(actor.id) && this.admissions.get(actor.id)!.playerId===actor.playerId)continue;
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
          } else this.discardCargo(actor);
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
      // Ownership may change while a ship is travelling. Returning cargo and
      // captured prizes are handled above; domestic water deliveries never pay.
      if (actor.naval && destination.playerId === player.id) {
        this.select(actor);
        continue;
      }
      const quantity = Math.min(10, actor.cargo);
      const foreign = destination.playerId !== player.id,
        allied =
          foreign &&
          actor.quoteAllies.includes(destination.playerId) &&
          this.diplomacy.allied(player.id, destination.playerId);
      const distance = Math.floor(
        Math.sqrt(map.euclideanDistSquared(destination.tile, actor.originTile)),
      );
      // Sea deliveries have no base payout: 1% per tile, capped at 200%.
      // A short round trip cannot repeatedly collect a full-distance reward.
      const gold = tradePayout({naval:actor.naval,quantity,valuePerGood:actor.valuePerGood,distance,foreign,allied});
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
        this.cancelTrade(this.actors[i].id);this.retryHistory.delete(this.actors[i].id);
        this.retired.delete(this.actors[i].id);
        this.actors.splice(i, 1);
      }
  }
}
