import { FormationOccupancy } from "../FormationOccupancy";
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
  standable,
  tilePoint,
  traversable,
} from "../SquadGeometry";
import { armyCapacity } from "../content/Armies";
import type { Army, ArmyOrder, UnitDefinition } from "./Definitions";
import type { Progression } from "./Progression";
import type { ArmyRouteRequest } from "./RouteTask";

// Coordination owns intent and membership; the existing simulation still owns
// every physical position, collision, shot, transport and pathfinding operation.
export interface ArmyWorld {
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
  armyBlocked(tile: number, playerId: number): boolean;
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
  transportArmy(squads: Squad[], tile: number): string | null;
  preferArmyTransport(squads: Squad[], tile: number): boolean;
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
const active = (s: Squad) => s.troops > 0 && s.embarkedOn === null && !s.refit;
const attackOrder = (
  o: ArmyOrder,
): o is Extract<ArmyOrder, { targetId: number }> => "targetId" in o;
export class Armies {
  checkpoint() { return structuredClone({armies:this.armies, membership:this.membership, marches:this.marches, externalActions:this.externalActions, nextId:this.nextId, leaderAdmissions:[...this.leaderAdmissions], nextAdmission:this.nextAdmission, cohorts:this.cohorts?.checkpoint(), cohortArmies:[...this.cohortArmies], slotPlanning:[...this.slotPlanning]}); }
  restore(saved: ReturnType<Armies["checkpoint"]>): void {
    const state=structuredClone(saved);
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
  private nextAdmission = 1;
  private readonly leaderAdmissions=new Map<number,ArmyLeaderAdmission>();
  private readonly cohortArmies=new Map<number,{armyId:number;revision:number;leaderId?:number}>();
  private occupancy?: FormationOccupancy;
  private readonly slotPlanning=new Map<number,{revision:number;formation:FormationPlanningState}>();
  private readonly cohorts?:CohortAdmission;
  constructor(
    private readonly world: ArmyWorld,
    private readonly progression: Progression,
  ) {
    if(world.domainRoutes)this.cohorts=new CohortAdmission("army",{
      map:world.map,paths:world.paths,squads:()=>world.squads,squad:id=>world.squad(id),routes:world.domainRoutes,
      blocked:id=>t=>world.armyBlocked(t,id),
      valid:(plan,squad)=>{const link=this.cohortArmies.get(plan.id),army=link&&this.byArmyId.get(link.armyId);return !!army && army.revision===link!.revision && this.membership.get(squad.id)===army.id;},
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
          world.setArmyMove(member.squad,member.point,member.path);
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
    if(task.stage==="cohort")return this.cohorts?.validRoute(task)??false;
    const plan=this.leaderAdmissions.get(task.admissionId);
    return !!plan && task.stage==="leader" && task.generation===plan.generation && this.leaderValid(plan);
  }
  completedRoute(task:DomainRouteTask,outcome:ExactRouteOutcome,path:number[]):void {
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
    if(plan && plan.revision!==army.revision){this.slotPlanning.delete(army.id);plan=undefined;}
    if(!plan){
      plan={revision:army.revision,formation:new FormationPlanning(this.world.map,this.world.paths,center,members.map(squad=>({squad,origin:squad})),()=>this.world.squads,Infinity,ideals).state};
      this.slotPlanning.set(army.id,plan);return undefined;
    }
    if(plan.formation.phase!=="done" && plan.formation.phase!=="failed")return undefined;
    this.slotPlanning.delete(army.id);
    return plan.formation.phase==="failed"?null:plan.formation.result;
  }
  stepPlanning(budget:number):number {
    const routes=this.world.domainRoutes;if(!routes)return 0;
    const occupancy = this.occupancy ??= new FormationOccupancy(this.world.map);
    if (this.slotPlanning.size) occupancy.rebuild(this.world.squads);
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
      while(plan.cursor<plan.path.length && used<budget){
        const point=tilePoint(this.world.map,plan.path[plan.cursor++]),last=plan.route[plan.route.length-1];
        plan.lengths.push(plan.lengths[plan.lengths.length-1]+Math.hypot(point.x-last.x,point.y-last.y));
        plan.route.push(point);used++;
      }
      if(plan.cursor<plan.path.length)continue;
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
      if(!army || army.revision!==plan.revision){this.slotPlanning.delete(id);continue;}
      const formation=new FormationPlanning(this.world.map,this.world.paths,plan.formation.center,[],()=>this.world.squads,Infinity,undefined,plan.formation,undefined,occupancy);
      used+=formation.step(Math.min(16,budget-used),t=>this.world.armyBlocked(t,army.playerId));
    }
    return used+(this.cohorts?.step(budget-used)??0);
  }
  capacity(playerId: number): number {
    return armyCapacity(this.progression.states[playerId]?.completed ?? []);
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
    return this.order(army, order, append);
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
        manual: false,
        revision: 0,
        reason: null,
      };
      this.armies.push(army);
      this.byArmyId.set(army.id, army);
      ids.forEach((id) => this.membership.set(id, army.id));
      return null;
    }
    if (
      !["army-members", "disband-army", "army-auto", "army-order"].includes(
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
            army.memberIds.push(id);
            this.membership.set(id, army.id);
          }
        army.memberIds.sort((a, b) => a - b);
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
  private detach(army: Army, ids: Set<number>): void {
    for (const id of ids) {
      this.membership.delete(id);
      this.world.cancelArmyRoute(`army:${army.id}:${id}`);
    }
    army.memberIds = army.memberIds.filter((id) => !ids.has(id));
    if (!army.memberIds.length) this.disband(army);
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
  private order(army: Army, order: ArmyOrder, append = false, prepared?:{path:number[];route:WorldPoint[];lengths:number[]}): string | null {
    const members = this.members(army).filter(active);
    if (!members.length) return "Army has no available land squads";
    let tile: number;
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
    if (!this.world.paths.walkable(tile))
      return "Choose passable land for the army";
    if (append && army.order.type!=="hold") {
      if(army.queuedOrders.length>=MAX_QUEUED_ORDERS)return "Army queue is full";
      army.queuedOrders.push({...order});return null;
    }
    if (
      members.some(
        (s) => !this.world.paths.connected(pointTile(this.world.map, s), tile),
      ) || (order.type === "move" && this.world.preferArmyTransport(members,tile))
    ) {
      if (order.type !== "move") return "Use a move order to transport the army across water";
      if (append && army.order.type !== "hold") {
        if (army.queuedOrders.length >= MAX_QUEUED_ORDERS) return "Army order queue is full";
        army.queuedOrders.push({...order}); return null;
      }
      const result = this.world.transportArmy(members,tile);
      if (result === null) {
        this.stop(army);
        army.manual = true;
        army.reason = "Crossing water";
        this.externalActions.add(army.id);
      }
      return result;
    }
    const objective = tilePoint(this.world.map, tile);
    const leader = [...members].sort(
      (a, b) =>
        distanceSquared(a, objective) - distanceSquared(b, objective) ||
        a.id - b.id,
    )[0];
    if(this.world.domainRoutes && !prepared && order.type!=="hold"){
      this.cancelPlanning(army.id);
      if(this.leaderAdmissions.size>=128)return "Army planning is full";
      const routes=this.world.domainRoutes,id=1_000_000_000+this.nextAdmission++;
      const plan:ArmyLeaderAdmission={id,armyId:army.id,revision:army.revision,playerId:army.playerId,generation:routes.generation(army.playerId),obstacles:routes.revision(army.playerId, "army"),order:{...order},leaderId:leader.id,
        memberIds:members.map(s=>s.id),memberRevisions:members.map(s=>routes.orderRevision(s.id)),tile,start:pointTile(this.world.map,leader),requested:false,route:[{x:leader.x,y:leader.y}],lengths:[0],cursor:0,attempts:0,retryAt:0,queueLength:army.queuedOrders.length};
      this.leaderAdmissions.set(id,plan);routes.event("army",{id,playerId:army.playerId,tick:this.world.tick,status:"deferred"});return null;
    }
    const path = order.type==="hold"?[]:prepared?.path ?? this.world.paths.find(
      pointTile(this.world.map, leader),
      tile,
      (t) => this.world.armyBlocked(t, army.playerId),
    );
    if (path === null)
      return "Army route is blocked; choose another destination";
    if (append && army.order.type !== "hold") {
      if (army.queuedOrders.length >= MAX_QUEUED_ORDERS)
        return "Army queue is full";
      army.queuedOrders.push({ ...order });
      return null;
    }
    this.stop(army);
    army.order = { ...order };
    army.manual = true;
    army.leaderId = leader.id;
    army.x = leader.x;
    army.y = leader.y;
    for (const s of members) {
      this.world.updateSquad(s.id, { charge: null });
      this.world.updateSquad(s.id, { structureTarget: null });
      this.world.updateSquad(s.id, { queuedOrders: [] });
      this.world.setArmyHold(s);
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
    if (distanceSquared(direction, leader))
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
      !squad.refit
      ? march.speed
      : ordinary;
  }
  private onRoute(march: March, distance: number): WorldPoint {
    distance = Math.max(0, distance);
    const { route, lengths } = march;
    for (let i = 1; i < route.length; i++)
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
        !standable(this.world.map, point, squadRadius(sorted[i].kind)) ||
        this.world.armyBlocked(
          pointTile(this.world.map, point),
          army.playerId,
        ) ||
        !traversable(this.world.map, center, point, squadRadius(sorted[i].kind))
      )
        point = this.onRoute(march, march.cursor - i * FIXED * 0.95);
      ideals.set(sorted[i].id, point);
    }
    if (!march.columnIds.length) march.columnIds = sorted.map((s) => s.id);
    const center = pointTile(this.world.map, this.onRoute(march, march.cursor));
    return this.planSlots(army,center,sorted,ideals);
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
      Math.abs(cached.facing - army.facing) < 0.3 &&
      distanceSquared(cached.point, point) < FIXED * FIXED &&
      members.every((s) => cached.slots.has(s.id))
    )
      return new Map(cached.slots);
    const ideals = new Map<number, WorldPoint>(),
      roles = ["frontline", "ranged", "mounted", "support"];
    const role = (s: Squad) => {
      const u = this.world.unit(s);
      return u.role === "mounted" && u.tags.includes("mounted")
        ? "mounted"
        : u.role === "frontline"
          ? "frontline"
          : u.role === "ranged"
            ? "ranged"
            : "support";
    };
    for (const r of roles) {
      const group = members
        .filter((s) => role(s) === r)
        .sort((a, b) => a.id - b.id);
      const columns = Math.max(1, Math.ceil(Math.sqrt(group.length))),
        rows = Math.ceil(group.length / columns);
      const pending = [...group];
      for (let i = 0; i < group.length; i++) {
        let lateral =
          ((i % columns) -
            (Math.min(
              columns,
              group.length - Math.floor(i / columns) * columns,
            ) -
              1) /
              2) *
          FIXED *
          2;
        let depth = -Math.floor(i / columns) * FIXED * 2;
        if (r === "ranged")
          depth -=
            FIXED *
            (2 +
              2 *
                Math.ceil(
                  Math.sqrt(
                    members.filter((s) => role(s) === "frontline").length,
                  ),
                ));
        if (r === "support") depth -= FIXED * (4 + rows);
        if (r === "mounted") {
          const wingSize = flank ? group.length : Math.ceil(group.length / 2);
          const wingColumns = Math.max(1, Math.ceil(Math.sqrt(wingSize)));
          const wingIndex = flank ? i : Math.floor(i / 2);
          const frontWidth = Math.ceil(
            Math.sqrt(members.filter((s) => role(s) === "frontline").length),
          );
          lateral =
            (flank || (i % 2 ? -1 : 1)) *
            FIXED *
            (frontWidth + 2 + (wingIndex % wingColumns) * 2);
          depth =
            FIXED *
            ((flank ? 2 : -1) - Math.floor(wingIndex / wingColumns) * 2);
        }
        const ideal = {
          x: Math.round(
            point.x +
              Math.cos(army.facing) * depth -
              Math.sin(army.facing) * lateral,
          ),
          y: Math.round(
            point.y +
              Math.sin(army.facing) * depth +
              Math.cos(army.facing) * lateral,
          ),
        };
        pending.sort(
          (a, b) =>
            distanceSquared(a, ideal) - distanceSquared(b, ideal) ||
            a.id - b.id,
        );
        ideals.set(pending.shift()!.id, ideal);
      }
    }
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
    if(this.cohorts && slots){
      if([...this.cohortArmies.values()].some(link=>link.armyId===army.id))return false;
      const needs=members.some(s=>distanceSquared(s,slots.get(s.id)!)>(FIXED/5)**2 &&
        (!march.planned.has(s.id) || distanceSquared(march.planned.get(s.id)!,slots.get(s.id)!)>(FIXED/3)**2));
      if(needs){
        const id=this.cohorts.start(army.playerId,members,pointTile(this.world.map,slots.values().next().value!),slots);
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
          !active(s)
        )
          return;
          march.pending.delete(s.id);
        const current = march.slots.get(s.id);
        if (!current) return;
        let via: WorldPoint[] | undefined;
        let path = this.world.paths.find(
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
            standable(this.world.map, p, squadRadius(s.kind))
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
            const head = this.world.paths.find(
              pointTile(this.world.map, s),
              pointTile(this.world.map, exit),
              blocked,
            );
            const middle = this.world.paths.find(
              pointTile(this.world.map, exit),
              pointTile(this.world.map, rear),
              blocked,
            );
            const tail = this.world.paths.find(
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
      if (lost.size) this.detach(army, lost);
      if (!this.armies.includes(army)) continue;
      const available = members.filter(active),
        leader = available.find((s) => s.id === army.leaderId) ?? available[0];
      if (!leader) {
        army.reason = "All members are embarked or refitting";
        continue;
      }
      army.leaderId = leader.id;
      army.x = leader.x;
      army.y = leader.y;
      const march = this.marches.get(army.id);
      if (!march) {
        if (
          army.manual &&
          this.externalActions.has(army.id) &&
          available.every(
            (s) => s.order.type === "hold" && !s.charge && !s.structureTarget,
          )
        ) {
          army.manual = false;
          this.externalActions.delete(army.id);
        }
        if (
          army.autoTactics &&
          !army.manual &&
          (this.world.tick + army.id) % 20 === 0
        ) {
          const target = this.world
            .nearbyArmyEnemies(leader, 12 * FIXED, army.playerId)
            .sort(
              (a, b) =>
                distanceSquared(leader, a) - distanceSquared(leader, b) ||
                a.id - b.id,
            )[0];
          if (target) {
            this.order(army, {
              type: available.some((s) => this.world.unit(s).role === "ranged")
                ? "fire-retreat"
                : "attack",
              targetId: target.id,
            });
            army.manual = false;
          }
        }
        continue;
      }
      if (army.state === "blocked" || [...this.leaderAdmissions.values()].some(plan=>plan.armyId===army.id) || [...this.cohortArmies.values()].some(link=>link.armyId===army.id)) continue;
      const target = this.target(army);
      if (attackOrder(army.order) && !target) {
        available.forEach((s) => this.world.setArmyHold(s));
        this.finish(army);
        continue;
      }
      const objective = target ?? march.route[march.route.length - 1],
        atEnd = march.cursor >= march.lengths[march.lengths.length - 1];
      if (
        target &&
        atEnd &&
        distanceSquared(target, march.route[march.route.length - 1]) >
          (12 * FIXED) ** 2
      ) {
        available.forEach((s) => this.world.setArmyHold(s));
        this.finish(army);
        continue;
      }
      const contact =
        target && distanceSquared(leader, target) <= (8 * FIXED) ** 2;
      const ambush =
        (army.state === "marching" || army.state === "fighting") &&
        available.some((s) => s.fighting);
      if (atEnd || contact || ambush || army.order.type === "deploy") {
        march.speed = 0;
        const near = this.world
          .nearbyArmyEnemies(leader, 12 * FIXED, army.playerId)
          .sort(
            (a, b) =>
              distanceSquared(leader, a) - distanceSquared(leader, b) ||
              a.id - b.id,
          );
        const enemy = target ?? near[0];
        const fighting =
          !!enemy && distanceSquared(leader, enemy) < (12 * FIXED) ** 2;
        if (enemy)
          army.facing = Math.atan2(enemy.y - leader.y, enemy.x - leader.x);
        const anchor = target
          ? {
              x: Math.round(target.x - Math.cos(army.facing) * FIXED * 3),
              y: Math.round(target.y - Math.sin(army.facing) * FIXED * 3),
            }
          : objective;
        army.state = fighting ? "fighting" : "deploying";
        const flank =
          army.order.type === "flank-left"
            ? -1
            : army.order.type === "flank-right"
              ? 1
              : 0;
        if (army.order.type === "fire-retreat" && fighting) {
          const ranged = available.filter(
            (s) => this.world.unit(s).attack.channel === "ranged",
          );
          // Withdraw after a real domain shot, then stop for the next cooldown.
          if (
            !march.retreating &&
            ranged.some((s) => (s.lastAttackTick ?? -1) >= march.phaseTick)
          ) {
            march.retreating = true;
            march.phaseTick = this.world.tick;
          }
          if (march.retreating && this.world.tick - march.phaseTick >= 40) {
            march.retreating = false;
            march.phaseTick = this.world.tick;
          }
        }
        const retreat = army.order.type === "fire-retreat" && march.retreating;
        const slots = this.deploy(army, march, available, anchor, flank);
        if (retreat && slots)
          for (const s of available.filter(
            (s) => this.world.unit(s).attack.channel === "ranged",
          )) {
            const slot = slots.get(s.id)!;
            slots.set(s.id, {
              x: Math.round(slot.x - Math.cos(army.facing) * FIXED * 2),
              y: Math.round(slot.y - Math.sin(army.facing) * FIXED * 2),
            });
          }
        if (!this.assign(army, march, available, slots)) continue;
        for (const s of available) {
          const slot = slots!.get(s.id)!;
          const range = this.world.unit(s).attack.range;
          const legalEnemy =
            enemy &&
            this.world.hostile(army.playerId, enemy.playerId) &&
            distanceSquared(enemy, anchor) < (10 * FIXED) ** 2;
          const flanker =
            flank &&
            this.world.unit(s).role === "mounted" &&
            this.world.unit(s).tags.includes("mounted");
          if (
            legalEnemy &&
            (!retreat || this.world.unit(s).attack.channel !== "ranged") &&
            (!flanker || distanceSquared(s, slot) < FIXED * FIXED) &&
            (distanceSquared(s, enemy) < range * range ||
              distanceSquared(s, slot) < FIXED * FIXED)
          ) {
            this.world.cancelArmyRoute(`army:${army.id}:${s.id}`);
            march.pending.delete(s.id);
            this.world.setArmyAttack(s, enemy.id);
          } else if (
            s.order.type === "attack" &&
            (!legalEnemy || distanceSquared(s, anchor) > (10 * FIXED) ** 2)
          )
            this.world.setArmyHold(s);
        }
        if (
          !fighting &&
          available.every(
            (s) => distanceSquared(s, slots!.get(s.id)!) < FIXED * FIXED,
          )
        ) {
          available.forEach((s) => this.world.setArmyHold(s));
          this.finish(army);
        }
        continue;
      }
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
        march.speed = available.some((s) => s.fighting || s.charge)
          ? 0
          : Math.floor(
              1.1 *
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
      if (lost.size) this.detach(army, lost);
    }
  }
  snapshot(): Army[] {
    return this.armies.map((a) => ({
      ...a,
      memberIds: [...a.memberIds],
      order: { ...a.order },
      queuedOrders: a.queuedOrders.map((o) => ({ ...o })),
    }));
  }
}
