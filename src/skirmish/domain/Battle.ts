import { TICKS_PER_SECOND } from '../Protocol';
import { secondsToTicks } from '../Protocol';
import type { GameMap } from "../../core/game/GameMap";
import { effectiveRange, maxEffectiveRange, elevationRangeAt, rangedElevation, highGroundDamageModifier } from "./ElevationAdvantage";
import { radians,formationDoctrine,formationSlots } from "./FormationGeometry";
import { CONTACT } from "../content/TacticalRules";
import { formationContact, formationPointContact, formationSweepEntry, formationFootprint, convexHull, contactParticipants, CONTACT_TOLERANCE } from "./FormationContact";
import { contactPath } from './ContactFront';
import { polygonSweepEntry } from './ProjectileCollision';
import { formationEnvelope, type FormationState } from "./FormationGeometry";
import { legacyWeaponStrength, remainingHealth, HEALTH_SCALE } from './Manpower';
import { directHitBodies, soldierHitCap } from './SoldierHitCap';
import { commitWeaponShot } from "./WeaponTiming";
import { cancelRangedPreparation, prepareRangedShot, releaseRangedShot, type RangedTarget } from "./RangedPreparation";
import { weaponAccuracy } from "./WeaponAccuracy";
import { MeleeDamageBatch, meleeReceivers } from './MeleeDamage';
import { afterWeaponShot } from "../content/WeaponCycles";
import { predictiveAim } from "../RangedAim";
import { navalAim, type NavalTarget } from "./NavalCombat";
import { restoreArray } from "../StateTransfer";
import { DamageLedger } from "../Conquest";
import { CombatGeometry } from './CombatGeometry';
import { CombatActivity } from './CombatActivity';
import { CHARGE_IMPACT, chargeDisrupted, resolveChargeImpact,commitChargeShot, type ChargeImpact } from './ChargeImpact';
import { tacticalDefence, tacticalFacts, formationModifiers } from './FormationTactics';
import { facingArc } from './FormationFacing';
import { TACTICAL_CHARGE } from '../content/TacticalRules';
import { CAVALRY_ENTRY } from './CavalryEngagement';
import { cavalryAssaultContact, meleeCavalry, ordinaryCavalryAssault, assaultBonus, assaultWeapon, assaultContactGeometry, assaultGeometryChanged, commitCavalryBonus } from './CavalryAssault';
import { waveTick,waveDamage,cavalryRanks,cavalryStrikeReach,cavalryAttackGap,cavalryUsesRankWaves,exposedCavalryContact,cavalryRankCycleTicks,type CavalryCycle } from './CavalryMelee';
import { isCavalryTroopClass } from './Definitions';
import { GUN_NEST_ATTACK } from "../content/Defences";
import { UNIT, defaultUnit } from "../content/Units";
import type { ArcherVolley, Building, Player, Ship, Squad } from "../Protocol";
import { FIXED } from "../Protocol";
import { chargeStrength } from './ChargeStrength';
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
import type { UnitQueries } from '../UnitIndex';
// Geometry-only reservation profile. This never becomes a unit weapon and never
// commits an attack: ranged-only soldiers in contact cannot contribute fire.
const RANGED_CONTACT: AttackProfile = {
  channel: "melee", perSoldier: true, ranks: 1, damage: 0,
  range: FIXED / 2, reloadTicks: 1, movingReloadPercent: 100,
  bonuses: {}, penetration: 0, targets: ["infantry", "ranged", "mounted", "vehicle", "siege"],
};
export interface BattleWorld {
  /** Optional match-local definition source for disposable balance arenas. */
  unitDefinition?(squad: Squad): UnitDefinition | undefined;
  /** Offline comparison arena only; ordinary matches use the authored timing. */
  cavalryRankLaunchSpacing?(squad: Squad): number;
  readonly combatGeometry?: CombatGeometry;
  map?: GameMap;
  combatOrderRevision?(id:number):number;
  chargePresentationClear?(s:Squad,dx:number,dy:number,lateral?:number):boolean;
  squadFacts?():UnitQueries<Squad>;
  spatialFacts?(phase: SpatialPhase): PhaseSpatialFacts;
  tick: number;
  squads: readonly Squad[];
  squad(id: number): Squad | undefined;
  ship(id: number): Ship | undefined;
  navalVelocity?(target: NavalTarget): { x: number; y: number };
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
    for(const p of state.projectiles)if(!Number.isInteger(p.elevationDamageBp??10000)||(p.elevationDamageBp??10000)<10000||(p.elevationDamageBp??10000)>11000)throw Error("Invalid committed elevation bonus");
    for(const p of state.projectiles)if(p.navalTargetId!==undefined&&(!Number.isSafeInteger(p.navalTargetId)||p.navalTargetId<0))throw Error("Invalid naval projectile target");
    restoreArray(this.projectiles,state.projectiles);
    this.reservedWarheads = this.projectiles.reduce((n,p) => n + (!p.impacted && p.kind === "mirv" ? p.warheads : 0),0);
    this.definitions.clear();
    this.hybridAcquisition.clear();
    this.acquisition.clear();this.activity=undefined;
    this.launchPermissions.clear();
    this.structureBodies.clear(); this.structureRevision = -1;
  }

  readonly projectiles: Projectile[] = [];
  private readonly launchPermissions = new Map<number, { signature: string; launchUnitOwners: number[]; launchStructureOwners: number[] }>();
  private permissionsAtLaunch(owner: number): { launchUnitOwners: number[]; launchStructureOwners: number[] } {
    const signature = this.diplomacy.permissionSignature(owner);
    let permissions = this.launchPermissions.get(owner);
    if (!permissions || permissions.signature !== signature) {
      permissions = { signature,
        launchUnitOwners: this.world.players.filter(p => this.diplomacy.hostile(owner, p.id)).map(p => p.id),
        launchStructureOwners: this.world.players.filter(p => this.diplomacy.canAttackStructure(owner, p.id)).map(p => p.id) };
      this.launchPermissions.set(owner, permissions);
    }
    // Never mutate these lists: in-flight shots retain the old permission set.
    return { launchUnitOwners: permissions.launchUnitOwners, launchStructureOwners: permissions.launchStructureOwners };
  }
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

  private readonly geometry: CombatGeometry;
  private activity?:CombatActivity;
  private groundRevision?:number;
  private acquisition = new Map<number,{revision:number;pose?:number;barriers:number;forts:number;diplomacy:number|string;
    order:Squad['order'];profile:AttackProfile;previous?:number;target?:number;
    engagement?:{profile:AttackProfile;participants:number;canFight:boolean}}>();
  readonly acquisitionWork={searches:0,reused:0,noOpponentSkips:0};
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
    this.geometry = world.combatGeometry ?? new CombatGeometry();
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
    if (this.mapWidth !== width) { this.mapWidth = width; this.structureRevision = -1; this.activity=undefined;this.acquisition.clear();this.hybridAcquisition.clear(); }
  }
  definition(s: Squad): UnitDefinition {
    const local=this.world.unitDefinition?.(s);
    if(local)return unitEffects(local,this.progression.states[s.playerId]?.completed??[]);
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
    return this.geometry.contact(a,b,this.world.tick);
  }
  private readonly engagedTargets=new Map<number,number>();
  private legalContact(a:Squad,b:Squad,range:number,melee=false):boolean {
    if(melee && this.forts.hasObstacles && this.forts.segmentTiles(a,b).some(tile=>this.forts.intactWallAt(tile)))return false;
    if(a.formation && b.formation && !a.afloat && !b.afloat){
      if(!this.geometry.withinReach(a,b,this.world.tick,range+CONTACT.release))return false;
      const contact=this.contact(a,b);
      if(melee && a.kind!=='cavalry' && b.kind==='cavalry' && !b.cavalryEngagement && contact.gap>CONTACT.release &&
        !exposedCavalryContact(b,a.id,this.world.tick))return false;
      return contact.gap<=range+(this.engagedTargets.get(a.id)===b.id?CONTACT.release:CONTACT_TOLERANCE) && this.forts.clear(a,b,a.playerId) && this.forts.clear(contact.source,contact.target,a.playerId);
    }
    return this.distance(a,b)<=range**2 && this.forts.clear(a,b,a.playerId);
  }
  private participants(a:Squad,profile:AttackProfile,b?:Squad):number {
    return profile.perSoldier && profile.channel==="melee" && a.formation && b?.formation && !a.afloat && !b.afloat
      ? contactParticipants(a,b,this.world.tick,profile.ranks??2,this.contact(a,b),!a.charge && this.contact(a,b).gap<=CONTACT.release) : attackContributors(a,profile,b);
  }
  /** Soldier slots of `s` whose world position lies inside the blast (C3, OD3). */
  private bodiesInBlast(s: Squad, point: Position, radius: number, tick: number): number {
    if (!s.formation || s.afloat) return s.troops;
    const angle = this.geometry.envelope(s, tick).angle, cos = Math.cos(angle), sin = Math.sin(angle);
    let bodies = 0;
    for (const slot of formationSlots(s, tick)) {
      const x = s.x + slot.x * cos - slot.y * sin, y = s.y + slot.x * sin + slot.y * cos;
      if ((x - point.x) ** 2 + (y - point.y) ** 2 <= radius ** 2) bodies++;
    }
    return bodies;
  }
  private distance(a: Position, b: Position): number {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  }
  private rebuild(phase: SpatialPhase): void {
    this.telemetry.indexRebuilds++;
    const spatialFacts = this.world.spatialFacts?.(phase);
    this.groundRevision=spatialFacts?.groundRevision;
    if (spatialFacts) { this.spatial = spatialFacts.ground; this.naval = spatialFacts.ships; }
    else {
      this.localSpatial ??= new SpatialGrid(this.mapWidth * FIXED, this.mapHeight * FIXED, 4 * FIXED, (s: Squad) => s.playerId,(s)=>s.formation ? this.geometry.envelope(s,this.world.tick).broadRadius : 0);
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
  }
  occupationCover:(s:Squad,source?:Position)=>number=()=>0;
  cover(s:Squad,source?:Position):number {return this.occupationCover(s,source);}
  /** A squad afloat is a hull: only weapons that engage ships can hit it,
   * and they meet ship armour rather than the soldiers' own. */
  private targetTags(s: Squad): readonly string[] {
    return s.afloat ? SHIP_DEFENCE.tags : this.definition(s).tags;
  }
  private targetDefence(s: Squad, source?:Position) {
    return s.afloat ? SHIP_DEFENCE : defenceOf(this.definition(s), this.cover(s,source));
  }
  private projectileDefence(s:Squad,x:number,y:number,tick:number):Defence {
    const defence=this.targetDefence(s,{x,y});
    if(!s.formation||s.afloat)return defence;
    const shape=formationEnvelope(s,tick).shape;
    return {...defence,tacticalBp:formationModifiers(shape,!s.formation.transition&&shape!=='column','ranged',facingArc(s,{x,y},tick),false).bp};
  }
  private explainProjectile(p:Projectile,target:Squad,damage:number,tick:number):void {
    if(p.sourceKind!=='squad'||!this.world.squad(p.sourceId)||!target.formation||target.afloat)return;
    const shape=formationEnvelope(target,tick).shape,
      facts=formationModifiers(shape,!target.formation.transition&&shape!=='column','ranged',facingArc(target,{x:p.fromX,y:p.fromY},tick),false);
    if((p.elevationDamageBp??10000)>10000)facts.modifiers.push(highGroundDamageModifier(p.elevationDamageBp!));
    if(this.cover(target,{x:p.fromX,y:p.fromY})>0)facts.modifiers.push(`cover -${this.cover(target,{x:p.fromX,y:p.fromY})/100}%`);
    this.world.updateSquad(p.sourceId,{combatFact:{tick,sourceId:p.sourceId,targetId:target.id,channel:'ranged',damage,
      charge:false,arc:facts.arc,modifiers:facts.modifiers}});
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
    navalTargetId?: number,
    droneImpact?: Projectile['droneImpact'],
  ): boolean {
    if (!this.canFire(kind === "mirv" ? warheads : 0)) return false;
    const elevationDamageBp=rangedElevation(this.world,source,profile,target).damageBp;
    damage=Math.floor(Math.round(damage*1000)*elevationDamageBp/10000)/1000;
    const a=source.domain===undefined || source.domain==="squad"?this.world.squad(source.id):undefined,b=this.world.squad((target as {id?:number}).id??-1);
    if(a?.formation && b?.formation && !a.afloat && !b.afloat){const contact=this.contact(a,b);source={...source,x:Math.round(contact.source.x),y:Math.round(contact.source.y)};target={...target,x:Math.round(contact.target.x),y:Math.round(contact.target.y)};}
    if (navalTargetId !== undefined) {
      const hull = this.world.ship(navalTargetId) ?? this.world.squad(navalTargetId);
      if (hull) target = navalAim(source, target, this.world.navalVelocity?.(hull) ?? { x: 0, y: 0 }, profile.projectile?.speed ?? FIXED);
    }
    const unit = definitionId && UNIT.get(definitionId);
    if (unit && unit.attack.channel === "ranged" && ["StoneAge","BronzeAge","ClassicalAge","EarlyMedieval","LateMedieval"].includes(unit.age) && unit.troopClass) {
      const motion = (target as Squad).locomotion;
      const velocity = motion ? {x:-Math.sin(motion.heading)*motion.speed*TICKS_PER_SECOND/FIXED*64,y:Math.cos(motion.heading)*motion.speed*TICKS_PER_SECOND/FIXED*64} : {x:0,y:0};
      const aimed = predictiveAim({x:source.x/FIXED*64,y:source.y/FIXED*64},{x:target.x/FIXED*64,y:target.y/FIXED*64},velocity,(profile.projectile?.speed ?? FIXED)*TICKS_PER_SECOND/FIXED*64,source.id*65537+this.world.tick,4);
      target = {x:Math.round(aimed.point.x/64*FIXED),y:Math.round(aimed.point.y/64*FIXED)};
    }
    if (kind === "mirv") this.reservedWarheads += warheads;
    this.projectiles.push({
      ...(this.diplomacy.raids?this.permissionsAtLaunch(source.playerId):{}),
      id: this.world.allocateId(),
      playerId: source.playerId,
      sourceId: source.id,
      sourceKind: source.domain ?? "squad",
      attackScale: profile.perSoldier
        ? (source.attackScale ?? source.troops ?? 0) * weaponAccuracy(profile, Math.sqrt(this.distance(source, target)))
        : source.attackScale,
      perSoldier: profile.perSoldier,
      elevationDamageBp,
      definitionId,
      ...(droneImpact ? {droneImpact} : {}),
      ...(targetAircraftId === undefined ? {} : {targetAircraftId}),
      ...(navalTargetId === undefined ? {} : {navalTargetId}),
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
    charge = false,
  ): void {
    const a=this.world.squad(source.id),b=target.id===undefined?undefined:this.world.squad(target.id);
    const contact=a?.formation && b?.formation && !a.afloat && !b.afloat ? formationContact(a,b,this.world.tick) : undefined;
    const exposed=melee&&a&&b&&contact&&contact.gap>CONTACT.release?exposedCavalryContact(b,a.id,this.world.tick):undefined;
    const tactics=a&&b?tacticalFacts(a,b,this.world.tick,melee?'melee':'ranged',charge):undefined;
    if(tactics&&a&&b&&!melee){const bonus=rangedElevation(this.world,a,this.definition(a).attack,b);if(bonus.damageBp>10000)tactics.modifiers.push(highGroundDamageModifier(bonus.damageBp));}
    if(tactics&&b&&this.cover(b,source)>0)tactics.modifiers.push(`cover -${this.cover(b,source)/100}%`);
    const combatFact=a&&b&&tactics?{tick:this.world.tick,sourceId:a.id,targetId:b.id,channel:melee?'melee' as const:'ranged' as const,
      arc:tactics.arc,damage,charge,modifiers:tactics.modifiers}:undefined;
    const anchors={fromX:contact?Math.round(contact.source.x):source.x,fromY:contact?Math.round(contact.source.y):source.y,
      toX:exposed&&contact?Math.round(contact.source.x-contact.normal.x*(exposed.strikeDepth??0)):contact?Math.round(contact.target.x):target.x,
      toY:exposed&&contact?Math.round(contact.source.y-contact.normal.y*(exposed.strikeDepth??0)):contact?Math.round(contact.target.y):target.y};
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
      const facts=tactics;
      const fact={...anchors,targetId:target.id,damage,charge:charge||undefined,arc:facts?.arc,modifiers:facts?.modifiers,bearing:exposed&&(exposed.strikeDepth??0)>0
        ?Math.atan2(anchors.toY-anchors.fromY,anchors.toX-anchors.fromX)
        :Math.atan2(contact?.normal.y??target.y-a.y,contact?.normal.x??target.x-a.x)};
      if(!contacts.some(c=>edge(c)===edge(fact)))contacts.push(fact);
      this.world.updateSquad(a.id,{meleeStrike:{tick:this.world.tick,contacts},combatFact});
    }
    else if(a&&combatFact)this.world.updateSquad(a.id,{combatFact});
    if (this.world.volleys.length >= 4096) return;
    this.world.volleys.push({
      id: this.world.allocateId(),
      tick: this.world.tick,
      squadId: source.id,
      definitionId: source.definitionId,
      playerId: source.playerId,
      ...anchors,
      targetId: target.id, damage, melee,
      ...(melee&&a&&b?{combatRoots:{sourceX:a.x,sourceY:a.y,targetX:b.x,targetY:b.y}}:{}),
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
    // One scan per ledger pass. Rebuild on every invocation: projectile and
    // melee passes can append events and rescale their applied damage separately.
    const events = new Map<number, Map<number, ArcherVolley[]>>();
    if (contributions.size) for (const event of this.world.volleys) {
      if (event.tick !== this.world.tick || event.targetId === undefined ||
        !(event.melee || event.impact) || !contributions.has(event.targetId)) continue;
      let sources = events.get(event.targetId);
      if (!sources) events.set(event.targetId, sources = new Map());
      let facts = sources.get(event.squadId);
      if (!facts) sources.set(event.squadId, facts = []);
      facts.push(event);
    }
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
        const facts=events.get(id)?.get(Number(sourceId)) ?? [];
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
  private commitShot(squad: Squad, profile: AttackProfile, target?: RangedTarget): boolean {
    if (profile.projectile && !this.canFire()) return false;
    const tick = this.world.tick;
    if (profile.channel === "ranged" && profile.preparation) {
      if (!target) throw new Error("Ranged preparation requires a target");
      const current = this.world.squad(squad.id)!;
      const definition = this.definition(current);
      const independent = !!(definition.meleeAttack?.perSoldier && definition.rangedAttack?.perSoldier);
      const ready = profile.perSoldier
        ? Math.max(current.weaponState?.ranged?.nextTick ?? 0, independent ? 0 : current.weaponState?.sharedReadyTick ?? 0)
        : current.nextAttackTick ?? 0;
      const preparation = prepareRangedShot(current.weaponState, profile, definition.id, target, tick, ready);
      if (preparation.state !== current.weaponState) this.world.updateSquad(squad.id, {weaponState: preparation.state});
      if (!preparation.ready) return false;
    }
    if (profile.perSoldier) {
      const definition=this.definition(squad);
      const independent=!!(definition.meleeAttack?.perSoldier && definition.rangedAttack?.perSoldier);
      const state = commitWeaponShot(profile, this.world.squad(squad.id)?.weaponState, tick, squad.moved, independent);
      if (!state) return false;
      const ranged = state.ranged;
      this.world.updateSquad(squad.id, { weaponState: state, lastAttackTick: tick,
        nextAttackTick: state[profile.channel]!.nextTick,
        magazineShots: ranged?.shots ?? 0, reloadStartedTick: ranged?.reloadStartedTick });
    } else {
      if (tick < (squad.nextAttackTick ?? 0)) return false;
      this.world.updateSquad(squad.id, { lastAttackTick: tick, ...afterWeaponShot(this.definition(squad), squad.magazineShots ?? 0, tick, attackInterval(profile, squad.moved)) });
    }
    if (profile.channel === "ranged" && profile.preparation) {
      const current = this.world.squad(squad.id)!;
      this.world.updateSquad(squad.id, {weaponState: releaseRangedShot(current.weaponState!, profile, tick)});
    }
    return true;
  }
  /** Contact edge pools reserve soldiers even between strikes. Ranged contributors
   * are the remainder, never a second full-squad damage budget. */
  private hybridContacts(squad:Squad, definition:UnitDefinition, damage:DamageLedger, contributions:Contributions, revision?:number) {
    const profile=definition.meleeAttack ?? RANGED_CONTACT;
    const radius=profile.range+CONTACT.release+(squad.formation?this.geometry.envelope(squad,this.world.tick).broadRadius:0);
    const epoch=revision===undefined?undefined:this.activity?.region(squad,radius,squad.playerId)??revision;
    const pose=this.activity?.pose(squad.id)??this.world.squadFacts?.().poseRevision(squad.id);
    const cached=this.hybridAcquisition.get(squad.id);
    let hits=cached?.hits,remaining=cached?.remaining??squad.troops;
    if(epoch===undefined || !cached || cached.epoch!==epoch || cached.pose!==pose || !!squad.formation?.transition || cached.profile!==profile || cached.barriers!==this.forts.barrierChanges.revision || cached.forts!==this.forts.version || cached.diplomacy!==(this.diplomacy.raids?this.diplomacy.permissionSignature(squad.playerId):this.diplomacy.revision)){
    this.spatial.queryOverlaps(squad.x,squad.y,profile.range+CONTACT.release+
      (squad.formation?this.geometry.envelope(squad,this.world.tick).broadRadius:0),this.hybridNearby,squad.playerId);
    const contacts=this.hybridNearby.filter(other=>!other.afloat && this.diplomacy.hostile(squad.playerId,other.playerId) &&
      profile.targets.some(tag=>this.targetTags(other).includes(tag)) && this.legalContact(squad,other,profile.range,true))
      .sort((a,b)=>this.contact(squad,a).gap-this.contact(squad,b).gap || a.id-b.id);
    const pools=new Map<number,number>();hits=[];remaining=squad.troops;
    const angle=squad.formation?this.geometry.envelope(squad,this.world.tick).angle:0;
    for(const target of contacts){
      if(!remaining)break;
      const contact=this.contact(squad,target),x=Math.cos(angle)*contact.normal.x+Math.sin(angle)*contact.normal.y,y=contact.facing;
      const edge=Math.abs(x)>Math.abs(y)?(x>0?1:3):(y>0?0:2),used=pools.get(edge)??0;
      const troops=Math.min(remaining,Math.max(0,this.participants(squad,profile,target)-used));
      if(!troops)continue;
      pools.set(edge,used+troops);remaining-=troops;hits.push({target,troops});
    }
    if(epoch!==undefined)this.hybridAcquisition.set(squad.id,{epoch,pose,profile,barriers:this.forts.barrierChanges.revision,forts:this.forts.version,diplomacy:this.diplomacy.raids?this.diplomacy.permissionSignature(squad.playerId):this.diplomacy.revision,hits,remaining});
    }
    hits??=[];
    if(definition.meleeAttack && hits.length && this.commitShot(squad,profile))for(const {target,troops} of hits){
      const hit=damageAmount(profile,tacticalDefence(squad,target,this.world.tick,'melee',this.targetDefence(target,squad)),troops,squad.xp);
      this.meleeHit(damage,contributions,squad,target,profile,troops,hit);
      this.world.updateSquad(target.id,{lastCombatTick:this.world.tick});
    }
    return {target:hits[0]?.target,remaining};
  }
  private readonly hybridNearby:Squad[]=[];
  private readonly meleeDamage = new MeleeDamageBatch<{source:Squad;target:Squad;charge:boolean}>();
  private meleeHit(damage:DamageLedger, contributions:Contributions, source:Squad, target:Squad,
    profile:AttackProfile, contributors:number, hit:number, charge=false, penetration=0):void {
    if(profile.perSoldier && target.manpower?.model==='soldiers' && !target.afloat){
      const slots=meleeReceivers(source,target,this.world.tick,profile.range,penetration);
      const bodies=charge?Math.max(1,Math.ceil(penetration/formationDoctrine(target.definitionId).bodyDepth)):1;
      this.meleeDamage.add(target,slots,contributors*bodies,hit,{source,target,charge});
    }else{
      damage.add(target.id,source.playerId,hit);this.volley(source,target,hit,true,charge);
      this.contribution(contributions,target.id,source.id,hit);
    }
  }
  private readonly hybridAcquisition=new Map<number,{epoch:number;pose?:number;profile:AttackProfile;barriers:number;forts:number;diplomacy:number|string;hits:{target:Squad;troops:number}[];remaining:number}>();
  fight(aircraft: Aircraft[]): void {
    this.engagedTargets.clear();for(const s of this.world.squads)if(s.fighting && s.combatTargetId!==null)this.engagedTargets.set(s.id,s.combatTargetId);
    this.rebuild("combat");
    const { tick, squads } = this.world,
      damage = new DamageLedger(),
      contributions: Contributions = new Map(),
      disruptions = new Map<number,ChargeImpact>();
    this.acquisitionWork.searches=this.acquisitionWork.reused=this.acquisitionWork.noOpponentSkips=0;
    // Permissions, not nearby motion, determine whether acquisition is possible.
    // Keep charge/cycle progression and already-launched projectile resolution.
    const quietOwners=this.diplomacy.raids?new Set(this.world.players.filter(p=>this.permissionsAtLaunch(p.id).launchUnitOwners.length===0).map(p=>p.id)):undefined;
    const unitFacts=this.world.squadFacts?.();
    // Local epochs mark animated bodies every tick. Worlds without the
    // lifecycle owner always use fresh acquisition rather than stale reuse.
    const revision=unitFacts?this.groundRevision:undefined;
    if(unitFacts && revision!==undefined&&(!quietOwners||squads.some(s=>!quietOwners.has(s.playerId))))(this.activity??=new CombatActivity(this.mapWidth,this.mapHeight)).update(squads,unitFacts,this.geometry,tick,
      quietOwners?new Set(this.world.players.filter(p=>!quietOwners.has(p.id)).map(p=>p.id)):undefined);
    for(const id of this.acquisition.keys())if(!this.world.squad(id))this.acquisition.delete(id);
    for(const id of this.hybridAcquisition.keys())if(!this.world.squad(id))this.hybridAcquisition.delete(id);
    for (const squad of squads
      .filter((s) => s.embarkedOn === null)
      .sort((a, b) => a.id - b.id)) {
      let fighting=false,combatTargetId:number|null=null;
      try {
      const definition = this.definition(squad);
      let profile = definition.attack;
      if(squad.cavalryMelee && !cavalryUsesRankWaves(squad) && squad.cavalryEngagement?.phase!=='withdrawing')this.world.updateSquad(squad.id,{cavalryMelee:undefined});
      const cycle=squad.cavalryMelee?.current;
      if(cycle && cycle.completed<3){
        const cancelled=squad.refit || squad.manpower?.enlargement || squad.afloat || squad.charge || chargeDisrupted(squad,tick) ||
          squad.order.type==='move' || squad.definitionId!==cycle.definitionId ||
          (this.world.combatOrderRevision?.(squad.id)??0)!==cycle.orderRevision;
        let completed=cancelled?3:cycle.completed;
        while(!cancelled && completed<3 && tick>=waveTick(cycle,completed)){
          for(const contact of cycle.contacts){
            const other=this.world.squad(contact.targetId);
            if(!other || other.troops<=0 || !this.diplomacy.hostile(squad.playerId,other.playerId) || other.afloat ||
              !this.legalContact(squad,other,Math.max(CONTACT.release,cavalryAttackGap(squad,other)),true) || !this.participants(squad,definition.meleeAttack??profile,other))continue;
            let hit=waveDamage(cycle,contact.budget,completed,squad.troops,contact.rankCounts);
            let waveContributors=contact.rankCounts?.[completed]??Math.ceil((contact.reachable??this.participants(squad,definition.meleeAttack??profile,other))/3);
            let reactionPoint:{x:number;y:number}|undefined;
            if(contact.targetBody && contact.rankCounts){
              const angle=this.geometry.envelope(squad,tick).angle;
              const members=formationSlots(squad,tick).map((p,id)=>({id,x:squad.x+p.x*Math.cos(angle)-p.y*Math.sin(angle),y:squad.y+p.x*Math.sin(angle)+p.y*Math.cos(angle)}));
              const ranks=cavalryRanks(members,cycle.rankAxis??angle+Math.PI/2,cycle.rankBand??formationDoctrine(squad.definitionId).spacing*.55);
              const body=formationFootprint(other,tick);
              const arrivals=members.filter(p=>ranks.get(p.id)===completed).flatMap(p=>{
                const path=contactPath(p,contact.targetBody!,contact.bearing??Math.PI/2,cavalryStrikeReach(contact.lunge,completed),contact.reshape??0,contact.strikeDepth??0);
                if(!path)return [];
                const entry=polygonSweepEntry(p,path.point,body);
                return entry===null?[]:[{x:p.x+(path.point.x-p.x)*entry,y:p.y+(path.point.y-p.y)*entry}];
              });
              hit*=Math.min(1,arrivals.length/Math.max(1,contact.rankCounts[completed]));
              waveContributors=Math.min(waveContributors,arrivals.length);
              if(arrivals.length)reactionPoint={x:arrivals.reduce((n,p)=>n+p.x,0)/arrivals.length,y:arrivals.reduce((n,p)=>n+p.y,0)/arrivals.length};
            }
            if(hit<=0)continue;
            this.meleeHit(damage,contributions,squad,other,definition.meleeAttack??profile,
              waveContributors,hit,
              false,contact.strikeDepth??0);
            if((other.kind==='infantry'||other.kind==='archer') && !this.definition(other).tags.includes('vehicle') &&
              (other.chargeImpact?.disruptedUntilTick??0)<=tick){
              const depth=contact.strikeDepth??0,bearing=contact.bearing??0;
              const offset=Math.min(48,formationDoctrine(other.definitionId).bodyDepth*.4);
              let dx=Math.round(Math.cos(bearing)*offset),dy=Math.round(Math.sin(bearing)*offset);
              if(!this.world.chargePresentationClear?.(other,dx,dy)){dx=dy=0;}
              this.world.updateSquad(other.id,{chargeImpact:{tick,role:'defender',sourceId:squad.id,disruptedUntilTick:tick,
                x:Math.round(reactionPoint?.x??contact.toX+Math.cos(bearing)*depth),y:Math.round(reactionPoint?.y??contact.toY+Math.sin(bearing)*depth),dx,dy,
                ...(contact.reachable?{participants:Math.min(CHARGE_IMPACT.maxMembers,Math.max(1,contact.rankCounts?.[completed]??Math.ceil(contact.reachable/3))),radius:Math.min(128,formationDoctrine(other.definitionId).bodyDepth*1.5)}:{})}});
            }
            this.world.updateSquad(squad.id,{lastAttackTick:tick,lastCombatTick:tick});this.world.updateSquad(other.id,{lastCombatTick:tick});
          }
          completed++;
        }
        if(cancelled)this.world.updateSquad(squad.id,{cavalryMelee:squad.cavalryEngagement?.phase==='withdrawing'?{...squad.cavalryMelee!,current:{...cycle,completed:3}}:undefined});
        else if(completed!==cycle.completed)this.world.updateSquad(squad.id,{cavalryMelee:{...squad.cavalryMelee!,current:{...cycle,completed}}});
      }
      // Transports carry soldiers; they do not fight from the water.
      if (squad.refit || squad.manpower?.enlargement || squad.afloat || squad.charge?.phase === "preparing" || chargeDisrupted(squad,tick) || squad.cavalryEngagement?.phase==='withdrawing') continue;
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
            this.legalContact(squad,s,isCavalryTroopClass(definition.troopClass)?CONTACT.release:definition.meleeAttack?.range ?? charge.radius,true) &&
            this.participants(squad,definition.meleeAttack ?? profile,s)>0,
        );
        if (
          targets.length ||
          this.distance(squad, squad.charge) <= FIXED ** 2 ||
          tick - squad.charge.committedTick > secondsToTicks(4)
        ) {
          const strength=chargeStrength(squad.charge),shock=.25+.75*strength,bonusStrength=charge.bonusDurationTicks===0?0:strength;
          const impact = definition.meleeAttack ? { ...definition.meleeAttack, damage: definition.meleeAttack.damage * (1+((definition.chargeMultiplier ?? 1)-1)*bonusStrength), penetration: charge.penetration*strength } : { ...profile, channel: "melee" as const, damage: profile.damage+(charge.damage-profile.damage)*strength, penetration: charge.penetration*strength };
          const resolved=impact.perSoldier?resolveChargeImpact(squad,targets,impact,tick,target=>this.targetDefence(target,squad)):undefined;
          let remaining = resolved?.budget ?? charge.damage * 4;
          const impactTargets=resolved?resolved.hits.map(hit=>hit.target):targets
            .sort((a, b) => a.id - b.id)
            .slice(0, 8);
          const resistance=new Map(impactTargets.map(target=>[target.id,cavalryAssaultContact(squad,target,definition,this.definition(target),tick,strength,
            (dx,dy,lateral)=>!!this.world.chargePresentationClear?.(squad,dx,dy,lateral))]));
          const entryDepth=(target:Squad)=>isCavalryTroopClass(definition.troopClass)?resistance.get(target.id)!.depth:0;
          for (const target of impactTargets) {
            const hit = resolved?.hits.find(hit=>hit.target.id===target.id)?.damage ?? Math.min(
              remaining,
              damageAmount(
                {
                  ...impact,
                },
                this.targetDefence(target,squad),
                impact.perSoldier ? this.participants(squad, impact, target) : legacyWeaponStrength(squad),
                squad.xp,
              ),
            );
            const penetration=entryDepth(target);
            this.meleeHit(damage,contributions,squad,target,impact,
              resolved?.hits.find(h=>h.target.id===target.id)?.contributors??this.participants(squad,impact,target),hit,true,penetration);
            if(hit>0 && isCavalryTroopClass(definition.troopClass) && (target.kind==='infantry'||target.kind==='archer') && !this.definition(target).tags.includes('vehicle')){
              const contact=this.contact(squad,target),receiving=this.contact(target,squad),defender=this.definition(target);
              const flank=receiving.facing<.25,braced=!resistance.get(target.id)?.penetrates;
              const offset=Math.min(CHARGE_IMPACT.maxOffset,this.geometry.envelope(target,tick).depth*.35)*(braced?.25:flank?1:.65)*shock;
              let dx=Math.round(contact.normal.x*offset),dy=Math.round(contact.normal.y*offset);
              if(!this.world.chargePresentationClear?.(target,dx,dy)){dx=dy=0;}
              const disruption=Math.floor((braced?2:flank?CHARGE_IMPACT.disruption:CHARGE_IMPACT.disruption*.75)*strength);
              // Staged: applying the disruption in place would skip a
              // higher-id defender's strike this tick but not a lower-id
              // one's, so creation order decided the duel (R2-L1, C2).
              const staged=disruptions.get(target.id);
              disruptions.set(target.id,{tick,role:'defender',sourceId:squad.id,
                disruptedUntilTick:Math.max(tick+disruption,staged?.disruptedUntilTick??tick),
                x:contact.target.x,y:contact.target.y,dx,dy});
              if(squad.chargeImpact?.tick!==tick){
                const followThrough=Math.min(CHARGE_IMPACT.maxRiderOffset,contact.gap+offset);
                let rx=Math.round(contact.normal.x*followThrough),ry=Math.round(contact.normal.y*followThrough);
                if(!this.world.chargePresentationClear?.(squad,rx,ry)){rx=ry=0;}
                this.world.updateSquad(squad.id,{chargeImpact:{tick,role:'rider',sourceId:squad.id,disruptedUntilTick:tick,
                  x:contact.source.x,y:contact.source.y,dx:rx,dy:ry}});
              }
            }
            remaining -= hit;
          }
          const assaultTargets=impactTargets;
          const receiving=assaultTargets[0];
          let entering=false;
          if(receiving && isCavalryTroopClass(definition.troopClass)){
            const c=this.contact(squad,receiving),depth=entryDepth(receiving);
            const dx=Math.round(c.normal.x*depth),dy=Math.round(c.normal.y*depth);
            const previous=squad.cavalryEngagement?.assault;
            entering=depth>0;
            this.world.updateSquad(squad.id,{cavalryEngagement:{phase:entering?'penetrating':'engaged',tick,untilTick:tick+CAVALRY_ENTRY.duration,
              targetIds:assaultTargets.slice(0,8).map(target=>target.id),
              assault:{startTick:previous?.startTick??tick,bonusUntilTick:previous?.bonusUntilTick??tick+(strength>0?charge.bonusDurationTicks??0:0),strength:previous?.strength??strength,
                penetrates:depth>0,...resistance.get(receiving.id)!.geometry,
                pressure:resistance.get(receiving.id)!.pressure,resistance:resistance.get(receiving.id)!.resistance},
              originX:squad.x,originY:squad.y,goalX:squad.x+dx,goalY:squad.y+dy}});
          }
          this.world.updateSquad(squad.id,{charge:receiving&&isCavalryTroopClass(definition.troopClass)?null:{ ...squad.charge, phase: "recovery" }});
          this.world.updateSquad(squad.id, { chargeReadyTick: tick + charge.cooldownTicks });
          if (impact.perSoldier) {
            const recovery=definition.chargeRecoveryTicks??TACTICAL_CHARGE.recoveryTicks;
            this.world.updateSquad(squad.id,{weaponState:commitChargeShot(impact,squad.weaponState,tick,recovery)});
          }
          this.world.updateSquad(squad.id, { order: receiving&&isCavalryTroopClass(definition.troopClass)?{type:'attack',targetId:receiving.id}:{ type: "hold" } });
          this.world.updateSquad(squad.id, { path: [] });
          this.world.updateSquad(squad.id, { queuedOrders: [] });
        }
        continue;
      }
      if (squad.charge?.phase === "recovery") {
        if (
          tick >=
          (squad.chargeReadyTick ?? 0) - (definition.charge!.cooldownTicks - (definition.chargeRecoveryTicks??TACTICAL_CHARGE.recoveryTicks))
        )
          this.world.updateSquad(squad.id, { charge: null });
        else continue;
      }
      if(squad.cavalryEngagement?.phase==='penetrating')continue;
      if(quietOwners?.has(squad.playerId)&&!squad.structureTarget){this.acquisitionWork.noOpponentSkips++;continue;}
      if (profile.targets.includes("aircraft")) {
        const eligible = (a: Aircraft) =>
          a.health > 0 && a.state !== "ready" &&
          this.diplomacy.hostile(squad.playerId, a.playerId) &&
          this.distance(squad, a) <= effectiveRange(this.world,squad,profile,a) ** 2;
        // Stay on the aircraft being aimed at while it remains eligible, as the
        // ground path keeps its previous target; re-picking the nearest every
        // tick restarted the wind-up and orbiting fighters were never shot (A5).
        const aim = squad.weaponState?.rangedAction;
        const held = aim?.targetKind === "aircraft"
          ? aircraft.find((a) => a.id === aim.targetId && eligible(a))
          : undefined;
        const target = held ?? aircraft
          .filter(eligible)
          .sort(
            (a, b) =>
              this.distance(squad, a) - this.distance(squad, b) || a.id - b.id,
          )[0];
        if (target) {
          fighting=true;
          this.world.updateSquad(squad.id, { lastCombatTick: tick });
          if (!this.commitShot(squad, profile, {targetKind: "aircraft", targetId: target.id})) continue;
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
              squad.xp,1000,undefined,rangedElevation(this.world,squad,profile,target).damageBp,
            ),
          );
          target.health -= hit;
          this.world.updateSquad(squad.id, { xp: Math.min(20000, (squad.xp ?? 0) + hit) });
          this.volley(squad, target);
          fighting=true;
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
        fighting=this.attackStructure(squad, profile);
        continue;
      }
      if (!profile.damage) continue;
      const acquisitionRange=maxEffectiveRange(profile);
      let queried=false;
      const gatherNearby=()=>{if(queried)return;queried=true;this.spatial.queryOverlaps(
        squad.x,
        squad.y,
        acquisitionRange + CONTACT.release + (squad.formation?this.geometry.envelope(squad,tick).broadRadius:0),
        this.nearby,
        squad.playerId,
      );};
      const eligible = (s: Squad) =>
        this.diplomacy.hostile(squad.playerId, s.playerId) &&
        profile.targets.some((tag) => this.targetTags(s).includes(tag)) &&
        this.legalContact(squad,s,profile.channel==='melee'&&isCavalryTroopClass(definition.troopClass)?Math.max(CONTACT.release,cavalryAttackGap(squad,s)):effectiveRange(this.world,squad,profile,s),profile.channel==="melee");
      let target: Squad | undefined;
      let nearest = Infinity;
      const cached=this.acquisition.get(squad.id),previousId=this.engagedTargets.get(squad.id);
      // Mid-pass charge geometry changes invalidate subsequent reuse immediately.
      // Between passes, local epochs avoid waking every army for a distant turn.
      const currentRevision=revision===undefined || unitFacts && unitFacts.spatialRevision!==revision?undefined:
        this.activity?.region(squad,Math.max(acquisitionRange,definition.meleeAttack?.range??0)+CONTACT.release+(squad.formation?this.geometry.envelope(squad,tick).broadRadius:0),squad.playerId,
          this.diplomacy.raids?this.permissionsAtLaunch(squad.playerId).launchUnitOwners:undefined)??revision;
      const pose=this.activity?.pose(squad.id)??unitFacts?.poseRevision(squad.id);
      const reuse=currentRevision!==undefined && cached?.revision===currentRevision && cached.pose===pose && !squad.formation?.transition && cached.barriers===this.forts.barrierChanges.revision &&
        cached.forts===this.forts.version && cached.diplomacy===(this.diplomacy.raids?this.diplomacy.permissionSignature(squad.playerId):this.diplomacy.revision) &&
        cached.order===squad.order && cached.profile===profile && cached.previous===previousId;
      if(reuse){target=cached.target===undefined?undefined:this.world.squad(cached.target);this.acquisitionWork.reused++;}
      else {
      this.acquisitionWork.searches++;
      // Explicit orders and a retained frontal melee target override nearest
      // acquisition. Resolve them first, without a background-work queue.
      const wanted=squad.order.type==='attack'?this.world.squad(squad.order.targetId):undefined;
      // An explicit mounted retarget must not rebuild a rank commitment against
      // the old nearby opponent while approaching the requested opponent.
      if(wanted && profile.channel==='melee' && isCavalryTroopClass(definition.troopClass) && !squad.cavalryEngagement && !eligible(wanted))continue;
      if(wanted && eligible(wanted))target=wanted;
      const previous=this.world.squad(previousId??-1);
      if(!target && previous && eligible(previous)){
        if(profile.channel==='ranged')target=previous;
        else {
          const contact=this.contact(squad,previous),angle=squad.formation?radians(squad.formation.facing):0;
          if(-Math.sin(angle)*contact.normal.x+Math.cos(angle)*contact.normal.y>=.25)target=previous;
        }
      }
      if(!target){gatherNearby();for (const candidate of this.nearby) {
        if(!this.diplomacy.hostile(squad.playerId,candidate.playerId) || !profile.targets.some(tag=>this.targetTags(candidate).includes(tag)))continue;
        if(squad.formation && candidate.formation &&
          (!this.geometry.withinReach(squad,candidate,tick,effectiveRange(this.world,squad,profile,candidate)+CONTACT.release) || this.geometry.lowerBound(squad,candidate,tick)>nearest))continue;
        const distance = squad.formation && candidate.formation ? this.contact(squad,candidate).gap**2 : this.distance(squad, candidate);
        if (distance > nearest || (distance === nearest && target && candidate.id >= target.id)) continue;
        if (!eligible(candidate)) continue;
        target = candidate;
        nearest = distance;
      }}
      if(currentRevision!==undefined)this.acquisition.set(squad.id,{revision:currentRevision,pose,barriers:this.forts.barrierChanges.revision,
        forts:this.forts.version,diplomacy:this.diplomacy.raids?this.diplomacy.permissionSignature(squad.playerId):this.diplomacy.revision,order:squad.order,profile,previous:previousId,target:target?.id});
      }
      const hybrid=definition.rangedAttack?.perSoldier && profile.channel==='ranged'
        ? this.hybridContacts(squad,definition,damage,contributions,currentRevision===undefined?undefined:revision):undefined;
      if(hybrid?.target){fighting=true;combatTargetId=hybrid.target.id;this.world.updateSquad(squad.id,{lastCombatTick:tick});}
      if (!target) continue;
      // Acquisition grants neither a shot nor an attack animation; close
      // contacted edges defend without rotating the physical formation.
      combatTargetId=hybrid?.target?.id??target.id;
      let engagement=reuse?cached!.engagement:undefined;
      if(!engagement){
        const participants=profile.channel==='melee'?this.participants(squad,profile,target):attackContributors(squad,profile,target);
        const canFight=profile.channel!=='melee'||participants>0;
        let effective=profile,contributors=participants;
        if(canFight && !hybrid && definition.meleeAttack && this.legalContact(squad,target,definition.meleeAttack.range,true)){
          const n=definition.meleeAttack===profile?participants:this.participants(squad,definition.meleeAttack,target);
          if(n>0){effective=definition.meleeAttack;contributors=n;}
        }
        engagement={profile:effective,participants:contributors,canFight};
        const retained=this.acquisition.get(squad.id);if(retained && currentRevision!==undefined)retained.engagement=engagement;
      }
      if(hybrid)engagement={...engagement,participants:Math.min(engagement.participants,hybrid.remaining),canFight:hybrid.remaining>0};
      if(!engagement.canFight)continue;
      fighting=true;
      profile=engagement.profile;
      if(profile.channel==='melee' && meleeCavalry(definition) && !squad.cavalryEngagement?.assault && !squad.charge &&
        squad.order.type!=='move' && !(squad.order.type==='attack'&&squad.order.cavalryMode==='ranks')){
        const assault=ordinaryCavalryAssault(squad,target,definition,this.definition(target),tick,
          (dx,dy,lateral)=>!!this.world.chargePresentationClear?.(squad,dx,dy,lateral));
        if(squad.order.type==='hold'){
          const geometry=assaultContactGeometry(squad,target,tick,0,(dx,dy,lateral)=>!!this.world.chargePresentationClear?.(squad,dx,dy,lateral));
          assault.phase='engaged';assault.goalX=squad.x;assault.goalY=squad.y;
          assault.assault={...assault.assault!,...geometry,penetrates:false};
        }
        this.world.updateSquad(squad.id,{cavalryEngagement:assault,cavalryMelee:undefined});
      }
      if(profile.channel==='melee' && definition.charge && !squad.cavalryEngagement && (squad.chargeReadyTick??0)>tick)
        this.world.updateSquad(squad.id,{chargeReadyTick:squad.chargeReadyTick!+1});
      const ordinaryProfile=profile;
      let bonus=profile.channel==='melee'?assaultBonus(squad,tick):0;
      profile=assaultWeapon(profile,definition,bonus);
      if(profile.channel==='melee' && isCavalryTroopClass(definition.troopClass) && squad.order.type==='move')continue;
      this.world.updateSquad(squad.id, { lastCombatTick: tick });
      this.world.updateSquad(target.id, { lastCombatTick: tick });
      // Per-channel weapon readiness can precede the mounted motion deadline.
      // Keep the existing commitment until its complete visual cycle ends.
      if(profile.channel==='melee' && !squad.cavalryEngagement && squad.cavalryMelee &&
        tick<squad.cavalryMelee.current.tick+squad.cavalryMelee.current.interval)continue;
      // Multiple weapon events may fall within one fixed step; acquisition is shared.
      const burstLimit=profile.perSoldier?Math.ceil(profile.rpm!/(60*TICKS_PER_SECOND))+1:1;
      for(let shot=0;shot<burstLimit && this.commitShot(squad,profile,{targetKind:"squad",targetId:target.id});shot++){
      const activated=profile.channel==='melee'?commitCavalryBonus(squad,definition,tick):undefined;
      if(activated){
        this.world.updateSquad(squad.id,{cavalryEngagement:activated.engagement,chargeReadyTick:activated.readyTick});
        bonus=assaultBonus(squad,tick);
        profile=assaultWeapon(ordinaryProfile,definition,bonus);
      }
      if (profile.projectile) {
        const weapon = scaledAttack(profile, 1000, 1000, squad.xp);
        this.fire(
          {
            ...squad,
            attackScale: profile.perSoldier ? engagement.participants : attackStrength(legacyWeaponStrength(squad), 1000),
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

      const activeAssault=squad.cavalryEngagement?.assault;
      if(activeAssault && squad.cavalryEngagement && squad.cavalryEngagement.targetIds.includes(target.id)){
        // Publish the edge only when it moved; rewriting an unchanged edge on
        // every strike churned the record and its snapshot detail (R2-P11, C5).
        const geometry=assaultContactGeometry(squad,target,tick,activeAssault.depth,(dx,dy,lateral)=>!!this.world.chargePresentationClear?.(squad,dx,dy,lateral));
        if(assaultGeometryChanged(activeAssault,geometry))
          this.world.updateSquad(squad.id,{cavalryEngagement:{...squad.cavalryEngagement,assault:{...activeAssault,...geometry}}});
      }
      const waves=profile.channel==='melee' && profile.perSoldier && cavalryUsesRankWaves(squad) && isCavalryTroopClass(definition.troopClass);
      const contacts:CavalryCycle['contacts'][number][]=[];
      const applyHit=(other:Squad,hit:number,contributors:number)=>{
        if(waves){
          if(contacts.length>=8)return;
          const c=this.contact(squad,other);
          const targetDoctrine=formationDoctrine(other.definitionId);
          const strikeDepth=targetDoctrine.hull?0:Math.round(Math.min(128,targetDoctrine.bodyDepth*1.5,this.geometry.envelope(other,tick).depth/3));
          const length=Math.min(512,this.geometry.envelope(squad,tick).depth+c.gap+strikeDepth+32);
          const lunge=this.world.chargePresentationClear?.(squad,Math.round(c.normal.x*length),Math.round(c.normal.y*length))?length:0;
          const laneWidth=lunge&&this.world.chargePresentationClear?.(squad,Math.round(c.normal.x*lunge),Math.round(c.normal.y*lunge),16)?16:0;
          const reshape=lunge&&this.world.chargePresentationClear?.(squad,Math.round(c.normal.x*lunge),Math.round(c.normal.y*lunge),64)?64:laneWidth;
          const targetBody=convexHull(formationFootprint(other,tick).map(p=>({x:Math.round(p.x),y:Math.round(p.y)})));
          const angle=this.geometry.envelope(squad,tick).angle,bearing=Math.atan2(c.normal.y,c.normal.x);
          const slots=formationSlots(squad,tick);
          const members=slots.map((p,id)=>({id,x:squad.x+p.x*Math.cos(angle)-p.y*Math.sin(angle),y:squad.y+p.x*Math.sin(angle)+p.y*Math.cos(angle)}));
          const ranks=cavalryRanks(members,angle+Math.PI/2,formationDoctrine(squad.definitionId).spacing*.55);
          const reachable=members.filter(p=>contactPath(p,targetBody,bearing,cavalryStrikeReach(lunge,ranks.get(p.id)!),reshape,strikeDepth));
          const rankCounts=[0,1,2].map(rank=>reachable.filter(p=>ranks.get(p.id)===rank).length);
          // Contact geometry bounds the damage budget as well as the visible
          // wave. Files that cannot reach the body never cast damage beside it.
          const budget=reachable.length?Math.round(hit*1000*reachable.length/slots.length):0;
          if(!budget)return;
          contacts.push({targetId:other.id,budget,lunge,laneWidth,strikeDepth,targetBody,reshape,reachable:reachable.length,rankCounts,bearing,
            fromX:c.source.x,fromY:c.source.y,toX:c.target.x,toY:c.target.y});
        }else if(profile.channel==='melee')this.meleeHit(damage,contributions,squad,other,profile,contributors,hit,bonus>0);
        else {
          // C3: one hull/burst hit kills at most the bodies it reaches.
          if(!profile.perSoldier)hit=Math.min(hit,soldierHitCap(other,directHitBodies(other)));
          damage.add(other.id,squad.playerId,hit);this.volley(squad,other,hit,false);this.contribution(contributions,other.id,squad.id,hit);
        }
      };
      const hit = damageAmount(
        profile,
        tacticalDefence(squad,target,tick,profile.channel,this.targetDefence(target,squad),bonus>0),
        profile.perSoldier ? engagement.participants * weaponAccuracy(profile, Math.sqrt(this.distance(squad,target))) : legacyWeaponStrength(squad),
        squad.xp,1000,undefined,rangedElevation(this.world,squad,profile,target).damageBp,
      );
      applyHit(target,hit,engagement.participants);
      if(profile.channel==='melee' && profile.perSoldier && squad.formation && !squad.charge){
        // One shared attack cycle defends contacted edges. The primary target
        // receives first priority; edge pools and total manpower bound damage.
        let remaining=squad.troops-engagement.participants;
        const edges=new Map<number,number>(),angle=formationEnvelope(squad,tick).angle;
        const edge=(other:Squad)=>{const c=this.contact(squad,other),x=Math.cos(angle)*c.normal.x+Math.sin(angle)*c.normal.y,y=c.facing;return Math.abs(x)>Math.abs(y)?(x>0?1:3):(y>0?0:2);};
        edges.set(edge(target),engagement.participants);
        if(remaining>0)gatherNearby();
        const others=(remaining>0?this.nearby:[]).filter(other=>other.id!==target.id && eligible(other) && this.contact(squad,other).gap<=CONTACT.release)
          .sort((a,b)=>this.contact(squad,a).gap-this.contact(squad,b).gap || a.id-b.id);
        for(const other of others){
          if(remaining<=0)break;
          const key=edge(other),used=edges.get(key)??0,n=Math.min(remaining,Math.max(0,this.participants(squad,profile,other)-used));if(!n)continue;
          edges.set(key,used+n);remaining-=n;
          const sideHit=damageAmount(profile,tacticalDefence(squad,other,tick,profile.channel,this.targetDefence(other,squad),bonus>0),n,squad.xp);
          applyHit(other,sideHit,n);
          this.world.updateSquad(other.id,{lastCombatTick:tick});
        }
      }
      if(waves && contacts.length){
        const previous=squad.cavalryMelee?.current;
        const launchSpacing=this.world.cavalryRankLaunchSpacing?.(squad)??.25;
        const interval=Math.max(cavalryRankCycleTicks(launchSpacing),(squad.nextAttackTick??tick+1)-tick);
        this.world.updateSquad(squad.id,{nextAttackTick:tick+interval,cavalryMelee:{current:{tick,interval,completed:0,
          ...(launchSpacing===1?{}:{launchSpacing}),
          troops:squad.troops,definitionId:squad.definitionId!,rankAxis:Math.atan2(Math.cos(this.geometry.envelope(squad,tick).angle),-Math.sin(this.geometry.envelope(squad,tick).angle)),rankBand:formationDoctrine(squad.definitionId).spacing*.55,approachSpeed:Math.min(32,squad.moved?(squad.locomotion?.speed??0):0),orderRevision:this.world.combatOrderRevision?.(squad.id)??0,contacts},
          ...(previous?.completed===3?{previous}:{} )}});
      }
      this.world.updateSquad(squad.id, { firingCharge: 0 });
      }
      } finally {
        const state = this.world.squad(squad.id)?.weaponState;
        if (state?.rangedAction && state.rangedAction.phase !== "released" && state.rangedAction.lastEligibleTick !== tick)
          this.world.updateSquad(squad.id, {weaponState: cancelRangedPreparation(state)});
        // Publish the final state once; clearing and restoring the same target
        // every tick caused journal/index churn for every engaged squad.
        this.world.updateSquad(squad.id,{fighting,combatTargetId});
      }
    }
    // Fixed gun nests have their own weapon, never a mobile squad's reserves.
    for (const b of this.world.buildings)
      if (
        b.type === "gun-nest" &&
        !b.remainingTicks &&
        (b.health ?? 1) > 0 &&
        tick >= (b.nextAttackTick ?? 0)
        && !quietOwners?.has(b.playerId)
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
            this.projectileDefence(target,p.x,p.y,tick),
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
    // Charge disruption lands after every squad has struck this tick, in id order.
    for(const id of [...disruptions.keys()].sort((a,b)=>a-b)){
      const target=this.world.squad(id),impact=disruptions.get(id)!;
      if(!target)continue;
      this.world.updateSquad(id,{chargeImpact:{...impact,
        disruptedUntilTick:Math.max(impact.disruptedUntilTick,target.chargeImpact?.disruptedUntilTick??tick)}});
    }
    this.meleeDamage.resolve(({source,target,charge},hit)=>{
      damage.add(target.id,source.playerId,hit);this.volley(source,target,hit,true,charge);
      this.contribution(contributions,target.id,source.id,hit);
    });
    this.awardDamage(damage, contributions);
    this.world.resolveLandDamage(damage);
  }
  private attackStructure(squad: Squad, profile: AttackProfile): boolean {
    const target =
      squad.structureTarget!.buildingId !== undefined
        ? this.world.building(squad.structureTarget!.buildingId)
        : this.forts.barrier(squad.structureTarget!.barrierId!);
    if (
      !target ||
      !this.diplomacy.canAttackStructure(squad.playerId, target.playerId) ||
      (target.health ?? 1) <= 0
    ) {
      this.world.updateSquad(squad.id, { structureTarget: null });
      return false;
    }
    const p = structureAim(squad, "tile" in target ? [target.tile] : target.tiles,
      elevationRangeAt(this.world,squad,profile), squad.playerId, this.mapWidth, this.forts,this.world.tick);
    if (!p) return false;
    this.world.updateSquad(squad.id, { lastCombatTick: this.world.tick });
    if (!this.commitShot(squad, profile, {targetKind: "tile" in target ? "building" : "barrier", targetId: target.id})) return true;
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
      return true;
    }
    if (profile.channel === "ranged") this.volley(p.source?{...squad,...p.source}:squad, p);
    let hit = damageAmount(
      profile,
      {
        ...STRUCTURE_DEFENCE,
        tags: "tile" in target ? ["structure"] : ["structure", "wall"],
      },
      profile.perSoldier ? attackContributors(squad, profile) : legacyWeaponStrength(squad),
      squad.xp,1000,undefined,rangedElevation(this.world,squad,profile,p).damageBp,
    );
    if (!("tile" in target) && this.diplomacy.state.betrayal[target.playerId])
      hit *= 2;
    if(profile.channel==="melee")this.volley(p.source?{...squad,...p.source}:squad,p,hit,true);
    this.structuralHit(target, squad.playerId, squad.id, hit);
    return true;
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
        const target=aircraft.find(a=>a.id===p.targetAircraftId && a.health>0 && a.state!=="ready");
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
          .filter(b => (b.health ?? 1) > 0 && this.diplomacy.hostile(p.playerId,b.playerId) && this.diplomacy.canAttackStructure(p.playerId,b.playerId))
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
          const child=this.projectiles[this.projectiles.length-1];
          if(p.launchUnitOwners)child.launchUnitOwners=[...p.launchUnitOwners];
          if(p.launchStructureOwners)child.launchStructureOwners=[...p.launchStructureOwners];
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
              (p.launchUnitOwners?.includes(s.playerId) ?? this.diplomacy.hostile(s.playerId,p.playerId)) &&
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
                  (p.launchStructureOwners?.includes(b.playerId) ?? this.diplomacy.canAttackStructure(p.playerId,b.playerId)),
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
                (p.launchStructureOwners?.includes(b.playerId) ?? this.diplomacy.canAttackStructure(p.playerId,b.playerId)),
            ) ??
            this.forts.barriersAt(wall.tile).find(
              (b) =>
                b.kind !== "trench" && b.health > 0 &&
                (p.launchStructureOwners?.includes(b.playerId) ?? this.diplomacy.canAttackStructure(p.playerId,b.playerId)),
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
      if(p.droneImpact) {
        const hit=p.droneImpact;
        if(hit.kind==='building') {
          const building=this.world.building(hit.targetId);
          if(building && (building.health??0)>0 && this.diplomacy.canAttackStructure(p.playerId,building.playerId))
            this.structuralHit(building,p.playerId,p.sourceId,hit.damage,p.sourceKind);
        } else if(hit.kind==='ship') {
          const ship=this.world.ship(hit.targetId);
          if(ship&&ship.health>0&&this.diplomacy.hostile(p.playerId,ship.playerId)){naval.add(ship.id,p.playerId,hit.damage);this.contribution(contributions,ship.id,p.sourceId,hit.damage,p.sourceKind);}
        } else {
          const squad=this.world.squad(hit.targetId);
          if(squad && squad.troops>0 && this.diplomacy.hostile(p.playerId,squad.playerId)) {
            impacts.add(squad.id,p.playerId,hit.damage);
            this.contribution(contributions,squad.id,p.sourceId,hit.damage,p.sourceKind);
          }
        }
        continue;
      }
      if (!p.blastRadius && !directHit && !directStructure && this.world.volleys.length < 4096) {
        this.world.volleys.push({id:this.world.allocateId(),squadId:p.sourceId,playerId:p.playerId,definitionId:p.definitionId,tick,fromX:p.fromX,fromY:p.fromY,toX:p.x,toY:p.y,impact:true});
      }
      if (!p.blastRadius) {
        // Contact weapons have one target. A miss is not a small explosion.
        if (
          directHit &&
          (p.launchUnitOwners?.includes(directHit.playerId) ?? this.diplomacy.hostile(directHit.playerId,p.playerId))
        ) {
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
            "troops" in directHit
              ? this.projectileDefence(directHit,p.fromX,p.fromY,tick)
              : {
                  tags: ["ship"],
                  meleeArmour: 1000,
                  rangedArmour: 2000,
                  bonusResistance: {},
                },
          );
          // C3: a direct shell hit kills at most one frontage of soldiers.
          if ("troops" in directHit && !p.perSoldier) hit = Math.min(hit, soldierHitCap(directHit, directHitBodies(directHit)));
          ("troops" in directHit ? impacts : naval).add(
            directHit.id,
            p.playerId,
            hit,
          );
          if('troops' in directHit)this.explainProjectile(p,directHit,hit,tick);
          if ("troops" in directHit && this.world.volleys.length < 4096) this.world.volleys.push({id:this.world.allocateId(),squadId:p.sourceId,playerId:p.playerId,definitionId:p.definitionId,tick,fromX:p.fromX,fromY:p.fromY,toX:p.x,toY:p.y,targetId:directHit.id,damage:hit,impact:true});
          this.contribution(
            contributions,
            directHit.id,
            p.sourceId,
            hit,
            p.sourceKind,
          );
        } else if (directStructure && (p.launchStructureOwners?.includes(directStructure.playerId)??this.diplomacy.canAttackStructure(p.playerId,directStructure.playerId))) {
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
      const scaled = (position: Position & { id?: number }) => {
        // A naval shell's direct hull hit delivers its authored damage. Splash
        // retains falloff; stopping at the collision rim must not weaken every hit.
        if (p.sourceKind === "ship" && directHit && directHit.id === position.id) return profile;
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
      const blastVictim = (owner:number) => indiscriminate || (p.launchUnitOwners?.includes(owner) ?? this.diplomacy.hostile(owner,p.playerId));
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
          const building=this.structureById.get(body.id);
          if (!building || (building.health ?? 1) <= 0) continue;
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
      // The shared budget goes to the bodies nearest the impact first, then
      // by id; choosing victims by id alone could starve the centre body or a
      // directly hit warship (L8, C2). Each kind keeps its own 64-victim cap.
      const byImpact = <T extends Position & { id: number }>(a: T, b: T) =>
        this.distance(a, p) - this.distance(b, p) || a.id - b.id;
      const victims: ({ ship: false; target: Squad } | { ship: true; target: Ship })[] = [
        ...this.nearby.filter(eligible).sort(byImpact).slice(0, targetLimit).map((target) => ({ ship: false as const, target })),
        ...this.nearbyShips.filter(eligible).sort(byImpact).slice(0, targetLimit).map((target) => ({ ship: true as const, target })),
      ].sort((a, b) => byImpact(a.target, b.target));
      for (const victim of victims) {
        if (victim.ship) {
          const target = victim.target;
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
          continue;
        }
        const target = victim.target;
        const hit = Math.min(
          budget,
          hitDamage(
            scaled(target),
            this.projectileDefence(target,p.fromX,p.fromY,tick),
          ),
          // C3: a blast kills at most the soldier bodies inside its radius.
          p.perSoldier ? Infinity : soldierHitCap(target, this.bodiesInBlast(target, p, radius, tick)),
        );
        if (hit <= 0) continue;
        impacts.add(target.id, p.playerId, hit);
        this.explainProjectile(p,target,hit,tick);
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
            (indiscriminate||(p.launchStructureOwners?.includes(b.playerId)??this.diplomacy.canAttackStructure(p.playerId,b.playerId))) &&
            this.distance(this.position(b), p) <= radius ** 2 &&
            (p.kind !== "shell" ||
              this.forts
                .segmentTiles(p, this.position(b))
                .every(
                  (t) => t === b.tile || !this.forts.blocked(t, p.playerId),
                )),
        )
        .sort((a, b) => a.id - b.id)) {
        const b = this.structureById.get(body.id);
        if (!b || (b.health ?? 1) <= 0) continue;
        const hit = Math.min(
          budget,
          hitDamage(scaled(this.position(b)), STRUCTURE_DEFENCE),
        );
        this.structuralHit(b, p.playerId, p.sourceId, hit, p.sourceKind);
        budget -= hit;
      }
      for (const wall of this.forts.nearbyBarriers(p.x, p.y, radius))
        if (
          (indiscriminate||(p.launchStructureOwners?.includes(wall.playerId)??this.diplomacy.canAttackStructure(p.playerId,wall.playerId))) &&
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
        tick - (this.projectiles[i].impactAt ?? tick) > secondsToTicks(0.5)
      )
        this.projectiles.splice(i, 1);
  }
}
