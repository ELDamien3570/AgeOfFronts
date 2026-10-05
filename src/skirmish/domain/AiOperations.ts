import { forceReadiness } from "./AiForceReadiness";
import { combatCohorts, combatAdvantage } from "./AiCombatPower";
import { canFinishConquest, conquestBuildings } from "./AiConquestObjective";
import { AI_DOCTRINES } from "../content/AiDoctrines";
import { personalityOf } from "../content/AiPersonalities";
import type { Player } from "../Protocol";
import type { Expansion } from "./Expansion";

export type OperationPhase = "peace" | "preparing" | "war" | "recovery";
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
}
/** Decision policy only. Never replaces Diplomacy.hostile or legal damage. */
export class AiOperations {
  private readonly records = new Map<number, AiOperation>();
  revision = 0;
  // Read-cache invalidation also observes refreshed threats, without restarting
  // route jobs every time combat extends an existing retaliation window.
  permissionRevision = 0;
  private work = 0;
  private territorialRevision=0;
  territoryChanged(oldOwner:number,newOwner:number):void{
    this.territorialRevision++;
    for(const id of [oldOwner,newOwner]){const record=this.records.get(id);if(record){record.sleepKey=undefined;record.territorialRevision=this.territorialRevision;record.nextThink=Math.min(record.nextThink,this.expansion.world.tick);}}
  }
  constructor(private readonly expansion: Expansion) {}
  enabled(player: Player | undefined): boolean {
    return !!this.expansion.world.options?.aiWarPolicy && !!player?.ai && player.kind === "regular" && !player.eliminated;
  }
  state(playerId: number): Readonly<AiOperation> | undefined { return this.records.get(playerId); }
  checkpoint() { return structuredClone({ records: [...this.records], revision: this.revision,territorialRevision:this.territorialRevision }); }
  restore(saved: ReturnType<AiOperations["checkpoint"]>): void {
    this.records.clear(); for (const [id, record] of structuredClone(saved.records)) this.records.set(id, record);
    this.permissionRevision++;
    this.revision = saved.revision;this.territorialRevision=saved.territorialRevision??0;
  }
  release(playerId: number): void { if (this.records.delete(playerId)) this.revision++; }
  private record(playerId: number): AiOperation {
    let record = this.records.get(playerId);
    if (!record) {
      record = { phase: "peace", since: this.expansion.world.tick, nextThink: this.expansion.world.tick + playerId % 60,
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
    if (threat) { threat.tile = tile; threat.until = world.tick + 600; }
    else { record.threats.push({ rival, tile, until: world.tick + 600 }); this.revision++; }
    this.permissionRevision++;
    record.nextThink = Math.min(record.nextThink, world.tick);
  }
  /** Offensive permission and remembered defensive retaliation are separate. */
  canTarget(playerId: number, rival: number): boolean {
    const player = this.expansion.world.players.find(p => p.id === playerId);
    if (!this.enabled(player)) return true;
    if (this.expansion.diplomacy.declaredWar(playerId, rival)) return true;
    const record = this.records.get(playerId);
    return !!record && ((record.phase === "war" && record.target === rival) ||
      record.threats.some(t => t.rival === rival && t.until >= this.expansion.world.tick));
  }
  offensiveTarget(playerId: number): number | undefined {
    const record = this.records.get(playerId);
    return record?.phase === "war" ? record.target : undefined;
  }
  finishing(playerId: number, rival: number): boolean {
    const r = this.records.get(playerId);
    return r?.phase === "war" && r.target === rival && r.finishProgressAt !== undefined &&
      this.expansion.world.tick - r.finishProgressAt < 1200;
  }
  /** Defensive pursuit remains local to observed aggression, not a free raid. */
  /** Only this faction's actual entry permissions fence its route work. */
  private readonly navigationKeys = new Map<number, {target: number | null | undefined; threats: number[]; wars: string; value: string}>();
  navigationRevision(playerId: number): string {
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
    if (!rival || rival === playerId || !this.expansion.diplomacy.hostile(playerId, rival)) return true;
    if (!this.enabled(this.expansion.world.players.find(p => p.id === playerId))) return true;
    if (this.expansion.diplomacy.declaredWar(playerId, rival)) return true;
    const record = this.records.get(playerId);
    if ((record?.phase === "war" && record.target === rival) || (record?.phase === "recovery" && record.retreatFrom === rival)) return true;
    return !!record?.threats.some(t => t.rival === rival && t.until >= this.expansion.world.tick &&
      this.expansion.world.map.euclideanDistSquared(t.tile, tile) <= 12 ** 2);
  }
  canPursue(playerId: number, rival: number, tile: number): boolean {
    if (!this.enabled(this.expansion.world.players.find(p => p.id === playerId))) return true;
    if (this.expansion.diplomacy.declaredWar(playerId, rival)) return true;
    const r = this.records.get(playerId);
    return !!r && ((r.phase === "war" && r.target === rival) || r.threats.some(t => t.rival === rival &&
      t.until >= this.expansion.world.tick && this.expansion.world.map.euclideanDistSquared(t.tile, tile) <= 12 ** 2));
  }
  private transition(player: Player, record: AiOperation, phase: OperationPhase, target?: number): void {
    const previous = record.phase, oldTarget = record.target, tick = this.expansion.world.tick;
    record.retreatFrom = phase === "recovery" && previous === "war" ? oldTarget : undefined;
    record.phase = phase; record.target = target; record.since = tick;
    record.finishCount = undefined; record.finishProgressAt = undefined;
    record.nextThink = tick + (phase === "war" ? 20 : 60 + player.id % 20);
    record.cursor = 0; record.candidate = undefined; record.score = Infinity; this.revision++;
    if (phase === "war") this.expansion.announce({ kind: "war", actorId: player.id, otherId: target, action: "declare" });
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
      if (r.target && (!target || target.eliminated || !diplomacy.hostile(player.id, r.target))) {
        this.transition(player, r, "recovery"); continue;
      }
      if (tick < r.nextThink) continue;
      const sleepKey=`${strength}:${player.land}:${this.expansion.progression.states[player.id]?.completed.length}:${this.expansion.progression.states[player.id]?.age}:${player.reserves>=1000}:${diplomacyKey}:${r.territorialRevision??0}:${ageKey}`;
      if(r.phase==="peace" && !r.threats.length && r.sleepKey===sleepKey){r.nextThink=tick+200;continue;}
      r.readiness=forceReadiness(this.expansion,player,2);
      if (r.phase === "war") {
        const buildings = target ? conquestBuildings(world.buildingFacts().byOwner(target.id), target.ai).length : Infinity;
        const enemies = target ? world.squadFacts().byOwner(target.id).filter(s => s.troops > 0).length : Infinity;
        if (canFinishConquest(buildings, enemies, strength)) {
          const count = buildings + enemies;
          if (r.finishCount === undefined || count < r.finishCount) r.finishProgressAt = tick;
          r.finishCount = count;
        } else { r.finishCount = undefined; r.finishProgressAt = undefined; }
        if (strength < 2 || (!this.finishing(player.id, r.target!) &&
          ((strength < Math.max(2, Math.floor(profile.minimumRaidSquads / 2)) && (!target || combatAdvantage(composition(player.id),composition(target.id)) < 1.1)) || tick - r.since >= 2400)))
          this.transition(player, r, "recovery");
        else r.nextThink = tick + 20;
        continue;
      }
      if (r.phase === "recovery") {
        if (tick - r.since >= 600) this.transition(player, r, "peace");
        else r.nextThink = tick + 60;
        continue;
      }
      if (r.phase === "preparing") {
        if (tick - r.since >= AI_DOCTRINES[profile.id].assemblyTicks+80 && strength >= 2 && r.readiness.reason==="ready" && !r.threats.some(t => t.rival !== r.target) && target && (combatAdvantage(composition(player.id),composition(target.id)) >= 1.1 || (strength >= profile.minimumRaidSquads && combatAdvantage(composition(player.id),composition(target.id)) >= .9)))
          this.transition(player, r, "war", r.target);
        else if (tick - r.since >= 1200 || strength < 2) this.transition(player, r, "recovery");
        else r.nextThink = tick + 60;
        continue;
      }
      if (r.threats.length || strength < 2 || r.readiness.reason!=="ready" || tick < profile.raidAfterTicks) {
        r.nextThink = tick + 60 + player.id % 20; continue;
      }
      let slice = 0;
      while (r.cursor < world.players.length && this.work < 16 && slice++ < 4) {
        const rival = world.players[r.cursor++]; this.work++;
        if (rival.id === player.id || rival.kind !== "regular" || rival.eliminated || !diplomacy.hostile(player.id, rival.id) ||
          !this.expansion.geography.eligible(player, rival)) continue;
        const commitments = [...this.records.values()].filter(other => other.target === rival.id && ["preparing", "war"].includes(other.phase)).length;
        const advantage = combatAdvantage(composition(player.id), composition(rival.id));
        const required = ["warden","builder","diplomat"].includes(profile.id) ? 1.6 : profile.id === "conqueror" ? 1.1 : 1.25;
        // Healthy parity-sized forces still commit; small forces need a clear
        // equipment/strength advantage instead of waiting for eight squads.
        if (advantage < required && !(advantage >= .9 && strength >= profile.minimumRaidSquads)) continue;
        const score = Math.floor(world.map.euclideanDistSquared(player.base, rival.base) / Math.max(.25,advantage)) + commitments * 4096;
        if (score < r.score || (score === r.score && rival.id < (r.candidate ?? Infinity))) { r.score = score; r.candidate = rival.id; }
      }
      if (r.cursor === world.players.length) {
        if (r.candidate !== undefined) this.transition(player, r, "preparing", r.candidate);
        else { r.cursor = 0; r.score = Infinity;r.sleepKey=sleepKey; r.nextThink = tick + 60 + player.id % 20; }
      }
    }
  }
  get workUsed(): number { return this.work; }
}
