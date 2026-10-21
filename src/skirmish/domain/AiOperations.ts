import { restoreAiMinimum } from "./AiCheckpointMinimum";
import {TICKS_PER_SECOND} from '../Protocol';
import { secondsToTicks } from '../Protocol';
import { remainingHealth,HEALTH_SCALE } from './Manpower';
import { forceReadiness } from "./AiForceReadiness";
import { combatCohorts, combatAdvantage } from "./AiCombatPower";
import { canFinishConquest, conquestBuildings } from "./AiConquestObjective";
import { AI_DOCTRINES } from "../content/AiDoctrines";
import { personalityOf } from "../content/AiPersonalities";
import type { Player } from "../Protocol";
import type { Expansion } from "./Expansion";
import { AI_DIFFICULTY, aiRaidAfterTicks } from "../content/AiDifficulty";
import { aiDifficultyOf, isHumanSeat, playtestCampaignAllowed } from "./PlaytestRules";
import { buildingTerrainRejection } from "../Construction";
import { campaignAdvantage, campaignForce, campaignQualityKey, campaignDeploymentCapacity, armyMissionCapacity, type CampaignAssessmentCache } from "./AiCampaignPolicy";
import type { Resource } from "./Definitions";
import { tribeMayCampaignAgainstNation } from "../FactionRules";

export interface ArmyTheatre {id:string;purpose:'offense'|'defense'|'screen';tile:number;target?:number;priority:number;desiredSquads:number}
export type OperationPhase = "peace" | "preparing" | "war" | "recovery";
interface TribePreparation {
  desiredSquads: number;
  progressAt: number;
  bestReady: number;
  route: "pending" | "ready";
}
interface CampaignIntent extends TribePreparation {
  motive: "dominance" | "resource" | "retaliation";
  goal: number;
  resource?: Resource;
}
interface Grievance { rival: number; value: number; at: number; lastEvent: number }
interface CampaignProgress {
  goal: number;
  land: number;
  cities: number;
  health: number;
  distance: number;
  progressAt: number;
  advanceIds?: number[];
  ownLand?: number;
}
export interface AiOperation {
  phase: OperationPhase;
  since: number;
  nextThink: number;
  target?: number;
  retreatFrom?: number;
  /** Recent aggression is independent of the single offensive commitment. */
  threats: { rival: number; tile: number; until: number }[];
  cursor: number;
  candidate?: number;
  score?: number;
  readiness?:import("./AiForceReadiness").AiForceReadiness;
  sleepKey?:string;
  territorialRevision?:number;
  finishCount?: number;
  finishProgressAt?: number;
  /** Historical high-water land growth: tiny neutral pockets do not veto war. */
  frontier?: { land: number; usefulAt: number };
  /** Campaigns involving tribes, either as invader or target. The persisted key
   * also reads checkpoints from the earlier nation-only implementation. */
  tribe?: TribePreparation;
  campaign?: CampaignProgress;
  intent?: CampaignIntent;
  candidateIntent?: Pick<CampaignIntent, "motive" | "goal" | "resource">;
  grievances?: Grievance[];
  watchdogAt?: number;
  enemyDamageAt?: number;
  retries?: { target: number; until: number }[];
  reason?: string;
}
/** Decision policy only. Never replaces Diplomacy.hostile or legal damage. */
/** Sleep-key force bucket width: a rival's ready force must change by about this percentage to wake a sleeping faction (P25). */
export const SLEEP_FORCE_STEP_PERCENT = 25;
/** Integer geometric bucket of a force count; deterministic, no floating-point logarithm. */
export function forceBucket(count: number): number {
  let bucket = 0;
  for (let edge = 1; edge <= count; edge += Math.max(1, Math.floor((edge * SLEEP_FORCE_STEP_PERCENT) / 100))) bucket++;
  return bucket;
}
export class AiOperations {
  private readonly records = new Map<number, AiOperation>();
  revision = 0;
  // Read-cache invalidation also observes refreshed threats, without restarting
  // route jobs every time combat extends an existing retaliation window.
  permissionRevision = 0;
  private work = 0;
  private readonly theatreRecords=new Map<number,ArmyTheatre[]>();
  theatres(playerId:number):readonly ArmyTheatre[]{return this.theatreRecords.get(playerId)??[];}
  private refreshTheatres(player:Player,r:AiOperation):void {
    const {world}=this.expansion,rows:ArmyTheatre[]=[],own=world.squadFacts().byOwner(player.id).filter(s=>s.troops>0),count=own.length;
    const cap=armyMissionCapacity(this.expansion.armies.capacity(player.id),count);
    if(!cap){this.theatreRecords.set(player.id,[]);return;}
    const reserve=Math.ceil(count*AI_DOCTRINES[personalityOf(player).id].reservePercent/100);
    let remaining=Math.max(0,count-reserve);
    const averageHealth=own.reduce((n,s)=>n+remainingHealth(s)/HEALTH_SCALE,0)/Math.max(1,count);
    const regions=this.expansion.economy.fronts.regionsForPlayer(player.id);
    const threats=r.threats.filter(t=>t.until>=world.tick).sort((a,b)=>a.rival-b.rival);
    const danger=threats.map(t=>{
      const region=regions.filter(f=>f.rival===t.rival).sort((a,b)=>world.map.euclideanDistSquared(a.anchor,t.tile)-world.map.euclideanDistSquared(b.anchor,t.tile)||a.id.localeCompare(b.id))[0];
      const health=world.squadFacts().aliveByOwner(t.rival).filter(s=>s.embarkedOn===null&&world.map.euclideanDistSquared(world.tileOf(s),t.tile)<=16**2).reduce((n,s)=>n+remainingHealth(s)/HEALTH_SCALE,0);
      return {id:'defense:'+(region?.id??t.rival),tile:region?.anchor??t.tile,target:t.rival,weight:Math.max(2,Math.ceil(health/Math.max(1,averageHealth)*1.2))};
    });
    const total=danger.reduce((n,t)=>n+t.weight,0),defensive=Math.min(remaining,total);
    for(const t of danger){if(rows.length>=cap||remaining<2)break;const desired=Math.min(this.expansion.armies.capacity(player.id),remaining,Math.max(2,Math.round(defensive*t.weight/Math.max(1,total))));rows.push({...t,purpose:'defense',priority:3,desiredSquads:desired});remaining-=desired;}
    const screen=count>=60?regions.filter(f=>!threats.some(t=>t.rival===f.rival)&&world.hostile(player.id,f.rival)).sort((a,b)=>b.edges-a.edges||a.id.localeCompare(b.id))[0]:undefined;
    if(screen&&remaining>=2&&rows.length<cap){const desired=Math.min(6,remaining);rows.push({id:'screen:'+screen.id,purpose:'screen',tile:screen.anchor,target:screen.rival,priority:1,desiredSquads:desired});remaining-=desired;}
    if(r.target!==undefined&&r.phase==='war'&&rows.length<cap&&remaining>=2){const target=world.players.find(p=>p.id===r.target);if(target)rows.push({id:'offense:'+r.target,purpose:'offense',tile:r.intent?.goal??target.base,target:r.target,priority:2,desiredSquads:remaining});}
    this.theatreRecords.set(player.id,rows.sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id)));
  }
  private territorialRevision=0;
  territoryChanged(oldOwner:number,newOwner:number):void{
    this.territorialRevision++;
    if (oldOwner && newOwner && oldOwner !== newOwner && this.expansion.diplomacy.declaredWar(oldOwner, newOwner))
      this.rememberGrievance(oldOwner, newOwner, 'territory');
    const tick=this.expansion.world.tick;
    for(const id of new Set([oldOwner,newOwner])) {
      const record=this.records.get(id);if(!record)continue;
      record.sleepKey=undefined;record.territorialRevision=this.territorialRevision;
      // Losing territory is urgent. Expansion and neighboring ownership
      // changes coalesce at a faction-staggered deadline; repeated changes
      // can bring it forward, but can never postpone an already queued think.
      const deadline=oldOwner!==newOwner && id===oldOwner ? tick : tick+secondsToTicks(1)+id%TICKS_PER_SECOND;
      record.nextThink=Math.min(record.nextThink,deadline);
    }
  }
  constructor(private readonly expansion: Expansion) {}
  enabled(player: Player | undefined): boolean {
    return !!this.expansion.world.options?.aiWarPolicy && !!player?.ai && !player.eliminated &&
      (player.kind === "regular" || this.expansion.world.options.deferredPlanning === true);
  }
  state(playerId: number): Readonly<AiOperation> | undefined { return this.records.get(playerId); }
  /** Paid recruitment demand, never a grant or a movement permission. */
  recruitmentObjective(playerId: number): { target: number; squads: number } | undefined {
    const r = this.records.get(playerId);
    const preparation = r?.tribe ?? r?.intent;
    return r && preparation?.route === "ready" && r.target !== undefined && ["preparing", "war"].includes(r.phase)
      ? { target: r.target, squads: preparation.desiredSquads } : undefined;
  }
  invasionReserve(playerId: number, squads: number): number {
    const player = this.expansion.world.players.find(p => p.id === playerId)!;
    if (player.kind === "tribe") return Math.min(1, squads);
    return Math.max(2, Math.ceil(squads * AI_DOCTRINES[personalityOf(player).id].reservePercent / 100));
  }
  /** Tribes develop peacefully first, then prioritize a promotion campaign. */
  promotionPressure(playerId: number): boolean {
    const player = this.expansion.world.players.find(p => p.id === playerId), r = this.records.get(playerId);
    return player?.kind === "tribe" && !!r?.frontier &&
      (!this.expansion.world.hasUnclaimedFrontier?.(playerId) || this.expansion.world.tick - r.frontier.usefulAt >= secondsToTicks(30));
  }
  private expansionBlocked(player: Player, r: AiOperation): boolean {
    const tick = this.expansion.world.tick;
    r.frontier ??= { land: player.land, usefulAt: tick };
    if (player.land >= r.frontier.land + Math.max(16, Math.ceil(r.frontier.land / 200))) {
      r.frontier = { land: player.land, usefulAt: tick };
    }
    return !this.expansion.world.hasUnclaimedFrontier?.(player.id) || tick - r.frontier.usefulAt >= secondsToTicks(30);
  }
  private retryLater(player: Player, r: AiOperation, reason: string): void {
    if (r.target !== undefined) r.retries = [
      ...(r.retries ?? []).filter(t => t.target !== r.target && t.until > this.expansion.world.tick).slice(-3),
      { target: r.target, until: this.expansion.world.tick + secondsToTicks(60) },
    ];
    this.transition(player, r, "recovery");
    r.reason = reason;
  }
  private updateCampaign(player: Player, target: Player, r: AiOperation): void {
    const { world } = this.expansion;
    const cities = conquestBuildings(world.buildingFacts().byOwner(target.id), target.ai);
    const goal = r.intent?.motive === "resource" ? r.intent.goal : cities[0]?.tile ?? target.base;
    if (r.intent && r.intent.motive !== "resource") r.intent.goal = goal;
    const health = world.squadFacts().aliveByOwner(target.id).reduce((n, s) => n + remainingHealth(s), 0) +
      cities.reduce((n, b) => n + (b.health ?? b.maxHealth ?? 1200) * HEALTH_SCALE, 0);
    const advancing = world.squadFacts().aliveByOwner(player.id).filter(s => !r.campaign?.advanceIds || r.campaign.advanceIds.includes(s.id));
    const distance = Math.sqrt(advancing.reduce((n, s) =>
      s.embarkedOn === null ? Math.min(n, world.map.euclideanDistSquared(world.tileOf(s), goal)) : n, Infinity));
    const p = r.campaign ??= { goal, land: target.land, cities: cities.length, health, distance, progressAt: world.tick, advanceIds: advancing.map(s => s.id), ownLand: player.land };
    if (p.goal !== goal) { p.goal = goal; p.distance = distance; }
    if ((target.land < p.land && (r.tribe || player.land > (p.ownLand ?? player.land))) || cities.length < p.cities && (r.tribe || player.land > (p.ownLand ?? player.land) || (r.enemyDamageAt ?? -1) >= p.progressAt) ||
      health < p.health && (r.tribe || (r.enemyDamageAt ?? -1) >= p.progressAt) || distance <= p.distance - 2) {
      p.progressAt = world.tick;
      p.land = Math.min(p.land, target.land); p.cities = Math.min(p.cities, cities.length);
      p.ownLand = Math.max(p.ownLand ?? player.land, player.land);
      p.health = Math.min(p.health, health); p.distance = Math.min(p.distance, distance);
    }
  }
  /** Progress, unlike finishing conquest, also includes a supported advance. */
  sustaining(playerId: number, rival: number): boolean {
    const r = this.records.get(playerId);
    return this.finishing(playerId, rival) || !!(r?.phase === "war" && r.target === rival && r.campaign &&
      this.expansion.world.tick - r.campaign.progressAt < secondsToTicks(90));
  }
  /** Sparse, lazy integer decay: a relationship costs at most four records.
   * Events are actual theft/capture commits, never raid intentions or damage ticks. */
  rememberGrievance(victim: number, rival: number, cause: "raid" | "attack" | "territory" | "betrayal", weight = 1): void {
    const { world, diplomacy } = this.expansion;
    if (victim === rival || !this.enabled(world.players.find(p => p.id === victim))) return;
    const r = this.record(victim), tick = world.tick;
    if (r.grievances?.some(g => g.rival === rival && tick - g.lastEvent < secondsToTicks(30))) return;
    const rows = (r.grievances ?? []).map(g => ({ ...g, value: Math.max(0, g.value - Math.floor((tick - g.at) / secondsToTicks(180))), at: g.at + Math.floor((tick - g.at) / secondsToTicks(180)) * secondsToTicks(180) })).filter(g => g.value > 0);
    const old = rows.find(g => g.rival === rival);
    // Tile captures in one engagement are one incident, not hundreds of grudges.
    if (old && tick - old.lastEvent < secondsToTicks(30)) return;
    if (diplomacy.allied(victim, rival) && cause !== "betrayal") return;
    if (old) { old.value = Math.min(8, old.value + Math.max(1, Math.min(3, weight))); old.lastEvent = tick; }
    else rows.push({ rival, value: Math.max(1, Math.min(3, weight)), at: tick, lastEvent: tick });
    r.grievances = rows.sort((a, b) => b.value - a.value || b.lastEvent - a.lastEvent || a.rival - b.rival).slice(0, 4);
    r.sleepKey = undefined; r.nextThink = Math.min(r.nextThink, tick);
  }
  enemyDamaged(attacker: number, victim: number): void {
    const r = this.records.get(attacker);
    if (r?.phase === "war" && r.target === victim) r.enemyDamageAt = this.expansion.world.tick;
  }
  grievance(playerId: number, rival: number): number {
    const g = this.records.get(playerId)?.grievances?.find(g => g.rival === rival);
    return g ? Math.max(0, g.value - Math.floor((this.expansion.world.tick - g.at) / secondsToTicks(180))) : 0;
  }
  private resourceGoal(player: Player, rival: Player): { tile: number; resource: Resource; blocked: boolean } | undefined {
    const pressures = this.expansion.economy.resourcePressures(player.id);
    if (!pressures.length) return;
    const paths = this.expansion.world.squadPaths(player.id);
    // Indexed owner deposits; no map-area scan or speculative path job per site.
    let best: { tile: number; resource: Resource; blocked: boolean; score: number } | undefined;
    for (const node of this.expansion.supply.resourcesByOwner(rival.id)) {
      const pressure = pressures.find(p => p.resource === node.resource);
      if (!pressure || !paths.connected(player.base, node.tile)) continue;
      const score = this.expansion.world.map.euclideanDistSquared(player.base, node.tile) / (pressure.blocked ? 2 : 1);
      if (!best || score < best.score || score === best.score && node.tile < best.tile)
        best = { tile: node.tile, resource: node.resource, blocked: pressure.blocked, score };
    }
    return best;
  }
  private resourceSecured(player: Player, r: AiOperation): boolean {
    const intent = r.intent, { world } = this.expansion;
    if (intent?.motive !== "resource" || !intent.resource ||
      this.expansion.supply.resourceSites.at(intent.goal)?.resource !== intent.resource ||
      buildingTerrainRejection(world.map, world.owners, player.id, "mine", intent.goal)) return false;
    const support = world.squadFacts().aliveByOwner(player.id).filter(s => s.embarkedOn === null && !s.refit &&
      world.map.euclideanDistSquared(world.tileOf(s), intent.goal) <= 16 ** 2);
    if (support.length < 2 || !forceReadiness(this.expansion, player, 2).logistics) return false;
    const enemies = world.squadFacts().aliveByOwner(r.target!).filter(s => s.embarkedOn === null &&
      world.map.euclideanDistSquared(world.tileOf(s), intent.goal) <= 16 ** 2);
    return combatAdvantage(combatCohorts(this.expansion, support), combatCohorts(this.expansion, enemies)) >= 1.25;
  }
  /** Called on the existing slow diplomacy cadence. An unrelated war never
   * blocks peace, and equal troop counts cannot erase a real equipment lead. */
  willingPeace(player: Player, rival: Player): boolean {
    const r = this.records.get(player.id);
    if (!this.expansion.diplomacy.declaredWar(player.id, rival.id) || r?.phase !== "war" || r.target !== rival.id) return true;
    if (this.resourceSecured(player, r)) return true;
    return !this.sustaining(player.id, rival.id) || campaignAdvantage(this.expansion, player, rival, true) < .9;
  }
  checkpoint() { return structuredClone({ records: [...this.records], revision: this.revision,territorialRevision:this.territorialRevision,theatres:[...this.theatreRecords] }); }
  restore(saved: Omit<ReturnType<AiOperations["checkpoint"]>,"theatres"> & Partial<Pick<ReturnType<AiOperations["checkpoint"]>,"theatres">>): void {
    this.theatreRecords.clear();for(const [id,rows] of saved.theatres??[])this.theatreRecords.set(id,structuredClone(rows));
    this.records.clear(); for (const [id, record] of structuredClone(saved.records)) { record.score = restoreAiMinimum(record.score); this.records.set(id, record); }
    this.permissionRevision++;
    this.revision = saved.revision;this.territorialRevision=saved.territorialRevision??0;
  }
  release(playerId: number): void {
    if (this.records.delete(playerId)) this.revision++;
    this.theatreRecords.delete(playerId);
    this.expansion.economy.routes.release(`invasion:${playerId}`);
  }
  private record(playerId: number): AiOperation {
    let record = this.records.get(playerId);
    if (!record) {
      record = { phase: "peace", since: this.expansion.world.tick, nextThink: this.expansion.world.tick + secondsToTicks((playerId % 60) / 20),
        threats: [], cursor: 0, score: undefined };
      this.records.set(playerId, record);
    }
    return record;
  }
  /** Called at authoritative capture pressure/damage commits, before conquest. */
  threatened(victim: number, rival: number, tile: number): void {
    const { world, diplomacy } = this.expansion;
    if (!world.options?.aiWarPolicy) return;
    if (!this.enabled(world.players.find(p => p.id === victim)) || !diplomacy.hostile(victim, rival)) return;
    const record = this.record(victim), threat = record.threats.find(t => t.rival === rival);
    const firstAttack=!threat || threat.until<world.tick;
    if (threat) { threat.tile = tile; threat.until = world.tick + secondsToTicks(30); }
    else { record.threats.push({ rival, tile, until: world.tick + secondsToTicks(30) }); this.revision++; }
    if(!diplomacy.raids)this.permissionRevision++;
    // Tactical defense reads refreshed threats immediately. Continuing fire
    // must not turn strategic readiness/target selection into per-tick work.
    if(firstAttack)record.nextThink = Math.min(record.nextThink, world.tick);
  }
  /** Offensive permission and remembered defensive retaliation are separate. */
  canTarget(playerId: number, rival: number): boolean {
    if(this.expansion.diplomacy.raids)return this.expansion.diplomacy.hostile(playerId,rival);
    const player = this.expansion.world.players.find(p => p.id === playerId);
    if (!this.enabled(player)) return true;
    if (this.expansion.diplomacy.declaredWar(playerId, rival)) return true;
    const record = this.records.get(playerId);
    return !!record && ((record.phase === "war" && record.target === rival) ||
      record.threats.some(t => t.rival === rival && t.until >= this.expansion.world.tick));
  }
  /** Presentation projection only: an offensive never becomes a formal war. */
  activeOffensives(): { a: number; b: number }[] {
    const { world, diplomacy } = this.expansion;
    const live = new Set(world.players.filter(p => !p.eliminated).map(p => p.id));
    const pairs = new Map<string, { a: number; b: number }>();
    for (const [id, record] of this.records) {
      if (record.phase !== "war" || record.target === undefined ||
        !this.enabled(world.players.find(p => p.id === id)) ||
        !live.has(record.target) || diplomacy.allied(id, record.target)) continue;
      const a = Math.min(id, record.target), b = Math.max(id, record.target);
      pairs.set(`${a}:${b}`, { a, b });
    }
    return [...pairs.values()].sort((x, y) => x.a - y.a || x.b - y.b);
  }
  offensiveTarget(playerId: number): number | undefined {
    const record = this.records.get(playerId);
    return record?.phase === "war" ? record.target : undefined;
  }
  resourceObjective(playerId: number): number | undefined {
    const r = this.records.get(playerId);
    return r?.phase === "war" && r.intent?.motive === "resource" ? r.intent.goal : undefined;
  }
  /** Bilateral activity includes defensive retaliation, not only offensives. */
  activeConflicts(): {a:number;b:number}[] {
    const pairs=new Map<string,{a:number;b:number}>();
    const add=(a:number,b:number)=>{if(a!==b && !this.expansion.diplomacy.allied(a,b)){
      const row={a:Math.min(a,b),b:Math.max(a,b)};pairs.set(`${row.a}:${row.b}`,row);
    }};
    for(const row of this.activeOffensives())add(row.a,row.b);
    for(const [id,r] of this.records)if(this.enabled(this.expansion.world.players.find(p=>p.id===id)))
      for(const t of r.threats)if(t.until>=this.expansion.world.tick)add(id,t.rival);
    return [...pairs.values()].sort((x,y)=>x.a-y.a||x.b-y.b);
  }
  finishing(playerId: number, rival: number): boolean {
    const r = this.records.get(playerId);
    return r?.phase === "war" && r.target === rival && r.finishProgressAt !== undefined &&
      this.expansion.world.tick - r.finishProgressAt < secondsToTicks(60);
  }
  /** Defensive pursuit remains local to observed aggression, not a free raid. */
  /** Only this faction's actual entry permissions fence its route work. */
  private readonly navigationKeys = new Map<number, {target: number | null | undefined; threats: number[]; wars: string; value: string}>();
  navigationRevision(playerId: number): string {
    if(this.expansion.diplomacy.raids)return this.expansion.diplomacy.permissionSignature(playerId);
    const record = this.records.get(playerId), tick = this.expansion.world.tick;
    if (!this.enabled(this.expansion.world.players.find(p => p.id === playerId))) return "unrestricted";
    const wars = (this.expansion.diplomacy.state.wars ?? [])
      .filter(w => w.a === playerId || w.b === playerId)
      .map(w => w.a === playerId ? w.b : w.a).sort((a, b) => a - b).join(",");
    if (!record) return wars ? JSON.stringify([null, [], wars]) : "unrestricted";
    const target = record.phase === "war" ? record.target : record.phase === "recovery" ? record.retreatFrom : null;
    const previous = this.navigationKeys.get(playerId);
    let at = 0, same = previous?.target === target && previous?.wars === wars;
    for (const threat of record.threats) if (threat.until >= tick) {
      same &&= previous?.threats[at] === threat.rival && previous?.threats[at+1] === threat.tile;
      at += 2;
    }
    if (same && previous!.threats.length === at) return previous!.value;
    const threats: number[] = [], rows: number[][] = [];
    for (const threat of record.threats) if (threat.until >= tick) {
      threats.push(threat.rival, threat.tile); rows.push([threat.rival, threat.tile]);
    }
    const value = JSON.stringify(wars ? [target, rows, wars] : [target, rows]);
    this.navigationKeys.set(playerId, {target, threats, wars, value});
    return value;
  }
  canEnter(playerId: number, rival: number, tile: number): boolean {
    if(this.expansion.diplomacy.raids){
      const d=this.expansion.diplomacy;
      return !rival||rival===playerId||d.allied(playerId,rival)||!d.protected(playerId,rival)&&(d.declaredWar(playerId,rival)||d.embargo(playerId,rival));
    }
    if (!rival || rival === playerId || !this.expansion.diplomacy.hostile(playerId, rival)) return true;
    if (!this.enabled(this.expansion.world.players.find(p => p.id === playerId))) return true;
    if (this.expansion.diplomacy.declaredWar(playerId, rival)) return true;
    const record = this.records.get(playerId);
    if ((record?.phase === "war" && record.target === rival) || (record?.phase === "recovery" && record.retreatFrom === rival)) return true;
    return !!record?.threats.some(t => t.rival === rival && t.until >= this.expansion.world.tick &&
      this.expansion.world.map.euclideanDistSquared(t.tile, tile) <= 12 ** 2);
  }
  canPursue(playerId: number, rival: number, tile: number): boolean {
    if(this.expansion.diplomacy.raids)return this.expansion.diplomacy.hostile(playerId,rival);
    if (!this.enabled(this.expansion.world.players.find(p => p.id === playerId))) return true;
    if (this.expansion.diplomacy.declaredWar(playerId, rival)) return true;
    const r = this.records.get(playerId);
    return !!r && ((r.phase === "war" && r.target === rival) || r.threats.some(t => t.rival === rival &&
      t.until >= this.expansion.world.tick && this.expansion.world.map.euclideanDistSquared(t.tile, tile) <= 12 ** 2));
  }
  private transition(player: Player, record: AiOperation, phase: OperationPhase, target?: number): void {
    if(phase==="war"&&target!==undefined&&this.expansion.diplomacy.raids&&this.expansion.diplomacy.establishWar(player.id,target,this.expansion.world.tick,"invasion"))return;
    const previous = record.phase, oldTarget = record.target, tick = this.expansion.world.tick;
    record.retreatFrom = phase === "recovery" && previous === "war" ? oldTarget : undefined;
    record.phase = phase; record.target = target; record.since = tick;
    this.expansion.economy.routes.release(`invasion:${player.id}`);
    if (phase !== "war") { record.campaign = undefined; record.watchdogAt = undefined; }
    if (phase !== "preparing" && phase !== "war") { record.tribe = undefined; record.intent = undefined; }
    record.finishCount = undefined; record.finishProgressAt = undefined;
    record.nextThink = tick + (phase === "war" ? TICKS_PER_SECOND : secondsToTicks(3) + player.id % TICKS_PER_SECOND);
    record.cursor = 0; record.candidate = undefined; record.candidateIntent = undefined; record.score = undefined; this.revision++;
    if (phase === "war"&&!this.expansion.diplomacy.raids) this.expansion.announce({ kind: "war", actorId: player.id, otherId: target, action: "declare" });
    else if (previous === "war") this.expansion.announce({ kind: "war", actorId: player.id, otherId: oldTarget, action: "withdraw" });
  }
  /** At most sixteen geographic candidate reads across all factions per tick.
   * Own force counts come from the caller's existing single grouping pass. */
  step(forces: ReadonlyMap<number, number>): void {
    const { world, diplomacy } = this.expansion, tick = world.tick; this.work = 0;
    const assessmentCache: CampaignAssessmentCache = new Map();
    const advantageFor = (player: Player, rival: Player, committed = false, projectedFieldSquads?: number) => campaignAdvantage(this.expansion, player, rival, committed, assessmentCache, projectedFieldSquads);
    const compositions = new Map<number, ReturnType<typeof combatCohorts>>();
    const composition = (id: number) => {
      if (!compositions.has(id)) compositions.set(id, combatCohorts(this.expansion, world.squadFacts().aliveByOwner(id)));
      return compositions.get(id)!;
    };
    // P25: rival forces enter the sleep key as ~25% buckets, so one recruit anywhere
    // no longer wakes every sleeping faction.
    const ageKey = world.players.map(p => `${p.id}:${this.expansion.progression.states[p.id]?.age}:${this.expansion.progression.states[p.id]?.completed.length}:${forceBucket(forces.get(p.id) ?? 0)}:${p.eliminated}`).join(",");
    const diplomacyKey = JSON.stringify([diplomacy.state.alliances,diplomacy.state.wars ?? []]);
    for (const [id] of this.records) if (!this.enabled(world.players.find(p => p.id === id))) this.release(id);
    for (const player of world.players) {
      if (!this.enabled(player)) continue;
      const r = this.record(player.id), profile = personalityOf(player), strength = forces.get(player.id) ?? 0;
      const threats = r.threats.filter(t => t.until >= tick && world.players.some(p => p.id === t.rival && !p.eliminated) && diplomacy.hostile(player.id, t.rival));
      if (threats.length !== r.threats.length) { r.threats = threats; this.revision++; }
      const target = world.players.find(p => p.id === r.target);
      if (r.target && (!target || target.eliminated || !(diplomacy.raids?diplomacy.nonAllied(player.id,r.target):diplomacy.hostile(player.id, r.target)) ||
        diplomacy.raids&&(diplomacy.protected(player.id,r.target)||r.phase==="war"&&!diplomacy.declaredWar(player.id,r.target)))) {
        this.transition(player, r, "recovery"); continue;
      }
      if (tick < r.nextThink) continue;
      this.refreshTheatres(player,r);
      const blocked = this.expansionBlocked(player, r);
      const sleepKey=`${strength}:${player.land}:${this.expansion.progression.states[player.id]?.completed.length}:${this.expansion.progression.states[player.id]?.age}:${player.reserves>=12}:${diplomacyKey}:${diplomacy.raids?diplomacy.permissionSignature(player.id):""}:${r.territorialRevision??0}:${ageKey}:${blocked}:${Math.floor(tick / secondsToTicks(30))}:${campaignQualityKey(this.expansion, player)}`;
      if(r.phase==="peace" && !r.threats.length && r.sleepKey===sleepKey){r.nextThink=tick+secondsToTicks(10);continue;}
      r.readiness=forceReadiness(this.expansion,player,2);
      const invasionTroops=r.threats.reduce((sum,t)=>sum+world.squadFacts().aliveByOwner(t.rival)
        .filter(s=>s.embarkedOn===null && world.owners[world.tileOf(s)]===player.id &&
          world.map.euclideanDistSquared(world.tileOf(s),t.tile)<=16**2).reduce((n,s)=>n+s.troops,0),0);
      const defending=player.kind === "tribe"
        ? invasionTroops>=Math.max(12,r.readiness.troops/5)
        : invasionTroops>Math.max(24,r.readiness.troops/3);
      if (r.phase === "war") {
        if (target) this.updateCampaign(player, target, r);
        const buildings = target ? conquestBuildings(world.buildingFacts().byOwner(target.id), target.ai).length : Infinity;
        const enemies = target ? world.squadFacts().byOwner(target.id).filter(s => s.troops > 0).length : Infinity;
        if (canFinishConquest(buildings, enemies, strength)) {
          const count = buildings + enemies;
          if (r.finishCount === undefined || count < r.finishCount) r.finishProgressAt = tick;
          r.finishCount = count;
        } else { r.finishCount = undefined; r.finishProgressAt = undefined; }
        if (r.tribe) {
          const depleted = strength < 2 || (target && strength < profile.minimumRaidSquads / 2 && combatAdvantage(composition(player.id), composition(target.id)) < .65);
          if (player.kind === "tribe" && defending) this.retryLater(player, r, "Tribal home under invasion; defending promotion progress");
          else if (depleted || !this.sustaining(player.id, r.target!)) this.retryLater(player, r, depleted ? "Invasion force depleted; rebuilding" : "Tribal campaign stalled; reassessing targets");
          else { r.reason = "Tribal campaign making progress"; r.nextThink = tick + secondsToTicks(1); }
        } else if (diplomacy.raids && target) {
          const depleted = strength < 2 || composition(player.id).reduce((n, c) => n + c.count, 0) < 2;
          const secured = this.resourceSecured(player, r);
          const watchdog = tick - (r.watchdogAt ?? r.since) >= secondsToTicks(600);
          if (defending || depleted || secured || !this.sustaining(player.id, target.id))
            this.retryLater(player, r, secured ? "Resource objective secured; seeking settlement" : defending ? "Home defense takes priority" : depleted ? "Invasion force depleted" : "Campaign stalled; reassessing");
          else if (watchdog && advantageFor(player, target, true) < 1.1)
            this.retryLater(player, r, "Long campaign no longer affordable");
          else { if (watchdog) r.watchdogAt = tick; r.reason = "Supported campaign making progress"; r.nextThink = tick + secondsToTicks(1); }
        } else if (strength < 2 || (!this.finishing(player.id, r.target!) &&
          ((strength < Math.max(2, Math.floor(profile.minimumRaidSquads / 2)) && (!target || combatAdvantage(composition(player.id),composition(target.id)) < 1.1)) || tick - r.since >= secondsToTicks(120))))
          this.transition(player, r, "recovery");
        else r.nextThink = tick + secondsToTicks(1);
        continue;
      }
      if (r.phase === "recovery") {
        if (tick - r.since >= secondsToTicks(30)) this.transition(player, r, "peace");
        else r.nextThink = tick + secondsToTicks(3);
        continue;
      }
      if (r.phase === "preparing") {
        if (r.tribe && target) {
          const ready = r.readiness.squads;
          if (ready > r.tribe.bestReady) { r.tribe.bestReady = ready; r.tribe.progressAt = tick; }
          const advantage = combatAdvantage(composition(player.id), composition(target.id));
          const deployable = Math.max(0, ready - this.invasionReserve(player.id, ready));
          const required = player.kind === "tribe" || profile.id === "conqueror" ? 1.1 : 1.25;
          // Cohort advantage combines health and DPS, hence quadratic force scaling.
          const projected = player.kind === "tribe"
            ? Math.max(3, Math.ceil(Math.max(2, ready) * Math.sqrt(required / Math.max(.05, advantage))) + 1)
            : Math.max(profile.minimumRaidSquads, Math.ceil(Math.max(2, ready) * Math.sqrt(required / Math.max(.05, advantage)) /
              Math.max(.1, 1 - AI_DOCTRINES[profile.id].reservePercent / 100)));
          r.tribe.desiredSquads = Math.min(world.squadCapacity(player), projected);
          const goal = conquestBuildings(world.buildingFacts().byOwner(target.id), target.ai)[0]?.tile ?? target.base;
          const route = this.expansion.economy.routes.request(`invasion:${player.id}`, player.id, player.base, goal, false, target.id);
          if (!route.pending && !route.path?.length) {
            this.retryLater(player, r, route.reason ?? "No certified invasion route"); continue;
          }
          r.tribe.route = route.path?.length ? "ready" : "pending";
          const fieldAdvantage = advantage * (deployable / Math.max(1, ready)) ** 2;
          r.reason = route.pending ? "Certifying invasion route" : defending ? "Defending home before invading" :
            r.readiness.reason !== "ready" ? `Preparing invasion: ${r.readiness.reason}` :
            fieldAdvantage < required ? `Building invasion force (${ready}/${r.tribe.desiredSquads} ready squads)` : "Assembling supported invasion";
          if (route.path?.length && deployable >= 2 && r.readiness.reason === "ready" && !defending && fieldAdvantage >= required &&
            tick - r.since >= AI_DOCTRINES[profile.id].assemblyTicks + secondsToTicks(4)) {
            this.transition(player, r, "war", target.id);
            if (this.offensiveTarget(player.id) === target.id) { this.updateCampaign(player, target, r); r.reason = "Launching supported tribal invasion"; }
          } else if (tick - r.tribe.progressAt >= secondsToTicks(90) || tick - r.since >= secondsToTicks(360)) {
            this.retryLater(player, r, "Invasion preparation stalled; reassessing targets");
          } else r.nextThink = tick + secondsToTicks(3);
          continue;
        }
        if (r.intent && target) {
          const preparation = r.intent, ready = r.readiness.squads;
          if (ready > preparation.bestReady) { preparation.bestReady = ready; preparation.progressAt = tick; }
          const field = campaignForce(this.expansion, player), advantage = advantageFor(player, target);
          const required = (["warden","builder","diplomat"].includes(profile.id) ? 1.6 : profile.id === "conqueror" ? 1.1 : 1.25) + AI_DIFFICULTY[aiDifficultyOf(world.options)].requiredAdvantageAdd;
          const projected = Math.ceil(Math.max(2, ready) * Math.sqrt(required / Math.max(1 / 1024, advantage)));
          const cap = world.squadCapacity(player);
          const deployment = campaignDeploymentCapacity(this.expansion, player, cap);
          const fieldCeiling = Math.min(deployment.maxSquads, Math.max(0, cap - this.invasionReserve(player.id, cap) - deployment.reservedSquads));
          if (advantage < required && (projected > cap || advantageFor(player, target, false, fieldCeiling) < required)) {
            this.retryLater(player, r, "Required campaign force exceeds legal deployable capacity; improve equipment or reassess"); continue;
          }
          preparation.desiredSquads = Math.min(cap, Math.max(ready, projected));
          const route = this.expansion.economy.routes.request(`invasion:${player.id}`, player.id, player.base, preparation.goal, false, target.id);
          if (!route.pending && !route.path?.length) { this.retryLater(player, r, route.reason ?? "No certified invasion route"); continue; }
          preparation.route = route.path?.length ? "ready" : "pending";
          r.reason = route.pending ? "Certifying campaign route" : defending ? "Defending home" : `Preparing ${preparation.motive} campaign (${ready}/${preparation.desiredSquads})`;
          if (route.path?.length && field.length >= 2 && r.readiness.reason === "ready" && !defending && advantage >= required &&
            tick - r.since >= AI_DOCTRINES[profile.id].assemblyTicks + secondsToTicks(4)) {
            this.transition(player, r, "war", target.id);
            if (this.offensiveTarget(player.id) === target.id) { this.updateCampaign(player, target, r); r.reason = `Launching supported ${preparation.motive} campaign`; }
          } else if (tick - preparation.progressAt >= secondsToTicks(90) || tick - r.since >= secondsToTicks(360))
            this.retryLater(player, r, "Campaign preparation stalled");
          else r.nextThink = tick + secondsToTicks(3);
          continue;
        }
        if (tick - r.since >= AI_DOCTRINES[profile.id].assemblyTicks+secondsToTicks(4) && strength >= 2 && r.readiness.reason==="ready" && !defending && target && (combatAdvantage(composition(player.id),composition(target.id)) >= 1.1 || (strength >= profile.minimumRaidSquads && combatAdvantage(composition(player.id),composition(target.id)) >= .9))) {
          const goal=conquestBuildings(world.buildingFacts().byOwner(target.id),target.ai)[0]?.tile??target.base;
          const route=diplomacy.raids?this.expansion.economy.routes.request(`invasion:${player.id}`,player.id,player.base,goal,false,target.id):undefined;
          if(!diplomacy.raids||route?.path?.length)this.transition(player, r, "war", r.target);
          else if(!route?.pending)this.transition(player,r,"recovery");
          else r.nextThink=tick+secondsToTicks(3);
        }
        else if (tick - r.since >= secondsToTicks(60) || strength < 2) this.transition(player, r, "recovery");
        else r.nextThink = tick + secondsToTicks(3);
        continue;
      }
      const level = AI_DIFFICULTY[aiDifficultyOf(world.options)];
      if (defending || tick < (player.kind === "tribe" ? secondsToTicks(30) : aiRaidAfterTicks(profile.raidAfterTicks, level))) {
        r.nextThink = tick + secondsToTicks(3) + player.id % TICKS_PER_SECOND; continue;
      }
      const expanding=diplomacy.raids&&!r.threats.length&&world.hasUnclaimedFrontier?.(player.id);
      let slice = 0;
      while (r.cursor < world.players.length && this.work < 16 && slice++ < 4) {
        const rival = world.players[r.cursor++]; this.work++;
        if (r.retries?.some(retry => retry.target === rival.id && retry.until > tick)) continue;
        if (rival.id === player.id || rival.eliminated || !(diplomacy.raids?diplomacy.nonAllied(player.id,rival.id)&&!diplomacy.protected(player.id,rival.id):diplomacy.hostile(player.id, rival.id)) ||
          !this.expansion.geography.eligible(player, rival)) continue;
        const commitments = [...this.records.values()].filter(other => other.target === rival.id && ["preparing", "war"].includes(other.phase)).length;
        const advantage = diplomacy.raids && player.kind !== "tribe" && rival.kind !== "tribe"
          ? advantageFor(player, rival) : combatAdvantage(composition(player.id), composition(rival.id));
        const tribalActor = player.kind === "tribe";
        const humanRival = isHumanSeat(world.options ?? {}, rival.id);
        if (!playtestCampaignAllowed({ actor: player, rival, humanRival, commitments, tick, rules: level,
          opening: world.options?.tribeOpening, actorAge: this.expansion.progression.states[player.id]?.age ?? "StoneAge" })) continue;
        // A tribe's first promotion route is peaceful land growth. Once boxed
        // in it may prepare against either a tribe or a vulnerable nation.
        if (tribalActor && (!blocked || advantage * ((world.squadCapacity(player) - 1) / Math.max(1, r.readiness.squads)) ** 2 < 1.1)) continue;
        const tribeExpansion = tribalActor || rival.kind === "tribe" && (blocked || advantage >= 1.5);
        const retaliating=diplomacy.raids&&(r.threats.some(t=>t.rival===rival.id)||
          !!diplomacy.state.wars?.some(w=>w.initiator===rival.id&&(w.a===player.id||w.b===player.id))||
          !!diplomacy.state.embargoes?.some(raid=>raid.initiator===rival.id&&raid.victim===player.id&&diplomacy.embargo(player.id,rival.id)));
        // Tribe opening (OD-9): no tribal campaign against a nation before
        // minute 8 and Bronze Age, unless the tribe is retaliating.
        if (tribalActor && rival.kind !== "tribe" && !retaliating &&
          !tribeMayCampaignAgainstNation(tick, this.expansion.progression.states[player.id].age)) continue;
        if(!tribeExpansion && (strength < 2 || r.readiness.reason !== "ready")) continue;
        const resource = !tribalActor && rival.kind !== "tribe" ? this.resourceGoal(player, rival) : undefined;
        const required = (["warden","builder","diplomat"].includes(profile.id) ? 1.6 : profile.id === "conqueror" ? 1.1 : 1.25) + level.requiredAdvantageAdd;
        // Productive neutral expansion does not veto a paid preparation
        // against another AI. The launch still needs a superior field force.
        if(expanding&&humanRival&&!retaliating&&!tribeExpansion&&advantage<level.expandingVetoVsHuman)continue;
        // Healthy parity-sized forces still commit; small forces need a clear
        // equipment/strength advantage instead of waiting for eight squads.
        if (!tribeExpansion && advantage < required && !(advantage >= .9 && strength >= profile.minimumRaidSquads)) continue;
        const grievance = this.grievance(player.id, rival.id);
        const opportunity = tribalActor ? (rival.kind === "tribe" ? 3 : 2) : tribeExpansion ? 3 : 1;
        const score = Math.floor(world.map.euclideanDistSquared(player.base, rival.base) / (Math.max(.25,advantage)*opportunity*(retaliating?2:1)*(1+grievance/8)*(resource ? resource.blocked ? 2 : 1.3 : 1))) + commitments * 4096;
        if (score < (r.score ?? Infinity) || (score === (r.score ?? Infinity) && rival.id < (r.candidate ?? Infinity))) { r.score = score; r.candidate = rival.id;
          r.candidateIntent = { motive: resource ? "resource" : retaliating || grievance >= 2 ? "retaliation" : "dominance",
            goal: resource?.tile ?? conquestBuildings(world.buildingFacts().byOwner(rival.id), rival.ai)[0]?.tile ?? rival.base,
            resource: resource?.resource };
        }
      }
      if (r.cursor === world.players.length) {
        if (r.candidate !== undefined) {
          const candidate = world.players.find(p => p.id === r.candidate)!;
          const intent = r.candidateIntent;
          this.transition(player, r, "preparing", r.candidate);
          if (world.options?.deferredPlanning && (player.kind === "tribe" || candidate.kind === "tribe")) {
            r.tribe = { desiredSquads: player.kind === "tribe" ? 3 : profile.minimumRaidSquads, bestReady: r.readiness.squads, progressAt: tick, route: "pending" };
            r.reason = player.kind === "tribe" ? "Preparing a promotion campaign" : "Preparing tribal expansion";
          } else if (diplomacy.raids && intent) {
            r.intent = { ...intent, desiredSquads: r.readiness.squads, bestReady: r.readiness.squads, progressAt: tick, route: "pending" };
            r.reason = `Preparing ${intent.motive} campaign`;
          }
        }
        else { r.cursor = 0; r.score = undefined;r.sleepKey=sleepKey; r.nextThink = tick + secondsToTicks(3) + player.id % TICKS_PER_SECOND; }
      }
    }
  }
  get workUsed(): number { return this.work; }
}
