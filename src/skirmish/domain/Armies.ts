import { effectiveRange } from "./ElevationAdvantage";
import { formationContact } from './FormationContact';
import { formationEnvelope,formationDoctrine } from './FormationGeometry';
import { layoutArmyBattleLine } from './BattleLineLayout';
import { mayWrite, mayNavigateArmy,type ControlWorld } from './CommandPrecedence';
import { ENGAGEMENT,LINES } from '../content/TacticalRules';
import { strengthFraction } from './Manpower';
import { AI_DOCTRINES } from '../content/AiDoctrines';
import { personalityOf } from '../content/AiPersonalities';
import type { EngagementManager } from './EngagementManager';
import { formationLayoutKey } from "./FormationGeometry";
import { CohortAdmission } from "./CohortAdmission";
import { FormationPlanning, type FormationPlanningState } from "../FormationPlanning";
import { limitedRouteRetry, ROUTE_CAPACITY_REASON } from "../RouteRetryPolicy";
import type { DomainRoutePorts, DomainRouteTask } from "./DomainRoutePorts";
import type { ExactRouteOutcome } from "../RoutePlanner";
import { restoreArray, restoreMap, restoreSet } from "../StateTransfer";
import type { GameMap } from "../../core/game/GameMap";
import type { LandPaths } from "../Pathfinding";
import {
  FIXED,
  MAX_QUEUED_ORDERS,
  type Command,
  type Order,
  type Player,
  type Squad,
} from "../Protocol";
import type { WorldPoint } from "../SpatialGrid";
import {
  distanceSquared,
  pointTile,
  squadRadius,
  squadSeparation,
  standable,
  tilePoint,
  traversable,
} from "../SquadGeometry";
import { armyCapacity } from "../content/Armies";
import type { Army, ArmyOrder, ArmySlotRecord, UnitDefinition } from "./Definitions";
import { validateArmyRecords } from './ArmyState';
import type { Progression } from "./Progression";
import type { ArmyRouteRequest } from "./RouteTask";

// Coordination owns intent and membership; the existing simulation still owns
// every physical position, collision, shot, transport and pathfinding operation.
export interface ArmyWorld {
  readonly sharedArmyTravel?: boolean;
  clearArmyLeg?(squad:Squad,end:WorldPoint):boolean;
  readonly domainRoutes?: DomainRoutePorts;
  map: GameMap;
  paths: LandPaths;
  squads: readonly Squad[];
  updateSquad(id: number, changes: Partial<Omit<Squad, "id">>): Squad | undefined;
  players: Player[];
  tick: number;
  squad(id: number): Squad | undefined;
  unit(squad: Squad): UnitDefinition;
  ordinarySpeed(squad: Squad): number;
  hostile(a: number, b: number): boolean;
  armyTargetAllowed?(a:number,b:number):boolean;
  armyBlocked(tile: number, playerId: number): boolean;
  formationFits?(squad:Squad,point:WorldPoint,heading?:number):boolean;
  nearbyArmyEnemies(
    point: WorldPoint,
    radius: number,
    playerId: number,
  ): Squad[];
  armySlots(
    tile: number,
    members: Squad[],
    ideals: Map<number, WorldPoint>,
    reserved?: WorldPoint[],
  ): Map<number, WorldPoint> | null;
  queueArmyRoute(key: string, work: ArmyRouteRequest): void;
  cancelArmyRoute(key: string): void;
  setArmyMove(
    squad: Squad,
    point: WorldPoint,
    path: number[],
    via?: WorldPoint[],
  ): void;
  setArmyAttack(squad: Squad, targetId: number): void;
  setArmyHold(squad: Squad): void;
  applyArmyCommand?(command:Extract<Command,{type:"formation"|"charge"}>):string|null;
  /** A faction's squad graph: armies of factions with transports cross water. */
  squadPaths(playerId: number): LandPaths;
}
interface ArmyLeaderAdmission {
  id:number;armyId:number;revision:number;playerId:number;generation:number;obstacles:string;
  order:ArmyOrder;leaderId:number;memberIds:number[];memberRevisions:number[];tile:number;start:number;
  requested:boolean;path?:number[];route:WorldPoint[];lengths:number[];cursor:number;
  attempts:number;retryAt:number;cohortId?:number;queueLength:number;
}
interface March {
  deployment?: {
    point: WorldPoint;
    facing: number;
    flank: number;
    slots: Map<number, WorldPoint>;
    geometry?: string;
  };
  columnIds: number[];
  route: WorldPoint[];
  lengths: number[];
  cursor: number;
  slots: Map<number, WorldPoint>;
  planned: Map<number, WorldPoint>;
  pending: Set<number>;
  speed: number;
  started: number;
  phaseTick: number;
  retreating: boolean;
}
/** Longest retarget, in cells, a member may take without corridor admission. */
const DIRECT_STEP = 3;
const active = (s: Squad|undefined):s is Squad => !!s && s.troops > 0 && s.embarkedOn === null && !s.refit && !s.manpower?.enlargement;
const attackOrder = (
  o: ArmyOrder,
): o is Extract<ArmyOrder, { targetId: number }> => "targetId" in o;
export class Armies {
  readonly travelWork = { directLegs: 0, sharedLegs: 0, recoveryMembers: 0, directAdmissions: 0 };
  checkpoint() { return structuredClone({armies:this.armies, membership:this.membership, marches:this.marches, externalActions:this.externalActions,commandHistory:[...this.commandHistory], nextId:this.nextId, leaderAdmissions:[...this.leaderAdmissions], nextAdmission:this.nextAdmission, cohorts:this.cohorts?.checkpoint(), cohortArmies:[...this.cohortArmies], slotPlanning:[...this.slotPlanning]}); }
  restore(saved: ReturnType<Armies["checkpoint"]>): void {
    const state=structuredClone(saved);
    validateArmyRecords(state.armies);
    if(state.commandHistory.some(([id,row])=>!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(row.tick)||row.tick<0||row.targetId!==null&&(!Number.isSafeInteger(row.targetId)||row.targetId<1)))throw Error("Invalid army command history");
    this.commandHistory.clear();for(const [id,row] of state.commandHistory)this.commandHistory.set(id,row);
    restoreArray(this.armies,state.armies);
    restoreMap(this.membership,state.membership);
    restoreMap(this.marches,state.marches);
    restoreSet(this.externalActions,state.externalActions);
    this.nextId=state.nextId;
    restoreMap(this.leaderAdmissions,new Map(state.leaderAdmissions??[]));this.nextAdmission=state.nextAdmission??1;
    restoreMap(this.cohortArmies,new Map(state.cohortArmies??[]));restoreMap(this.slotPlanning,new Map(state.slotPlanning??[]));this.cohorts?.restore(state.cohorts);
    this.byArmyId.clear(); for (const army of this.armies) this.byArmyId.set(army.id,army);
  }

  readonly armies: Army[] = [];
  private readonly membership = new Map<number, number>();
  private readonly byArmyId = new Map<number, Army>();
  private readonly marches = new Map<number, March>();
  private readonly externalActions = new Set<number>();
  private nextId = 1;
  private engagements?:EngagementManager;
  private readonly commandHistory=new Map<number,{tick:number;targetId:number|null}>();
  setEngagementManager(manager:EngagementManager){this.engagements=manager;}
  advisoryMovement:(id:number)=>boolean=()=>false;
  slotAnchor(id:number):WorldPoint|undefined {const army=this.armyOf(id);return army?this.marches.get(army.id)?.slots.get(id):undefined;}
  directArmyAction(id:number){return this.externalActions.has(id);}
  private readonly controls:ControlWorld={armyOf:id=>this.armyOf(id),directArmyAction:id=>this.externalActions.has(id),human:id=>!this.world.players.find(p=>p.id===id)?.ai,stance:id=>this.advisoryMovement(id)};
  private nextAdmission = 1;
  private readonly leaderAdmissions=new Map<number,ArmyLeaderAdmission>();
  private readonly cohortArmies=new Map<number,{armyId:number;revision:number;leaderId?:number}>();
  private readonly slotPlanning=new Map<number,{revision:number;geometry?:string;formation:FormationPlanningState}>();
  private readonly cohorts?:CohortAdmission;
  constructor(
    private readonly world: ArmyWorld,
    private readonly progression: Progression,
  ) {
    if(world.domainRoutes)this.cohorts=new CohortAdmission("army",{
      map:world.map,paths:world.paths,squadPaths:id=>world.squadPaths(id),squads:()=>world.squads,squad:id=>world.squad(id),routes:world.domainRoutes,
      blocked:id=>t=>world.armyBlocked(t,id),
      valid:(plan,squad)=>{const link=this.cohortArmies.get(plan.id),army=link&&this.byArmyId.get(link.armyId);return !!army && army.revision===link!.revision && this.membership.get(squad.id)===army.id && mayNavigateArmy(this.controls,squad);},
      directRoute:(squad,point)=>{
        const tile=pointTile(world.map,point);
        if(!world.sharedArmyTravel||!world.clearArmyLeg?.(squad,point)||!world.clearArmyLeg(squad,tilePoint(world.map,tile)))return undefined;
        this.travelWork.directAdmissions++;
        return pointTile(world.map,squad)===tile?[]:[tile];
      },
      commit:(plan,members)=>{
        const link=this.cohortArmies.get(plan.id)!,army=this.byArmyId.get(link.armyId)!;
        if(link.leaderId!==undefined){
          const leaderPlan=this.leaderAdmissions.get(link.leaderId)!;
          this.leaderAdmissions.delete(leaderPlan.id);this.cohortArmies.delete(plan.id);
          const queued=army.queuedOrders.slice(leaderPlan.queueLength??army.queuedOrders.length);
          this.order(army,leaderPlan.order,false,{path:leaderPlan.path!,route:leaderPlan.route,lengths:leaderPlan.lengths});
          army.queuedOrders=queued;
          this.world.domainRoutes!.event("army",{id:leaderPlan.id,playerId:army.playerId,tick:world.tick,status:"executed"});
        }
        const march=this.marches.get(army.id);
        for(const member of members){
          const current=world.squad(member.squad.id);if(!current||!mayNavigateArmy(this.controls,current)||army.withdrawalTick!==undefined&&world.tick-army.withdrawalTick<LINES.rearWithdrawalTicks&&army.slots?.find(r=>r.squadId===current.id)?.role==="frontline")continue;world.setArmyMove(current,member.point,member.path);
          world.updateSquad(member.squad.id,{nextPathIndex:member.index});
          march?.planned.set(member.squad.id,member.point);march?.pending.delete(member.squad.id);
        }
      },
      finished:(plan,status,reason)=>{
        const link=this.cohortArmies.get(plan.id);this.cohortArmies.delete(plan.id);
        if(link?.leaderId!==undefined){const leader=this.leaderAdmissions.get(link.leaderId);if(leader)this.finishLeader(leader,status,reason);}
      },
    });
  }
  private leaderTask(plan:ArmyLeaderAdmission):DomainRouteTask {return {kind:"domain",owner:"army",admissionId:plan.id,memberId:plan.leaderId,stage:"leader",playerId:plan.playerId,generation:plan.generation};}
  private leaderValid(plan:ArmyLeaderAdmission):boolean {
    const army=this.byArmyId.get(plan.armyId),routes=this.world.domainRoutes;
    return !!routes && !!army && army.revision===plan.revision && routes.generation(plan.playerId)===plan.generation &&
      routes.revision(plan.playerId, "army")===plan.obstacles && army.memberIds.length===plan.memberIds.length &&
      plan.memberIds.every((id,i)=>{const s=this.world.squad(id);return !!s && active(s) && s.playerId===plan.playerId && this.membership.get(id)===army.id && routes.orderRevision(id)===plan.memberRevisions[i];}) &&
      (!attackOrder(plan.order) || (()=>{const s=this.world.squad(plan.order.targetId);return !!s && active(s) && this.world.hostile(plan.playerId,s.playerId) && pointTile(this.world.map,s)===plan.tile;})());
  }
  validRoute(task:DomainRouteTask):boolean {
    if(task.stage.startsWith("engagement-wing-"))return this.engagements?.validRoute(task)??false;
    if(task.stage==="cohort")return this.cohorts?.validRoute(task)??false;
    const plan=this.leaderAdmissions.get(task.admissionId);
    return !!plan && task.stage==="leader" && task.generation===plan.generation && this.leaderValid(plan);
  }
  completedRoute(task:DomainRouteTask,outcome:ExactRouteOutcome,path:number[]):void {
    if(task.stage.startsWith("engagement-wing-")){this.engagements?.completedRoute(task,outcome,path);return;}
    if(task.stage==="cohort"){this.cohorts?.completedRoute(task,outcome,path);return;}
    const plan=this.leaderAdmissions.get(task.admissionId);if(!plan)return;
    plan.requested=false;
    if(!this.leaderValid(plan)){this.finishLeader(plan,"superseded","Army or target changed");return;}
    if(outcome==="complete"){plan.path=path;plan.cursor=0;}
    else if(outcome==="limited"){
      const retry=limitedRouteRetry(plan.attempts,this.world.tick,true);plan.attempts=retry.attempts;plan.retryAt=retry.retryAt;
      if(retry.exhausted)this.finishLeader(plan,"rejected",ROUTE_CAPACITY_REASON);
    }else this.finishLeader(plan,outcome==="unreachable"?"rejected":"superseded","Army corridor unavailable");
  }
  private finishLeader(plan:ArmyLeaderAdmission,status:"executed"|"rejected"|"superseded",reason?:string):void {
    this.leaderAdmissions.delete(plan.id);
    this.world.domainRoutes!.cancel(this.leaderTask(plan));
    if(plan.cohortId!==undefined){this.cohortArmies.delete(plan.cohortId);this.cohorts?.cancel(plan.cohortId,reason);}
    this.world.domainRoutes!.event("army",{id:plan.id,playerId:plan.playerId,tick:this.world.tick,status,reason});
  }
  private cancelPlanning(armyId:number):void {
    for(const plan of [...this.leaderAdmissions.values()])if(plan.armyId===armyId)this.finishLeader(plan,"superseded","Army order changed");
    for(const [id,link] of [...this.cohortArmies])if(link.armyId===armyId){this.cohortArmies.delete(id);this.cohorts?.cancel(id);}
    this.slotPlanning.delete(armyId);
  }
  private planSlots(army:Army,center:number,members:Squad[],ideals:Map<number,WorldPoint>):Map<number,WorldPoint>|null|undefined {
    if(!this.world.domainRoutes)return this.world.armySlots(center,members,ideals);
    let plan=this.slotPlanning.get(army.id);
    if(plan && (plan.revision!==army.revision || plan.geometry!==JSON.stringify(members.map(formationLayoutKey)))){this.slotPlanning.delete(army.id);plan=undefined;}
    if(!plan){
      plan={revision:army.revision,geometry:JSON.stringify(members.map(formationLayoutKey)),formation:new FormationPlanning(this.world.map,this.world.squadPaths(army.playerId),center,members.map(squad=>({squad,origin:squad})),()=>this.world.squads,Infinity,ideals).state};
      this.slotPlanning.set(army.id,plan);return undefined;
    }
    if(plan.formation.phase!=="done" && plan.formation.phase!=="failed")return undefined;
    this.slotPlanning.delete(army.id);
    return plan.formation.phase==="failed"?null:plan.formation.result;
  }
  stepPlanning(budget:number):number {
    const routes=this.world.domainRoutes;if(!routes)return 0;
    let used=0;
    for(const plan of [...this.leaderAdmissions.values()]){
      if(used>=budget)break;
      used++;
      if(!this.leaderValid(plan)){this.finishLeader(plan,"superseded","Army or control changed");continue;}
      if(!plan.path){
        if(!plan.requested && plan.retryAt<=this.world.tick)plan.requested=routes.request(this.leaderTask(plan),plan.start,plan.tile);
        continue;
      }
      if(plan.cohortId!==undefined)continue;
      // Arithmetic only: one tile per work unit made a long march wait a
      // second before assembly could even start. Charge per 64 points.
      const from=plan.cursor;
      while(plan.cursor<plan.path.length){
        const point=tilePoint(this.world.map,plan.path[plan.cursor++]),last=plan.route[plan.route.length-1];
        plan.lengths.push(plan.lengths[plan.lengths.length-1]+Math.hypot(point.x-last.x,point.y-last.y));
        plan.route.push(point);
      }
      used+=Math.ceil((plan.cursor-from)/64);
      if(plan.route.length===1){const end=tilePoint(this.world.map,plan.tile),last=plan.route[0];plan.route.push(end);plan.lengths.push(Math.hypot(end.x-last.x,end.y-last.y));}
      const army=this.byArmyId.get(plan.armyId)!,members=plan.memberIds.map(id=>this.world.squad(id)!);
      const leader=this.world.squad(plan.leaderId)!;
      // Admit the initial assembling footprint before replacing any old order.
      const ideals=new Map<number,WorldPoint>();
      members.forEach((s,i)=>ideals.set(s.id,{x:leader.x+((i%2)-.5)*FIXED,y:leader.y-Math.floor(i/2)*FIXED*1.1}));
      const id=this.cohorts!.start(plan.playerId,members,pointTile(this.world.map,leader),ideals);
      if(id===undefined){this.finishLeader(plan,"rejected","Army admission is full");continue;}
      plan.cohortId=id;this.cohortArmies.set(id,{armyId:army.id,revision:army.revision,leaderId:plan.id});
    }
    for(const [id,plan] of this.slotPlanning){
      if(used>=budget)break;
      const army=this.byArmyId.get(id);
      if(!army || army.revision!==plan.revision || plan.geometry!==JSON.stringify(this.members(army).filter(active).map(formationLayoutKey))){this.slotPlanning.delete(id);continue;}
      const formation=new FormationPlanning(this.world.map,this.world.squadPaths(army.playerId),plan.formation.center,[],()=>this.world.squads,Infinity,undefined,plan.formation);
      used+=formation.step(Math.min(16,budget-used),t=>this.world.armyBlocked(t,army.playerId));
    }
    return used+(this.cohorts?.step(budget-used)??0);
  }
  capacity(playerId: number): number {
    return armyCapacity(this.progression.states[playerId]?.completed ?? []);
  }
  private syncSlots(army:Army,members:Squad[]):void {
    const slots=army.slots??=[],ids=new Set(members.map(s=>s.id));
    army.slots=slots.filter(r=>ids.has(r.squadId));
    let joined=false,mounted=slots.filter(r=>r.role.startsWith('mounted')).length;
    for(const squad of members)if(!army.slots.some(r=>r.squadId===squad.id)){
      const unit=this.world.unit(squad),role=unit.tags.includes('mounted')?(mounted++%2?'mounted-right':'mounted-left'):unit.role==='frontline'?'frontline':unit.role==='ranged'?'ranged':'support';
      army.slots.push({squadId:squad.id,role,index:army.nextSlotIndex??0,lateral:0,depth:0,widthRev:'',width:0,bodyDepth:0});army.nextSlotIndex=(army.nextSlotIndex??0)+1;joined=true;
    }
    if(joined){
      const fronts=army.slots.filter(r=>r.role==='frontline'||r.role==='reserve').sort((a,b)=>b.index-a.index),player=this.world.players.find(p=>p.id===army.playerId)!;
      const percent=player.ai?AI_DOCTRINES[personalityOf(player).id].reservePercent*.5:ENGAGEMENT.reservePercent;
      let missing=Math.max(0,Math.min(fronts.length-1,Math.ceil(fronts.length*percent/100))-fronts.filter(r=>r.role==='reserve').length);
      for(const r of fronts)if(missing>0&&r.role==='frontline'){r.role='reserve';missing--;}
    }
    if(!joined&&army.lastLayoutTick!==undefined&&this.world.tick-army.lastLayoutTick<LINES.gapCheckTicks)return;
    const next=army.slots.map(r=>{
      const s=this.world.squad(r.squadId)!,d=formationDoctrine(s.definitionId),shape=s.formation?.deployedShape??(s.formation?.shape==='column'?d.defaultShape:s.formation?.shape)??d.defaultShape;
      const deployed={...s,charge:null,formation:s.formation?{...s.formation,shape,frontage:s.formation.preferredFrontage??s.formation.frontage,facing:0,transition:undefined,trail:undefined}:undefined};
      const e=formationEnvelope(deployed,this.world.tick);
      return {...r,width:Math.round(e.width),bodyDepth:Math.round(e.depth),widthRev:formationLayoutKey(deployed)};
    });
    const bandWidth=(rows:ArmySlotRecord[])=>rows.filter(r=>r.role==='frontline').reduce((n,r)=>n+r.width,0);
    const shapeKey=(key:string)=>key?JSON.stringify((JSON.parse(key) as unknown[]).filter((_,i)=>i!==2&&i!==3)):key;
    const definitionChanged=next.some((r,i)=>shapeKey(r.widthRev)!==shapeKey(army.slots![i].widthRev)||Math.abs(r.bodyDepth-army.slots![i].bodyDepth)>LINES.relayoutTiles*FIXED);
    if(joined||army.lastLayoutTick===undefined||army.layoutPosture!==army.posture||!(army.frontGaps?.length)&&
      (Math.abs(bandWidth(next)-bandWidth(army.slots))>LINES.relayoutTiles*FIXED||definitionChanged)){
      army.slots=layoutArmyBattleLine(next,army.terrainPosition);army.slotRevision=(army.slotRevision??0)+1;army.layoutPosture=army.posture;army.lastLayoutTick=this.world.tick;this.engagements?.invalidate(army.id);
    }
    army.lastLayoutTick=this.world.tick;
  }
  private closeGap(army:Army):void {
    if(this.world.tick-(army.lastGapTick??-LINES.gapCheckTicks)<LINES.gapCheckTicks)return;
    const slots=army.slots??[],plan=this.engagements?.planFor(army.id),planKey=plan?`${plan.engagementId}:${plan.revision}`:undefined;
    let weak=slots.find(r=>r.role==='frontline'&&(()=>{const s=this.world.squad(r.squadId);return !!s&&(strengthFraction(s)<LINES.gapStrength||s.order.type==='replenish');})());
    if(!weak&&!army.frontGaps?.length&&plan?.reserveCommit&&army.reservePlan!==planKey)weak=slots.find(r=>r.role==='frontline'&&r.index===plan.reserveCommit!.slotIndex);
    const gap=army.frontGaps?.[0]??(weak?{index:weak.index,lateral:weak.lateral,depth:weak.depth,width:weak.width}:undefined);
    if(!gap)return;
    const reserve=slots.filter(r=>r.role==='reserve'&&(()=>{const s=this.world.squad(r.squadId);return !!s&&active(s)&&mayWrite(this.controls,s,'army')&&strengthFraction(s)>=LINES.gapStrength;})()).sort((a,b)=>Math.abs(a.lateral-gap.lateral)-Math.abs(b.lateral-gap.lateral)||a.index-b.index)[0];
    if(reserve){
      const previous={index:reserve.index,lateral:reserve.lateral,depth:reserve.depth};reserve.role='frontline';reserve.index=gap.index;reserve.lateral=gap.lateral;reserve.depth=gap.depth;
      if(weak){weak.role='reserve';Object.assign(weak,previous);}else army.frontGaps!.shift();
    }else if(!weak){
      const neighbours=slots.filter(r=>r.role==='frontline').sort((a,b)=>Math.abs(a.lateral-gap.lateral)-Math.abs(b.lateral-gap.lateral)||a.index-b.index).slice(0,2);
      for(const r of neighbours)r.lateral=Math.round(r.lateral+(gap.lateral-r.lateral)*.5);army.frontGaps!.shift();
    }else return;
    army.reservePlan=planKey;army.lastGapTick=this.world.tick;army.slotRevision=(army.slotRevision??0)+1;this.engagements?.invalidate(army.id);
  }
  setTerrainPosition(id:number,enabled:boolean):void {
    const army=this.armies.find(a=>a.id===id);if(!army||!!army.terrainPosition===enabled)return;
    if(enabled){army.terrainReserveIds=[];let screens=(army.slots??[]).filter(s=>s.role==="frontline").length;
      for(const slot of army.slots??[])if(screens<2&&slot.role==="reserve"&&this.world.unit(this.world.squad(slot.squadId)!).role==="frontline"){slot.role="frontline";army.terrainReserveIds.push(slot.squadId);screens++;}
    }else{for(const slot of army.slots??[])if(army.terrainReserveIds?.includes(slot.squadId)&&slot.role==="frontline")slot.role="reserve";army.terrainReserveIds=undefined;}
    army.terrainPosition=enabled;army.lastLayoutTick=undefined;this.engagements?.invalidate(id);
  }
  private tacticalStep(army:Army,march:March,members:Squad[],slots:Map<number,WorldPoint>,near:Squad[]):void {
    const plan=this.engagements?.planFor(army.id),moves:Squad[]=[];
    const ai=!!this.world.players.find(p=>p.id===army.playerId)?.ai;
    if(ai&&plan?.posture==='withdraw'&&army.order.type!=='regroup'){
      const oldOrders=new Map(members.map(s=>[s.id,s.order]));
      if(!this.order(army,{type:'regroup',tile:this.world.players.find(p=>p.id===army.playerId)!.base})){
        army.withdrawalTick=this.world.tick;
        for(const r of army.slots??[])if(r.role==='frontline'){const s=this.world.squad(r.squadId),order=oldOrders.get(r.squadId);if(s&&order?.type==='attack')this.world.setArmyAttack(s,order.targetId);}
      }return;
    }
    for(const old of members){
      const s=this.world.squad(old.id)??old,record=army.slots?.find(r=>r.squadId===s.id),slot=slots.get(s.id);if(!record||!slot||!mayWrite(this.controls,s,'army'))continue;
      let targetId=plan?.assignments.find(a=>a.squadId===s.id)?.targetId??null;
      let leash=record.role==='frontline'?ENGAGEMENT.frontLeash:record.role==='ranged'?ENGAGEMENT.rangedLeash:0;
      const wing=record.role.startsWith('mounted')?this.engagements?.wingFor(army.id,record.role==='mounted-left'?'left':'right'):undefined;
      if(wing?.phase==='route'&&wing.path&&wing.via!==undefined){const goal=tilePoint(this.world.map,wing.via);slots.set(s.id,{x:Math.round(goal.x-Math.sin(army.facing)*(record.lateral*.1)),y:Math.round(goal.y+Math.cos(army.facing)*(record.lateral*.1))});moves.push(s);continue;}
      if(wing?.phase==='strike'){targetId=wing.targetId??null;leash=14;}
      if(s.cavalryEngagement?.phase==='engaged'&&s.order.type==='attack'&&active(this.world.squad(s.order.targetId)!)&&this.world.hostile(army.playerId,this.world.squad(s.order.targetId)!.playerId))continue;
      const allowed=(t:Squad|undefined,extra=0)=>!!t&&active(t)&&!t.afloat&&this.world.hostile(army.playerId,t.playerId)&&(this.world.armyTargetAllowed?.(army.playerId,t.playerId)??true)&&
        this.world.unit(s).attack.targets.some(tag=>this.world.unit(t).tags.includes(tag))&&
        formationContact({...s,...slot},t,this.world.tick).gap<=effectiveRange(this.world,{...s,...slot},this.world.unit(s).attack,t)+(leash+extra)*FIXED;
      // A legal current target is sticky; a new plan cannot cause command oscillation.
      const current=s.order.type==='attack'?this.world.squad(s.order.targetId):undefined;
      if(allowed(current)&&distanceSquared(s,slot)<=((leash+ENGAGEMENT.pursuitSlack)*FIXED)**2)targetId=current!.id;
      let target=targetId===null?undefined:this.world.squad(targetId);
      if(!allowed(target)){target=undefined;targetId=null;}
      if(!plan&&leash>0)target=near.find(t=>allowed(t)&&formationContact({...s,...slot},t,this.world.tick).gap<=effectiveRange(this.world,{...s,...slot},this.world.unit(s).attack,t));
      if(distanceSquared(s,slot)>((leash+ENGAGEMENT.pursuitSlack)*FIXED)**2&&wing?.phase!=='strike'){target=undefined;}
      if(target&&leash>0){
        const history=this.commandHistory.get(s.id),same=s.order.type==='attack'&&s.order.targetId===target.id;
        if(!same&&history&&this.world.tick-history.tick<LINES.retargetTicks&&allowed(current))continue;
        if(!same){this.world.cancelArmyRoute(`army:${army.id}:${s.id}`);march.pending.delete(s.id);this.world.setArmyAttack(s,target.id);this.commandHistory.set(s.id,{tick:this.world.tick,targetId:target.id});}
        if(wing?.phase==='strike'&&s.charge===null&&this.world.unit(s).charge&&this.world.applyArmyCommand){
          this.world.applyArmyCommand({type:'charge',playerId:army.playerId,squadIds:[s.id],x:target.x,y:target.y,targetId:target.id});
        }
      }else {if(s.order.type==='attack'){this.world.setArmyHold(s);march.planned.delete(s.id);}moves.push(s);}
    }
    // Certification includes all members, but only idle/returning members receive movement commands.
    march.slots=slots;this.assign(army,march,moves,slots);
  }
  armyOf(squadId: number): Army | undefined {
    return this.byArmyId.get(this.membership.get(squadId) ?? -1);
  }
  // An arrived formation slot is provisional while the army is assembling.
  // Explicit member orders detach or stop the army through observeOrder, so
  // this permission cannot override a player-issued Hold.
  yieldSlot(squad: Squad): WorldPoint | undefined {
    const army=this.armyOf(squad.id),march=army && this.marches.get(army.id);
    if(!army || !march || this.externalActions.has(army.id) || squad.order.type!=="hold" ||
      (army.state!=="assembling" && army.state!=="marching" && army.state!=="regrouping") ||
      (army.order.type!=="move" && army.order.type!=="regroup"))return undefined;
    return march.slots.get(squad.id);
  }
  groupOrder(
    ids: readonly number[],
    order: Order,
    append: boolean,
    beforeCommit?: () => void,
  ): string | null | undefined {
    if (
      order.type !== "move" &&
      order.type !== "attack" &&
      order.type !== "hold"
    )
      return undefined;
    const army = this.armyOf(ids[0]);
    if (!army) return undefined;
    const available = this.members(army).filter(active);
    const selected = new Set(ids);
    if (
      available.length !== selected.size ||
      available.some((s) => !selected.has(s.id))
    )
      return undefined;
    return this.order(army, order, append, undefined, beforeCommit);
  }
  private members(army: Army): Squad[] {
    return army.memberIds
      .map((id) => this.world.squad(id))
      .filter(
        (s): s is Squad => !!s && s.playerId === army.playerId && s.troops > 0,
      );
  }
  private eligible(player: Player, ids: number[], army?: Army): string | null {
    if (!this.capacity(player.id))
      return "Research Armies in Bronze Warfare first";
    if (!ids.length || new Set(ids).size !== ids.length)
      return "Select distinct squad formations";
    const byId = {get:(id:number)=>this.world.squad(id)};
    if (
      ids.some(
        (id) =>
          !byId.get(id) ||
          byId.get(id)!.playerId !== player.id ||
          !active(byId.get(id)!),
      )
    )
      return "Select living, available land squads of your faction";
    if (
      ids.some(
        (id) => this.membership.has(id) && this.membership.get(id) !== army?.id,
      )
    )
      return "Detach squads from their current army first";
    if (
      new Set([...(army?.memberIds ?? []), ...ids]).size >
      this.capacity(player.id)
    )
      return `Army capacity is ${this.capacity(player.id)} squad formations`;
    return null;
  }
  command(player: Player, command: Command): string | null | undefined {
    if (command.type === "create-army") {
      const reason = this.eligible(player, command.squadIds);
      if (reason) return reason;
      const ids = [...command.squadIds].sort((a, b) => a - b),
        leader = this.world.squad(ids[0])!;
      const army: Army = {
        id: this.nextId++,
        playerId: player.id,
        name: `Army ${this.nextId - 1}`,
        memberIds: ids,
        leaderId: leader.id,
        x: leader.x,
        y: leader.y,
        facing: 0,
        state: "holding",
        order: { type: "hold" },
        queuedOrders: [],
        autoTactics: false,
        manual: false,posture:"line",slots:[],slotRevision:0,nextSlotIndex:0,initialTroops:ids.reduce((n,id)=>n+this.world.squad(id)!.troops,0),
        revision: 0,
        reason: null,
      };
      this.armies.push(army);
      this.byArmyId.set(army.id, army);
      ids.forEach((id) => this.membership.set(id, army.id));
      this.syncSlots(army,this.members(army));
      return null;
    }
    if (
      !["army-members", "disband-army", "army-auto", "army-order", "army-posture"].includes(
        command.type,
      )
    )
      return undefined;
    const id = (command as { armyId: number }).armyId,
      army = this.armies.find((a) => a.id === id && a.playerId === player.id);
    if (!army) return "Choose your own army";
    if (command.type === "disband-army") {
      this.disband(army);
      return null;
    }
    if(command.type==="army-posture"){army.posture=command.posture;army.slotRevision=(army.slotRevision??0)+1;this.engagements?.invalidate(army.id);return null;}
    if (command.type === "army-auto") {
      army.autoTactics = command.enabled;
      return null;
    }
    if (command.type === "army-members") {
      if (command.action === "add") {
        const reason = this.eligible(player, command.squadIds, army);
        if (reason) return reason;
        if (command.squadIds.every((id) => army.memberIds.includes(id)))
          return "Those squads already belong to this army";
        for (const id of command.squadIds)
          if (!army.memberIds.includes(id)) {
            army.initialTroops=(army.initialTroops??0)+(this.world.squad(id)?.troops??0);
            army.memberIds.push(id);
            this.membership.set(id, army.id);
          }
        army.memberIds.sort((a, b) => a - b);
        this.syncSlots(army,this.members(army));
        this.restart(army);
      } else {
        if (command.squadIds.some((id) => this.membership.get(id) !== army.id))
          return "Every selected squad must belong to this army";
        this.detach(army, new Set(command.squadIds));
      }
      return null;
    }
    if (command.type === "army-order")
      return this.order(army, command.order, command.append === true);
    return undefined;
  }
  // Only called after a normal unit command has passed authoritative validation.
  // Available members define the whole selection while embarked/refitting units
  // retain their slots and reassemble after returning.
  observeOrder(ids: readonly number[], order?: Order, append = false): void {
    const selected = new Set(ids);
    for (const army of [...this.armies]) {
      const members = this.members(army).filter(active),
        intersection = members.filter((s) => selected.has(s.id));
      if (!intersection.length) continue;
      if (intersection.length !== members.length) {
        this.detach(army, new Set(intersection.map((s) => s.id)));
        continue;
      }
      if (
        order?.type === "move" ||
        order?.type === "attack" ||
        order?.type === "hold"
      ) {
        this.order(army, order, append);
      } else {
        // Explicit replenishment/charge/structure attack retains full membership
        // and suspends coordination until that operation has ended.
        this.stop(army);
        army.manual = true;
        this.externalActions.add(army.id);
      }
    }
  }
  private detach(army: Army, ids: Set<number>,casualty=false): void {
    if(!casualty)army.initialTroops=Math.max(0,(army.initialTroops??0)-[...ids].reduce((n,id)=>n+(this.world.squad(id)?.troops??0),0));
    for(const slot of army.slots??[])if(ids.has(slot.squadId)&&slot.role==='frontline')(army.frontGaps??=[]).push({index:slot.index,lateral:slot.lateral,depth:slot.depth,width:slot.width});
    army.slots=army.slots?.filter(slot=>!ids.has(slot.squadId));army.slotRevision=(army.slotRevision??0)+1;this.engagements?.invalidate(army.id);
    for (const id of ids) {
      this.commandHistory.delete(id);this.membership.delete(id);
      this.world.cancelArmyRoute(`army:${army.id}:${id}`);
    }
    army.memberIds = army.memberIds.filter((id) => !ids.has(id));
    if (!army.memberIds.length) this.disband(army);
    else if(casualty){army.revision++;const march=this.marches.get(army.id);for(const id of ids){march?.slots.delete(id);march?.planned.delete(id);march?.pending.delete(id);}}
    else this.restart(army);
  }
  private disband(army: Army): void {
    this.cancelPlanning(army.id);
    for (const id of army.memberIds) {
      this.membership.delete(id);
      this.world.cancelArmyRoute(`army:${army.id}:${id}`);
    }
    this.marches.delete(army.id);
    this.byArmyId.delete(army.id);
    this.externalActions.delete(army.id);
    this.armies.splice(this.armies.indexOf(army), 1);
  }
  private stop(army: Army): void {
    this.cancelPlanning(army.id);
    this.externalActions.delete(army.id);
    army.revision++;
    for (const id of army.memberIds)
      this.world.cancelArmyRoute(`army:${army.id}:${id}`);
    this.marches.delete(army.id);
    army.state = "holding";
    army.order = { type: "hold" };
    army.queuedOrders = [];
    army.reason = null;
  }
  private restart(army: Army): void {
    const order = army.order;
    if (order.type === "hold") {
      this.stop(army);
      return;
    }
    this.order(army, order);
  }
  private target(army: Army): Squad | undefined {
    const order = army.order;
    return attackOrder(order)
      ? this.world.squads.find(
          (s) =>
            s.id === order.targetId &&
            active(s) &&
            this.world.hostile(army.playerId, s.playerId),
        )
      : undefined;
  }
  // beforeCommit runs once, after every rejection and before the first write.
  private order(army: Army, order: ArmyOrder, append = false, prepared?:{path:number[];route:WorldPoint[];lengths:number[]}, beforeCommit?: () => void): string | null {
    if(order.type==="deploy"&&order.facing!==undefined&&(!Number.isFinite(order.facing)||Math.abs(order.facing)>Math.PI))return "Invalid army facing";
    const members = this.members(army).filter(s=>active(s)&&mayNavigateArmy({...this.controls,directArmyAction:()=>false,stance:()=>false},{...s,occupancy:undefined}));
    if (!members.length) return "Army has no available land squads";
    let tile: number;
    // Posture and planning state change only once the order is admitted, so a
    // rejected order leaves the army as it was (R2-L14).
    if (order.type === "hold") tile = pointTile(this.world.map, members[0]);
    else if (attackOrder(order)) {
      const target = this.world.squads.find(
        (s) =>
          s.id === order.targetId &&
          active(s) &&
          this.world.hostile(army.playerId, s.playerId),
      );
      if (!target) return "Choose a hostile land squad";
      tile = pointTile(this.world.map, target);
    } else tile = order.tile;
    const paths = this.world.squadPaths(army.playerId);
    if (!paths.walkable(tile))
      return paths.amphibious ? "Choose passable land or navigable water for the army" : "Choose passable land for the army";
    if (append && army.order.type!=="hold") {
      if(army.queuedOrders.length>=MAX_QUEUED_ORDERS)return "Army queue is full";
      beforeCommit?.();
      army.queuedOrders.push({...order});return null;
    }
    if (members.some((s) => !paths.connected(pointTile(this.world.map, s), tile)))
      return paths.amphibious ? "The army cannot reach that destination" : "Research Cargo Canoes to take the army across water";
    const objective = tilePoint(this.world.map, tile);
    const leader = [...members].sort(
      (a, b) =>
        distanceSquared(a, objective) - distanceSquared(b, objective) ||
        a.id - b.id,
    )[0];
    if(this.world.domainRoutes && !prepared && order.type!=="hold"){
      // The army's own pending plan is superseded by this order, so it frees a slot.
      let own=0;for(const plan of this.leaderAdmissions.values())if(plan.armyId===army.id)own++;
      if(this.leaderAdmissions.size-own>=128)return "Army planning is full";
      beforeCommit?.();
      this.externalActions.delete(army.id);
      this.cancelPlanning(army.id);
      // An admitted fire-retreat takes its posture now, as the direct path does.
      if(order.type==='fire-retreat')army.posture='skirmish';
      const routes=this.world.domainRoutes,id=1_000_000_000+this.nextAdmission++;
      const plan:ArmyLeaderAdmission={id,armyId:army.id,revision:army.revision,playerId:army.playerId,generation:routes.generation(army.playerId),obstacles:routes.revision(army.playerId, "army"),order:{...order},leaderId:leader.id,
        memberIds:members.map(s=>s.id),memberRevisions:members.map(s=>routes.orderRevision(s.id)),tile,start:pointTile(this.world.map,leader),requested:false,route:[{x:leader.x,y:leader.y}],lengths:[0],cursor:0,attempts:0,retryAt:0,queueLength:army.queuedOrders.length};
      this.leaderAdmissions.set(id,plan);routes.event("army",{id,playerId:army.playerId,tick:this.world.tick,status:"deferred"});return null;
    }
    const path = order.type==="hold"?[]:prepared?.path ?? this.world.squadPaths(army.playerId).find(
      pointTile(this.world.map, leader),
      tile,
      (t) => this.world.armyBlocked(t, army.playerId),
    );
    if (path === null)
      return "Army route is blocked; choose another destination";
    if (append && army.order.type !== "hold") {
      if (army.queuedOrders.length >= MAX_QUEUED_ORDERS)
        return "Army queue is full";
      beforeCommit?.();
      army.queuedOrders.push({ ...order });
      return null;
    }
    const retreatOrders=order.type==="regroup"&&(army.state==="fighting"||army.withdrawalTick!==undefined)?new Map(members.filter(s=>army.slots?.find(r=>r.squadId===s.id)?.role==="frontline").map(s=>[s.id,s.order])):undefined;
    beforeCommit?.();
    this.stop(army);
    army.withdrawalTick=retreatOrders?.size?this.world.tick:undefined;
    army.order = { ...order };
    if(order.type==='fire-retreat')army.posture='skirmish';
    if(order.type==="deploy"&&order.facing!==undefined){army.facing=order.facing;army.lastFacingTick=this.world.tick;}
    army.manual = true;
    army.leaderId = leader.id;
    army.x = leader.x;
    army.y = leader.y;
    for (const s of members) {
      this.world.updateSquad(s.id, { charge: null });
      this.world.updateSquad(s.id, { structureTarget: null });
      this.world.updateSquad(s.id, { queuedOrders: [] });
      this.world.setArmyHold(s);
      const previous=retreatOrders?.get(s.id);if(previous?.type==="attack")this.world.setArmyAttack(s,previous.targetId);
    }
    if (order.type === "hold") {
      return null;
    }
    const route = prepared?.route ?? [
      { x: leader.x, y: leader.y },
      ...path.map((t) => tilePoint(this.world.map, t)),
    ];
    if (route.length === 1) route.push(tilePoint(this.world.map, tile));
    const lengths = prepared?.lengths ?? [0];
    for (let i = prepared ? route.length : 1; i < route.length; i++)
      lengths.push(
        lengths[i - 1] +
          Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y),
      );
    const direction =
      route.find((p) => distanceSquared(p, leader) > FIXED * FIXED) ??
      route[route.length - 1];
    if (distanceSquared(direction, leader)&&!(order.type==="deploy"&&order.facing!==undefined))
      army.facing = Math.atan2(direction.y - leader.y, direction.x - leader.x);
    this.marches.set(army.id, {
      route,
      columnIds: [],
      lengths,
      cursor: Math.min(
        lengths[lengths.length - 1],
        (Math.ceil(members.length / 2) - 1) * FIXED * 1.1,
      ),
      slots: new Map(),
      planned: new Map(),
      pending: new Set(),
      speed: 0,
      started: this.world.tick,
      phaseTick: this.world.tick,
      retreating: false,
    });
    army.state = order.type === "regroup" ? "regrouping" : "assembling";
    return null;
  }
  speed(squad: Squad, ordinary: number): number {
    const army = this.armyOf(squad.id),
      march = army && this.marches.get(army.id);
    return army?.state === "marching" &&
      march &&
      !squad.fighting &&
      !squad.charge &&
      !squad.refit && !squad.manpower?.enlargement
      ? march.speed
      : ordinary;
  }
  private onRoute(march: March, distance: number): WorldPoint {
    distance = Math.max(0, distance);
    const { route, lengths } = march;
    // First segment whose accumulated length reaches the requested distance.
    // Equal-length vertices retain the previous interpolation/tie behavior.
    let low=1,high=route.length-1;
    while(low<high){const mid=(low+high)>>>1;if(lengths[mid]<distance)low=mid+1;else high=mid;}
    for (let i = low; i < route.length; i++)
      if (distance <= lengths[i] || i === route.length - 1) {
        const span = lengths[i] - lengths[i - 1],
          f = span ? Math.min(1, (distance - lengths[i - 1]) / span) : 0;
        return {
          x: Math.round(route[i - 1].x + (route[i].x - route[i - 1].x) * f),
          y: Math.round(route[i - 1].y + (route[i].y - route[i - 1].y) * f),
        };
      }
    return route[0];
  }
  private column(
    army: Army,
    march: March,
    members: Squad[],
  ): Map<number, WorldPoint> | null | undefined {
    const sorted = [...members].sort((a, b) => {
      const ai = march.columnIds.indexOf(a.id),
        bi = march.columnIds.indexOf(b.id);
      return ai < 0 ? (bi < 0 ? a.id - b.id : 1) : bi < 0 ? -1 : ai - bi;
    });
    const ideals = new Map<number, WorldPoint>();
    for (let i = 0; i < sorted.length; i++) {
      const d = march.cursor - Math.floor(i / 2) * FIXED * 1.1;
      const center = this.onRoute(march, d),
        ahead = this.onRoute(march, d + FIXED / 3),
        angle = Math.atan2(ahead.y - center.y, ahead.x - center.x);
      const side = ((i % 2) - 0.5) * FIXED * 0.95;
      let point = {
        x: Math.round(center.x - Math.sin(angle) * side),
        y: Math.round(center.y + Math.cos(angle) * side),
      };
      if (!march.columnIds.length) {
        let best = i;
        for (let j = i + 1; j < sorted.length; j++)
          if (
            distanceSquared(sorted[j], point) <
            distanceSquared(sorted[best], point)
          )
            best = j;
        [sorted[i], sorted[best]] = [sorted[best], sorted[i]];
      }
      // Single file in narrow corridors; never offset a slot across a coast or wall.
      if (
        !standable(this.world.map, point, squadRadius(sorted[i].kind), this.world.squadPaths(army.playerId).amphibious) ||
        this.world.armyBlocked(
          pointTile(this.world.map, point),
          army.playerId,
        ) ||
        !traversable(this.world.map, center, point, squadRadius(sorted[i].kind), this.world.squadPaths(army.playerId).amphibious)
      )
        point = this.onRoute(march, march.cursor - i * FIXED * 0.95);
      if(this.world.formationFits && !this.world.formationFits(sorted[i],point,angle-Math.PI/2)){
        // Certify a bounded lateral adjustment of the existing army column.
        // This changes aggregate slot placement, never individual soldier paths.
        for(let step=1;step<=4;step++){
          let found=false;
          for(const sign of [1,-1]){
            const adjusted={x:Math.round(point.x-Math.sin(angle)*step*FIXED/2*sign),y:Math.round(point.y+Math.cos(angle)*step*FIXED/2*sign)};
            if(this.world.formationFits(sorted[i],adjusted,angle-Math.PI/2) && standable(this.world.map,adjusted,squadRadius(sorted[i].kind),this.world.squadPaths(army.playerId).amphibious)){
              point=adjusted;found=true;break;
            }
          }
          if(found)break;
        }
      }
      ideals.set(sorted[i].id, point);
    }
    if (!march.columnIds.length) march.columnIds = sorted.map((s) => s.id);
    const center = pointTile(this.world.map, this.onRoute(march, march.cursor));
    // The column advances every tick. Waiting for a deferred formation search
    // on open ground stalls the whole march, so legal ideals are used as-is.
    if (this.world.domainRoutes && this.legalSlots(army, center, sorted, ideals)) {
      this.slotPlanning.delete(army.id);
      return ideals;
    }
    return this.planSlots(army,center,sorted,ideals);
  }
  /** The same per-slot legality FormationPlanning applies to a candidate. */
  private legalSlots(army: Army, center: number, members: Squad[], ideals: Map<number, WorldPoint>): boolean {
    const paths = this.world.squadPaths(army.playerId);
    return members.every((s) => {
      const point = ideals.get(s.id)!, tile = pointTile(this.world.map, point);
      return standable(this.world.map, point, squadRadius(s.kind), paths.amphibious) &&
        !this.world.armyBlocked(tile, army.playerId) &&
        paths.connected(center, tile) &&
        this.world.nearbyArmyEnemies(point, 2 * FIXED, army.playerId)
          .every((other) => distanceSquared(point, other) >= squadSeparation(s, other) ** 2);
    });
  }
  /** A short, straight, unobstructed step needs no admitted corridor. */
  private directMove(army: Army, march: March, s: Squad, slot: WorldPoint): boolean {
    if(!mayNavigateArmy(this.controls,s))return true;
    const paths = this.world.squadPaths(army.playerId), tile = pointTile(this.world.map, slot);
    if (
      distanceSquared(s, slot) > (DIRECT_STEP * FIXED) ** 2 ||
      this.world.armyBlocked(tile, army.playerId) ||
      !traversable(this.world.map, s, slot, squadRadius(s.kind), paths.amphibious)
    )
      return false;
    this.world.cancelArmyRoute(`army:${army.id}:${s.id}`);
    march.pending.delete(s.id);
    this.world.setArmyMove(s, slot, tile === pointTile(this.world.map, s) ? [] : [tile]);
    march.planned.set(s.id, slot);
    this.travelWork.directLegs++;
    return true;
  }
  /** Reuse a bounded section of the army corridor with checked root connectors.
   * Actual formation sweeps remain the simulation's per-member responsibility. */
  private followCorridor(army:Army,march:March,s:Squad,slot:WorldPoint):boolean {
    const clear=this.world.clearArmyLeg;
    if(!this.world.sharedArmyTravel||!clear||march.deployment||march.route.length<2)return false;
    let upper=1,high=march.lengths.length-1;
    while(upper<high){const mid=(upper+high)>>>1;if(march.lengths[mid]<march.cursor)upper=mid+1;else high=mid;}
    upper=Math.min(march.route.length-1,upper+4);
    let start=-1,goal=-1,startDistance=(DIRECT_STEP*FIXED)**2,goalDistance=startDistance;
    for(let i=upper,reads=0;i>=0&&reads++<96;i--){
      if(march.lengths[i]<march.cursor-40*FIXED)break;
      const point=march.route[i],from=distanceSquared(s,point),to=distanceSquared(slot,point);
      if(from<=startDistance){start=i;startDistance=from;}
      if(to<=goalDistance){goal=i;goalDistance=to;}
    }
    if(start<0||goal<0||Math.abs(start-goal)>24||!clear.call(this.world,s,march.route[start]))return false;
    const path:number[]=[];let previous:WorldPoint=s;
    const direction=start<=goal?1:-1;
    for(let i=start;;i+=direction){
      const point=march.route[i];
      if(!clear.call(this.world,{...s,x:previous.x,y:previous.y},point))return false;
      const tile=pointTile(this.world.map,point);if(path[path.length-1]!==tile)path.push(tile);
      previous=point;if(i===goal)break;
    }
    if(!clear.call(this.world,{...s,x:previous.x,y:previous.y},slot))return false;
    const tile=pointTile(this.world.map,slot);if(path[path.length-1]!==tile)path.push(tile);
    this.world.cancelArmyRoute(`army:${army.id}:${s.id}`);march.pending.delete(s.id);
    this.world.setArmyMove(s,slot,path);march.planned.set(s.id,slot);this.travelWork.sharedLegs++;
    return true;
  }
  private deploy(
    army: Army,
    march: March,
    members: Squad[],
    point: WorldPoint,
    flank = 0,
  ): Map<number, WorldPoint> | null | undefined {
    const cached = march.deployment;
    if (
      cached &&
      cached.flank === flank &&
      cached.geometry === String(army.slotRevision) &&
      Math.abs(cached.facing - army.facing) < 0.3 &&
      distanceSquared(cached.point, point) < FIXED * FIXED &&
      members.every((s) => cached.slots.has(s.id))
    )
      return new Map(cached.slots);
    this.syncSlots(army,this.members(army));
    const ideals=new Map<number,WorldPoint>();
    for(const slot of army.slots??[])if(members.some(s=>s.id===slot.squadId))ideals.set(slot.squadId,{
      x:Math.round(point.x+Math.cos(army.facing)*slot.depth-Math.sin(army.facing)*slot.lateral),
      y:Math.round(point.y+Math.sin(army.facing)*slot.depth+Math.cos(army.facing)*slot.lateral)});
    const slots = this.planSlots(army,
      pointTile(this.world.map, point),
      members,
      ideals,
    );
    if (slots)
      march.deployment = {
        point: { ...point },
        facing: army.facing,
        flank,
        slots: new Map(slots),
        geometry: String(army.slotRevision),
      };
    return slots;
  }
  private assign(
    army: Army,
    march: March,
    members: Squad[],
    slots: Map<number, WorldPoint> | null | undefined,
  ): boolean {
    if(slots===undefined)return false;
    members=members.filter(s=>mayNavigateArmy(this.controls,this.world.squad(s.id)??s));
    if(!members.length)return true;
    if(this.cohorts && slots){
      if([...this.cohortArmies.values()].some(link=>link.armyId===army.id))return false;
      // Marching slots creep forward every tick. Retarget short steps directly,
      // as the synchronous path does; only distant or obstructed members need
      // a transactional cohort admission (which pauses the march meanwhile).
      let needs=false;
      const recovery:Squad[]=[];
      for(const s of members){
        const slot=slots.get(s.id)!,planned=march.planned.get(s.id);
        if(distanceSquared(s,slot)<=(FIXED/5)**2)continue;
        if(planned && distanceSquared(planned,slot)<=(FIXED/3)**2){
          if(s.order.type==="move" && pointTile(this.world.map,planned)===pointTile(this.world.map,slot))
            this.world.updateSquad(s.id,{order:{...s.order,x:slot.x,y:slot.y}});
          continue;
        }
        if(!this.directMove(army,march,s,slot)&&!this.followCorridor(army,march,s,slot)){needs=true;recovery.push(s);}
      }
      if(needs){
        const reconnect=this.world.sharedArmyTravel?recovery:members;
        this.travelWork.recoveryMembers+=reconnect.length;
        march.slots=slots;
        const id=this.cohorts.start(army.playerId,reconnect,pointTile(this.world.map,slots.values().next().value!),new Map(reconnect.map(s=>[s.id,slots.get(s.id)!])));
        if(id!==undefined)this.cohortArmies.set(id,{armyId:army.id,revision:army.revision});
        return false;
      }
      march.slots=slots;return true;
    }
    if (!slots) {
      march.speed = 0;
      army.state = "blocked";
      army.reason =
        "No legal formation space. Regroup or detach obstructed members.";
      return false;
    }
    march.slots = slots;
    for (const s of members) {
      const point = slots.get(s.id)!;
      const planned = march.planned.get(s.id);
      if (
        planned &&
        s.queuedOrders.length &&
        distanceSquared(planned, point) < (FIXED / 3) ** 2
      )
        continue;
      if (
        planned &&
        distanceSquared(planned, point) < (FIXED / 3) ** 2 &&
        s.order.type === "move"
      ) {
        // A moving slot inside the same corridor needs no new long-distance path.
        if (
          pointTile(this.world.map, planned) ===
          pointTile(this.world.map, point)
        ) {
          this.world.updateSquad(s.id, { order: { ...s.order, x: point.x, y: point.y } });
          continue;
        }
      }
      if (
        distanceSquared(s, point) < (FIXED / 5) ** 2 ||
        march.pending.has(s.id)
      )
        continue;
      march.pending.add(s.id);
      this.world.queueArmyRoute(`army:${army.id}:${s.id}`, { armyId: army.id, squadId: s.id, revision: army.revision });
    }
    return true;
  }
  resolveRoute(request: ArmyRouteRequest): void {
    const army = this.byArmyId.get(request.armyId);
    const march = this.marches.get(request.armyId);
    const s = this.world.squad(request.squadId);
    if (!army || !march || !s) return;
        if (
          army.revision !== request.revision ||
          this.membership.get(s.id) !== army.id ||
          !active(s) || !mayNavigateArmy(this.controls,s)
        )
          return;
          march.pending.delete(s.id);
        const current = march.slots.get(s.id);
        if (!current) return;
        let via: WorldPoint[] | undefined;
        let path = this.world.squadPaths(army.playerId).find(
          pointTile(this.world.map, s),
          pointTile(this.world.map, current),
          (t) => this.world.armyBlocked(t, army.playerId),
        );
        // A unit deploying toward the rear leaves the column on its nearest
        // side before returning inward. This avoids opposing streams through
        // the same occupied files; every connector still uses the land router.
        const backward =
          (current.x - s.x) * Math.cos(army.facing) +
          (current.y - s.y) * Math.sin(army.facing);
        const lateralTravel =
          (current.x - s.x) * -Math.sin(army.facing) +
          (current.y - s.y) * Math.cos(army.facing);
        const mounted =
          this.world.unit(s).role === "mounted" &&
          this.world.unit(s).tags.includes("mounted");
        if (
          march.deployment &&
          (backward < -FIXED ||
            (mounted && Math.abs(lateralTravel) > FIXED * 2)) &&
          path !== null
        ) {
          const anchor = march.deployment.point;
          const sidePoint = mounted ? current : s;
          const side =
            (sidePoint.x - anchor.x) * -Math.sin(army.facing) +
              (sidePoint.y - anchor.y) * Math.cos(army.facing) >=
            0
              ? 1
              : -1;
          const nx = -Math.sin(army.facing) * side,
            ny = Math.cos(army.facing) * side;
          const exitIdeal = {
            x: Math.round(s.x + nx * FIXED * 4),
            y: Math.round(s.y + ny * FIXED * 4),
          };
          const rearIdeal = {
            x: Math.round(current.x + nx * FIXED * 4),
            y: Math.round(current.y + ny * FIXED * 4),
          };
          const safe = (p: WorldPoint) =>
            standable(this.world.map, p, squadRadius(s.kind), this.world.squadPaths(army.playerId).amphibious)
              ? this.world
                  .armySlots(
                    pointTile(this.world.map, p),
                    [s],
                    new Map([[s.id, p]]),
                    [...march.slots.values()],
                  )
                  ?.get(s.id)
              : undefined;
          const exit = safe(exitIdeal),
            rear = safe(rearIdeal);
          if (exit && rear) {
            const blocked = (t: number) =>
              this.world.armyBlocked(t, army.playerId);
            const head = this.world.squadPaths(army.playerId).find(
              pointTile(this.world.map, s),
              pointTile(this.world.map, exit),
              blocked,
            );
            const middle = this.world.squadPaths(army.playerId).find(
              pointTile(this.world.map, exit),
              pointTile(this.world.map, rear),
              blocked,
            );
            const tail = this.world.squadPaths(army.playerId).find(
              pointTile(this.world.map, rear),
              pointTile(this.world.map, current),
              blocked,
            );
            if (head && middle && tail) {
              path = head;
              via = [exit, rear];
            }
          }
        }
        if (path === null) {
          army.state = "blocked";
          army.reason = "A member has no legal route. Regroup or detach it.";
          march.speed = 0;
          return;
        }
        this.world.setArmyMove(s, current, path, via);
        march.planned.set(s.id, current);
  }
  private finish(army: Army): void {
    const queued = army.queuedOrders.shift();
    const rest = [...army.queuedOrders];
    this.stop(army);
    army.manual = false;
    if (queued) {
      const error = this.order(army, queued);
      army.queuedOrders = rest;
      if (error) {
        army.reason = error;
        army.state = "blocked";
      }
    }
  }
  step(): void {
    for (const army of [...this.armies]) {
      const members = this.members(army),
        live = new Set(members.map((s) => s.id)),
        lost = new Set(army.memberIds.filter((id) => !live.has(id)));
      if (lost.size) this.detach(army, lost,true);
      if (!this.armies.includes(army)) continue;
      // Diplomacy and target loss invalidate the objective even while route
      // admission or a blocked deployment prevents movement this tick.
      if (attackOrder(army.order) && !this.target(army)) {
        this.order(army, { type: "hold" });
        continue;
      }
      this.syncSlots(army,members);this.closeGap(army);
      if(this.externalActions.has(army.id)){
        if(members.every(s=>s.order.type==='hold'&&!s.charge&&!s.structureTarget)){army.manual=false;this.externalActions.delete(army.id);}else continue;
      }
      const available=members.filter(s=>active(s)&&mayNavigateArmy(this.controls,s));
      const leader=available.find(s=>s.id===army.leaderId)??available[0];
      if(!leader){army.reason='Members are under domain control';continue;}
      army.leaderId=leader.id;
      let march=this.marches.get(army.id);
      if(!march){
        army.x=leader.x;army.y=leader.y;
        if(!army.autoTactics||army.manual||!this.engagements?.planFor(army.id))continue;
        march={columnIds:[],route:[{x:army.x,y:army.y}],lengths:[0],cursor:0,slots:new Map(),planned:new Map(),pending:new Set(),speed:0,started:this.world.tick,phaseTick:this.world.tick,retreating:false};
        this.marches.set(army.id,march);
      }
      if(army.state==='blocked'||[...this.leaderAdmissions.values()].some(p=>p.armyId===army.id)||[...this.cohortArmies.values()].some(p=>p.armyId===army.id))continue;
      const target=this.target(army),atEnd=march.cursor>=march.lengths[march.lengths.length-1];
      const contact=!!target&&formationContact(leader,target,this.world.tick).gap<8*FIXED;
      const withdrawing=army.order.type==='regroup'&&army.withdrawalTick!==undefined;
      const deliberateMove=army.manual&&(army.order.type==="move"||army.order.type==="regroup")&&!this.world.players.find(p=>p.id===army.playerId)?.ai;
      // A deliberate march can be interrupted by a member's close-contact
      // Move-to-Attack transition; distant ranged fire alone retains the march.
      const ambush=!withdrawing&&available.some(s=>s.fighting&&(!deliberateMove||s.order.type==='attack'));
      if(!withdrawing&&(atEnd||contact||ambush||army.order.type==='deploy')){
        march.speed=0;
        const near=this.world.nearbyArmyEnemies(march.deployment?.point??leader,ENGAGEMENT.joinTiles*FIXED,army.playerId);
        if(!march.deployment){
          const enemy=target??near[0];
          if(enemy&&this.world.tick-(army.lastFacingTick??-LINES.facingRefreshTicks)>=LINES.facingRefreshTicks){
            const desired=Math.atan2(enemy.y-leader.y,enemy.x-leader.x),delta=Math.atan2(Math.sin(desired-army.facing),Math.cos(desired-army.facing));
            if(Math.abs(delta)>LINES.facingDeadband){army.facing=desired;army.lastFacingTick=this.world.tick;}
          }
        }
        // Once contact begins the deployment anchor/facing remain stable. Flank pressure is local.
        let anchor=march.deployment?.point??(target?{x:leader.x,y:leader.y}:march.route[march.route.length-1]);
        const plan=this.engagements?.planFor(army.id);
        if(plan?.posture==='advance'&&army.posture!=='defend'&&this.world.players.find(p=>p.id===army.playerId)?.ai&&this.world.tick-(army.lastAdvanceTick??march.started)>=ENGAGEMENT.refreshTicks&&!available.some(s=>s.fighting)){
          const goal=near.length?{x:near.reduce((n,s)=>n+s.x,0)/near.length,y:near.reduce((n,s)=>n+s.y,0)/near.length}:undefined;
          if(goal){const length=Math.hypot(goal.x-anchor.x,goal.y-anchor.y);if(length>3*FIXED){anchor={x:Math.round(anchor.x+(goal.x-anchor.x)/length*FIXED),y:Math.round(anchor.y+(goal.y-anchor.y)/length*FIXED)};march.deployment=undefined;army.lastAdvanceTick=this.world.tick;}}
        }
        army.x=anchor.x;army.y=anchor.y;
        army.state=near.length?'fighting':'deploying';
        if(army.order.type==='fire-retreat')army.posture='skirmish';
        const flank=army.order.type==='flank-left'?-1:army.order.type==='flank-right'?1:0;
        const slots=this.deploy(army,march,available,anchor,flank);if(!slots)continue;
        this.tacticalStep(army,march,available,slots,near);
        if(!near.length&&available.every(s=>distanceSquared(s,slots.get(s.id)!)<FIXED*FIXED)){
          if(army.autoTactics){army.state='holding';}else{available.forEach(s=>this.world.setArmyHold(s));this.finish(army);}
        }
        continue;
      }
      army.x=leader.x;army.y=leader.y;
      if(withdrawing&&this.world.tick-army.withdrawalTick!<LINES.rearWithdrawalTicks){
        const rear=available.filter(s=>army.slots?.find(r=>r.squadId===s.id)?.role!=='frontline');
        const slots=this.column(army,march,available);this.assign(army,march,rear,slots);continue;
      }
      if(withdrawing){for(const s of available)if(army.slots?.find(r=>r.squadId===s.id)?.role==="frontline"&&s.order.type==="attack"){this.world.setArmyHold(s);march.planned.delete(s.id);}}
      if(withdrawing&&atEnd)army.withdrawalTick=undefined;
      const slots = this.column(army, march, available);
      if (!this.assign(army, march, available, slots) || !slots) continue;
      const lag = Math.max(
        ...available.map((s) =>
          Math.sqrt(distanceSquared(s, slots.get(s.id)!)),
        ),
      );
      if (lag > FIXED * 6) {
        march.speed = 0;
        army.state = "assembling";
        army.reason = "Waiting for the rear of the column";
      } else {
        army.state = "marching";
        army.reason = null;
        // No charge, recovery, refit or fighting bonus can enter this calculation.
        march.speed = available.some((s) => s.charge || s.fighting&&!withdrawing&&!deliberateMove)
          ? 0
          : Math.floor(
              (this.world.sharedArmyTravel?1:1.1) *
                Math.min(...available.map((s) => this.world.ordinarySpeed(s))),
            );
        const previous = this.onRoute(march, march.cursor);
        march.cursor = Math.min(
          march.lengths[march.lengths.length - 1],
          march.cursor + march.speed * (lag > FIXED * 1.5 ? 0.4 : 0.85),
        );
        const point = this.onRoute(march, march.cursor);
        if (distanceSquared(point, previous))
          army.facing = Math.atan2(point.y - previous.y, point.x - previous.x);
      }
    }
  }
  reconcile(): void {
    for (const army of [...this.armies]) {
      const lost = new Set(
        army.memberIds.filter((id) => {
          const s = this.world.squad(id);
          return !s || s.playerId !== army.playerId || s.troops <= 0;
        }),
      );
      if (lost.size) this.detach(army, lost,true);
    }
  }
  snapshot(): Army[] {
    return this.armies.map((a) => ({
      ...a,
      memberIds: [...a.memberIds],slots:a.slots?.map(slot=>({...slot})),frontGaps:a.frontGaps?.map(gap=>({...gap})),
      order: { ...a.order },
      queuedOrders: a.queuedOrders.map((o) => ({ ...o })),
    }));
  }
}
