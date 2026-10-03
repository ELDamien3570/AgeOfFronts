import { limitedRouteRetry, ROUTE_CAPACITY_REASON } from "../RouteRetryPolicy";
import { CohortAdmission } from "./CohortAdmission";
import type { ShorePlanning } from "./ShorePlanning";
import type { DomainRoutePorts, DomainRouteTask } from "./DomainRoutePorts";
import type { ExactRouteOutcome } from "../RoutePlanner";
import type { GameMap } from "../../core/game/GameMap";
import type { LandPaths } from "../Pathfinding";
import { FIXED, type Order, type Ship, type Squad } from "../Protocol";
import type { WorldPoint } from "../SpatialGrid";
import { pointTile, tilePoint } from "../SquadGeometry";
import { terrainSpeed } from "../Terrain";
import type { VesselDefinition } from "./Definitions";
import type { ShoreLeg, ShoreRoutes } from "./ShoreRoutes";

export interface ShoreTransportWorld {
  readonly domainRoutes?: DomainRoutePorts;
  squad?(id:number):Squad|undefined;
  ship?(id:number):Ship|undefined;
  capacity?(ship:Ship):number;
  boardCandidates?(ship:Ship,members:readonly Squad[]):readonly import("../CoastIndex").Coast[];
  owned?(tile:number,playerId:number):boolean;
  commitBoard?(ship:Ship,meeting:import("../Protocol").BoardingMeeting,seaPath:number[],index:number,members:readonly {squad:Squad;point:WorldPoint;path:number[];index:number}[]):void;
  map: GameMap;
  paths: LandPaths;
  squads: readonly Squad[];
  ships: readonly Ship[];
  updateSquad(id: number, changes: Partial<Omit<Squad, "id">>): Squad | undefined;
  updateShip(id: number, changes: Partial<Omit<Ship, "id">>): Ship | undefined;
  removeShip(id: number): boolean;
  cargo(shipId: number): readonly Squad[];
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
  unloadPrepared?(ship:Ship,members:readonly {squad:Squad;point:WorldPoint}[],tile:number):string|null;
  resume(squad: Squad, tile: number): void;
}
interface PreparedSquad {id:number;point:WorldPoint;path:number[];index:number}
interface BoardAdmission {
 id:number;playerId:number;shipId:number;generation:number;revision:string;fence:string;cargoIds:number[];
 members:{id:number;revision:number}[];phase:"extrema"|"candidates"|"routes"|"connector";cursor:number;
 extrema:(number|undefined)[];candidate:number;score?:number;meeting?:import("../Protocol").BoardingMeeting;
 seaStart:number;requested:boolean;path?:number[];outcome?:ExactRouteOutcome;attempts:number;retryAt:number;connectorCursor:number;cohortId?:number;prepared?:PreparedSquad[];
}
interface TransferAdmission {
  id:number;playerId:number;generation:number;revision:string;destination:number;definition:VesselDefinition;capacity:number;preserveQueue:boolean;
  members:{id:number;revision:number;queued:Order[]}[];cursor:number;
  groups:{ids:number[];leg?:ShoreLeg;shortcut?:{requested:boolean;path?:number[];outcome?:ExactRouteOutcome;cursor:number;part:number;landTicks:number;crossingTicks:number;attempts:number;retryAt:number;done:boolean};cohortId?:number;prepared?:{id:number;point:WorldPoint;path:number[];index:number}[]}[];
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
  ) {
    const domainRoutes=world.domainRoutes;
    if(domainRoutes){
      this.planning=this.routes.createPlanner(domainRoutes,(tile,owner)=>world.blocked(tile,owner));
      this.cohorts=new CohortAdmission("shore",{
        map:world.map,paths:world.paths,squads:()=>world.squads,squad:id=>this.squad(id),routes:domainRoutes,
        blocked:(id,plan)=>tile=>{
          const board=this.boardingGroups.get(plan.id),boarding=board===undefined?undefined:this.pendingBoards.get(board);
          const link=this.cohortGroups.get(plan.id),transfer=link&&this.pendingStarts.get(link.admissionId)?.groups[link.group];
          const water=boarding?.meeting?.waterTile??transfer?.leg?.departure.waterTile;
          return world.blocked(tile,id)||(water!==undefined&&world.map.euclideanDistSquared(tile,water)>9);
        },
        valid:(plan,squad)=>{
          const board=this.boardingGroups.get(plan.id);if(board!==undefined){const admission=this.pendingBoards.get(board);return !!admission && this.boardValid(admission);}
          const landing=this.landingGroups.get(plan.id);
          if(landing){const ship=world.ship?.(landing.shipId)??world.ships.find(s=>s.id===landing.shipId),cargo=ship&&world.cargo(ship.id);return !!ship && ship.health>0&&!ship.refit&&ship.playerId===plan.playerId&&ship.destination===null&&world.map.manhattanDist(pointTile(world.map,ship),landing.tile)===1&&cargo!.length===landing.cargoIds.length&&cargo!.every(s=>landing.cargoIds.includes(s.id))&&cargo!.some(s=>s.id===squad.id);}
          const link=this.cohortGroups.get(plan.id),admission=link&&this.pendingStarts.get(link.admissionId);
          return !!admission && this.validStart(admission);
        },
        commit:(plan,members)=>{
          const board=this.boardingGroups.get(plan.id);if(board!==undefined){const admission=this.pendingBoards.get(board)!;admission.prepared=members.map(m=>({id:m.squad.id,point:m.point,path:m.path,index:m.index}));return;}
          const landing=this.landingGroups.get(plan.id);
          if(landing){
            const ship=world.ships.find(s=>s.id===landing.shipId)!;
            // Physical unloading stays owned by the existing transactional domain command.
            // Supply a fully admitted footprint through the match unload boundary.
            const result=world.unloadPrepared?.(ship,members.map(m=>({squad:m.squad,point:m.point})),landing.tile);
            if(result===null && ship.shoreTransfer){const transfer=ship.shoreTransfer;for(const row of members){world.updateSquad(row.squad.id,{queuedOrders:landing.redirected?[]:transfer.queued.find(q=>q.squadId===row.squad.id)?.orders??[]});world.resume(row.squad,landing.redirected?landing.tile:transfer.destinationTile);}if(!world.cargo(ship.id).length)world.removeShip(ship.id);}
            return result===null;
          }
          const link=this.cohortGroups.get(plan.id)!,admission=this.pendingStarts.get(link.admissionId)!;
          admission.groups[link.group].prepared=members.map(m=>({id:m.squad.id,point:m.point,path:m.path,index:m.index}));
        },
        finished:(plan,status,reason)=>{
          const board=this.boardingGroups.get(plan.id);this.boardingGroups.delete(plan.id);
          if(board!==undefined && status!=="executed"){const admission=this.pendingBoards.get(board);if(admission)this.finishBoard(admission,status,reason);}
          const link=this.cohortGroups.get(plan.id);this.cohortGroups.delete(plan.id);this.landingGroups.delete(plan.id);
          if(link && status!=="executed"){const admission=this.pendingStarts.get(link.admissionId);if(admission)this.finishStart(admission,status,reason);}
        },
        embarked:plan=>this.landingGroups.has(plan.id),
      });
    }
  }
  private readonly pendingBoards=new Map<number,BoardAdmission>();
  private readonly boardingGroups=new Map<number,number>();
  private readonly boardEdges=new Map<number,readonly import("../CoastIndex").Coast[]>();
  private shipFence(ship:Ship):string{return JSON.stringify([ship.playerId,ship.definitionId,ship.destination,ship.waypoints,ship.boarding,ship.attackTargetId,ship.refit?.targetId]);}
  board(playerId:number,ship:Ship,members:Squad[]):string|null {
    const routes=this.world.domainRoutes!;
    if(!this.cohorts || !this.world.boardCandidates || !this.world.commitBoard)return "Boarding admission is unavailable";
    if(this.pendingBoards.size>=128)return "Boarding planning is full";
    const existing=[...this.pendingBoards.values()].find(p=>p.shipId===ship.id);
    if(existing&&existing.members.length===members.length&&existing.members.every(m=>members.some(s=>s.id===m.id))&&this.boardValid(existing))return null;
    const capacity=this.world.capacity!(ship);
    if(this.world.cargo(ship.id).length+members.length>capacity)return `This transport carries up to ${capacity} squads`;
    const selected=new Set(members.map(s=>s.id));
    for(const plan of [...this.pendingBoards.values()])if(plan.shipId===ship.id || plan.members.some(m=>selected.has(m.id)))this.finishBoard(plan,"superseded","Replacement boarding request");
    const candidates=this.world.boardCandidates(ship,members);
    if(!candidates.length)return "No shared reachable coast";
    const id=1_000_000_000+this.nextAdmission++,plan:BoardAdmission={id,playerId,shipId:ship.id,generation:routes.generation(playerId),revision:routes.revision(),fence:this.shipFence(ship),
      cargoIds:this.world.cargo(ship.id).map(s=>s.id),members:members.map(s=>({id:s.id,revision:routes.orderRevision(s.id)})),
      phase:"extrema",cursor:0,extrema:[undefined,undefined,undefined,undefined],candidate:0,seaStart:pointTile(this.world.map,ship),requested:false,attempts:0,retryAt:0,connectorCursor:0};
    this.pendingBoards.set(id,plan);this.boardEdges.set(id,candidates);routes.event("shore",{id,playerId,tick:routes.tick(),status:"deferred"});return null;
  }
  private boardValid(plan:BoardAdmission):boolean{
    const ship=this.world.ship?.(plan.shipId)??this.world.ships.find(s=>s.id===plan.shipId),routes=this.world.domainRoutes!;
    return !!ship && ship.health>0 && !ship.refit && ship.playerId===plan.playerId && this.shipFence(ship)===plan.fence &&
      routes.generation(plan.playerId)===plan.generation && routes.revision()===plan.revision &&
      this.world.cargo(ship.id).map(s=>s.id).join(",")===plan.cargoIds.join(",") &&
      this.world.capacity!(ship)>=plan.cargoIds.length+plan.members.length &&
      plan.members.every(m=>{const squad=this.squad(m.id);return squad && squad.playerId===plan.playerId && squad.troops>0 && !squad.refit && squad.embarkedOn===null && routes.orderRevision(m.id)===m.revision;});
  }
  private boardTask(plan:BoardAdmission):DomainRouteTask{return {kind:"domain",owner:"shore",admissionId:plan.id,memberId:plan.shipId,stage:"boarding-sea",playerId:plan.playerId,generation:plan.generation};}
  private finishBoard(plan:BoardAdmission,status:"executed"|"rejected"|"superseded",reason?:string):void{
    this.pendingBoards.delete(plan.id);this.boardEdges.delete(plan.id);this.world.domainRoutes!.cancel(this.boardTask(plan));
    if(plan.cohortId!==undefined){this.boardingGroups.delete(plan.cohortId);this.cohorts!.cancel(plan.cohortId,reason);}
    this.world.domainRoutes!.event("shore",{id:plan.id,playerId:plan.playerId,tick:this.world.domainRoutes!.tick(),status,reason});
  }
  private stepBoards(budget:number):number{
    let used=0;
    for(const plan of [...this.pendingBoards.values()]){
      if(used>=budget)break;used++;
      if(!this.boardValid(plan)){this.finishBoard(plan,"superseded","Vessel, capacity or selected units changed");continue;}
      const ship=this.world.ship?.(plan.shipId)??this.world.ships.find(s=>s.id===plan.shipId)!;
      const members=plan.members.map(m=>this.squad(m.id)!);
      if(plan.phase==="extrema"){
        const squad=members[plan.cursor++];
        if(!squad){plan.phase="candidates";continue;}
        const tile=pointTile(this.world.map,squad),x=this.world.map.x(tile),y=this.world.map.y(tile),values=[x+y,x-y,-x+y,-x-y];
        values.forEach((n,i)=>plan.extrema[i]=Math.max(plan.extrema[i]??-Infinity,n));
      }else if(plan.phase==="candidates"){
        let edges=this.boardEdges.get(plan.id);if(!edges){edges=this.world.boardCandidates!(ship,members);this.boardEdges.set(plan.id,edges);}
        const edge=edges[plan.candidate++];
        if(!edge){if(!plan.meeting){this.finishBoard(plan,"rejected","No shared reachable coast");continue;}plan.phase="routes";continue;}
        const x=this.world.map.x(edge.landTile),y=this.world.map.y(edge.landTile),e=plan.extrema;
        const score=(this.world.owned!(edge.landTile,plan.playerId)?0:100000)+Math.max(e[0]!-x-y,e[1]!-x+y,e[2]!+x-y,e[3]!+x+y)*70+this.world.map.manhattanDist(plan.seaStart,edge.waterTile)*56;
        if(plan.score===undefined||score<plan.score){plan.score=score;plan.meeting={...edge,squadIds:plan.members.map(m=>m.id)};}
      }else if(plan.phase==="routes"){
        if(plan.outcome!==undefined){
          const outcome=plan.outcome;plan.outcome=undefined;
          if(outcome==="unreachable"||outcome==="superseded"){this.finishBoard(plan,outcome==="unreachable"?"rejected":"superseded","Vessel route unavailable");continue;}
        }
        if(!plan.path){
          if(!plan.requested && plan.retryAt<=this.world.domainRoutes!.tick())plan.requested=this.world.domainRoutes!.request(this.boardTask(plan),plan.seaStart,plan.meeting!.waterTile,true);
          continue;
        }
        if(plan.cohortId===undefined){
          const id=this.cohorts!.start(plan.playerId,members,plan.meeting!.landTile,undefined,3*FIXED);
          if(id===undefined){this.finishBoard(plan,"rejected","Boarding footprint admission is full");continue;}
          plan.cohortId=id;this.boardingGroups.set(id,plan.id);
        }
        if(plan.prepared)plan.phase="connector";
      }else {
        const tile=plan.path![plan.connectorCursor++];
        if(tile!==undefined && this.world.map.manhattanDist(pointTile(this.world.map,ship),tile)>1)continue;
        if(tile===undefined && plan.path!.length){this.finishBoard(plan,"rejected","Vessel moved away from its admitted route");continue;}
        const selected=new Set(plan.members.map(m=>m.id));
        if(plan.prepared!.some(row=>{const squad=this.squad(row.id)!;return !this.world.domainRoutes!.clear(squad,row.path.length?tilePoint(this.world.map,row.path[row.index]):row.point) || !this.world.domainRoutes!.destinationValid(squad,row.point,selected);})){
          this.finishBoard(plan,"rejected","Boarding footprint changed");continue;
        }
        this.world.commitBoard!(ship,plan.meeting!,plan.path!,Math.max(0,plan.connectorCursor-1),plan.prepared!.map(row=>({squad:this.squad(row.id)!,...row})));
        this.finishBoard(plan,"executed");
      }
    }
    return used;
  }
  cancelShip(shipId:number,reason="Vessel order changed"):void{
    for(const plan of [...this.pendingBoards.values()])if(plan.shipId===shipId)this.finishBoard(plan,"superseded",reason);
    for(const [id,landing] of [...this.landingGroups])if(landing.shipId===shipId)this.cohorts?.cancel(id,reason);
  }
  private squad(id:number):Squad|undefined{return this.world.squad?.(id)??this.world.squads.find(s=>s.id===id);}
  private readonly pendingStarts=new Map<number,TransferAdmission>();
  private nextAdmission=1;
  private readonly planning?:ShorePlanning;
  private readonly cohorts?:CohortAdmission;
  private readonly cohortGroups=new Map<number,{admissionId:number;group:number}>();
  private readonly landingGroups=new Map<number,{shipId:number;cargoIds:number[];tile:number;redirected:boolean}>();
  private startDeferred(playerId:number,members:Squad[],destination:number,definition:VesselDefinition,capacity:number,preserveQueue:boolean):string|null {
    const routes=this.world.domainRoutes!;
    if(!Number.isInteger(capacity)||capacity<1||!members.length)return "Invalid transport capacity";
    if(this.pendingStarts.size>=128)return "Transport planning is full";
    const selected=new Set(members.map(s=>s.id));
    for(const plan of [...this.pendingStarts.values()])if(plan.members.some(m=>selected.has(m.id)))this.finishStart(plan,"superseded","Replacement transfer");
    const grouped=new Map<number,number[]>();
    for(const squad of [...members].sort((a,b)=>a.id-b.id)){const component=this.world.paths.component[pointTile(this.world.map,squad)],group=grouped.get(component)??[];group.push(squad.id);grouped.set(component,group);}
    const groups:TransferAdmission["groups"]=[];
    for(const group of grouped.values())for(let i=0;i<group.length;i+=capacity)groups.push({ids:group.slice(i,i+capacity)});
    const id=1_000_000_000+this.nextAdmission++;
    const plan:TransferAdmission={id,playerId,generation:routes.generation(playerId),revision:routes.revision(),destination,definition,capacity,preserveQueue,
      members:members.map(s=>({id:s.id,revision:routes.orderRevision(s.id),queued:preserveQueue?[...s.queuedOrders]:[]})),groups,cursor:0};
    this.pendingStarts.set(id,plan);routes.event("shore",{id,playerId,tick:routes.tick(),status:"deferred"});return null;
  }
  private validStart(plan:TransferAdmission):boolean {
    const routes=this.world.domainRoutes!;
    return routes.generation(plan.playerId)===plan.generation && routes.revision()===plan.revision &&
      plan.members.every(m=>{const s=this.squad(m.id);return s && s.playerId===plan.playerId && s.troops>0 && s.embarkedOn===null && !s.refit && routes.orderRevision(s.id)===m.revision;});
  }
  private finishStart(plan:TransferAdmission,status:"executed"|"rejected"|"superseded",reason?:string):void {
    this.world.domainRoutes!.cancel(this.shortcutTask(plan));
    this.pendingStarts.delete(plan.id);
    plan.groups.forEach((group,i)=>{this.planning!.release(`transfer:${plan.id}:${i}`);if(group.cohortId!==undefined){this.cohortGroups.delete(group.cohortId);this.cohorts!.cancel(group.cohortId,reason);}});
    this.world.domainRoutes!.event("shore",{id:plan.id,playerId:plan.playerId,tick:this.world.domainRoutes!.tick(),status,reason});
  }
  private shortcutTask(plan:TransferAdmission):DomainRouteTask{return {kind:"domain",owner:"shore",admissionId:plan.id,memberId:plan.cursor,stage:"shortcut",playerId:plan.playerId,generation:plan.generation};}
  validRoute(task:DomainRouteTask):boolean {if(task.stage==="shortcut"){const plan=this.pendingStarts.get(task.admissionId);return !!plan&&plan.cursor===task.memberId&&this.validStart(plan);}if(task.stage==="boarding-sea"){const plan=this.pendingBoards.get(task.admissionId);return !!plan&&this.boardValid(plan);}return task.stage.startsWith("crossing:") ? this.planning?.validRoute(task)??false : this.cohorts?.validRoute(task)??false;}
  completedRoute(task:DomainRouteTask,outcome:ExactRouteOutcome,path:number[]):void {
    if(task.stage==="shortcut"){const plan=this.pendingStarts.get(task.admissionId),quote=plan?.groups[task.memberId]?.shortcut;if(!plan||!quote||!this.validRoute(task))return;quote.requested=false;quote.outcome=outcome;if(outcome==="complete")quote.path=path;else if(outcome==="limited"){const retry=limitedRouteRetry(quote.attempts,this.world.domainRoutes!.tick(),true);quote.attempts=retry.attempts;quote.retryAt=retry.retryAt;if(retry.exhausted)this.finishStart(plan,"rejected",ROUTE_CAPACITY_REASON);}return;}
    if(task.stage==="boarding-sea"){const plan=this.pendingBoards.get(task.admissionId);if(!plan)return;plan.requested=false;plan.outcome=outcome;if(outcome==="complete")plan.path=path;else if(outcome==="limited"){const retry=limitedRouteRetry(plan.attempts,this.world.domainRoutes!.tick(),true);plan.attempts=retry.attempts;plan.retryAt=retry.retryAt;if(retry.exhausted)this.finishBoard(plan,"rejected",ROUTE_CAPACITY_REASON);}return;}
    if(task.stage.startsWith("crossing:"))this.planning?.completedRoute(task,outcome,path);
    else this.cohorts?.completedRoute(task,outcome,path);
  }
  stepPlanning(budget:number):number {
    if(!this.planning || !this.cohorts)return 0;
    let used=this.planning.step(Math.min(8,budget));
    used+=this.stepBoards(Math.min(8,budget-used));
    for(const plan of [...this.pendingStarts.values()]){
      if(used>=budget)break;used++;
      if(!this.validStart(plan)){this.finishStart(plan,"superseded","Units or transport permission changed");continue;}
      const group=plan.groups[plan.cursor];
      if(!group){this.commitStart(plan);continue;}
      if(group.prepared){plan.cursor++;continue;}
      if(group.cohortId!==undefined)continue;
      const members=group.ids.map(id=>this.squad(id)!);
      let leg:ShoreLeg|undefined;
      const origin=pointTile(this.world.map,members[0]),connected=this.world.paths.connected(origin,plan.destination);
      // A shortcut is quoted by the resumable shore planner, never by the
      // synchronous legacy coastline search inside this bounded work slice.
      {
        const result=this.planning.request(`transfer:${plan.id}:${plan.cursor}`,plan.playerId,pointTile(this.world.map,members[0]),plan.destination);
        if(result.status==="pending")continue;
        if(result.status!=="complete"){
          if(!connected||result.status==="superseded"){this.finishStart(plan,result.status==="superseded"?"superseded":"rejected",result.reason??"No reachable water crossing");continue;}
        }else leg=result.leg;
      }
      if(connected&&leg){
        const quote=group.shortcut??={requested:false,cursor:0,part:0,landTicks:0,crossingTicks:leg.waterPath.length*FIXED/plan.definition.speed+20,attempts:0,retryAt:0,done:false};
        if(!quote.done){
          if(!quote.path){
            if(quote.outcome==="unreachable"){quote.done=true;}
            else if(quote.outcome==="superseded"){this.finishStart(plan,"superseded","Shortcut facts changed");continue;}
            else{quote.outcome=undefined;if(!quote.requested&&quote.retryAt<=this.world.domainRoutes!.tick())quote.requested=this.world.domainRoutes!.request(this.shortcutTask(plan),origin,plan.destination);continue;}
          }
          if(!quote.done){
            const paths=[quote.path!,leg.approachPath??[],leg.arrivalPath??[]],path=paths[quote.part],tile=path[quote.cursor++];
            if(tile!==undefined){if(quote.part===0)quote.landTicks+=FIXED/terrainSpeed(this.world.map,tile);else quote.crossingTicks+=FIXED/terrainSpeed(this.world.map,tile);continue;}
            quote.cursor=0;if(++quote.part<3)continue;quote.done=true;
          }
        }
        if(quote.path&&quote.crossingTicks>=quote.landTicks)leg=undefined;
      }
      group.leg=leg;
      const shore=leg?.departure.landTile??plan.destination;
      const extra=new Map<number,Order[]>();
      for(const prior of plan.groups)for(const row of prior.prepared??[])extra.set(row.id,[{type:"move",tile:pointTile(this.world.map,row.point),...row.point}]);
      const id=this.cohorts.start(plan.playerId,members,shore,undefined,leg?3*FIXED:Infinity,extra);
      if(id===undefined){this.finishStart(plan,"rejected","Shore staging admission is full");continue;}
      group.cohortId=id;this.cohortGroups.set(id,{admissionId:plan.id,group:plan.cursor});
    }
    return used+this.cohorts.step(budget-used);
  }
  private commitStart(plan:TransferAdmission):void {
    const routes=this.world.domainRoutes!,selected=new Set(plan.members.map(m=>m.id));
    const rows=plan.groups.flatMap(g=>g.prepared??[]);
    if(!this.validStart(plan) || rows.some(row=>{
      const squad=this.squad(row.id)!;
      const point=row.path.length?tilePoint(this.world.map,row.path[row.index]):row.point;
      return !routes.clear(squad,point)||!routes.destinationValid(squad,row.point,selected);
    })){this.finishStart(plan,"rejected","Departure changed while staging");return;}
    for(const group of plan.groups){
      const ship=group.leg?this.world.launch(plan.playerId,plan.definition,group.leg.departure.waterTile):undefined;
      if(ship)this.world.updateShip(ship.id,{shoreTransfer:{destinationTile:plan.destination,landingTile:group.leg!.arrival.landTile,
        waterPath:group.leg!.waterPath,capacity:plan.capacity,phase:"boarding",queued:group.ids.map(id=>({squadId:id,orders:plan.members.find(m=>m.id===id)!.queued}))},
        boarding:{...group.leg!.departure,squadIds:group.ids}});
      for(const row of group.prepared!){
        const squad=this.squad(row.id)!;
        this.world.updateSquad(squad.id,{queuedOrders:[],charge:null,structureTarget:null});
        this.world.activate(squad,ship?{type:"board",shipId:ship.id,tile:pointTile(this.world.map,row.point)}:{type:"move",tile:pointTile(this.world.map,row.point),...row.point},row.path);
        this.world.updateSquad(squad.id,{nextPathIndex:row.index});
      }
    }
    this.finishStart(plan,"executed");
  }
  private landDeferred(ship:Ship,tile:number,redirected:boolean):string|null {
    const existing=[...this.landingGroups].find(([,g])=>g.shipId===ship.id);
    if(existing){if(existing[1].tile===tile&&existing[1].redirected===redirected)return null;this.cohorts!.cancel(existing[0],"Replacement landing");}
    const cargo=[...this.world.cargo(ship.id)];
    if(!cargo.length)return "No cargo to land";
    const id=this.cohorts!.start(ship.playerId,cargo,tile,undefined,3*FIXED);
    if(id===undefined)return "Landing planning is full";
    this.landingGroups.set(id,{shipId:ship.id,cargoIds:cargo.map(s=>s.id),tile,redirected});
    return null;
  }
  checkpoint(){return structuredClone({boards:[...this.pendingBoards],boardingGroups:[...this.boardingGroups],pending:[...this.pendingStarts],nextAdmission:this.nextAdmission,cohorts:this.cohorts?.checkpoint(),crossings:this.planning?.checkpoint(),cohortGroups:[...this.cohortGroups],landingGroups:[...this.landingGroups]});}
  restore(saved?:ReturnType<ShoreTransport["checkpoint"]>):void{
    this.pendingBoards.clear();this.boardingGroups.clear();this.boardEdges.clear();
    for(const [id,plan] of structuredClone(saved?.boards??[]))this.pendingBoards.set(id,plan);
    for(const [id,link] of saved?.boardingGroups??[])this.boardingGroups.set(id,link);
    this.pendingStarts.clear();this.cohortGroups.clear();this.landingGroups.clear();this.nextAdmission=saved?.nextAdmission??1;
    if(saved && saved.pending.length>128)throw new Error("Transfer checkpoint exceeds envelope");
    for(const [id,plan] of structuredClone(saved?.pending??[]))this.pendingStarts.set(id,plan);
    for(const [id,link] of saved?.cohortGroups??[])this.cohortGroups.set(id,structuredClone(link));
    for(const [id,link] of saved?.landingGroups??[])this.landingGroups.set(id,structuredClone(link));
    this.planning?.restore(saved?.crossings);this.cohorts?.restore(saved?.cohorts);
  }

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
    if(w.domainRoutes)return (this.planning?.hasCoast(origin)??false)&&w.map.manhattanDist(origin,destination)>=24;
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
    if(this.world.domainRoutes)return this.startDeferred(playerId,members,destination,definition,capacity,preserveQueue);
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
        w.updateShip(ship.id, {
          shoreTransfer: {
            destinationTile: destination,
            landingTile: plan.leg!.arrival.landTile,
            waterPath: plan.leg!.waterPath,
            capacity,
            phase: "boarding",
            queued: plan.members.map(s => ({ squadId: s.id, orders: preserveQueue ? [...s.queuedOrders] : [] })),
          },
          boarding: { ...plan.leg!.departure, squadIds: plan.members.map(s => s.id) },
        });
      }
      plan.members.forEach((s, index) => {
        w.updateSquad(s.id, { queuedOrders: [], charge: null, structureTarget: null });
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
    if(this.cohorts && this.world.unloadPrepared)return this.landDeferred(ship,tile,redirected);
    const w = this.world;
    let transfer = ship.shoreTransfer!;
    const cargo = w.cargo(ship.id);
    const result = w.unload(ship, tile);
    if (result !== null) return result;
    if (redirected) {
      w.updateShip(ship.id, { shoreTransfer: { ...transfer, landingTile: tile, destinationTile: tile, queued: [] } });
      transfer = ship.shoreTransfer!;
    }
    for (const squad of cargo) {
      if (squad.embarkedOn === ship.id) continue;
      w.updateSquad(squad.id, { queuedOrders: redirected
        ? [] : (transfer.queued.find(q => q.squadId === squad.id)?.orders ?? []) });
      w.resume(squad, transfer.destinationTile);
    }
    if (!w.cargo(ship.id).length) w.removeShip(ship.id);
    return null;
  }

  step(): void {
    const w = this.world;
    for (const ship of [...w.ships]) {
      let transfer = ship.shoreTransfer;
      if (!transfer) continue;
      const cargo = w.cargo(ship.id);
      if (transfer.phase !== "boarding" && !cargo.length) {
        w.removeShip(ship.id);
        continue;
      }
      if (transfer.phase === "boarding" && !ship.boarding) {
        if (!cargo.length) {
          w.removeShip(ship.id);
          continue;
        }
        const end = transfer.waterPath[transfer.waterPath.length - 1] ?? pointTile(w.map, ship);
        w.updateShip(ship.id, { shoreTransfer: { ...transfer, phase: "sailing" },
          destination: end, path: [pointTile(w.map, ship), ...transfer.waterPath], nextPathIndex: 0 });
        transfer = ship.shoreTransfer!;
      }
      if (transfer.phase === "sailing" && ship.destination === null) {
        w.updateShip(ship.id, { shoreTransfer: { ...transfer, phase: "landing" } });
        transfer = ship.shoreTransfer!;
      }
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
