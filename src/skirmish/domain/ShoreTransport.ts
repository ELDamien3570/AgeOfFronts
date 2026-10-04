import { limitedRouteRetry, ROUTE_CAPACITY_REASON } from "../RouteRetryPolicy";
import { CohortAdmission } from "./CohortAdmission";
import type { ShorePlanning } from "./ShorePlanning";
import type { DomainRoutePorts, DomainRouteTask } from "./DomainRoutePorts";
import type { ExactRouteOutcome } from "../RoutePlanner";
import type { MovementAdmissionEvent } from "../MovementAdmission";
import type { Coast } from "../CoastIndex";
import type { GameMap } from "../../core/game/GameMap";
import type { LandPaths } from "../Pathfinding";
import { FIXED, type Order, type Ship, type Squad } from "../Protocol";
import type { WorldPoint } from "../SpatialGrid";
import { pointTile, tilePoint } from "../SquadGeometry";
import { terrainSpeed } from "../Terrain";
import type { VesselDefinition } from "./Definitions";
import type { ShoreLeg, ShoreRoutes } from "./ShoreRoutes";

export interface ShoreTransportWorld {
  continueByLand?(playerId:number,members:Squad[],destination:number,preserveQueue:boolean):void;
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
  landingAllowed?(playerId:number,tile:number):boolean;
  sailForLanding(ship:Ship,tile:number):{rejection:string|null;admissionId?:number};
  sailingPending(ship:Ship):boolean;
}
interface LandingVoyage {
  id:number;playerId:number;shipId:number;origin:number;destination:number;cargoIds:number[];
  generation?:number;append:boolean;phase:"coast"|"voyage"|"sailing";
  coast?:Coast;waterAdmissionId?:number;
}
interface PreparedSquad {id:number;point:WorldPoint;path:number[];index:number}
interface BoardAdmission {
 id:number;playerId:number;shipId:number;generation:number;revision:string;fence:string;cargoIds:number[];
 members:{id:number;revision:number}[];phase:"extrema"|"candidates"|"routes"|"connector";cursor:number;
 extrema:(number|undefined)[];candidate:number;score?:number;meeting?:import("../Protocol").BoardingMeeting;
 seaStart:number;requested:boolean;path?:number[];outcome?:ExactRouteOutcome;attempts:number;retryAt:number;connectorCursor:number;cohortId?:number;prepared?:PreparedSquad[];
}
interface TransferAdmission {
  startedTick?:number;
  id:number;playerId:number;generation:number;revision:string;destination:number;definition:VesselDefinition;capacity:number;preserveQueue:boolean;
  members:{id:number;revision:number;queued:Order[];committed?:boolean}[];cursor:number;
  groups:{ids:number[];crossingOrigin?:number;committed?:boolean;leg?:ShoreLeg;shortcut?:{requested:boolean;path?:number[];outcome?:ExactRouteOutcome;cursor:number;part:number;landTicks:number;crossingTicks:number;attempts:number;retryAt:number;done:boolean};cohortId?:number;prepared?:{id:number;point:WorldPoint;path:number[];index:number}[]}[];
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
            if(result===null){
              const transfer=ship.shoreTransfer;
              for(const row of members){
                if(transfer)world.updateSquad(row.squad.id,{queuedOrders:landing.redirected?[]:transfer.queued.find(q=>q.squadId===row.squad.id)?.orders??[]});
                const destination=landing.destination??(transfer ? landing.redirected?landing.tile:transfer.destinationTile : undefined);
                if(destination!==undefined)world.resume(row.squad,destination);
              }
              if(!world.cargo(ship.id).length){this.cancelVoyage(ship.id);if(transfer)world.removeShip(ship.id);}
            }
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
    const id=1_000_000_000+this.nextAdmission++,plan:BoardAdmission={id,playerId,shipId:ship.id,generation:routes.generation(playerId),revision:routes.revision(playerId, "shore"),fence:this.shipFence(ship),
      cargoIds:this.world.cargo(ship.id).map(s=>s.id),members:members.map(s=>({id:s.id,revision:routes.orderRevision(s.id)})),
      phase:"extrema",cursor:0,extrema:[undefined,undefined,undefined,undefined],candidate:0,seaStart:pointTile(this.world.map,ship),requested:false,attempts:0,retryAt:0,connectorCursor:0};
    this.pendingBoards.set(id,plan);this.boardEdges.set(id,candidates);routes.event("shore",{id,playerId,tick:routes.tick(),status:"deferred"});return null;
  }
  private boardValid(plan:BoardAdmission):boolean{
    const ship=this.world.ship?.(plan.shipId)??this.world.ships.find(s=>s.id===plan.shipId),routes=this.world.domainRoutes!;
    return !!ship && ship.health>0 && !ship.refit && ship.playerId===plan.playerId && this.shipFence(ship)===plan.fence &&
      routes.generation(plan.playerId)===plan.generation && routes.revision(plan.playerId, "shore")===plan.revision &&
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
  private stepBoards(budget:number,interactive=false):number{
    let used=0;
    for(const plan of [...this.pendingBoards.values()]){
      if(interactive&&!this.world.domainRoutes?.priority?.(plan.playerId))continue;
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
    this.cancelVoyage(shipId,reason);
    for(const plan of [...this.pendingBoards.values()])if(plan.shipId===shipId)this.finishBoard(plan,"superseded",reason);
    for(const [id,landing] of [...this.landingGroups])if(landing.shipId===shipId)this.cohorts?.cancel(id,reason);
  }
  private squad(id:number):Squad|undefined{return this.world.squad?.(id)??this.world.squads.find(s=>s.id===id);}
  private readonly pendingStarts=new Map<number,TransferAdmission>();
  private nextAdmission=1;
  private readonly planning?:ShorePlanning;
  private readonly cohorts?:CohortAdmission;
  private readonly cohortGroups=new Map<number,{admissionId:number;group:number}>();
  private readonly landingGroups=new Map<number,{shipId:number;cargoIds:number[];tile:number;redirected:boolean;destination?:number}>();
  private readonly landingVoyages=new Map<number,LandingVoyage>();
  /** A land click is an itinerary; the water and footprint owners still admit each leg. */
  moveToLand(ships:readonly Ship[],destination:number,append:boolean):string|null {
    const w=this.world;
    if(!w.paths.walkable(destination))return "Choose passable land for the troops";
    if(ships.some(s=>s.kind!=="transport" || s.boarding!==null || !w.cargo(s.id).length))return "Choose a loaded transport to land troops";
    if(ships.some(s=>!this.routes.canLand(pointTile(w.map,s),destination)))return "No reachable coastline leads to that land";
    if(this.landingVoyages.size+ships.filter(s=>!this.landingVoyages.has(s.id)).length>128)return "Landing planning is full";
    const coasts=this.planning?undefined:ships.map(s=>this.routes.nearestLanding(pointTile(w.map,s),destination,t=>w.blocked(t,s.playerId)));
    if(coasts?.some(c=>!c))return "No reachable coastline leads to that land";
    for(const [index,ship] of ships.entries()){
      this.cancelShip(ship.id,"Replacement landing order");
      const plan:LandingVoyage={id:1_000_000_000+this.nextAdmission++,playerId:ship.playerId,shipId:ship.id,
        origin:pointTile(w.map,ship),destination,cargoIds:w.cargo(ship.id).map(s=>s.id),generation:w.domainRoutes?.generation(ship.playerId),
        append,phase:"coast",coast:coasts?.[index]};
      this.landingVoyages.set(ship.id,plan);
      w.domainRoutes?.event("shore",{id:plan.id,playerId:plan.playerId,tick:w.domainRoutes.tick(),status:"deferred"});
      // Suppress the previous automatic landing while its replacement is planned.
      if(ship.shoreTransfer)w.updateShip(ship.id,{shoreTransfer:{...ship.shoreTransfer,phase:"afloat"}});
    }
    return null;
  }
  cancelVoyage(shipId:number,reason="Vessel order changed"):void {
    const plan=this.landingVoyages.get(shipId);if(!plan)return;
    this.finishVoyage(plan,"superseded",reason);
  }
  private finishVoyage(plan:LandingVoyage,status:"executed"|"rejected"|"superseded",reason?:string):void {
    this.planning?.release(`landing:${plan.id}`);
    this.landingVoyages.delete(plan.shipId);
    if(plan.phase!=="sailing")this.world.domainRoutes?.event("shore",{id:plan.id,playerId:plan.playerId,tick:this.world.domainRoutes.tick(),status,reason});
  }
  observeSailing(event:MovementAdmissionEvent):void {
    if(event.status!=="rejected"&&event.status!=="superseded")return;
    for(const plan of this.landingVoyages.values())if(plan.waterAdmissionId===event.id)this.finishVoyage(plan,event.status,event.reason);
  }
  voyageCommitted(ship:Ship,tile:number):void {
    const plan=this.landingVoyages.get(ship.id);
    if(!plan || plan.phase!=="voyage" || plan.coast?.waterTile!==tile)return;
    this.planning?.release(`landing:${plan.id}`);
    if(ship.shoreTransfer)this.world.updateShip(ship.id,{shoreTransfer:{...ship.shoreTransfer,
      phase:"sailing",landingTile:plan.coast.landTile,destinationTile:plan.destination,waterPath:[...ship.path],queued:[],returning:undefined}});
    this.world.domainRoutes?.event("shore",{id:plan.id,playerId:plan.playerId,tick:this.world.domainRoutes.tick(),status:"executed"});
    plan.phase="sailing";
    if(ship.shoreTransfer)this.landingVoyages.delete(ship.id);
  }
  private stepLandingVoyages(budget:number,interactive=false):number {
    let used=0;const w=this.world;
    for(const plan of [...this.landingVoyages.values()]){
      if(interactive&&!this.world.domainRoutes?.priority?.(plan.playerId))continue;
      if(used>=budget)break;used++;
      // Rotate for fairness when many loaded vessels request landing together.
      this.landingVoyages.delete(plan.shipId);this.landingVoyages.set(plan.shipId,plan);
      const ship=w.ship?.(plan.shipId)??w.ships.find(s=>s.id===plan.shipId);
      const cargo=ship&&w.cargo(ship.id);
      if(!ship || ship.health<=0 || ship.refit || ship.playerId!==plan.playerId ||
        (plan.phase!=="sailing"&&w.domainRoutes?.generation(plan.playerId)!==plan.generation) ||
        cargo!.length!==plan.cargoIds.length || !cargo!.every(s=>plan.cargoIds.includes(s.id))){
        this.finishVoyage(plan,"superseded","Transport or cargo changed");continue;
      }
      if(plan.phase==="sailing"){
        if(ship.destination===null && pointTile(w.map,ship)===plan.coast!.waterTile)this.land(ship,plan.coast!.landTile,false,plan.destination);
        continue;
      }
      if(plan.phase==="voyage" || (plan.append&&(ship.destination!==null||ship.waypoints.length||w.sailingPending(ship))))continue;
      if(!plan.coast){
        const result=this.planning!.request(`landing:${plan.id}`,plan.playerId,plan.origin,plan.destination);
        if(result.status==="pending")continue;
        if(result.status!=="complete" || !result.landing){this.finishVoyage(plan,result.status==="superseded"?"superseded":"rejected",result.reason??"No reachable coastline leads to that land");continue;}
        plan.coast=result.landing;
      }
      plan.phase="voyage";
      const result=w.sailForLanding(ship,plan.coast.waterTile);
      if(result.rejection!==null)this.finishVoyage(plan,"rejected",result.rejection);
      else plan.waterAdmissionId=result.admissionId;
    }
    return used;
  }
  pending(squadId: number): boolean {
    return [...this.pendingStarts.values()].some(p => p.members.some(m => m.id === squadId)) ||
      [...this.pendingBoards.values()].some(p => p.members.some(m => m.id === squadId));
  }
  private startDeferred(playerId:number,members:Squad[],destination:number,definition:VesselDefinition,capacity:number,preserveQueue:boolean):string|null {
    const routes=this.world.domainRoutes!;
    if(!Number.isInteger(capacity)||capacity<1||!members.length)return "Invalid transport capacity";
    const selected=new Set(members.map(s=>s.id));
    const existing=[...this.pendingStarts.values()].find(p=>p.playerId===playerId && p.destination===destination &&
      p.definition.id===definition.id && p.capacity===capacity && p.preserveQueue===preserveQueue &&
      p.members.length===selected.size && p.members.every(m=>selected.has(m.id)) && this.validStart(p));
    if(existing){routes.event("shore",{id:existing.id,playerId,tick:routes.tick(),status:"deferred"});return null;}
    if(this.pendingStarts.size>=128)return "Transport planning is full";
    for(const plan of [...this.pendingStarts.values()])if(plan.members.some(m=>selected.has(m.id)))this.finishStart(plan,"superseded","Replacement transfer");
    const grouped=new Map<number,number[]>();
    for(const squad of [...members].sort((a,b)=>a.id-b.id)){const component=this.world.paths.component[pointTile(this.world.map,squad)],group=grouped.get(component)??[];group.push(squad.id);grouped.set(component,group);}
    const groups:TransferAdmission["groups"]=[];
    for(const group of grouped.values()) {
      const crossingOrigin=pointTile(this.world.map,this.squad(group[0])!);
      for(let i=0;i<group.length;i+=capacity)groups.push({ids:group.slice(i,i+capacity),crossingOrigin});
    }
    const id=1_000_000_000+this.nextAdmission++;
    const plan:TransferAdmission={id,playerId,startedTick:routes.tick(),generation:routes.generation(playerId),revision:routes.revision(playerId, "shore"),destination,definition,capacity,preserveQueue,
      members:members.map(s=>({id:s.id,revision:routes.orderRevision(s.id),queued:preserveQueue?[...s.queuedOrders]:[]})),groups,cursor:0};
    this.pendingStarts.set(id,plan);routes.event("shore",{id,playerId,tick:routes.tick(),status:"deferred"});return null;
  }
  private validStart(plan:TransferAdmission):boolean {
    const routes=this.world.domainRoutes!;
    return routes.generation(plan.playerId)===plan.generation && routes.revision(plan.playerId, "shore")===plan.revision &&
      plan.members.every(m=>{if(m.committed)return true;const s=this.squad(m.id);return s && s.playerId===plan.playerId && s.troops>0 && s.embarkedOn===null && !s.refit && routes.orderRevision(s.id)===m.revision;});
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
    if(task.stage==="shortcut"){const plan=this.pendingStarts.get(task.admissionId),quote=plan?.groups[task.memberId]?.shortcut;if(!plan||!quote||!this.validRoute(task))return;quote.requested=false;quote.outcome=outcome;if(outcome==="superseded"){quote.outcome=undefined;quote.retryAt=this.world.domainRoutes!.tick()+1;}else if(outcome==="complete")quote.path=path;else if(outcome==="limited"){const retry=limitedRouteRetry(quote.attempts,this.world.domainRoutes!.tick(),true);quote.attempts=retry.attempts;quote.retryAt=retry.retryAt;if(retry.exhausted)this.finishStart(plan,"rejected",ROUTE_CAPACITY_REASON);}return;}
    if(task.stage==="boarding-sea"){const plan=this.pendingBoards.get(task.admissionId);if(!plan)return;plan.requested=false;plan.outcome=outcome;if(outcome==="superseded"&&this.boardValid(plan)){plan.outcome=undefined;plan.retryAt=this.world.domainRoutes!.tick()+1;}else if(outcome==="complete")plan.path=path;else if(outcome==="limited"){const retry=limitedRouteRetry(plan.attempts,this.world.domainRoutes!.tick(),true);plan.attempts=retry.attempts;plan.retryAt=retry.retryAt;if(retry.exhausted)this.finishBoard(plan,"rejected",ROUTE_CAPACITY_REASON);}return;}
    if(task.stage.startsWith("crossing:"))this.planning?.completedRoute(task,outcome,path);
    else this.cohorts?.completedRoute(task,outcome,path);
  }
  stepInteractive(budget:number):number {
    const priority=this.world.domainRoutes?.priority;
    if(!priority||(![...this.pendingStarts.values(),...this.pendingBoards.values(),...this.landingVoyages.values()].some(p=>priority(p.playerId))&&
      ![...this.landingGroups.values()].some(p=>priority(this.world.ship?.(p.shipId)?.playerId??0))))return 0;
    return this.stepPlanning(budget,true);
  }
  stepPlanning(budget:number,interactive=false):number {
    if(!this.planning || !this.cohorts)return 0;
    // Each stage gets a slice even when another stage has a full backlog.
    // In particular, boarding must never consume the landing/staging budget.
    const slice=Math.floor(budget/5);
    let used=this.planning.step(slice,interactive);
    used+=this.stepBoards(slice,interactive);
    used+=this.stepLandingVoyages(slice,interactive);
    const startsEnd=used+slice;
    for(const plan of [...this.pendingStarts.values()]){
      if(interactive&&!this.world.domainRoutes!.priority?.(plan.playerId))continue;
      if(used>=startsEnd)break;used++;
      this.pendingStarts.delete(plan.id);this.pendingStarts.set(plan.id,plan);
      if(!this.validStart(plan)){this.finishStart(plan,"superseded","Units or transport permission changed");continue;}
      // An optional shortcut may not monopolize an otherwise legal land order.
      // Only hand off before any group stages/commits, preserving one itinerary.
      if(this.world.continueByLand && this.world.domainRoutes!.tick()-(plan.startedTick??this.world.domainRoutes!.tick())>=12 &&
        plan.groups.every(g=>g.cohortId===undefined) &&
        plan.members.every(m=>this.world.paths.connected(pointTile(this.world.map,this.squad(m.id)!),plan.destination))) {
        const members=plan.members.map(m=>this.squad(m.id)!);
        this.finishStart(plan,"executed");
        this.world.continueByLand(plan.playerId,members,plan.destination,plan.preserveQueue);
        continue;
      }
      const group=plan.groups[plan.cursor];
      if(!group){this.finishStart(plan,"executed");continue;}
      if(group.prepared){if(!group.committed&&!this.commitGroup(plan,group))continue;plan.cursor++;continue;}
      if(group.cohortId!==undefined)continue;
      const members=group.ids.map(id=>this.squad(id)!);
      let leg:ShoreLeg|undefined;
      const origin=pointTile(this.world.map,members[0]),connected=this.world.paths.connected(origin,plan.destination);
      // A shortcut is quoted by the resumable shore planner, never by the
      // synchronous legacy coastline search inside this bounded work slice.
      {
        // One representative quotes the order's crossing; every boat certifies
        // its actual member connectors through CohortAdmission.
        const searchOrigin=group.crossingOrigin ?? origin;
        const result=this.planning.request(`transfer:${plan.id}:${plan.cursor}`,plan.playerId,searchOrigin,plan.destination);
        if(result.status==="pending")continue;
        if(result.status!=="complete"){
          if(!connected||result.status==="superseded"){this.finishStart(plan,result.status==="superseded"?"superseded":"rejected",result.reason??"No reachable water crossing");continue;}
        }else leg=result.leg;
      }
      if(connected&&leg){
        const quote=group.shortcut??=(plan.groups.find(prior=>prior!==group && prior.crossingOrigin===group.crossingOrigin && prior.shortcut)?.shortcut ??
          {requested:false,cursor:0,part:0,landTicks:0,crossingTicks:leg.waterPath.length*FIXED/plan.definition.speed+20,attempts:0,retryAt:0,done:false});
        if(!quote.done){
          if(!quote.path){
            if(quote.outcome==="unreachable"){quote.done=true;}
            else if(quote.outcome==="superseded"){this.finishStart(plan,"superseded","Shortcut facts changed");continue;}
            else{quote.outcome=undefined;if(!quote.requested&&quote.retryAt<=this.world.domainRoutes!.tick())quote.requested=this.world.domainRoutes!.request(this.shortcutTask(plan),group.crossingOrigin ?? origin,plan.destination);continue;}
          }
          if(!quote.done){
            const paths=[quote.path!,leg.approachPath??[],leg.arrivalPath??[]];
            // Terrain-cost reads are cheap; one tile per tick added seconds of
            // latency despite an already completed path. Keep a bounded batch.
            for(let reads=0;reads<64 && quote.part<3;reads++) {
              const tile=paths[quote.part][quote.cursor++];
              if(tile===undefined){quote.cursor=0;quote.part++;continue;}
              if(quote.part===0)quote.landTicks+=FIXED/terrainSpeed(this.world.map,tile);
              else quote.crossingTicks+=FIXED/terrainSpeed(this.world.map,tile);
            }
            quote.done=quote.part>=3;if(!quote.done)continue;
          }
        }
        if(quote.path&&quote.crossingTicks>=quote.landTicks)leg=undefined;
      }
      group.leg=leg;
      const shore=leg?.departure.landTile??plan.destination;
      const extra=new Map<number,Order[]>();
      for(const prior of plan.groups)for(const row of prior.prepared??[])extra.set(row.id,[{type:"move",tile:pointTile(this.world.map,row.point),...row.point}]);
      // Friendly overlap permits a shared boarding point. This avoids fitting
      // an artificial formation before boarding a capacity-sized boat.
      const preferred=leg?new Map(members.map(s=>[s.id,tilePoint(this.world.map,shore)])):undefined;
      const id=this.cohorts.start(plan.playerId,members,shore,preferred,leg?3*FIXED:Infinity,extra);
      if(id===undefined){this.finishStart(plan,"rejected","Shore staging admission is full");continue;}
      group.cohortId=id;this.cohortGroups.set(id,{admissionId:plan.id,group:plan.cursor});
    }
    return used+this.cohorts.step(budget-used,interactive);
  }
  private commitGroup(plan:TransferAdmission,group:TransferAdmission["groups"][number]):boolean {
    const routes=this.world.domainRoutes!,selected=new Set(group.ids);
    const rows=group.prepared!;
    if(!this.validStart(plan) || rows.some(row=>{
      const squad=this.squad(row.id)!;
      const point=row.path.length?tilePoint(this.world.map,row.path[row.index]):row.point;
      return !routes.clear(squad,point)||!routes.destinationValid(squad,row.point,selected);
    })){this.finishStart(plan,"rejected","Departure changed while staging");return false;}
    {
      const ship=group.leg?this.world.launch(plan.playerId,plan.definition,group.leg.departure.waterTile):undefined;
      if(ship)this.world.updateShip(ship.id,{shoreTransfer:{destinationTile:plan.destination,landingTile:group.leg!.arrival?.landTile ?? null,departureTile:group.leg!.departure.landTile,
        waterPath:group.leg!.waterPath,capacity:plan.capacity,phase:"boarding",queued:group.ids.map(id=>({squadId:id,orders:plan.members.find(m=>m.id===id)!.queued}))},
        boarding:{...group.leg!.departure,squadIds:group.ids}});
      for(const row of group.prepared!){
        const squad=this.squad(row.id)!;
        // A committed boat owns these squads independently of the remaining
        // admission. Its movement, damage and cancellation stay authoritative.
        plan.members.find(m=>m.id===row.id)!.committed=true;
        this.world.updateSquad(squad.id,{queuedOrders:[],charge:null,structureTarget:null});
        this.world.activate(squad,ship?{type:"board",shipId:ship.id,tile:pointTile(this.world.map,row.point)}:{type:"move",tile:pointTile(this.world.map,row.point),...row.point},row.path);
        this.world.updateSquad(squad.id,{nextPathIndex:row.index});
      }
    }
    group.committed=true;
    return true;
  }
  private landDeferred(ship:Ship,tile:number,redirected:boolean,destination?:number):string|null {
    if (ship.destination !== null) return "Stop beside the landing coast before unloading";
    if (!this.world.paths.walkable(tile) || this.world.map.manhattanDist(pointTile(this.world.map,ship),tile) !== 1)
      return "Choose passable coastal land directly beside the transport";
    if (this.world.landingAllowed && !this.world.landingAllowed(ship.playerId,tile))
      return "AI landing requires a declared operation or local defensive response";
    const existing=[...this.landingGroups].find(([,g])=>g.shipId===ship.id);
    if(existing){if(existing[1].tile===tile&&existing[1].redirected===redirected&&existing[1].destination===destination)return null;this.cohorts!.cancel(existing[0],"Replacement landing");}
    const cargo=[...this.world.cargo(ship.id)];
    if(!cargo.length)return "No cargo to land";
    const id=this.cohorts!.start(ship.playerId,cargo,tile,undefined,3*FIXED);
    if(id===undefined)return "Landing planning is full";
    this.landingGroups.set(id,{shipId:ship.id,cargoIds:cargo.map(s=>s.id),tile,redirected,destination});
    return null;
  }
  checkpoint(){return structuredClone({boards:[...this.pendingBoards],boardingGroups:[...this.boardingGroups],pending:[...this.pendingStarts],nextAdmission:this.nextAdmission,cohorts:this.cohorts?.checkpoint(),crossings:this.planning?.checkpoint(),cohortGroups:[...this.cohortGroups],landingGroups:[...this.landingGroups],landingVoyages:[...this.landingVoyages]});}
  restore(saved?:ReturnType<ShoreTransport["checkpoint"]>):void{
    this.pendingBoards.clear();this.boardingGroups.clear();this.boardEdges.clear();
    for(const [id,plan] of structuredClone(saved?.boards??[]))this.pendingBoards.set(id,plan);
    for(const [id,link] of saved?.boardingGroups??[])this.boardingGroups.set(id,link);
    this.pendingStarts.clear();this.cohortGroups.clear();this.landingGroups.clear();this.nextAdmission=saved?.nextAdmission??1;
    if(saved && saved.pending.length>128)throw new Error("Transfer checkpoint exceeds envelope");
    for(const [id,plan] of structuredClone(saved?.pending??[]))this.pendingStarts.set(id,plan);
    for(const [id,link] of saved?.cohortGroups??[])this.cohortGroups.set(id,structuredClone(link));
    for(const [id,link] of saved?.landingGroups??[])this.landingGroups.set(id,structuredClone(link));
    this.landingVoyages.clear();
    if((saved?.landingVoyages?.length??0)>128)throw new Error("Landing checkpoint exceeds envelope");
    for(const [id,plan] of structuredClone(saved?.landingVoyages??[]))this.landingVoyages.set(id,plan);
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
    if (!leg || !leg.arrival || !w.paths.connected(origin, destination)) return leg;
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
    if(w.domainRoutes && (!(this.planning?.hasCoast(origin)??false) || w.map.manhattanDist(origin,destination)<24))return false;
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
      crosses && (w.domainRoutes ? true : this.preferredLeg(squad, destination, definition) !== null)
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
            landingTile: plan.leg!.arrival?.landTile ?? null,
            departureTile: plan.leg!.departure.landTile,
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

  land(ship: Ship, tile: number, redirected = false, destination?:number): string | null {
    if(this.cohorts && this.world.unloadPrepared)return this.landDeferred(ship,tile,redirected,destination);
    const w = this.world;
    let transfer = ship.shoreTransfer;
    const cargo = w.cargo(ship.id);
    const result = w.unload(ship, tile);
    if (result !== null) return result;
    if (redirected && transfer) {
      w.updateShip(ship.id, { shoreTransfer: { ...transfer, landingTile: tile, destinationTile: tile, queued: [] } });
      transfer = ship.shoreTransfer!;
    }
    for (const squad of cargo) {
      const current=this.squad(squad.id)!;
      if (current.embarkedOn === ship.id) continue;
      if(transfer)w.updateSquad(squad.id, { queuedOrders: redirected
        ? [] : (transfer.queued.find(q => q.squadId === squad.id)?.orders ?? []) });
      const target=destination??transfer?.destinationTile;
      if(target!==undefined)w.resume(current, target);
    }
    if (!w.cargo(ship.id).length){this.cancelVoyage(ship.id);if(transfer)w.removeShip(ship.id);}
    return null;
  }

  step(): void {
    const w = this.world;
    if(!this.planning)this.stepLandingVoyages(128);
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
        w.updateShip(ship.id, { shoreTransfer: { ...transfer, phase: transfer.landingTile === null ? "afloat" : "landing" } });
        transfer = ship.shoreTransfer!;
      }
      if (transfer.phase !== "landing" || transfer.landingTile === null || ship.destination !== null) continue;
      const end=transfer.waterPath[transfer.waterPath.length-1];
      if (end!==undefined && pointTile(w.map,ship)!==end) {
        // Historical policy stops must resume their admitted physical passage.
        const at=transfer.waterPath.indexOf(pointTile(w.map,ship));
        if(at>=0){w.updateShip(ship.id,{shoreTransfer:{...transfer,phase:"sailing"},destination:end,path:transfer.waterPath.slice(at),nextPathIndex:0});continue;}
      }
      if (w.landingAllowed && !w.landingAllowed(ship.playerId,transfer.landingTile)) {
        const departure=transfer.departureTile ?? w.map.neighbors(transfer.waterPath[0]).find(t=>w.paths.walkable(t)&&w.landingAllowed!(ship.playerId,t));
        if(!transfer.returning && departure!==undefined && w.landingAllowed(ship.playerId,departure)) {
          const path=[...transfer.waterPath].reverse();
          w.updateShip(ship.id,{shoreTransfer:{...transfer,phase:"sailing",returning:true,landingTile:departure,destinationTile:departure,waterPath:path,queued:[]},destination:path[path.length-1],path,nextPathIndex:0});
        } else w.updateShip(ship.id,{shoreTransfer:{...transfer,phase:"afloat"}});
        continue;
      }
      // A newly occupied landing is retried; never force units into blockers.
      if (
        w.blocked(transfer.landingTile, ship.playerId) ||
        this.land(ship, transfer.landingTile) !== null
      )
        continue;
    }
  }
}
