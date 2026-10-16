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
import { tribeMayCampaignAgainstNation } from "../FactionRules";

export interface ArmyTheatre {id:string;purpose:'offense'|'defense'|'screen';tile:number;target?:number;priority:number;desiredSquads:number}
export type OperationPhase = "peace" | "preparing" | "war" | "recovery";
interface TribePreparation {
  desiredSquads: number;
  progressAt: number;
  bestReady: number;
  route: "pending" | "ready";
}
interface CampaignProgress {
  goal: number;
  land: number;
  cities: number;
  health: number;
  distance: number;
  progressAt: number;
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
  score: number;
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
  retries?: { target: number; until: number }[];
  reason?: string;
}
/** Decision policy only. Never replaces Diplomacy.hostile or legal damage. */
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
    const cap=Math.min(this.expansion.armies.capacity(player.id),1+Math.floor(count/40),4);
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
    if(r.target!==undefined&&r.phase==='war'&&rows.length<cap&&remaining>=2){const target=world.players.find(p=>p.id===r.target);if(target)rows.push({id:'offense:'+r.target,purpose:'offense',tile:target.base,target:r.target,priority:2,desiredSquads:remaining});}
    this.theatreRecords.set(player.id,rows.sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id)));
  }
  private territorialRevision=0;
  territoryChanged(oldOwner:number,newOwner:number):void{
    this.territorialRevision++;
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
    return r?.tribe?.route === "ready" && r.target !== undefined && ["preparing", "war"].includes(r.phase)
      ? { target: r.target, squads: r.tribe.desiredSquads } : undefined;
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
    const goal = cities[0]?.tile ?? target.base;
    const health = world.squadFacts().aliveByOwner(target.id).reduce((n, s) => n + remainingHealth(s), 0) +
      cities.reduce((n, b) => n + (b.health ?? b.maxHealth ?? 1200) * HEALTH_SCALE, 0);
    const distance = Math.sqrt(world.squadFacts().aliveByOwner(player.id).reduce((n, s) =>
      s.embarkedOn === null ? Math.min(n, world.map.euclideanDistSquared(world.tileOf(s), goal)) : n, Infinity));
    const p = r.campaign ??= { goal, land: target.land, cities: cities.length, health, distance, progressAt: world.tick };
    if (p.goal !== goal) { p.goal = goal; p.distance = distance; }
    if (target.land < p.land || cities.length < p.cities || health < p.health || distance <= p.distance - 2) {
      p.progressAt = world.tick;
      p.land = Math.min(p.land, target.land); p.cities = Math.min(p.cities, cities.length);
      p.health = Math.min(p.health, health); p.distance = Math.min(p.distance, distance);
    }
  }
  /** Progress, unlike finishing conquest, also includes a supported advance. */
  sustaining(playerId: number, rival: number): boolean {
    const r = this.records.get(playerId);
    return this.finishing(playerId, rival) || !!(r?.phase === "war" && r.target === rival && r.tribe && r.campaign &&
      this.expansion.world.tick - r.campaign.progressAt < secondsToTicks(90));
  }
  checkpoint() { return structuredClone({ records: [...this.records], revision: this.revision,territorialRevision:this.territorialRevision,theatres:[...this.theatreRecords] }); }
  restore(saved: Omit<ReturnType<AiOperations["checkpoint"]>,"theatres"> & Partial<Pick<ReturnType<AiOperations["checkpoint"]>,"theatres">>): void {
    this.theatreRecords.clear();for(const [id,rows] of saved.theatres??[])this.theatreRecords.set(id,structuredClone(rows));
    this.records.clear(); for (const [id, record] of structuredClone(saved.records)) this.records.set(id, record);
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
        threats: [], cursor: 0, score: Infinity };
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
    if (phase !== "war") record.campaign = undefined;
    if (phase !== "preparing" && phase !== "war") record.tribe = undefined;
    record.finishCount = undefined; record.finishProgressAt = undefined;
    record.nextThink = tick + (phase === "war" ? TICKS_PER_SECOND : secondsToTicks(3) + player.id % TICKS_PER_SECOND);
    record.cursor = 0; record.candidate = undefined; record.score = Infinity; this.revision++;
    if (phase === "war"&&!this.expansion.diplomacy.raids) this.expansion.announce({ kind: "war", actorId: player.id, otherId: target, action: "declare" });
    else if (previous === "war") this.expansion.announce({ kind: "war", actorId: player.id, otherId: oldTarget, action: "withdraw" });
  }
  /** At most sixteen geographic candidate reads across all factions per tick.
   * Own force counts come from the caller's existing single grouping pass. */
  step(forces: ReadonlyMap<number, number>): void {
    const { world, diplomacy } = this.expansion, tick = world.tick; this.work = 0;
    const compositions = new Map<number, ReturnType<typeof combatCohorts>>();
    const composition = (id: number) => {
      if (!compositions.has(id)) compositions.set(id, combatCohorts(this.expansion, world.squadFacts().aliveByOwner(id)));
      return compositions.get(id)!;
    };
    const ageKey = world.players.map(p => `${p.id}:${this.expansion.progression.states[p.id]?.age}:${this.expansion.progression.states[p.id]?.completed.length}:${forces.get(p.id) ?? 0}:${p.eliminated}`).join(",");
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
      const sleepKey=`${strength}:${player.land}:${this.expansion.progression.states[player.id]?.completed.length}:${this.expansion.progression.states[player.id]?.age}:${player.reserves>=12}:${diplomacyKey}:${diplomacy.raids?diplomacy.permissionSignature(player.id):""}:${r.territorialRevision??0}:${ageKey}:${blocked}:${blocked ? Math.floor(tick / secondsToTicks(30)) : 0}`;
      if(r.phase==="peace" && !r.threats.length && r.sleepKey===sleepKey){r.nextThink=tick+secondsToTicks(10);continue;}
      r.readiness=forceReadiness(this.expansion,player,2);
      const invasionTroops=r.threats.reduce((sum,t)=>sum+world.squadFacts().aliveByOwner(t.rival)
        .filter(s=>s.embarkedOn===null && world.owners[world.tileOf(s)]===player.id &&
          world.map.euclideanDistSquared(world.tileOf(s),t.tile)<=16**2).reduce((n,s)=>n+s.troops,0),0);
      const defending=player.kind === "tribe"
        ? invasionTroops>=Math.max(12,r.readiness.troops/5)
        : invasionTroops>Math.max(24,r.readiness.troops/3);
      if (r.phase === "war") {
        if (r.tribe && target) this.updateCampaign(player, target, r);
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
      if (defending || tick < (player.kind === "tribe" ? secondsToTicks(30) : profile.raidAfterTicks)) {
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
        const advantage = combatAdvantage(composition(player.id), composition(rival.id));
        const tribalActor = player.kind === "tribe";
        // A tribe's first promotion route is peaceful land growth. Once boxed
        // in it may prepare against either a tribe or a vulnerable nation.
        if (tribalActor && (!blocked || advantage * ((world.squadCapacity(player) - 1) / Math.max(1, r.readiness.squads)) ** 2 < 1.1)) continue;
        const tribeExpansion = tribalActor || rival.kind === "tribe" && (blocked || advantage >= 1.5);
        const retaliating=diplomacy.raids&&(r.threats.some(t=>t.rival===rival.id)||
          diplomacy.state.wars?.some(w=>w.initiator===rival.id&&(w.a===player.id||w.b===player.id))||
          diplomacy.state.embargoes?.some(raid=>raid.initiator===rival.id&&raid.victim===player.id&&diplomacy.embargo(player.id,rival.id)));
        // Tribe opening (OD-9): no tribal campaign against a nation before
        // minute 8 and Bronze Age, unless the tribe is retaliating.
        if (tribalActor && rival.kind !== "tribe" && !retaliating &&
          !tribeMayCampaignAgainstNation(tick, this.expansion.progression.states[player.id].age)) continue;
        if(!tribeExpansion && (strength < 2 || r.readiness.reason !== "ready")) continue;
        if(expanding&&!retaliating&&!tribeExpansion&&advantage<(profile.id==="conqueror"?1.6:2.5))continue;
        const required = ["warden","builder","diplomat"].includes(profile.id) ? 1.6 : profile.id === "conqueror" ? 1.1 : 1.25;
        // Healthy parity-sized forces still commit; small forces need a clear
        // equipment/strength advantage instead of waiting for eight squads.
        if (!tribeExpansion && advantage < required && !(advantage >= .9 && strength >= profile.minimumRaidSquads)) continue;
        const opportunity = tribalActor ? (rival.kind === "tribe" ? 3 : 2) : tribeExpansion ? 3 : 1;
        const score = Math.floor(world.map.euclideanDistSquared(player.base, rival.base) / (Math.max(.25,advantage)*opportunity*(retaliating?2:1))) + commitments * 4096;
        if (score < r.score || (score === r.score && rival.id < (r.candidate ?? Infinity))) { r.score = score; r.candidate = rival.id; }
      }
      if (r.cursor === world.players.length) {
        if (r.candidate !== undefined) {
          const candidate = world.players.find(p => p.id === r.candidate)!;
          this.transition(player, r, "preparing", r.candidate);
          if (world.options?.deferredPlanning && (player.kind === "tribe" || candidate.kind === "tribe")) {
            r.tribe = { desiredSquads: player.kind === "tribe" ? 3 : profile.minimumRaidSquads, bestReady: r.readiness.squads, progressAt: tick, route: "pending" };
            r.reason = player.kind === "tribe" ? "Preparing a promotion campaign" : "Preparing tribal expansion";
          }
        }
        else { r.cursor = 0; r.score = Infinity;r.sleepKey=sleepKey; r.nextThink = tick + secondsToTicks(3) + player.id % TICKS_PER_SECOND; }
      }
    }
  }
  get workUsed(): number { return this.work; }
}
