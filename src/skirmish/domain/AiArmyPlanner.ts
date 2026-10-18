import { armyMissionCapacity, campaignSquadOrder } from "./AiCampaignPolicy";
import { secondsToTicks } from '../Protocol';
import { TrenchPositioning,validateTrenchMission,type TrenchMissionState } from "./TrenchPositioning";
import { HillPositioning, validateHillState, type HillState } from "./HillPositioning";
import { effectiveRange, maxEffectiveRange, elevationRangeAt } from "./ElevationAdvantage";
import { AI_BATTLE,BUDGETS,ENGAGEMENT } from '../content/TacticalRules';
import { preferredShape } from './TacticalEstimate';
import { formationDoctrine } from './FormationGeometry';
import { readyFraction, strengthFraction, manpowerCount } from './Manpower';
import { approachCandidate } from "./AiTacticalRoutes";
import { AiInvasionResponse } from "./AiInvasionResponse";
import { structureAim } from "./StructureTargeting";
import { tilePoint,pointTile } from "../SquadGeometry";
import { UNITS } from "../content/Units";
import { AGES } from "./Definitions";
import { unitRefitCost } from "./Refitting";
import { recruitmentVariant } from "../content/FormationRecipes";
import { conquestBuildings } from "./AiConquestObjective";
import { ARMY_ROUTE_BLOCKED } from "./Armies";
import { affordableAiCost } from "./AiBudgetLedger";
import { AI_DOCTRINES } from "../content/AiDoctrines";
import { personalityOf } from "../content/AiPersonalities";
import { FIXED, type Player, type Squad } from "../Protocol";
import type { AiEconomicDirector } from "./AiEconomicDirector";
import type { Expansion } from "./Expansion";
interface ArmyObjective {
  id: string;
  kind?:"combat"|"hold-position"|"hold-trench";
  trench?:TrenchMissionState;
  hill?:HillState;
  screenNeeded?:number;
  playerId: number;
  generation: number;
  phase:
    | "select"
    | "rally"
    | "assemble"
    | "advance"
    | "engage"
    | "recover"
    | "breach"
    | "replenish"
    | "refit"
    | "complete";
  created: number;
  since: number;
  deadline: number;
  nextThink: number;
  cursor: number;
  rosterIds: number[];
  home?: number;
  members: number[];
  armyId?: number;
  target?: number;
  targetTile?: number;
  initialTroops: number;
  reason: string;
  purpose?: "combat" | "coast" | "defense" | "screen";
  theatreId?:string;
  shapeTicks?:[number,number][];
  desiredSquads?:number;retire?:boolean;resizeCursor?:number;
  rejoined?: number;
  /** T-b: tick of the last standoff press order. */
  pressTick?: number;
  /** T-b: last tick at which at least AI_BATTLE.engagedShare of the members were fighting. */
  engagedTick?: number;
  /** I3: tick of a synchronous no-corridor rejection (the army itself is left untouched). */
  routeBlockedTick?: number;
  /** I4: building or squad objective tile, kept apart from the theatre's targetTile. */
  objectiveTile?: number;
  /** I4: no objective re-send before this tick after a rejected route. */
  objectiveRetryTick?: number;
  maneuver?: { enemy: number; targetTile: number; start: number; cursor: number; tile?: number; since: number };
  breach?: { scan: number; start: number; barrier?: number; building?: number; cursor: number; tile?: number; shooters: number[]; since: number };
}
/** M3 (owner decision OD-5, provisional): after a human-to-AI handover, the
 * human's armies have no AI mission and the AI never selects their members.
 * The planner disbands them after this grace; a reconnect within it cancels. */
export const ORPHAN_ARMY_GRACE_TICKS = secondsToTicks(10);
export class AiArmyPlanner {
  readonly invasion: AiInvasionResponse;
  readonly hillPositions:HillPositioning;
  readonly trenchPositions:TrenchPositioning;
  readonly missions = new Map<string, ArmyObjective>();
  readonly byPlayer = new Map<number,string[]>();
  private missionCursor=0;
  /** Handover tick per faction whose orphaned armies await disbanding (M3). */
  private readonly orphanSince = new Map<number, number>();
  private cursor = 0;
  private serial = 0;
  readonly diagnostics = { work: 0, commands: 0, rejected: 0, completed: 0 };
  constructor(
    private readonly expansion: Expansion,
    private readonly economy: AiEconomicDirector,
  ) { this.trenchPositions=new TrenchPositioning(expansion);this.hillPositions=new HillPositioning(expansion,economy.routes);this.invasion = new AiInvasionResponse(expansion, economy); }
  checkpoint() {
    return structuredClone({
      missions: [...this.missions],byPlayer:[...this.byPlayer],missionCursor:this.missionCursor,
      cursor: this.cursor,
      serial: this.serial,
      invasion: this.invasion.checkpoint(),
      orphans: [...this.orphanSince],
    });
  }
  /** Lifecycle subscriber: control of `playerId` moved to the AI or back. */
  controllerChanged(playerId: number, ai: boolean, tick: number): void {
    if (ai) this.orphanSince.set(playerId, tick);
    else this.orphanSince.delete(playerId);
  }
  private disbandOrphans(): void {
    const { world, armies } = this.expansion;
    for (const [playerId, since] of [...this.orphanSince]) {
      if (world.tick < since + ORPHAN_ARMY_GRACE_TICKS) continue;
      const player = world.players.find(p => p.id === playerId);
      if (!player?.ai || player.eliminated) { this.orphanSince.delete(playerId); continue; }
      const missionArmies = new Set((this.byPlayer.get(playerId) ?? []).map(id => this.missions.get(id)?.armyId));
      let fighting = false;
      for (const army of armies.armies.filter(a => a.playerId === playerId && !missionArmies.has(a.id))) {
        // An army in melee keeps its automatic tactics (handOverToAi) until the
        // fight ends; disbanding it then would strand its members without
        // orders mid-battle. It is disbanded on the first think after.
        if (army.memberIds.some(id => world.squad(id)?.fighting)) { fighting = true; continue; }
        world.applyCommand({ type: "disband-army", playerId, armyId: army.id });
      }
      if (!fighting) this.orphanSince.delete(playerId);
    }
  }
  restore(saved?: ReturnType<AiArmyPlanner["checkpoint"]>): void {
    this.invasion.restore(saved?.invasion);
    if(saved && (!Array.isArray(saved.missions)||!Array.isArray(saved.byPlayer)))throw Error("Invalid army mission checkpoint");
    this.missions.clear();this.byPlayer.clear();this.missionCursor=saved?.missionCursor??0;
    this.cursor = saved?.cursor ?? 0;
    this.serial = saved?.serial ?? 0;
    this.orphanSince.clear();
    for (const [playerId, since] of saved?.orphans ?? []) {
      if (!Number.isSafeInteger(playerId) || playerId < 1 || !Number.isSafeInteger(since) || since < 0 || this.orphanSince.has(playerId))
        throw Error("Invalid orphaned army checkpoint");
      this.orphanSince.set(playerId, since);
    }
    for (const [id, plan] of structuredClone(saved?.missions ?? []))
      {// The unreachable "flank" phase was removed (R2-L11); older saves resume as engage.
      if((plan.phase as string)==="flank")plan.phase="engage";
      validateTrenchMission(plan.trench);validateHillState(plan.hill,plan.kind);if(id!==plan.id||!Number.isSafeInteger(plan.playerId)||plan.playerId<1||!Number.isSafeInteger(plan.cursor)||plan.cursor<0||plan.cursor>plan.rosterIds.length||plan.members.length>60||new Set(plan.members).size!==plan.members.length||!["select","rally","assemble","advance","engage","recover","breach","replenish","refit","complete"].includes(plan.phase))throw Error("Invalid army mission");this.missions.set(id,plan);}
    for(const [id,rows] of structuredClone(saved?.byPlayer??[])){if(rows.length>4||new Set(rows).size!==rows.length||rows.some(key=>this.missions.get(key)?.playerId!==id))throw Error("Invalid army mission index");this.byPlayer.set(id,rows);}
    if([...this.missions.values()].some(p=>!(this.byPlayer.get(p.playerId)??[]).includes(p.id)))throw Error("Missing army mission index");
  }
  missionCap(player:Player):number{return armyMissionCapacity(this.expansion.armies.capacity(player.id),this.expansion.world.squadFacts().byOwner(player.id).filter(s=>s.troops>0).length);}
  /** Small read-only commitment quote; strategy never reads private mission state. */
  nonOffensiveCommitment(playerId:number){
    let defenseSlots=0,coastSlots=0,defenseSquads=0,coastSquads=0;
    for(const id of this.byPlayer.get(playerId)??[]){const plan=this.missions.get(id);if(!plan||plan.phase==="complete"||plan.purpose===undefined||plan.purpose==="combat")continue;
      if(plan.purpose==="coast"){coastSlots++;coastSquads+=plan.members.length;}else{defenseSlots++;defenseSquads+=plan.members.length;}
    }
    return {defenseSlots,coastSlots,defenseSquads,coastSquads};
  }
  private addMission(plan:ArmyObjective):void {this.missions.set(plan.id,plan);this.byPlayer.set(plan.playerId,[...(this.byPlayer.get(plan.playerId)??[]),plan.id]);}
  private refreshRoster(plan:ArmyObjective):void {
    plan.rosterIds=this.expansion.world.squadFacts().byOwner(plan.playerId).map(s=>s.id);
    // Both continuations index this roster. Neither survives its replacement.
    plan.cursor=0;
    plan.resizeCursor=0;
  }
  private releaseMission(plan:ArmyObjective):void {
    this.trenchPositions.release(plan,plan.members.map(id=>this.expansion.world.squad(id)).filter((s):s is Squad=>!!s));
    this.hillPositions.release(plan,this.expansion.armies.armies.find(a=>a.id===plan.armyId));
    this.economy.assets.release(plan.id);this.economy.routes.release(plan.id);
    const army=this.expansion.armies.armies.find(a=>a.id===plan.armyId&&a.playerId===plan.playerId);
    if(army)this.expansion.world.applyCommand({type:'disband-army',playerId:plan.playerId,armyId:army.id});
    this.missions.delete(plan.id);this.byPlayer.set(plan.playerId,(this.byPlayer.get(plan.playerId)??[]).filter(id=>id!==plan.id));
  }
  release(playerId:number):void {this.orphanSince.delete(playerId);this.invasion.release(playerId);this.releaseMissions(playerId);}
  /** Offensive missions only: an invasion response frees their squads but
   * keeps the faction's orphaned-army grace (M3) and its own response. */
  private releaseMissions(playerId:number):void {for(const id of [...(this.byPlayer.get(playerId)??[])]){const plan=this.missions.get(id);if(plan)this.releaseMission(plan);}this.byPlayer.delete(playerId);}
  acquireCoast(player:Player,tile:number):boolean {
    const {world}=this.expansion;
    if((this.byPlayer.get(player.id)?.length??0)>=this.missionCap(player)||!world.squadPaths(player.id).connected(player.base,tile))return false;
    this.addMission({id:'land-coast:'+player.id+':'+(++this.serial),playerId:player.id,generation:world.aiGeneration(player.id),phase:'select',created:world.tick,since:world.tick,deadline:world.tick+secondsToTicks(180),nextThink:world.tick,cursor:0,rosterIds:world.squadFacts().byOwner(player.id).map(s=>s.id),members:[],initialTroops:0,target:world.owners[tile]||undefined,targetTile:tile,purpose:'coast',reason:'Acquiring a useful reachable coast'});return true;
  }
  private eligible(squad: Squad, plan: ArmyObjective): boolean {
    const { world } = this.expansion;
    return (
      squad.playerId === plan.playerId &&
      strengthFraction(squad) >=
        AI_DOCTRINES[
          personalityOf(world.players.find((p) => p.id === plan.playerId)!).id
        ].minimumHealth / 1000 &&
      squad.embarkedOn === null &&
      !squad.refit &&
      !squad.manpower?.enlargement &&
      !squad.charge &&
      !squad.structureTarget &&
      !squad.fighting &&
      squad.order.type === "hold" &&
      !this.expansion.armies.armyOf(squad.id) &&
      !this.economy.assets.held(`squad:${squad.id}`) &&
      // Reachable by this faction's squads: amphibious factions cross water.
      world.squadPaths(plan.playerId).connected(
        world.tileOf(squad),
        world.players.find((p) => p.id === plan.playerId)!.base,
      )
    );
  }
  private order(
    plan: ArmyObjective,
    order: import("./Definitions").ArmyOrder,
  ): boolean {
    const rejected = this.expansion.world.applyCommand({
      type: "army-order",
      playerId: plan.playerId,
      armyId: plan.armyId!,
      order,
    });
    this.diagnostics.commands++;
    if (rejected) {
      this.diagnostics.rejected++;
      plan.reason = rejected;
      if (rejected === ARMY_ROUTE_BLOCKED) plan.routeBlockedTick = this.expansion.world.tick;
      return false;
    }
    plan.routeBlockedTick = undefined;
    return true;
  }
  step(budget:number=BUDGETS.armyMissions):number {
    this.hillPositions.beginTick();
    if (this.orphanSince.size) this.disbandOrphans();
    budget=Math.min(budget,BUDGETS.armyMissions);
    const {world,armies,operations}=this.expansion;this.diagnostics.work=0;
    if(budget<=0||!world.options?.deferredPlanning||!world.players.length)return 0;
    let player:Player|undefined;
    for(let n=0;n<world.players.length;n++){const p=world.players[this.cursor++%world.players.length];if(this.economy.enabled(p)){player=p;break;}}
    if(!player)return 0;
    const defense=this.invasion.step(player,Math.min(budget,BUDGETS.missionQuantum),()=>this.releaseMissions(player!.id));
    let total=defense;
    const cap=this.missionCap(player),ids=this.byPlayer.get(player.id)??[];
    for(const id of [...ids]){const p=this.missions.get(id);if(p&&(p.generation!==world.aiGeneration(player.id)||!cap||p.phase==='complete'&&world.tick>=p.nextThink))this.releaseMission(p);}
    if(!this.invasion.blocking(player.id)&&cap>0&&world.tick>=personalityOf(player).raidAfterTicks){
      const occupied=new Set((this.byPlayer.get(player.id)??[]).map(id=>this.missions.get(id)?.theatreId));
      let theatres=[...operations.theatres(player.id)];
      if(!operations.enabled(player)){
        const rival=world.players.filter(p=>p.id!==player!.id&&!p.eliminated&&world.hostile(player!.id,p.id)&&world.squadPaths(player!.id).connected(player!.base,p.base)).sort((a,b)=>world.map.euclideanDistSquared(player!.base,a.base)-world.map.euclideanDistSquared(player!.base,b.base)||a.id-b.id)[0];
        if(rival)theatres=[{id:'offense:'+rival.id,purpose:'offense',tile:rival.base,target:rival.id,priority:2,desiredSquads:Math.max(2,world.squadFacts().byOwner(player.id).filter(s=>s.troops>0).length-Math.ceil(world.squadFacts().byOwner(player.id).length*AI_DOCTRINES[personalityOf(player).id].reservePercent/100))}];
      }
      // Additional armies may support a large offensive, with independent leases and recovery.
      const defensive=theatres.filter(t=>t.purpose!=='offense').length;
      const intents=theatres.flatMap(t=>{const n=t.purpose==='offense'?Math.max(1,Math.min(cap-defensive,Math.ceil(t.desiredSquads/Math.max(2,armies.capacity(player!.id))))):1;return Array.from({length:n},(_,i)=>({...t,id:t.id+':'+i,desiredSquads:Math.min(armies.capacity(player!.id),Math.floor(t.desiredSquads/n)+(i<t.desiredSquads%n?1:0))}));});
      const desired=new Map(intents.map(t=>[t.id,t]));
      for(const id of this.byPlayer.get(player.id)??[]){const plan=this.missions.get(id)!;if(plan.purpose==='coast')continue;const intent=desired.get(plan.theatreId??'');if(!intent){plan.retire=true;continue;}plan.desiredSquads=plan.screenNeeded?Math.min(armies.capacity(player.id),Math.max(intent.desiredSquads,plan.members.length+plan.screenNeeded)):intent.desiredSquads;plan.target=intent.target;plan.targetTile=intent.tile;}
      for(const t of intents){if((this.byPlayer.get(player.id)?.length??0)>=cap)break;if(occupied.has(t.id)||!world.squadPaths(player.id).connected(player.base,t.tile))continue;
        this.addMission({id:'land-army:'+player.id+':'+(++this.serial),theatreId:t.id,desiredSquads:t.desiredSquads,playerId:player.id,generation:world.aiGeneration(player.id),phase:'select',created:world.tick,since:world.tick,deadline:world.tick+secondsToTicks(180),nextThink:world.tick,cursor:0,rosterIds:world.squadFacts().byOwner(player.id).map(s=>s.id),members:[],target:t.target,targetTile:t.tile,home:t.purpose==='offense'?player.base:t.tile,purpose:t.purpose==='offense'?'combat':t.purpose,initialTroops:0,reason:'Selecting a roster for '+t.purpose});
      }
    }
    const runnable=[...this.missions.values()].filter(p=>!this.invasion.blocking(p.playerId)&&this.economy.enabled(world.players.find(a=>a.id===p.playerId)!));
    if(runnable.length){const start=this.missionCursor%runnable.length;
      for(let n=0;n<runnable.length&&total<budget;n++){
        const plan=runnable[(start+n)%runnable.length],owner=world.players.find(p=>p.id===plan.playerId)!;this.missionCursor=start+n+1;
        if(world.tick<plan.nextThink)continue;
        this.diagnostics.work=0;this.stepMission(owner,plan,Math.min(BUDGETS.missionQuantum,budget-total));total+=Math.max(1,this.diagnostics.work);
      }
    }
    this.diagnostics.work=total;return total;
  }
  private stepMission(player:Player,plan:ArmyObjective,budget:number):number {
    const {world,armies,operations}=this.expansion,profile=personalityOf(player),doctrine=AI_DOCTRINES[profile.id];
    if(plan.generation!==world.aiGeneration(player.id)){this.releaseMission(plan);return this.diagnostics.work;}
    if(world.tick<plan.nextThink)return this.diagnostics.work;
    if(plan.retire&&plan.phase==='select'){this.releaseMission(plan);return this.diagnostics.work;}
    if (plan.phase === "select") {
      const own = plan.rosterIds;
      while (plan.cursor < own.length && this.diagnostics.work < budget) {
        const squad = world.squad(own[plan.cursor++]);
        this.diagnostics.work++;
        if (squad && this.eligible(squad, plan)) plan.members.push(squad.id);
      }
      if (plan.cursor < own.length) return this.diagnostics.work;
      const available = plan.members
        .map((id) => world.squad(id)!)
        .filter((s) => s && this.eligible(s, plan!));
      const reserve = operations.recruitmentObjective(player.id) ? operations.invasionReserve(player.id, available.length) : Math.max(
          operations.offensiveTarget(player.id) !== undefined ? 0 : 2,
          operations.offensiveTarget(player.id) !== undefined && available.length < profile.minimumRaidSquads ? 0 : Math.ceil((available.length * doctrine.reservePercent) / 100),
        ),
        maximum = Math.min(
          plan.desiredSquads??armies.capacity(player.id),
          armies.capacity(player.id),
          available.length - reserve,
          Math.max(2,Math.floor((world.squadFacts().byOwner(player.id).filter(s=>s.troops>0).length-reserve)/Math.max(1,this.byPlayer.get(player.id)?.length??1))),
        );
      if (
        maximum <
        Math.min(plan.purpose==="defense"||plan.purpose==="screen"||operations.offensiveTarget(player.id)!==undefined?2:profile.minimumRaidSquads, armies.capacity(player.id))
      ) {
        this.refreshRoster(plan);
        plan.members = [];
        plan.nextThink = world.tick + secondsToTicks(10);
        plan.reason = "Retaining mobile reserve while filling role shortfalls";
        return this.diagnostics.work;
      }
      available.sort((a, b) => campaignSquadOrder(this.expansion, player!, a, b));
      plan.members = available.slice(0, maximum).map((s) => s.id);
      plan.initialTroops = plan.members.reduce(
        (n, id) => { const squad=world.squad(id)!;return n+manpowerCount(this.expansion.unit(squad),squad.manpower?.model,squad.troops); },
        0,
      );
      if (
        !this.economy.assets.acquire(
          plan.members.map((id) => ({
            asset: `squad:${id}` as const,
            playerId: player!.id,
            generation: plan!.generation,
            controller: plan!.id,
            priority: (plan!.purpose==="defense"?"defense":"operation") as "defense"|"operation",
            createdTick: world.tick,
            expiresTick: plan!.deadline+secondsToTicks(40),
          })),
        )
      ) {
        plan.nextThink = world.tick + secondsToTicks(3);
        plan.cursor = 0;
        plan.members = [];
        return this.diagnostics.work;
      }
      const rejected = world.applyCommand({
        type: "create-army",
        playerId: player.id,
        squadIds: plan.members,
      });
      this.diagnostics.commands++;
      if (rejected) {
        this.economy.assets.release(plan.id);
        plan.reason = rejected;
        plan.nextThink = world.tick + secondsToTicks(10);
        plan.cursor = 0;
        plan.members = [];
        this.diagnostics.rejected++;
        return this.diagnostics.work;
      }
      plan.armyId = armies.armyOf(plan.members[0])!.id;
      world.applyCommand({
        type: "army-auto",
        playerId: player.id,
        armyId: plan.armyId,
        enabled: false,
      });
      if (
        this.order(plan, { type: "regroup", tile: plan.home ?? player.base })
      ) {
        plan.phase = "rally";
        plan.since = world.tick;
        plan.reason = "Rallying through transactional Army admission";
      } else {
        world.applyCommand({
          type: "disband-army",
          playerId: player.id,
          armyId: plan.armyId,
        });
        this.economy.assets.release(plan.id);
        plan.phase = "complete";
        plan.nextThink = world.tick + secondsToTicks(10);
      }
      return this.diagnostics.work;
    }
    const army = armies.armies.find((a) => a.id === plan!.armyId),
      members = plan.members
        .map((id) => world.squad(id))
        .filter(
          (s): s is Squad => !!s && s.playerId === player!.id && s.troops > 0,
        );
    if (
      !members.length || (!army && plan.phase !== "replenish" && plan.phase !== "refit") ||
      members.some((s) => !this.economy.assets.owns(`squad:${s.id}`, plan!.id))
    ) {
      // Only the failing mission is torn down; sibling armies keep their leases.
      this.releaseMission(plan);
      return this.diagnostics.work;
    }
    plan.members=members.map(s=>s.id);
    if(plan.retire&&!['recover','replenish','refit','complete'].includes(plan.phase)){
      if(this.order(plan,{type:'regroup',tile:player.base})){plan.phase='recover';plan.home=player.base;plan.since=world.tick;plan.nextThink=world.tick+secondsToTicks(2);plan.reason='Theatre ended; returning roster before releasing leases';}return this.diagnostics.work;
    }
    const desired=Math.min(plan.desiredSquads??members.length,armies.capacity(player.id));
    if(army&&['rally','assemble','advance','engage'].includes(plan.phase)&&!members.some(s=>s.fighting||s.charge||s.cavalryEngagement)&&members.length!==desired){
      if(members.length>desired){
        const remove=[...members].sort((a,b)=>(army.slots?.find(r=>r.squadId===b.id)?.role==='reserve'?1:0)-(army.slots?.find(r=>r.squadId===a.id)?.role==='reserve'?1:0)||b.id-a.id)[0];
        this.diagnostics.work++;if(!world.applyCommand({type:'army-members',playerId:player.id,armyId:army.id,squadIds:[remove.id],action:'remove'})){
          plan.initialTroops=Math.max(0,plan.initialTroops-manpowerCount(this.expansion.unit(remove),remove.manpower?.model,remove.troops));
          plan.members=plan.members.filter(id=>id!==remove.id);this.economy.assets.retain(plan.id,new Set(plan.members.map(id=>`squad:${id}` as const)));
          world.applyCommand({type:'order',playerId:player.id,squadIds:[remove.id],order:{type:'move',tile:player.base}});plan.nextThink=world.tick+secondsToTicks(2);
        }return this.diagnostics.work;
      }
      while(this.diagnostics.work<budget){
        const cursor=plan.resizeCursor??0;
        if(cursor>=plan.rosterIds.length){this.refreshRoster(plan);break;}
        plan.resizeCursor=cursor+1;this.diagnostics.work++;const recruit=world.squad(plan.rosterIds[cursor]);if(!recruit||!this.eligible(recruit,plan)||(plan.screenNeeded??0)>0&&this.expansion.unit(recruit).role!=="frontline")continue;
        if(this.economy.assets.acquire([{asset:`squad:${recruit.id}`,playerId:player.id,generation:plan.generation,controller:plan.id,priority:plan.purpose==='defense'?'defense':'operation',createdTick:world.tick,expiresTick:plan.deadline+secondsToTicks(40)}])){
          if(!world.applyCommand({type:'army-members',playerId:player.id,armyId:army.id,squadIds:[recruit.id],action:'add'})){plan.members.push(recruit.id);if((plan.screenNeeded??0)>0)plan.screenNeeded!--;plan.initialTroops+=manpowerCount(this.expansion.unit(recruit),recruit.manpower?.model,recruit.troops);}
          else this.economy.assets.retain(plan.id,new Set(plan.members.map(id=>`squad:${id}` as const)));
          plan.nextThink=world.tick+secondsToTicks(2);return this.diagnostics.work;
        }
      }
    }
    if(plan.hill&&(!["advance","engage"].includes(plan.phase)||plan.retire))this.hillPositions.release(plan,army);
    const target = world.players.find((p) => p.id === plan!.target),
      troops = members.reduce((n, s) => n + manpowerCount(this.expansion.unit(s),s.manpower?.model,s.troops), 0);
    if(operations.sustaining(player.id,plan.target ?? 0) && plan.deadline < world.tick+secondsToTicks(10)) {
      plan.deadline=world.tick+secondsToTicks(10);
      this.economy.assets.acquire(members.map(s=>({...this.economy.assets.leases.get(`squad:${s.id}`)!,expiresTick:plan!.deadline+secondsToTicks(40)})));
    }
    if (
      !["recover","replenish","refit"].includes(plan.phase) &&
      ((world.tick >= plan.deadline && !operations.sustaining(player.id,plan.target ?? 0)) ||
        (plan.purpose !== "coast" && (!target || target.eliminated || !world.hostile(player.id, target.id) ||
          (operations.enabled(player) && !operations.canTarget(player.id,target.id)))) ||
        (plan.purpose === "coast" && plan.targetTile !== undefined &&
          world.owners[plan.targetTile] !== player.id && operations.enabled(player) &&
          !operations.canEnter(player.id,world.owners[plan.targetTile],plan.targetTile)) ||
        troops < plan.initialTroops * 0.55 &&
          // T-b: do not regroup while ahead in a live engagement, nor turn a line in
          // melee contact into a rout unless it is clearly losing.
          !(army && (this.expansion.engagements.advantageFor(army.id) ?? 0) >=
            (members.some(s=>s.fighting) ? ENGAGEMENT.withdrawBelow : AI_BATTLE.pressOnAdvantage)))
    ) {
      if (
        this.order(plan, { type: "regroup", tile: plan.home ?? player.base })
      ) {
        plan.phase = "recover";
        plan.since = world.tick; this.economy.routes.release(plan.id);
        const detached=members.filter(s=>!armies.armyOf(s.id));
        if(detached.length)world.applyCommand({type:"order",playerId:player.id,squadIds:detached.map(s=>s.id),order:{type:"move",tile:plan.home??player.base}});
        plan.reason = "Returning survivors through the same movement owner";
      }
    }
    if(plan.trench&&(!["advance","engage"].includes(plan.phase)||plan.retire))this.trenchPositions.release(plan,members);
    if(army&&["advance","engage"].includes(plan.phase)&&this.trenchPositions.step(plan,player,army,members,o=>this.order(plan,o))){plan.nextThink=world.tick+secondsToTicks(2);return Math.max(1,this.diagnostics.work);}
    if(army&&["advance","engage"].includes(plan.phase)&&this.hillPositions.step(plan,player,army,members,personalityOf(player).id,o=>this.order(plan,o))){
      plan.nextThink=world.tick+secondsToTicks(2);return Math.max(1,this.diagnostics.work);
    }
    if (
      plan.phase === "rally" &&
      members.every(
        (s) =>
          world.map.euclideanDistSquared(
            world.tileOf(s),
            plan!.home ?? player!.base,
          ) <
          12 ** 2,
      )
    ) {
      plan.phase = "assemble";
      plan.since = world.tick;
    } else if (
      plan.phase === "assemble" &&
      world.tick - plan.since >= doctrine.assemblyTicks
    ) {
      if (
        plan.targetTile !== undefined &&
        (!operations.enabled(player) ||
          operations.canEnter(player.id, plan.target!, plan.targetTile)) &&
        this.order(plan, { type: "move", tile: plan.targetTile })
      ) {
        plan.phase = "advance";
        plan.since = world.tick;
        plan.reason = "Supported Army advancing on its committed region";
      }
    } else if(plan.phase==="breach"){
      const b=plan.breach!,forts=this.expansion.fortifications;
      const wall=b.barrier===undefined?undefined:forts.barrier(b.barrier),building=b.building===undefined?undefined:world.building(b.building);
      if(b.barrier===undefined && b.building===undefined){
        // I3: a corridor can be refused far from the wall (the army stops where it stood).
        // Then the nearest hostile wall guarding the objective is the breach target.
        if(b.scan===0&&plan.targetTile!==undefined){
          const goal=plan.targetTile;let best:{id:number;d:number}|undefined;
          for(const w of forts.barriers){
            if(w.kind==="trench"||w.health<=0||!w.tiles.length||!world.hostile(player.id,w.playerId)||operations.enabled(player)&&!operations.canTarget(player.id,w.playerId))continue;
            if(world.map.euclideanDistSquared(w.tiles[0],goal)>AI_BATTLE.breachObjectiveTiles**2)continue;
            const d=world.map.euclideanDistSquared(w.tiles[0],b.start);
            if(!best||d<best.d||d===best.d&&w.id<best.id)best={id:w.id,d};
          }
          this.diagnostics.work+=Math.ceil(forts.barriers.length/32);
          if(best){b.barrier=best.id;b.since=world.tick;}
        }
        while(b.barrier===undefined&&b.scan<81 && this.diagnostics.work<Math.min(budget,8)){
          const x=world.map.x(b.start)+(b.scan%9)-4,y=world.map.y(b.start)+Math.floor(b.scan/9)-4;b.scan++;this.diagnostics.work++;
          if(x<0||y<0||x>=world.map.width()||y>=world.map.height())continue;
          const tile=world.map.ref(x,y),barrier=forts.barriersAt(tile).find(w=>w.kind!=="trench"&&w.health>0&&world.hostile(player.id,w.playerId)&&
            (!operations.enabled(player)||operations.canTarget(player.id,w.playerId)));
          if(barrier){b.barrier=barrier.id;break;}
          const tower=world.buildingsAt(tile).find(t=>t.type==="tower"&&(t.health??1)>0&&world.hostile(player.id,t.playerId)&&
            (!operations.enabled(player)||operations.canTarget(player.id,t.playerId)));
          if(tower){b.building=tower.id;break;}
        }
        if(b.scan>=81&&b.barrier===undefined&&b.building===undefined){this.order(plan,{type:"regroup",tile:plan.home??player.base});plan.phase="recover";plan.since=world.tick;plan.reason="Blocked approach has no supported local breach target";}
      } else if(!wall && !building || (wall?.health??building?.health??0)<=0 ||
        !world.hostile(player.id,(wall??building)!.playerId)){
        this.economy.routes.release(plan.id);plan.phase="advance";plan.breach=undefined;
        if(plan.targetTile!==undefined)this.order(plan,{type:"move",tile:plan.targetTile});plan.reason="Breach opened or structure access changed";
      } else {
        const shooters=b.shooters.map(id=>world.squad(id)).filter((s):s is Squad=>!!s&&s.playerId===player!.id&&readyFraction(s)>=.5);
        const tiles=wall?.tiles??[building!.tile],range=Math.min(...shooters.map(s=>maxEffectiveRange(this.expansion.unit(s).attack)));
        if(!shooters.length || members.filter(s=>this.expansion.unit(s).role==="frontline"&&readyFraction(s)>=.5).length<2 || world.tick-b.since>secondsToTicks(30)){
          this.order(plan,{type:"regroup",tile:plan.home??player.base});plan.phase="recover";plan.since=world.tick;plan.reason="Breach support lost; protecting survivors";
        } else if(b.tile===undefined){
          // Several cheap candidate checks per think; one exact route request at a time.
          for(let tries=0;tries<AI_BATTLE.breachCandidatesPerThink&&b.tile===undefined&&b.cursor<24;tries++){
            const tile=approachCandidate(world.map,tiles[0],range,b.cursor);this.diagnostics.work++;
            if(tile===undefined || forts.blocked(tile,player.id) || !world.paths.walkable(tile) ||
              !structureAim(tilePoint(world.map,tile),tiles,range,player.id,world.map.width(),forts)){b.cursor++;continue;}
            const route=this.economy.routes.request(plan.id,player.id,b.start,tile);
            if(route.pending)break;
            if(route.path&&this.order(plan,{type:"move",tile})){b.tile=tile;b.since=world.tick;plan.reason="Bringing siege and escort to a legal firing approach";}else b.cursor++;
          }
          if(b.cursor>=24){this.order(plan,{type:"regroup",tile:plan.home??player.base});plan.phase="recover";plan.since=world.tick;plan.reason="No certified protected siege approach";}
        } else {
          // Siege actively firing on the structure, or the escort still marching to its
          // firing approach, is progress rather than a stalled breach.
          if(army&&army.order.type==="move"&&army.order.tile===b.tile&&["assembling","marching"].includes(army.state))b.since=world.tick;
          // An approach march refused after admission leaves the army holding short: try the next approach.
          else if(army&&army.order.type!=="move"&&!this.expansion.armies.admissionPending(army.id)&&
            members.filter(s=>this.expansion.unit(s).role==="frontline").some(s=>world.map.euclideanDistSquared(world.tileOf(s),b.tile!)>6**2)){b.tile=undefined;b.cursor++;}
          if(shooters.some(s=>s.structureTarget&&(!!wall&&s.structureTarget.barrierId===wall.id||!!building&&s.structureTarget.buildingId===building.id)))b.since=world.tick;
          const ready=shooters.filter(s=>!s.structureTarget&&structureAim(s,tiles,elevationRangeAt(world,s,this.expansion.unit(s).attack),player.id,world.map.width(),forts));
          if(ready.length && members.filter(s=>this.expansion.unit(s).role==="frontline").every(s=>world.map.euclideanDistSquared(world.tileOf(s),b.tile!)<=6**2)){
            world.applyCommand({type:"attack-structure",playerId:player.id,squadIds:ready.map(s=>s.id),barrierId:wall?.id,buildingId:building?.id});
            plan.reason="Researched siege firing with a physical escort";
          }
        }
      }
    } else if (plan.phase === "advance" || plan.phase === "engage") {
      if(plan.purpose==="coast" && plan.targetTile!==undefined && world.owners[plan.targetTile]===player.id){
        this.order(plan,{type:"regroup",tile:plan.home??player.base});plan.phase="recover";plan.since=world.tick;plan.reason="Coastal objective physically captured";
      } else if(army?.state==="blocked"||plan.routeBlockedTick!==undefined){
        plan.routeBlockedTick=undefined;
        const siege=members.filter(s=>["siege","artillery"].includes(this.expansion.unit(s).role)&&
          this.expansion.progression.has(player!.id,this.expansion.unit(s).technologyId)&&
          this.expansion.unit(s).attack.targets.some(t=>t==="wall"||t==="structure"));
        if(siege.length&&members.filter(s=>this.expansion.unit(s).role==="frontline").length>=2){
          this.order(plan,{type:"hold"});plan.phase="breach";plan.breach={scan:0,start:world.tileOf(army??members[0]),cursor:0,shooters:siege.map(s=>s.id),since:world.tick};
        } else {this.order(plan,{type:"regroup",tile:plan.home??player.base});plan.phase="recover";plan.since=world.tick;plan.reason="Intact fortification requires researched siege and escort";}
      }
      // A breach or recovery chosen above owns the army until the next think.
      if((plan.phase as string)!=="advance"&&(plan.phase as string)!=="engage"){plan.nextThink=world.tick+secondsToTicks(2);return this.diagnostics.work;}

      const enemies=world.nearbyArmyEnemies(army??members[0],12*FIXED,player.id).filter(s=>!operations.enabled(player)||operations.canTarget(player.id,s.playerId));
      const enemy=enemies.length?{x:enemies.reduce((n,s)=>n+s.x,0)/enemies.length,y:enemies.reduce((n,s)=>n+s.y,0)/enemies.length}:undefined;
      const centre={x:Math.round(members.reduce((n,s)=>n+s.x,0)/members.length),y:Math.round(members.reduce((n,s)=>n+s.y,0)/members.length)};
      if (
        enemy &&
        plan.phase !== "engage" &&
        plan.phase === "advance"
      ) {
        const enemies=world.nearbyArmyEnemies(army!,16*FIXED,player.id);
        const rangedShare=members.filter(s=>this.expansion.unit(s).attack.channel==='ranged').length/Math.max(1,members.length);
        const meleeShare=enemies.filter(s=>this.expansion.unit(s).attack.channel==='melee'||formationDoctrine(s.definitionId).mounted).length/Math.max(1,enemies.length);
        const posture=plan.purpose==='defense'||plan.purpose==='screen'?'defend':doctrine.engagement==='fire-retreat'||rangedShare>=.5&&meleeShare>=.6?'skirmish':'line';
        if(doctrine.engagement==='flank-left'||doctrine.engagement==='flank-right')army!.wingPreference=doctrine.engagement==='flank-left'?'left':'right';
        world.applyCommand({type:'army-posture',playerId:player.id,armyId:army!.id,posture});
        // The army deploys once; L3 subsequently owns target assignment and wing routing.
        if(this.order(plan,{type:'deploy',tile:pointTile(world.map,centre),facing:Math.atan2(enemy.y-centre.y,enemy.x-centre.x)})){
          plan.phase='engage';plan.since=world.tick;plan.reason='Persistent battle line with independently supported wings';
          const shapeTicks=new Map(plan.shapeTicks??[]),near=world.nearbyArmyEnemies(army!,14*FIXED,player.id),count=Math.max(1,near.length);
          for(const s of members){if(world.tick-(shapeTicks.get(s.id)??-ENGAGEMENT.shapeCooldownTicks)<ENGAGEMENT.shapeCooldownTicks||s.formation?.shapeLock||s.fighting)continue;
            const unit=this.expansion.unit(s),shape=preferredShape(unit,formationDoctrine(s.definitionId),{mountedShare:near.filter(t=>this.expansion.unit(t).tags.includes('mounted')).length/count,rangedShare:near.filter(t=>this.expansion.unit(t).attack.channel==='ranged').length/count,distanceTiles:Math.hypot(enemy.x-s.x,enemy.y-s.y)/FIXED},unit.role==='frontline'?'frontline':unit.role==='ranged'?'ranged':unit.tags.includes('mounted')?'mounted':'support');
            if(world.applyArmyCommand&&!world.applyArmyCommand({type:'formation',playerId:player.id,squadIds:[s.id],shape}))shapeTicks.set(s.id,world.tick);
          }plan.shapeTicks=[...shapeTicks];
        }
      } else if (!enemy && plan.purpose !== "coast" && plan.purpose!=="defense"&&plan.purpose!=="screen" && target) {
        const remaining = conquestBuildings(world.buildingFacts().byOwner(target.id), target.ai)
          .filter(b => operations.canEnter(player.id, target.id, b.tile))
          .sort((a,b) => world.map.euclideanDistSquared(world.tileOf(army ?? members[0]),a.tile) -
            world.map.euclideanDistSquared(world.tileOf(army ?? members[0]),b.tile) || a.id-b.id);
        const lastSquad = !remaining.length && operations.finishing(player.id,target.id)
          ? world.squads.filter(s => s.playerId === target.id && s.troops > 0 && s.embarkedOn === null &&
            operations.canEnter(player.id,target.id,world.tileOf(s)))
            .sort((a,b) => world.map.euclideanDistSquared(world.tileOf(army ?? members[0]),world.tileOf(a)) -
              world.map.euclideanDistSquared(world.tileOf(army ?? members[0]),world.tileOf(b)) || a.id-b.id)[0]
          : undefined;
        const resourceGoal = operations.resourceObjective(player.id);
        const objective = resourceGoal !== undefined ? { tile: resourceGoal } : remaining[0] ?? (lastSquad ? {tile:world.tileOf(lastSquad)} : undefined);
        // I4: one order per objective change. The theatre pass rewrites targetTile,
        // so the objective lives in its own field; identical or pending orders are skipped.
        const settled = !!army && (this.expansion.armies.admissionPending(army.id) ||
          (army.order.type === "move" && army.order.tile === objective?.tile && army.state !== "holding"));
        if (objective && !settled && world.tick >= (plan.objectiveRetryTick ?? 0) &&
          (plan.objectiveTile !== objective.tile || army?.state === "holding" && members.every(s => s.order.type === "hold"))) {
          if (this.order(plan, {type:"move",tile:objective.tile})) {
            plan.targetTile = objective.tile; plan.objectiveTile = objective.tile; plan.phase = "advance"; plan.reason = "Securing remaining cities and ground squads";
          } else plan.objectiveRetryTick = world.tick + AI_BATTLE.objectiveRetryTicks;
        }
      }
      // T-b: commitment counts from the last real engagement, not from deployment. One
      // member trading shots at range is not an engagement and must not freeze the army.
      const anyFighting=members.filter(s=>s.fighting).length>=Math.max(1,Math.ceil(members.length*AI_BATTLE.engagedShare));
      if(anyFighting)plan.engagedTick=world.tick;
      const lastContact=Math.max(plan.since,plan.engagedTick??0);
      const moving=!!army&&["marching","assembling","regrouping"].includes(army.state);
      // Hill and trench positioning own the army while they hold a plan.
      if((plan.phase==="engage"||plan.phase==="advance"&&!moving)&&!plan.hill&&!plan.trench&&army&&army.state!=="blocked"&&!anyFighting&&world.tick-lastContact>=AI_BATTLE.standoffTicks&&
        world.tick-(plan.pressTick??-AI_BATTLE.standoffTicks)>=AI_BATTLE.standoffTicks&&this.expansion.engagements.planFor(army.id)?.posture!=="withdraw"){
        const legalFoe=(s:Squad)=>!operations.enabled(player)||operations.canTarget(player.id,s.playerId);
        const foes=world.nearbyArmyEnemies(army,AI_BATTLE.standoffSearchTiles*FIXED,player.id).filter(legalFoe);
        const here=pointTile(world.map,centre);
        // T-b pursuit: a routed target army is followed rather than left to recover.
        const quarry=foes.length||plan.purpose==="coast"||!target?undefined:world.squadFacts().aliveByOwner(target.id)
          .filter(s=>s.embarkedOn===null&&!s.afloat&&legalFoe(s)&&world.map.euclideanDistSquared(world.tileOf(s),here)<=AI_BATTLE.pursuitTiles**2&&
            world.squadPaths(player.id).connected(here,world.tileOf(s))&&(!operations.enabled(player)||operations.canEnter(player.id,target.id,world.tileOf(s))))
          .sort((a,b)=>world.map.euclideanDistSquared(world.tileOf(a),here)-world.map.euclideanDistSquared(world.tileOf(b),here)||a.id-b.id)[0];
        if(foes.length){
          const goal={x:foes.reduce((n,s)=>n+s.x,0)/foes.length,y:foes.reduce((n,s)=>n+s.y,0)/foes.length};
          const length=Math.hypot(goal.x-centre.x,goal.y-centre.y),stop=Math.max(0,length-AI_BATTLE.pressStopTiles*FIXED);
          const point={x:Math.round(centre.x+(length?(goal.x-centre.x)/length*stop:0)),y:Math.round(centre.y+(length?(goal.y-centre.y)/length*stop:0))};
          plan.pressTick=world.tick;
          if(this.order(plan,{type:"deploy",tile:pointTile(world.map,point),facing:Math.atan2(goal.y-centre.y,goal.x-centre.x)})){plan.phase="engage";plan.reason="Closing a standoff with the battle line";}
        } else if(quarry){
          plan.pressTick=world.tick;
          if(this.order(plan,{type:"move",tile:world.tileOf(quarry)})){plan.phase="advance";plan.reason="Pursuing the routed enemy army";}
        } else if(plan.targetTile!==undefined&&plan.purpose!=="coast"&&!(army.order.type==="move"&&army.order.tile===plan.targetTile)&&
          world.map.euclideanDistSquared(here,plan.targetTile)>6**2&&(!operations.enabled(player)||plan.target===undefined||operations.canEnter(player.id,plan.target,plan.targetTile))){
          plan.pressTick=world.tick;
          if(this.order(plan,{type:"move",tile:plan.targetTile})){plan.phase="advance";plan.reason="No enemy in reach; resuming the advance on the objective";}
        }
      }
      if (
        (plan.phase === "advance" || plan.phase === "engage") &&
        (world.tick - lastContact >= doctrine.commitmentTicks ||
          !anyFighting && world.tick - plan.since >= doctrine.commitmentTicks * AI_BATTLE.commitmentCapFactor) &&
        !operations.sustaining(player.id, plan.target ?? 0) &&
        this.order(plan, { type: "regroup", tile: plan.home ?? player.base })
      ) {
        plan.phase = "recover";
        plan.since = world.tick;
        // Was left at the previous phase's reason ("No enemy in reach; resuming
        // the advance..."), which read wrong on a returning army.
        plan.reason = "Commitment window ended; regrouping";
      }
    } else if (
      plan.phase === "recover" &&
      // Disbanding mid-melee strands the members without orders; finish the retreat first.
      (!members.some((s) => s.fighting) && members.every(
        (s) =>
          world.map.euclideanDistSquared(
            world.tileOf(s),
            plan!.home ?? player!.base,
          ) <
          12 ** 2,
      ) ||
        world.tick - plan.since >= secondsToTicks(40))
    ) {
      this.economy.assets.release(plan.id);
      world.applyCommand({
        type: "disband-army",
        playerId: player.id,
        armyId: army!.id,
      });
      const wounded=members.filter(s=>world.owners[world.tileOf(s)]===player!.id && readyFraction(s)<.9 && !s.fighting);
      if(wounded.length && player.reserves>0 && !(plan.rejoined??0)){
        this.economy.assets.acquire(members.map(s=>({asset:`squad:${s.id}` as const,playerId:player!.id,generation:plan!.generation,controller:plan!.id,
          priority:"recovery" as const,createdTick:world.tick,expiresTick:world.tick+secondsToTicks(50)})));
        world.applyCommand({type:"order",playerId:player.id,squadIds:wounded.map(s=>s.id),order:{type:"replenish"}});
        plan.phase="replenish";plan.since=world.tick;plan.reason="Replenishing survivors using actual reserves";
      } else {plan.phase="complete";plan.nextThink=world.tick+secondsToTicks(20);plan.reason="Survivors returned and objective leases released";this.diagnostics.completed++;}
    } else if(plan.phase==="replenish" || plan.phase==="refit"){
      if(members.some(s=>s.refit) || (members.some(s=>readyFraction(s)<.9)&&player.reserves>0&&world.tick-plan.since<secondsToTicks(30))){
        plan.nextThink=world.tick+secondsToTicks(2);return this.diagnostics.work;
      }
      const replacement=members.find(s=>!s.refit&&!s.fighting&&world.owners[world.tileOf(s)]===player!.id &&
        UNITS.some(u=>u.line===this.expansion.unit(s).line&&u.role===this.expansion.unit(s).role&&
          AGES.indexOf(u.age)>AGES.indexOf(this.expansion.unit(s).age)&&this.expansion.progression.has(player!.id,u.technologyId)));
      if(plan.phase==="replenish"&&replacement){
        const unit=[...UNITS].reverse().find(u=>u.line===this.expansion.unit(replacement).line&&u.role===this.expansion.unit(replacement).role&&
          AGES.indexOf(u.age)>AGES.indexOf(this.expansion.unit(replacement).age)&&this.expansion.progression.has(player!.id,u.technologyId))!;
        const stock=this.economy.ledger.spendable(player.id,{gold:player.gold,reserves:player.reserves,items:this.expansion.supply.inventories[player.id]},plan.id,"growth");
        if(affordableAiCost(stock,unitRefitCost(unit,this.expansion.unit(replacement),1,recruitmentVariant(unit.id,this.expansion.progression.states[player.id].completed)))&&!world.applyCommand({type:"refit",playerId:player.id,squadIds:[replacement.id],definitionId:unit.id})){
          plan.phase="refit";plan.since=world.tick;plan.reason="Paid compatible survivor refit";return this.diagnostics.work;
        }
      }
      if(!plan.retire&&plan.purpose!=="coast"&&target&&!target.eliminated&&world.hostile(player.id,target.id)&&
        (!operations.enabled(player)||operations.canTarget(player.id,target.id))&&world.tick<plan.deadline&&
        members.length>=2&&members.every(s=>readyFraction(s)>=.8)){
        world.applyCommand({type:"order",playerId:player.id,squadIds:members.map(s=>s.id),order:{type:"hold"}});
        const rejection=world.applyCommand({type:"create-army",playerId:player.id,squadIds:members.map(s=>s.id)});
        if(!rejection){this.economy.assets.acquire(members.map(s=>({asset:`squad:${s.id}` as const,playerId:player!.id,generation:plan!.generation,controller:plan!.id,priority:"operation" as const,createdTick:world.tick,expiresTick:plan!.deadline+secondsToTicks(40)})));plan.armyId=armies.armyOf(members[0].id)!.id;plan.phase="assemble";plan.since=world.tick;plan.initialTroops=troops;plan.rejoined=1;plan.reason="Recovered supported roster rejoining once";
          world.applyCommand({type:"army-auto",playerId:player.id,armyId:plan.armyId,enabled:false});return this.diagnostics.work;}
      }
      this.economy.assets.release(plan.id);plan.phase="complete";plan.nextThink=world.tick+secondsToTicks(20);plan.reason="Paid recovery finished; objective closed";this.diagnostics.completed++;
    }
    if (plan.phase !== "complete") plan.nextThink = world.tick + secondsToTicks(2);
    return this.diagnostics.work;
  }
}
