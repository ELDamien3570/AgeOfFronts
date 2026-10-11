import { radians } from "./FormationGeometry";
import { CONTACT } from "../content/TacticalRules";
import { formationContact, formationPointContact, formationSweepEntry, contactParticipants, CONTACT_TOLERANCE, formationWithinReach, formationSeparationLowerBound } from "./FormationContact";
import { formationEnvelope, type FormationState } from "./FormationGeometry";
import { legacyWeaponStrength, remainingHealth, HEALTH_SCALE } from './Manpower';
import { commitWeaponShot } from "./WeaponTiming";
import { afterWeaponShot } from "../content/WeaponCycles";
import { predictiveAim } from "../RangedAim";
import { restoreArray } from "../StateTransfer";
import { DamageLedger } from "../Conquest";
import { GUN_NEST_ATTACK, TRENCH_COVER } from "../content/Defences";
import { UNIT, defaultUnit } from "../content/Units";
import type { ArcherVolley, Building, Player, Ship, Squad } from "../Protocol";
import { FIXED } from "../Protocol";
import { SpatialGrid } from "../SpatialGrid";
import type { BuildingQueries } from "../BuildingIndex";
import {
  attackContributors,
  attackInterval,
  attackStrength,
  damageAmount,
  defenceOf,
  SHIP_DEFENCE,
  effectiveDamageShares,
  scaledAttack,
  type Defence,
} from "./Combat";
import type {
  Aircraft,
  AttackProfile,
  CombatSourceKind,
  Projectile,
  UnitDefinition,
} from "./Definitions";
import type { Diplomacy } from "./Diplomacy";
import type { Fortifications } from "./Fortifications";
import type { Progression } from "./Progression";
import { boxSweepEntry, circleSweepEntry } from "./ProjectileCollision";
import { unitEffects } from "./ResearchEffects";
import { structureAim } from "./StructureTargeting";
import { missileDefenseRange, MISSILE_DEFENSE_RELOAD_TICKS } from "../content/MissileDefense";
import { interceptionPoint } from "./MissileInterception";
import type { PhaseSpatialFacts, SpatialPhase, SpatialQueries } from "../PhaseSpatialViews";
export interface BattleWorld {
  spatialFacts?(phase: SpatialPhase): PhaseSpatialFacts;
  tick: number;
  squads: readonly Squad[];
  squad(id: number): Squad | undefined;
  ship(id: number): Ship | undefined;
  building(id: number): Building | undefined;
  buildingFacts(): BuildingQueries;
  updateSquad(id: number, changes: Partial<Omit<Squad, "id">>): Squad | undefined;
  updateShip(id: number, changes: Partial<Omit<Ship, "id">>): Ship | undefined;
  players: Player[];
  buildings: readonly Building[];
  updateBuilding(id: number, changes: Partial<Omit<Building, "id">>): Building | undefined;
  ships: readonly Ship[];
  volleys: ArcherVolley[];
  allocateId(): number;
  notifyHostileAction?(victim: number, attacker: number, tile: number): void;
  resolveLandDamage(damage: DamageLedger): void;
  resolveNavalDamage(damage: DamageLedger): void;
  nuclearBlast?(x:number,y:number,radius:number):void;
  destroyTradersInBlast?(attacker:number,x:number,y:number,radius:number):void;
  recordMilitaryLosses(
    victims: { id: number; playerId: number }[],
    damage: DamageLedger,
  ): void;
}
type Position = { x: number; y: number };
type StructureBody = Position & Pick<Building, "id" | "playerId" | "tile">;
type Contributions = Map<number, { id: string; damage: number }[]>;
function segmentBoxEntry(
  from: Position,
  to: Position,
  tile: number,
  width: number,
  radius = 0,
): number | null {
  return boxSweepEntry(
    from,
    to,
    { x: (tile % width) * FIXED, y: Math.floor(tile / width) * FIXED },
    FIXED,
    radius,
  );
}
const GROUND = [
  "infantry",
  "ranged",
  "mounted",
  "vehicle",
  "siege",
  "structure",
  "wall",
  "ship",
] as const;
const STRUCTURE_DEFENCE = {
  tags: ["structure"] as const,
  meleeArmour: 5000,
  rangedArmour: 6500,
  bonusResistance: {},
};
export class Battle {
  checkpoint() { return structuredClone({projectiles:this.projectiles}); }
  restore(saved: ReturnType<Battle["checkpoint"]>): void {
    const state=structuredClone(saved);
    restoreArray(this.projectiles,state.projectiles);
    this.reservedWarheads = this.projectiles.reduce((n,p) => n + (!p.impacted && p.kind === "mirv" ? p.warheads : 0),0);
    this.definitions.clear();
    this.structureBodies.clear(); this.structureRevision = -1;
  }

  readonly projectiles: Projectile[] = [];
  private reservedWarheads = 0;
  canFire(warheads = 0): boolean {
    return this.projectiles.length + this.reservedWarheads + 1 + warheads <= 4096;
  }
  // Read-only diagnostics: cache warmth and counters never drive simulation.
  readonly telemetry = { indexRebuilds: 0, trenchCandidates: 0, nestSearches: 0, emptyNestSkips: 0, structureRebuilds: 0, structureAllocations: 0 };
  private spatial: SpatialQueries<Squad>;
  private naval: SpatialQueries<Ship>;
  private localSpatial?: SpatialGrid<Squad>;
  private localNaval?: SpatialGrid<Ship>;
  private readonly mapHeight: number;
  private readonly structures: SpatialGrid<StructureBody>;
  private readonly nearby: Squad[] = [];
  private readonly nearbyShips: Ship[] = [];
  private readonly nearbyStructures: StructureBody[] = [];
  private readonly structureBodies = new Map<number, StructureBody>();
  private structureRevision = -1;
  private structureGeometryRevision = -1;
  private readonly structureById = new Map<number, Building>();
  private readonly covered = new Set<number>();
  private readonly definitions = new Map<number, Map<string, { revision: number; unit: UnitDefinition }>>();
  private mapWidth: number;
  constructor(
    private readonly world: BattleWorld,
    width: number,
    height: number,
    private readonly diplomacy: Diplomacy,
    private readonly forts: Fortifications,
    private readonly progression: Progression,
  ) {
    this.mapWidth = width;
    this.mapHeight = height;
    this.spatial = new SpatialGrid<Squad>(0, 0, 4 * FIXED);
    this.naval = new SpatialGrid<Ship>(0, 0, 4 * FIXED);
    this.structures = new SpatialGrid(
      width * FIXED,
      height * FIXED,
      4 * FIXED,
      (b) => b.playerId,
    );
  }
  setWidth(width: number): void {
    if (this.mapWidth !== width) { this.mapWidth = width; this.structureRevision = -1; }
  }
  definition(s: Squad): UnitDefinition {
    const base = UNIT.get(s.definitionId ?? "") ?? defaultUnit(s.kind),
      research = this.progression.states[s.playerId]?.completed ?? [],
      byDefinition = this.definitions.get(s.playerId),
      cached = byDefinition?.get(base.id);
    if (cached?.revision === research.length) return cached.unit;
    const unit = unitEffects(base, research);
    const entries = byDefinition ?? new Map<string, { revision: number; unit: UnitDefinition }>();
    if (!byDefinition) this.definitions.set(s.playerId, entries);
    entries.set(base.id, { revision: research.length, unit });
    return unit;
  }
  position(b: Pick<Building, "tile">): Position {
    return {
      x: ((b.tile % this.mapWidth) + 0.5) * FIXED,
      y: (Math.floor(b.tile / this.mapWidth) + 0.5) * FIXED,
    };
  }
  private contact(a:Squad,b:Squad):ReturnType<typeof formationContact> {
    return formationContact(a,b,this.world.tick);
  }
  private readonly engagedTargets=new Map<number,number>();
  private legalContact(a:Squad,b:Squad,range:number,melee=false):boolean {
    if(melee && this.forts.hasObstacles && this.forts.segmentTiles(a,b).some(tile=>this.forts.intactWallAt(tile)))return false;
    if(a.formation && b.formation && !a.afloat && !b.afloat){
      if(!formationWithinReach(a,b,this.world.tick,range+CONTACT.release))return false;
      const contact=this.contact(a,b);
      return contact.gap<=range+(this.engagedTargets.get(a.id)===b.id?CONTACT.release:CONTACT_TOLERANCE) && this.forts.clear(a,b,a.playerId) && this.forts.clear(contact.source,contact.target,a.playerId);
    }
    return this.distance(a,b)<=range**2 && this.forts.clear(a,b,a.playerId);
  }
  private participants(a:Squad,profile:AttackProfile,b?:Squad):number {
    return profile.perSoldier && profile.channel==="melee" && a.formation && b?.formation && !a.afloat && !b.afloat
      ? contactParticipants(a,b,this.world.tick,profile.ranks??2,this.contact(a,b),!a.charge && this.contact(a,b).gap<=CONTACT.release) : attackContributors(a,profile,b);
  }
  private distance(a: Position, b: Position): number {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  }
  private rebuild(phase: SpatialPhase): void {
    this.telemetry.indexRebuilds++;
    const spatialFacts = this.world.spatialFacts?.(phase);
    if (spatialFacts) { this.spatial = spatialFacts.ground; this.naval = spatialFacts.ships; }
    else {
      this.localSpatial ??= new SpatialGrid(this.mapWidth * FIXED, this.mapHeight * FIXED, 4 * FIXED, (s: Squad) => s.playerId,(s)=>s.formation ? formationEnvelope(s,this.world.tick).broadRadius : 0);
      this.localNaval ??= new SpatialGrid(this.mapWidth * FIXED, this.mapHeight * FIXED, 4 * FIXED, (s: Ship) => s.playerId);
      this.localSpatial.rebuild(this.world.squads.filter((s) => s.embarkedOn === null));
      this.localNaval.rebuild(this.world.ships);
      this.spatial = this.localSpatial; this.naval = this.localNaval;
    }
    const facts = this.world.buildingFacts();
    if (this.structureRevision !== facts.producerRevision || this.structureGeometryRevision !== facts.geometryRevision) {
      this.telemetry.structureRebuilds++;
      this.structureRevision = facts.producerRevision;
      this.structureGeometryRevision = facts.geometryRevision;
      this.structureById.clear();
      const bodies: StructureBody[] = [];
      for (const b of this.world.buildings) {
        this.structureById.set(b.id, b);
        if ((b.health ?? 1) <= 0) continue;
        let body = this.structureBodies.get(b.id);
        if (!body) {
          body = {...this.position(b), id: b.id, playerId: b.playerId, tile: b.tile};
          this.structureBodies.set(b.id, body); this.telemetry.structureAllocations++;
        } else {
          const point = this.position(b);
          body.x = point.x; body.y = point.y;
          // The body fields are derived; the canonical building stays read-only.
          Object.assign(body, {playerId: b.playerId, tile: b.tile});
        }
        bodies.push(body);
      }
      for (const id of this.structureBodies.keys())
        if (!this.world.building(id)) this.structureBodies.delete(id);
      this.structures.rebuild(bodies);
    }
    this.covered.clear();
    const coverTiles = new Set<string>();
    const coverTile = (owner: number, tile: number) => {
      const key = `${owner}:${tile}`;
      if (coverTiles.has(key)) return;
      coverTiles.add(key);
      const p = this.position({tile});
      this.spatial.queryOverlaps(p.x, p.y, FIXED, this.nearby);
      this.telemetry.trenchCandidates += this.nearby.length;
      for (const s of this.nearby.filter(s => s.playerId === owner && s.embarkedOn === null && !s.afloat &&
        this.definition(s).tags.includes("infantry") && this.distance(s,p) <= TRENCH_COVER.radius ** 2)
        .sort((a,b) => a.id-b.id).slice(0,TRENCH_COVER.slots)) this.covered.add(s.id);
    };
    for (const b of this.world.buildings)
      if (b.type === "trench" && !b.remainingTicks && (b.health ?? 1) > 0) {
        coverTile(b.playerId, b.tile);
      }
    for (const run of this.forts.barriers)
      if (run.kind === "trench" && run.health > 0 && !run.remainingTicks)
        for (const tile of run.tiles) coverTile(run.playerId, tile);
  }
  cover(s: Squad): number {
    return this.covered.has(s.id) ? TRENCH_COVER.reduction : 0;
  }
  /** A squad afloat is a hull: only weapons that engage ships can hit it,
   * and they meet ship armour rather than the soldiers' own. */
  private targetTags(s: Squad): readonly string[] {
    return s.afloat ? SHIP_DEFENCE.tags : this.definition(s).tags;
  }
  private targetDefence(s: Squad) {
    return s.afloat ? SHIP_DEFENCE : defenceOf(this.definition(s), this.cover(s));
  }
  fire(
    source: {
      id: number;
      playerId: number;
      x: number;
      y: number;
      domain?: CombatSourceKind;
      attackScale?: number;
      troops?: number;
      originTile?: number;
    },
    target: Position,
    profile: AttackProfile,
    damage: number,
    kind: Projectile["kind"] = "shell",
    flightTicks?: number,
    warheads = 0,
    definitionId?: string,
    targetBuildingId?: number,
    targetAircraftId?: number,
  ): boolean {
    if (!this.canFire(kind === "mirv" ? warheads : 0)) return false;
    const a=source.domain===undefined || source.domain==="squad"?this.world.squad(source.id):undefined,b=this.world.squad((target as {id?:number}).id??-1);
    if(a?.formation && b?.formation && !a.afloat && !b.afloat){const contact=this.contact(a,b);source={...source,x:Math.round(contact.source.x),y:Math.round(contact.source.y)};target={...target,x:Math.round(contact.target.x),y:Math.round(contact.target.y)};}
    const unit = definitionId && UNIT.get(definitionId);
    if (unit && unit.attack.channel === "ranged" && ["StoneAge","BronzeAge","ClassicalAge","EarlyMedieval","LateMedieval"].includes(unit.age) && unit.troopClass) {
      const motion = (target as Squad).locomotion;
      const velocity = motion ? {x:-Math.sin(motion.heading)*motion.speed*20/FIXED*64,y:Math.cos(motion.heading)*motion.speed*20/FIXED*64} : {x:0,y:0};
      const aimed = predictiveAim({x:source.x/FIXED*64,y:source.y/FIXED*64},{x:target.x/FIXED*64,y:target.y/FIXED*64},velocity,(profile.projectile?.speed ?? FIXED)*20/FIXED*64,source.id*65537+this.world.tick,4);
      target = {x:Math.round(aimed.point.x/64*FIXED),y:Math.round(aimed.point.y/64*FIXED)};
    }
    if (kind === "mirv") this.reservedWarheads += warheads;
    this.projectiles.push({
      id: this.world.allocateId(),
      playerId: source.playerId,
      sourceId: source.id,
      sourceKind: source.domain ?? "squad",
      attackScale: profile.perSoldier ? source.attackScale ?? source.troops ?? 0 : source.attackScale,
      perSoldier: profile.perSoldier,
      definitionId,
      ...(targetAircraftId === undefined ? {} : {targetAircraftId}),
      ...(targetBuildingId === undefined ? {} : {targetBuildingId}),
      originTile: source.originTile,
      fromX: source.x,
      fromY: source.y,
      x: source.x,
      y: source.y,
      toX: target.x,
      toY: target.y,
      tick: this.world.tick,
      impactTick:
        this.world.tick +
        (flightTicks ??
          Math.max(
            1,
            Math.ceil(
              Math.sqrt(this.distance(source, target)) /
                (profile.projectile?.speed ?? FIXED),
            ),
          )),
      diameter: profile.projectile?.diameter ?? FIXED / 4,
      blastRadius: profile.projectile?.blastRadius ?? 0,
      damage,
      channel: profile.channel,
      bonuses: { ...profile.bonuses },
      penetration: profile.penetration,
      targets: [...profile.targets],
      kind,
      warheads,
      impacted: false,
    });
    return true;
  }
  private volley(
    source: {
      id: number;
      playerId: number;
      x: number;
      y: number;
      definitionId?: string;
    },
    target: Position & {id?:number},
    damage = 0,
    melee = false,
  ): void {
    const a=this.world.squad(source.id),b=target.id===undefined?undefined:this.world.squad(target.id);
    const contact=a?.formation && b?.formation && !a.afloat && !b.afloat ? formationContact(a,b,this.world.tick) : undefined;
    const anchors={fromX:contact?Math.round(contact.source.x):source.x,fromY:contact?Math.round(contact.source.y):source.y,toX:contact?Math.round(contact.target.x):target.x,toY:contact?Math.round(contact.target.y):target.y};
    // Latest committed edges survive effect saturation and coalesced snapshots.
    // Record before the cosmetic event cap; damage never reads these facts.
    if(melee && a && damage>0){
      const contacts=a.meleeStrike?.tick===this.world.tick?[...a.meleeStrike.contacts]:[];
      // Coalesce an edge's targets so crowded fronts cannot exhaust the record
      // before a newly contacted flank is represented. Eight bearings are bounded.
      const edge=(p:typeof anchors & {bearing?:number})=>{
        let dx=p.fromX-a.x,dy=p.fromY-a.y;
        if(Math.hypot(dx,dy)<1){dx=p.toX-p.fromX;dy=p.toY-p.fromY;}
        return (Math.round((p.bearing??Math.atan2(dy,dx))/(Math.PI/4))+8)%8;
      };
      const fact={...anchors,targetId:target.id,bearing:Math.atan2(contact?.normal.y??target.y-a.y,contact?.normal.x??target.x-a.x)};
      if(!contacts.some(c=>edge(c)===edge(fact)))contacts.push(fact);
      this.world.updateSquad(a.id,{meleeStrike:{tick:this.world.tick,contacts}});
    }
    if (this.world.volleys.length >= 4096) return;
    this.world.volleys.push({
      id: this.world.allocateId(),
      tick: this.world.tick,
      squadId: source.id,
      definitionId: source.definitionId,
      playerId: source.playerId,
      ...anchors,
      targetId: target.id, damage, melee,
    });
  }
  private contribution(
    map: Contributions,
    target: number,
    attacker: number,
    damage: number,
    kind: CombatSourceKind = "squad",
  ): void {
    let list = map.get(target);
    if (!list) map.set(target, (list = []));
    list.push({ id: `${kind}:${attacker}`, damage });
  }
  private updateSource(source: Squad | Ship, changes: { xp: number }): void {
    if ("troops" in source) this.world.updateSquad(source.id, changes);
    else this.world.updateShip(source.id, changes);
  }
  awardDamage(damage: DamageLedger, contributions: Contributions): void {
    for (const [id, list] of contributions) {
      const target = this.world.squad(id) ?? this.world.ship(id);
      if (!target) continue;

      const health = "troops" in target ? (target.afloat?.hull ?? (target.manpower ? remainingHealth(target) / HEALTH_SCALE : target.troops)) : target.health;
      const applied = Math.min(health, damage.damage(id)),
        subunitShares = effectiveDamageShares(Math.round(applied * HEALTH_SCALE), list.map(c=>({id:c.id,damage:Math.round(c.damage * HEALTH_SCALE)}))),
        shares = new Map([...subunitShares].map(([id,n])=>[id,n / HEALTH_SCALE]));
      for(const [sourceKey,amount] of subunitShares){
        const [kind,sourceId]=sourceKey.split(":");
        if(kind!=="squad")continue;
        const facts=this.world.volleys.filter(v=>v.tick===this.world.tick && v.squadId===Number(sourceId) && v.targetId===id && (v.melee||v.impact));
        const total=facts.reduce((n,v)=>n+(v.damage??0),0);
        if(total>0)for(const fact of facts)fact.damage=(fact.damage??0)*amount/(total*HEALTH_SCALE);
      }
      if (applied === health) {
        const killer = [...shares].sort(
          (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"),
        )[0];
        if (killer) shares.set(killer[0], killer[1] + 50);
      }
      for (const [attacker, xp] of shares) {
        const [kind, id] = attacker.split(":");
        const s = kind === "squad" ? this.world.squad(Number(id)) : kind === "ship" ? this.world.ship(Number(id)) : undefined;
        if (s) this.updateSource(s, { xp: Math.min(20000, (s.xp ?? 0) + xp) });
      }
    }
  }
  hitBuilding(
    building: Building,
    playerId: number,
    sourceId: number,
    damage: number,
    kind: CombatSourceKind = "squad",
  ): void {
    this.structuralHit(building, playerId, sourceId, damage, kind);
  }
  private structuralHit(
    target: Building | (typeof this.forts.barriers)[number],
    attacker: number,
    source: number,
    hit: number,
    kind: CombatSourceKind = "squad",
  ): void {
    if ((target.health ?? 1) <= 0) return;
    const applied = Math.min(target.health ?? target.maxHealth ?? 1200, hit);
    const health = (target.health ?? target.maxHealth ?? 1200) - applied;
    if ("tile" in target) this.world.updateBuilding(target.id, { health });
    else this.forts.updateBarrier(target.id, { health });
    if (applied > 0) this.world.notifyHostileAction?.(target.playerId, attacker, "tile" in target ? target.tile : target.tiles[0]);
    const s =
      kind === "squad"
        ? this.world.squad(source)
        : kind === "ship"
          ? this.world.ship(source)
          : undefined;
    if (s?.playerId === attacker)
      this.updateSource(s, { xp: Math.min(
        20000,
        (s.xp ?? 0) + applied + (health <= 0 ? 50 : 0),
      ) });
    if (health <= 0) {
      const ledger = new DamageLedger();
      ledger.add(target.id, attacker, applied);
      this.world.recordMilitaryLosses([target], ledger);
    }
  }
  private commitShot(squad: Squad, profile: AttackProfile): boolean {
    if (profile.projectile && !this.canFire()) return false;
    const tick = this.world.tick;
    if (profile.perSoldier) {
      const state = commitWeaponShot(profile, squad.weaponState, tick, squad.moved);
      if (!state) return false;
      const ranged = state.ranged;
      this.world.updateSquad(squad.id, { weaponState: state, lastAttackTick: tick,
        nextAttackTick: state[profile.channel]!.nextTick,
        magazineShots: ranged?.shots ?? 0, reloadStartedTick: ranged?.reloadStartedTick });
    } else {
      if (tick < (squad.nextAttackTick ?? 0)) return false;
      this.world.updateSquad(squad.id, { lastAttackTick: tick, ...afterWeaponShot(this.definition(squad), squad.magazineShots ?? 0, tick, attackInterval(profile, squad.moved)) });
    }
    return true;
  }
  fight(aircraft: Aircraft[]): void {
    this.engagedTargets.clear();for(const s of this.world.squads)if(s.fighting && s.combatTargetId!==null)this.engagedTargets.set(s.id,s.combatTargetId);
    this.rebuild("combat");
    const { tick, squads } = this.world,
      damage = new DamageLedger(),
      contributions: Contributions = new Map();
    for (const squad of squads
      .filter((s) => s.embarkedOn === null)
      .sort((a, b) => a.id - b.id)) {
      const definition = this.definition(squad);
      let profile = definition.attack;
      this.world.updateSquad(squad.id, { fighting: false });
      this.world.updateSquad(squad.id, { combatTargetId: null });
      // Transports carry soldiers; they do not fight from the water.
      if (squad.refit || squad.manpower?.enlargement || squad.afloat || squad.charge?.phase === "preparing") continue;
      if (squad.charge?.phase === "committed") {
        const charge = definition.charge!;
        this.spatial.queryOverlaps(
          squad.x,
          squad.y,
          charge.radius + FIXED + (squad.formation?formationEnvelope(squad,tick).broadRadius:0),
          this.nearby,
        );
        const targets = this.nearby.filter(
          (s) =>
            this.diplomacy.hostile(squad.playerId, s.playerId) &&
            !s.afloat &&
            this.legalContact(squad,s,definition.meleeAttack?.range ?? charge.radius,true) &&
            this.participants(squad,definition.meleeAttack ?? profile,s)>0,
        );
        if (
          targets.length ||
          this.distance(squad, squad.charge) <= FIXED ** 2 ||
          tick - squad.charge.committedTick > 80
        ) {
          const impact = definition.meleeAttack ? { ...definition.meleeAttack, damage: definition.meleeAttack.damage * (definition.chargeMultiplier ?? 1), penetration: charge.penetration } : { ...profile, channel: "melee" as const, damage: charge.damage, penetration: charge.penetration };
          const contributors = attackContributors(squad, impact);
          let remaining = impact.perSoldier ? (impact.damage + Math.max(0,...Object.values(impact.bonuses))) * contributors * 4 : charge.damage * 4;
          for (const target of targets
            .sort((a, b) => a.id - b.id)
            .slice(0, 8)) {
            const hit = Math.min(
              remaining,
              damageAmount(
                {
                  ...impact,
                },
                this.targetDefence(target),
                impact.perSoldier ? this.participants(squad, impact, target) : legacyWeaponStrength(squad),
                squad.xp,
              ),
            );
            damage.add(target.id, squad.playerId, hit);
            this.volley(squad, target, hit, true);
            this.contribution(contributions, target.id, squad.id, hit);
            remaining -= hit;
          }
          this.world.updateSquad(squad.id, { charge: { ...squad.charge, phase: "recovery" } });
          this.world.updateSquad(squad.id, { chargeReadyTick: tick + charge.cooldownTicks });
          if (impact.perSoldier) this.world.updateSquad(squad.id, { weaponState: { ...squad.weaponState, sharedReadyTick: Math.max(tick + 10, squad.weaponState?.sharedReadyTick ?? 0) } });
          this.world.updateSquad(squad.id, { order: { type: "hold" } });
          this.world.updateSquad(squad.id, { path: [] });
          this.world.updateSquad(squad.id, { queuedOrders: [] });
          if (definition.age === "Napoleonic" && definition.troopClass === "frontline") this.world.updateSquad(squad.id, {lastAttackTick:tick-1,nextAttackTick:Math.max(tick+10,squad.nextAttackTick ?? 0)});
        }
        continue;
      }
      if (squad.charge?.phase === "recovery") {
        if (
          tick >=
          (squad.chargeReadyTick ?? 0) - (definition.charge!.cooldownTicks - 10)
        )
          this.world.updateSquad(squad.id, { charge: null });
        else continue;
      }
      if (profile.targets.includes("aircraft")) {
        const target = aircraft
          .filter(
            (a) =>
              a.health > 0 && a.definitionId !== "drone" && a.state !== "ready" &&
              this.diplomacy.hostile(squad.playerId, a.playerId) &&
              this.distance(squad, a) <= profile.range ** 2,
          )
          .sort(
            (a, b) =>
              this.distance(squad, a) - this.distance(squad, b) || a.id - b.id,
          )[0];
        if (target && tick >= (squad.nextAttackTick ?? 0)) {
          const hit = Math.min(
            target.health,
            damageAmount(
              profile,
              {
                tags: ["aircraft"],
                meleeArmour: 0,
                rangedArmour: 0,
                bonusResistance: {},
              },
              legacyWeaponStrength(squad),
              squad.xp,
            ),
          );
          target.health -= hit;
          this.world.updateSquad(squad.id, { xp: Math.min(20000, (squad.xp ?? 0) + hit) });
          this.volley(squad, target);
          this.world.updateSquad(squad.id, { lastAttackTick: tick });
          this.world.updateSquad(squad.id, afterWeaponShot(definition, squad.magazineShots ?? 0, tick, attackInterval(profile, squad.moved)));
          this.world.updateSquad(squad.id, { fighting: true });
          this.world.updateSquad(squad.id, { lastCombatTick: tick });
          if (target.health <= 0) {
            const ledger = new DamageLedger();
            ledger.add(target.id, squad.playerId, hit);
            this.world.recordMilitaryLosses([target], ledger);
          }
        }
        continue;
      }
      if (squad.structureTarget) {
        this.attackStructure(squad, profile);
        continue;
      }
      if (!profile.damage) continue;
      const acquisitionRange=profile.range;
      let queried=false;
      const gatherNearby=()=>{if(queried)return;queried=true;this.spatial.queryOverlaps(
        squad.x,
        squad.y,
        acquisitionRange + CONTACT.release + (squad.formation?formationEnvelope(squad,tick).broadRadius:0),
        this.nearby,
        squad.playerId,
      );};
      const eligible = (s: Squad) =>
        this.diplomacy.hostile(squad.playerId, s.playerId) &&
        profile.targets.some((tag) => this.targetTags(s).includes(tag)) &&
        this.legalContact(squad,s,profile.range,profile.channel==="melee");
      let target: Squad | undefined;
      let nearest = Infinity;
      // Explicit orders and a retained frontal melee target override nearest
      // acquisition. Resolve them first, without a background-work queue.
      const wanted=squad.order.type==='attack'?this.world.squad(squad.order.targetId):undefined;
      if(wanted && eligible(wanted))target=wanted;
      const previous=this.world.squad(this.engagedTargets.get(squad.id)??-1);
      if(!target && previous && profile.channel==='melee' && eligible(previous)){
        const contact=this.contact(squad,previous),angle=squad.formation?radians(squad.formation.facing):0;
        if(-Math.sin(angle)*contact.normal.x+Math.cos(angle)*contact.normal.y>=.25)target=previous;
      }
      if(!target){gatherNearby();for (const candidate of this.nearby) {
        if(!this.diplomacy.hostile(squad.playerId,candidate.playerId) || !profile.targets.some(tag=>this.targetTags(candidate).includes(tag)))continue;
        if(squad.formation && candidate.formation &&
          (!formationWithinReach(squad,candidate,tick,profile.range+CONTACT.release) || formationSeparationLowerBound(squad,candidate,tick)>nearest))continue;
        const distance = squad.formation && candidate.formation ? this.contact(squad,candidate).gap**2 : this.distance(squad, candidate);
        if (distance > nearest || (distance === nearest && target && candidate.id >= target.id)) continue;
        if (!eligible(candidate)) continue;
        target = candidate;
        nearest = distance;
      }}
      if (!target) continue;
      // Acquisition grants neither a shot nor an attack animation; close
      // contacted edges defend without rotating the physical formation.
      this.world.updateSquad(squad.id, { combatTargetId: target.id });
      if(profile.channel==='melee' && this.participants(squad,profile,target)<=0)continue;
      this.world.updateSquad(squad.id, { fighting: true });
      if (definition.meleeAttack && this.legalContact(squad,target,definition.meleeAttack.range,true) && this.participants(squad,definition.meleeAttack,target)>0) profile = definition.meleeAttack;
      this.world.updateSquad(squad.id, { combatTargetId: target.id });
      this.world.updateSquad(squad.id, { lastCombatTick: tick });
      this.world.updateSquad(target.id, { lastCombatTick: tick });
      if (!this.commitShot(squad, profile)) continue;
      if (profile.projectile) {
        const weapon = scaledAttack(profile, 1000, 1000, squad.xp);
        this.fire(
          {
            ...squad,
            attackScale: profile.perSoldier ? attackContributors(squad, profile) : attackStrength(legacyWeaponStrength(squad), 1000),
          },
          target,
          weapon,
          weapon.damage,
          "shell",
          undefined,
          0,
          squad.definitionId,
        );
        continue;
      }

      const hit = damageAmount(
        profile,
        this.targetDefence(target),
        profile.perSoldier ? this.participants(squad, profile, target) : legacyWeaponStrength(squad),
        squad.xp,
      );
      damage.add(target.id, squad.playerId, hit);
      this.volley(squad, target, hit, profile.channel === "melee");
      this.contribution(contributions, target.id, squad.id, hit);
      if(profile.channel==='melee' && profile.perSoldier && squad.formation && !squad.charge){
        // One shared attack cycle defends contacted edges. The primary target
        // receives first priority; edge pools and total manpower bound damage.
        let remaining=squad.troops-this.participants(squad,profile,target);
        const edges=new Map<number,number>(),angle=formationEnvelope(squad,tick).angle;
        const edge=(other:Squad)=>{const c=this.contact(squad,other),x=Math.cos(angle)*c.normal.x+Math.sin(angle)*c.normal.y,y=c.facing;return Math.abs(x)>Math.abs(y)?(x>0?1:3):(y>0?0:2);};
        edges.set(edge(target),this.participants(squad,profile,target));
        if(remaining>0)gatherNearby();
        const others=(remaining>0?this.nearby:[]).filter(other=>other.id!==target.id && eligible(other) && this.contact(squad,other).gap<=CONTACT.release)
          .sort((a,b)=>this.contact(squad,a).gap-this.contact(squad,b).gap || a.id-b.id);
        for(const other of others){
          if(remaining<=0)break;
          const key=edge(other),used=edges.get(key)??0,n=Math.min(remaining,Math.max(0,this.participants(squad,profile,other)-used));if(!n)continue;
          edges.set(key,used+n);remaining-=n;
          const sideHit=damageAmount(profile,this.targetDefence(other),n,squad.xp);
          damage.add(other.id,squad.playerId,sideHit);this.volley(squad,other,sideHit,true);this.contribution(contributions,other.id,squad.id,sideHit);
          this.world.updateSquad(other.id,{lastCombatTick:tick});
        }
      }
      this.world.updateSquad(squad.id, { firingCharge: 0 });
    }
    // Fixed gun nests have their own weapon, never a mobile squad's reserves.
    for (const b of this.world.buildings)
      if (
        b.type === "gun-nest" &&
        !b.remainingTicks &&
        (b.health ?? 1) > 0 &&
        tick >= (b.nextAttackTick ?? 0)
      ) {
        const p = this.position(b);
        this.spatial.queryOverlaps(p.x,p.y,GUN_NEST_ATTACK.range,this.nearby,b.playerId);
        if (!this.nearby.length) {
          this.telemetry.emptyNestSkips++;
          continue;
        }
        this.telemetry.nestSearches++;
        const target = this.nearby
          .filter(
            (s) =>
              this.diplomacy.hostile(b.playerId, s.playerId) &&
              (s.formation && !s.afloat ? formationPointContact(s,p,tick).gap : Math.sqrt(this.distance(p,s))) <= GUN_NEST_ATTACK.range &&
              this.forts.clear(p, s, b.playerId),
          )
          .sort(
            (a, c) => this.distance(p, a) - this.distance(p, c) || a.id - c.id,
          )[0];
        if (target) {
          const hit = damageAmount(
            GUN_NEST_ATTACK,
            this.targetDefence(target),
          );
          damage.add(target.id, b.playerId, hit);
          this.contribution(contributions, target.id, b.id, hit, "building");
          this.volley(
            {
              ...p,
              id: b.id,
              playerId: b.playerId,
              definitionId: "modern-gun-nest",
            },
            target,
          );
          this.world.updateBuilding(b.id, { nextAttackTick: tick + GUN_NEST_ATTACK.reloadTicks });
        }
      }
    this.awardDamage(damage, contributions);
    this.world.resolveLandDamage(damage);
  }
  private attackStructure(squad: Squad, profile: AttackProfile): void {
    const target =
      squad.structureTarget!.buildingId !== undefined
        ? this.world.building(squad.structureTarget!.buildingId)
        : this.forts.barrier(squad.structureTarget!.barrierId!);
    if (
      !target ||
      !this.diplomacy.hostile(squad.playerId, target.playerId) ||
      (target.health ?? 1) <= 0
    ) {
      this.world.updateSquad(squad.id, { structureTarget: null });
      return;
    }
    const p = structureAim(squad, "tile" in target ? [target.tile] : target.tiles,
      profile.range, squad.playerId, this.mapWidth, this.forts,this.world.tick);
    if (!p) return;
    this.world.updateSquad(squad.id, { fighting: true });
    this.world.updateSquad(squad.id, { lastCombatTick: this.world.tick });
    if (!this.commitShot(squad, profile)) return;
    if (profile.projectile) {
      const weapon = scaledAttack(profile, 1000, 1000, squad.xp);
      this.fire(
        { ...squad, attackScale: profile.perSoldier ? attackContributors(squad, profile) : attackStrength(legacyWeaponStrength(squad), 1000) },
        p,
        weapon,
        weapon.damage,
        "shell",
        undefined,
        0,
        squad.definitionId,
      );
      return;
    }
    if (profile.channel === "ranged") this.volley(p.source?{...squad,...p.source}:squad, p);
    let hit = damageAmount(
      profile,
      {
        ...STRUCTURE_DEFENCE,
        tags: "tile" in target ? ["structure"] : ["structure", "wall"],
      },
      profile.perSoldier ? attackContributors(squad, profile) : legacyWeaponStrength(squad),
      squad.xp,
    );
    if (!("tile" in target) && this.diplomacy.state.betrayal[target.playerId])
      hit *= 2;
    if(profile.channel==="melee")this.volley(p.source?{...squad,...p.source}:squad,p,hit,true);
    this.structuralHit(target, squad.playerId, squad.id, hit);
  }
  advanceProjectiles(aircraft:readonly Aircraft[]=[]): void {
    // Retained impact visuals still expire below, but no collision/cover query
    // consumes these indexes when every projectile has already impacted.
    if (this.projectiles.some(p => !p.impacted && !p.interception)) this.rebuild("projectiles");
    const { tick } = this.world,
      impacts = new DamageLedger(),
      naval = new DamageLedger(),
      contributions: Contributions = new Map();
    const incoming = this.projectiles.filter(p => !p.impacted && !p.interception && (p.kind === "icbm" || p.kind === "warhead"));
    if (incoming.length) {
      const stacks = new Map<string, Building[]>();
      const fired = new Set<number>();
      for (const player of this.world.players) for (const b of this.world.buildingFacts().completed(player.id,"missile-defence")) {
        const key = `${b.playerId}:${b.tile}`;
        const stack = stacks.get(key) ?? [];
        stack.push(b); stacks.set(key,stack);
      }
      // Imminent impacts first. One persisted claim per warhead prevents
      // overlapping sites wasting reloads, including after checkpoint restore.
      for (const p of incoming.sort((a,b)=>a.impactTick-b.impactTick || b.blastRadius-a.blastRadius || a.id-b.id)) {
        if (p.interception) continue;
        let chosen: {building: Building; point: NonNullable<ReturnType<typeof interceptionPoint>>} | undefined;
        const duration=p.impactTick-p.tick, fraction=Math.min(1,(tick-p.tick)/duration),x=p.fromX+(p.toX-p.fromX)*fraction,y=p.fromY+(p.toY-p.fromY)*fraction;
        const nearby=new Set<string>();
        this.structures.query(x,y,missileDefenseRange(10),this.nearbyStructures);
        for (const body of this.nearbyStructures) if (this.structureById.get(body.id)?.type==="missile-defence") nearby.add(`${body.playerId}:${body.tile}`);
        for (const key of nearby) {
          const stack=stacks.get(key);
          if (!stack) continue;
          const building = stack.filter(b=>!fired.has(b.id) && tick >= (b.nextAttackTick ?? 0)).sort((a,b)=>a.id-b.id)[0];
          if (!building || !this.diplomacy.hostile(building.playerId,p.playerId)) continue;
          const from = this.position(building), point = interceptionPoint(p,tick,from.x,from.y,missileDefenseRange(stack.length));
          if (point && (!chosen || point.impactTick < chosen.point.impactTick || (point.impactTick === chosen.point.impactTick && building.id < chosen.building.id))) chosen={building,point};
        }
        if (chosen) {
          const from=this.position(chosen.building);
          p.interception={defenseId:chosen.building.id,playerId:chosen.building.playerId,tick,fromX:from.x,fromY:from.y,...chosen.point};
          this.world.updateBuilding(chosen.building.id,{nextAttackTick:tick+MISSILE_DEFENSE_RELOAD_TICKS});
          fired.add(chosen.building.id);
        }
      }
    }
    for (const p of [...this.projectiles].sort((a, b) => a.id - b.id)) {
      if (p.impacted) continue;
      const hitDamage = (attack: AttackProfile, defence: Defence) =>
        damageAmount({ ...attack, perSoldier: p.perSoldier }, defence, 1000, 0, 1000, p.attackScale);
      const progress = Math.min(1, (tick - p.tick) / (p.impactTick - p.tick)),
        old = { x: p.x, y: p.y };
      p.x = Math.round(p.fromX + (p.toX - p.fromX) * progress);
      p.y = Math.round(p.fromY + (p.toY - p.fromY) * progress);
      if (p.interception && tick >= p.interception.impactTick) {
          p.impacted = true;
          p.impactAt = tick;
          p.x = p.interception.toX;
          p.y = p.interception.toY;
          p.damage = 0;
          continue;
      }
      if(p.targetAircraftId !== undefined) {
        const target=aircraft.find(a=>a.id===p.targetAircraftId && a.health>0 && a.definitionId!=="drone" && a.state!=="ready");
        if(target) {p.toX=target.x;p.toY=target.y;}
        if(tick>=p.impactTick) {
          p.impacted=true;p.impactAt=tick;
          if(target) {
            const health=target.health;target.health=Math.max(0,health-p.damage);
            if(target.health===0) {const loss=new DamageLedger();loss.add(target.id,p.playerId,health);this.world.recordMilitaryLosses([target],loss);}
          }
        }
        continue;
      }
      if (p.kind === "mirv" && progress >= 0.5) {
        this.reservedWarheads = Math.max(0,this.reservedWarheads-p.warheads);
        p.impacted = true;
        p.impactAt = tick;
        const targets = p.targetBuildingId === undefined ? this.world.buildings
          .filter(b => (b.health ?? 1) > 0 && this.diplomacy.hostile(p.playerId,b.playerId))
          .sort((a,b) => this.distance(this.position(a), {x:p.toX,y:p.toY}) -
            this.distance(this.position(b), {x:p.toX,y:p.toY}) || a.id-b.id).slice(0,8) : [];
        for (let i = 0; i < p.warheads; i++) {
          this.fire(
            {
              id: p.sourceId,
              playerId: p.playerId,
              x: p.x,
              y: p.y,
              domain: p.sourceKind,
            },
            {
              ...(targets.length ? this.position(targets[i % targets.length]) : {x:p.toX,y:p.toY}),
            },
            {
              channel: p.channel,
              damage: Math.floor(p.damage / p.warheads),
              range: 0,
              reloadTicks: 1,
              movingReloadPercent: 100,
              bonuses: Object.fromEntries(
                Object.entries(p.bonuses).map(([k, n]) => [
                  k,
                  Math.floor(n / p.warheads),
                ]),
              ),
              penetration: p.penetration,
              targets: p.targets ?? GROUND,
              projectile: {
                diameter: p.diameter,
                speed: FIXED,
                blastRadius: p.blastRadius,
              },
            },
            Math.floor(p.damage / p.warheads),
            "warhead",
            Math.max(1, p.impactTick - tick),
            0,
            "mirv-warhead",
          );
        }
        continue;
      }
      let arrived = progress === 1;
      let directHit: Squad | Ship | undefined;
      let directStructure:
        | Building
        | (typeof this.forts.barriers)[number]
        | undefined;
      if (p.kind === "shell") {
        const midpoint = { x: (old.x + p.x) / 2, y: (old.y + p.y) / 2 },
          length = Math.sqrt(this.distance(old, p));
        this.spatial.queryOverlaps(
          midpoint.x,
          midpoint.y,
          length / 2 + FIXED + p.diameter / 2,
          this.nearby,
        );
        this.naval.query(
          midpoint.x,
          midpoint.y,
          length / 2 + FIXED + p.diameter / 2,
          this.nearbyShips,
        );
        this.structures.query(
          midpoint.x,
          midpoint.y,
          length / 2 + FIXED + p.diameter / 2,
          this.nearbyStructures,
        );
        const dx = p.x - old.x,
          dy = p.y - old.y;
        const hit = [...this.nearby, ...this.nearbyShips]
          .filter(
            (s) =>
              this.diplomacy.hostile(s.playerId, p.playerId) &&
              (p.targets ?? GROUND).some((tag) =>
                ("troops" in s ? this.targetTags(s) : SHIP_DEFENCE.tags).includes(
                  tag,
                ),
              ),
          )
          .map((s) => {
            const t = "troops" in s && s.formation && !s.afloat ? formationSweepEntry(s,old,p,this.world.tick,p.diameter/2) : circleSweepEntry(
              old,
              p,
              s,
              p.diameter / 2 + FIXED * 0.45,
            );
            if (t === null) return null;
            const x = old.x + t * dx,
              y = old.y + t * dy;
            return { s, t, x, y };
          })
          .filter((h): h is NonNullable<typeof h> => h !== null)
          .sort((a, b) => a.t - b.t || a.s.id - b.s.id)[0];
        const wall = this.forts
          .blockingTilesOnSweep(
            old,
            p,
            p.playerId,
            p.diameter / 2,
            p.originTile,
          )
          .map((tile) => ({
            tile,
            t: segmentBoxEntry(old, p, tile, this.mapWidth, p.diameter / 2),
          }))
          .filter((w): w is { tile: number; t: number } => w.t !== null)
          .sort((a, b) => a.t - b.t || a.tile - b.tile)[0];
        const structure = (p.targets ?? GROUND).includes("structure")
          ? this.nearbyStructures
              .filter(
                (b) =>
                  (this.structureById.get(b.id)?.health ?? 1) > 0 &&
                  this.diplomacy.hostile(b.playerId, p.playerId),
              )
              .map((body) => ({
                b: this.structureById.get(body.id)!,
                t: segmentBoxEntry(
                  old,
                  p,
                  body.tile,
                  this.mapWidth,
                  p.diameter / 2,
                ),
              }))
              .filter((h): h is { b: Building; t: number } => h.t !== null)
              .sort((a, b) => a.t - b.t || a.b.id - b.b.id)[0]
          : undefined;
        if (
          wall &&
          (!hit || wall.t <= hit.t) &&
          (!structure || wall.t <= structure.t)
        ) {
          // Keep the blast on the incident side, so the struck wall protects
          // targets behind it. Its own integrity is still hit by the radius.
          const t = Math.max(0, wall.t - 1 / Math.max(1, length));
          p.x = Math.round(old.x + dx * t);
          p.y = Math.round(old.y + dy * t);
          arrived = true;
          directStructure =
            this.world.buildings.find(
              (b) =>
                b.tile === wall.tile &&
                b.health! > 0 &&
                this.diplomacy.hostile(b.playerId, p.playerId),
            ) ??
            this.forts.barriersAt(wall.tile).find(
              (b) =>
                b.kind !== "trench" && b.health > 0 &&
                this.diplomacy.hostile(b.playerId, p.playerId),
            );
        } else if (structure && (!hit || structure.t <= hit.t)) {
          p.x = Math.round(old.x + dx * structure.t);
          p.y = Math.round(old.y + dy * structure.t);
          arrived = true;
          directStructure = structure.b;
        } else if (hit) {
          p.x = Math.round(hit.x);
          p.y = Math.round(hit.y);
          arrived = true;
          directHit = hit.s;
        }
      }
      if (!arrived) continue;
      p.impacted = true;
      p.impactAt = tick;
      if (!p.blastRadius && !directHit && !directStructure && this.world.volleys.length < 4096) {
        this.world.volleys.push({id:this.world.allocateId(),squadId:p.sourceId,playerId:p.playerId,definitionId:p.definitionId,tick,fromX:p.fromX,fromY:p.fromY,toX:p.x,toY:p.y,impact:true});
      }
      if (!p.blastRadius) {
        // Contact weapons have one target. A miss is not a small explosion.
        if (
          directHit &&
          this.diplomacy.hostile(directHit.playerId, p.playerId)
        ) {
          const hit = hitDamage(
            {
              channel: p.channel,
              damage: p.damage,
              range: 0,
              reloadTicks: 1,
              movingReloadPercent: 100,
              bonuses: p.bonuses,
              penetration: p.penetration,
              targets: p.targets ?? GROUND,
            },
            "troops" in directHit
              ? this.targetDefence(directHit)
              : {
                  tags: ["ship"],
                  meleeArmour: 1000,
                  rangedArmour: 2000,
                  bonusResistance: {},
                },
          );
          ("troops" in directHit ? impacts : naval).add(
            directHit.id,
            p.playerId,
            hit,
          );
          if ("troops" in directHit && this.world.volleys.length < 4096) this.world.volleys.push({id:this.world.allocateId(),squadId:p.sourceId,playerId:p.playerId,definitionId:p.definitionId,tick,fromX:p.fromX,fromY:p.fromY,toX:p.x,toY:p.y,targetId:directHit.id,damage:hit,impact:true});
          this.contribution(
            contributions,
            directHit.id,
            p.sourceId,
            hit,
            p.sourceKind,
          );
        } else if (directStructure) {
          let hit = hitDamage(
            {
              channel: p.channel,
              damage: p.damage,
              range: 0,
              reloadTicks: 1,
              movingReloadPercent: 100,
              bonuses: p.bonuses,
              penetration: p.penetration,
              targets: p.targets ?? GROUND,
            },
            {
              ...STRUCTURE_DEFENCE,
              tags:
                "tile" in directStructure
                  ? ["structure"]
                  : ["structure", "wall"],
            },
          );
          if (
            !("tile" in directStructure) &&
            this.diplomacy.state.betrayal[directStructure.playerId]
          )
            hit *= 2;
          this.structuralHit(
            directStructure,
            p.playerId,
            p.sourceId,
            hit,
            p.sourceKind,
          );
        }
        continue;
      }
      const radius = Math.max(p.blastRadius, FIXED * 0.6),
        profile: AttackProfile = {
          channel: p.channel,
          damage: p.damage,
          range: radius,
          reloadTicks: 1,
          movingReloadPercent: 100,
          bonuses: p.bonuses,
          penetration: p.penetration,
          targets: p.targets ?? GROUND,
        };
      const scaled = (position: Position) => {
        const fraction =
          1 - (0.5 * Math.sqrt(this.distance(position, p))) / radius;
        return {
          ...profile,
          damage: Math.floor(p.damage * fraction),
          bonuses: Object.fromEntries(
            Object.entries(p.bonuses).map(([tag, n]) => [
              tag,
              Math.floor(n * fraction),
            ]),
          ),
        };
      };
      this.spatial.queryOverlaps(p.x, p.y, radius, this.nearby);
      this.naval.query(p.x, p.y, radius, this.nearbyShips);
      this.structures.query(p.x, p.y, radius, this.nearbyStructures);
      const indiscriminate = p.kind === "bomb" || p.kind === "icbm" || p.kind === "warhead";
      const blastVictim = (owner:number) => indiscriminate || this.diplomacy.hostile(owner,p.playerId);
      if (indiscriminate)
        this.world.destroyTradersInBlast?.(p.playerId,p.x,p.y,radius);
      if (p.kind === "icbm" || p.kind === "warhead" || p.definitionId === "atomic") {
        // Nuclear effects are per victim, independent of conventional armour,
        // shared damage budgets, or the ordinary 64-target splash envelope.
        const inside = (s: {playerId:number;x:number;y:number}) => this.distance(s,p)<=radius**2;
        for (const target of this.nearby.filter(inside).sort((a,b)=>a.id-b.id)) {
          const lethal = target.afloat?.hull ?? (target.manpower ? Math.ceil(remainingHealth(target) / HEALTH_SCALE) : target.troops);
          impacts.add(target.id,p.playerId,lethal);
          this.contribution(contributions,target.id,p.sourceId,lethal,p.sourceKind);
        }
        for (const target of this.nearbyShips.filter(inside).sort((a,b)=>a.id-b.id)) {
          naval.add(target.id,p.playerId,target.health);
          this.contribution(contributions,target.id,p.sourceId,target.health,p.sourceKind);
        }
        const structuralDamage = (health:number,distance:number) => Math.ceil(health*(distance<=radius*0.8 ? 1 : 1-(distance/radius-0.8)*0.5));
        for (const body of this.nearbyStructures.filter(inside).sort((a,b)=>a.id-b.id)) {
          const building=this.structureById.get(body.id)!;
          this.structuralHit(building,p.playerId,p.sourceId,structuralDamage(building.maxHealth??building.health??1200,Math.sqrt(this.distance(body,p))),p.sourceKind);
        }
        for (const wall of this.forts.nearbyBarriers(p.x,p.y,radius)) {
          const distance=Math.min(...wall.tiles.map(tile=>Math.hypot(((tile%this.mapWidth)+0.5)*FIXED-p.x,(Math.floor(tile/this.mapWidth)+0.5)*FIXED-p.y)));
          if (distance<=radius) this.structuralHit(wall,p.playerId,p.sourceId,structuralDamage(wall.maxHealth,distance),p.sourceKind);
        }
        this.world.nuclearBlast?.(p.x,p.y,radius);
        continue;
      }
      let budget =
        p.kind === "bomb" ? Infinity :
        (p.damage + Object.values(p.bonuses).reduce((sum, n) => sum + n, 0)) * 4;
      const targetLimit = p.kind === "bomb" ? Infinity : 64;
      const eligible = (s: { playerId: number; x: number; y: number }) =>
        blastVictim(s.playerId) &&
        ("formation" in s && (s as Squad).formation && !(s as Squad).afloat ? formationPointContact(s as Squad,p,tick).gap : Math.sqrt(this.distance(s,p))) <= radius &&
        (p.kind !== "shell" || this.forts.clear(p, s, p.playerId));
      for (const target of this.nearby
        .filter(eligible)
        .sort((a, b) => a.id - b.id)
        .slice(0, targetLimit)) {
        const hit = Math.min(
          budget,
          hitDamage(
            scaled(target),
            this.targetDefence(target),
          ),
        );
        if (hit <= 0) continue;
        impacts.add(target.id, p.playerId, hit);
        this.contribution(
          contributions,
          target.id,
          p.sourceId,
          hit,
          p.sourceKind,
        );
        budget -= hit;
      }
      for (const target of this.nearbyShips
        .filter(eligible)
        .sort((a, b) => a.id - b.id)
        .slice(0, targetLimit)) {
        const hit = Math.min(
          budget,
          hitDamage(scaled(target), {
            tags: ["ship"],
            meleeArmour: 1000,
            rangedArmour: 2000,
            bonusResistance: {},
          }),
        );
        if (hit <= 0) continue;
        naval.add(target.id, p.playerId, hit);
        this.contribution(
          contributions,
          target.id,
          p.sourceId,
          hit,
          p.sourceKind,
        );
        budget -= hit;
      }
      for (const body of this.nearbyStructures
        .filter(
          (b) =>
            blastVictim(b.playerId) &&
            this.distance(this.position(b), p) <= radius ** 2 &&
            (p.kind !== "shell" ||
              this.forts
                .segmentTiles(p, this.position(b))
                .every(
                  (t) => t === b.tile || !this.forts.blocked(t, p.playerId),
                )),
        )
        .sort((a, b) => a.id - b.id)) {
        const b = this.structureById.get(body.id)!;
        const hit = Math.min(
          budget,
          hitDamage(scaled(this.position(b)), STRUCTURE_DEFENCE),
        );
        this.structuralHit(b, p.playerId, p.sourceId, hit, p.sourceKind);
        budget -= hit;
      }
      for (const wall of this.forts.nearbyBarriers(p.x, p.y, radius))
        if (
          blastVictim(wall.playerId) &&
          wall.tiles.some(
            (t) =>
              this.distance(
                {
                  x: ((t % this.mapWidth) + 0.5) * FIXED,
                  y: (Math.floor(t / this.mapWidth) + 0.5) * FIXED,
                },
                p,
              ) <=
              radius ** 2,
          )
        ) {
          const hit = Math.min(
            budget,
            hitDamage(profile, {
              ...STRUCTURE_DEFENCE,
              tags: ["structure", "wall"],
            }) * (this.diplomacy.state.betrayal[wall.playerId] ? 2 : 1),
          );
          this.structuralHit(wall, p.playerId, p.sourceId, hit, p.sourceKind);
          budget -= hit;
        }
    }
    this.awardDamage(impacts, contributions);
    this.awardDamage(naval, contributions);
    this.world.resolveLandDamage(impacts);
    this.world.resolveNavalDamage(naval);
    for (let i = this.projectiles.length - 1; i >= 0; i--)
      if (
        this.projectiles[i].impacted &&
        tick - (this.projectiles[i].impactAt ?? tick) > 10
      )
        this.projectiles.splice(i, 1);
  }
}
