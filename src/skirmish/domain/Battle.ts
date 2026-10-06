import { restoreArray } from "../StateTransfer";
import { DamageLedger } from "../Conquest";
import { GUN_NEST_ATTACK, TRENCH_COVER } from "../content/Defences";
import { UNIT, defaultUnit } from "../content/Units";
import type { ArcherVolley, Building, Player, Ship, Squad } from "../Protocol";
import { FIXED } from "../Protocol";
import { SpatialGrid } from "../SpatialGrid";
import type { BuildingQueries } from "../BuildingIndex";
import {
  attackInterval,
  attackStrength,
  damageAmount,
  defenceOf,
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
  private distance(a: Position, b: Position): number {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  }
  private rebuild(phase: SpatialPhase): void {
    this.telemetry.indexRebuilds++;
    const spatialFacts = this.world.spatialFacts?.(phase);
    if (spatialFacts) { this.spatial = spatialFacts.ground; this.naval = spatialFacts.ships; }
    else {
      this.localSpatial ??= new SpatialGrid(this.mapWidth * FIXED, this.mapHeight * FIXED, 4 * FIXED, (s: Squad) => s.playerId);
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
      this.spatial.query(p.x, p.y, FIXED, this.nearby);
      this.telemetry.trenchCandidates += this.nearby.length;
      for (const s of this.nearby.filter(s => s.playerId === owner && s.embarkedOn === null &&
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
  fire(
    source: {
      id: number;
      playerId: number;
      x: number;
      y: number;
      domain?: CombatSourceKind;
      attackScale?: number;
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
  ): boolean {
    if (!this.canFire(kind === "mirv" ? warheads : 0)) return false;
    if (kind === "mirv") this.reservedWarheads += warheads;
    this.projectiles.push({
      id: this.world.allocateId(),
      playerId: source.playerId,
      sourceId: source.id,
      sourceKind: source.domain ?? "squad",
      attackScale: source.attackScale,
      definitionId,
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
    target: Position,
  ): void {
    if (this.world.volleys.length >= 4096) return;
    this.world.volleys.push({
      id: this.world.allocateId(),
      tick: this.world.tick,
      squadId: source.id,
      definitionId: source.definitionId,
      playerId: source.playerId,
      fromX: source.x,
      fromY: source.y,
      toX: target.x,
      toY: target.y,
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
      const health = "troops" in target ? target.troops : target.health;
      const applied = Math.min(health, damage.damage(id)),
        shares = effectiveDamageShares(applied, list);
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
  fight(aircraft: Aircraft[]): void {
    this.rebuild("combat");
    const { tick, squads } = this.world,
      damage = new DamageLedger(),
      contributions: Contributions = new Map();
    for (const squad of squads
      .filter((s) => s.embarkedOn === null)
      .sort((a, b) => a.id - b.id)) {
      const definition = this.definition(squad),
        profile = definition.attack;
      this.world.updateSquad(squad.id, { fighting: false });
      this.world.updateSquad(squad.id, { combatTargetId: null });
      if (squad.refit) continue;
      if (squad.charge?.phase === "committed") {
        const charge = definition.charge!;
        this.spatial.query(
          squad.x,
          squad.y,
          charge.radius + FIXED,
          this.nearby,
        );
        const targets = this.nearby.filter(
          (s) =>
            this.diplomacy.hostile(squad.playerId, s.playerId) &&
            this.distance(squad, s) <= (charge.radius + FIXED / 2) ** 2 &&
            this.forts.clear(squad, s, squad.playerId),
        );
        if (
          targets.length ||
          this.distance(squad, squad.charge) <= FIXED ** 2 ||
          tick - squad.charge.committedTick > 80
        ) {
          let remaining = charge.damage * 4;
          for (const target of targets
            .sort((a, b) => a.id - b.id)
            .slice(0, 8)) {
            const hit = Math.min(
              remaining,
              damageAmount(
                {
                  ...profile,
                  channel: "melee",
                  damage: charge.damage,
                  penetration: charge.penetration,
                },
                defenceOf(this.definition(target), this.cover(target)),
                squad.troops,
                squad.xp,
              ),
            );
            damage.add(target.id, squad.playerId, hit);
            this.contribution(contributions, target.id, squad.id, hit);
            remaining -= hit;
          }
          this.world.updateSquad(squad.id, { charge: { ...squad.charge, phase: "recovery" } });
          this.world.updateSquad(squad.id, { chargeReadyTick: tick + charge.cooldownTicks });
          this.world.updateSquad(squad.id, { order: { type: "hold" } });
          this.world.updateSquad(squad.id, { path: [] });
          this.world.updateSquad(squad.id, { queuedOrders: [] });
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
              a.health > 0 &&
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
              squad.troops,
              squad.xp,
            ),
          );
          target.health -= hit;
          this.world.updateSquad(squad.id, { xp: Math.min(20000, (squad.xp ?? 0) + hit) });
          this.volley(squad, target);
          this.world.updateSquad(squad.id, { lastAttackTick: tick });
          this.world.updateSquad(squad.id, { nextAttackTick: tick + attackInterval(profile, squad.moved) });
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
      this.spatial.query(
        squad.x,
        squad.y,
        profile.range,
        this.nearby,
        squad.playerId,
      );
      const eligible = (s: Squad) =>
        this.diplomacy.hostile(squad.playerId, s.playerId) &&
        profile.targets.some((tag) => this.definition(s).tags.includes(tag)) &&
        this.distance(squad, s) <= profile.range ** 2 &&
        this.forts.clear(squad, s, squad.playerId);
      let target: Squad | undefined;
      let nearest = Infinity;
      for (const candidate of this.nearby) {
        const distance = this.distance(squad, candidate);
        if (distance > nearest || (distance === nearest && target && candidate.id >= target.id)) continue;
        if (!eligible(candidate)) continue;
        target = candidate;
        nearest = distance;
      }
      if (squad.order.type === "attack") {
        const wanted = this.world.squad(squad.order.targetId);
        if (wanted && eligible(wanted)) target = wanted;
      }
      if (!target) continue;
      this.world.updateSquad(squad.id, { fighting: true });
      this.world.updateSquad(squad.id, { combatTargetId: target.id });
      this.world.updateSquad(squad.id, { lastCombatTick: tick });
      this.world.updateSquad(target.id, { lastCombatTick: tick });
      if (tick < (squad.nextAttackTick ?? 0)) continue;
      this.world.updateSquad(squad.id, { lastAttackTick: tick });
      this.world.updateSquad(squad.id, { nextAttackTick: tick + attackInterval(profile, squad.moved) });
      if (profile.projectile) {
        const weapon = scaledAttack(profile, 1000, 1000, squad.xp);
        this.fire(
          {
            ...squad,
            attackScale: attackStrength(squad.troops, 1000),
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
      if (profile.channel === "ranged") this.volley(squad, target);
      const hit = damageAmount(
        profile,
        defenceOf(this.definition(target), this.cover(target)),
        squad.troops,
        squad.xp,
      );
      damage.add(target.id, squad.playerId, hit);
      this.contribution(contributions, target.id, squad.id, hit);
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
        if (!this.spatial.mayContain(p.x, p.y, GUN_NEST_ATTACK.range, b.playerId)) {
          this.telemetry.emptyNestSkips++;
          continue;
        }
        this.telemetry.nestSearches++;
        this.spatial.query(p.x, p.y, GUN_NEST_ATTACK.range, this.nearby);
        const target = this.nearby
          .filter(
            (s) =>
              this.diplomacy.hostile(b.playerId, s.playerId) &&
              this.distance(p, s) <= GUN_NEST_ATTACK.range ** 2 &&
              this.forts.clear(p, s, b.playerId),
          )
          .sort(
            (a, c) => this.distance(p, a) - this.distance(p, c) || a.id - c.id,
          )[0];
        if (target) {
          const hit = damageAmount(
            GUN_NEST_ATTACK,
            defenceOf(this.definition(target), this.cover(target)),
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
      profile.range, squad.playerId, this.mapWidth, this.forts);
    if (!p) return;
    this.world.updateSquad(squad.id, { fighting: true });
    this.world.updateSquad(squad.id, { lastCombatTick: this.world.tick });
    if (this.world.tick < (squad.nextAttackTick ?? 0)) return;
    this.world.updateSquad(squad.id, { lastAttackTick: this.world.tick });
    this.world.updateSquad(squad.id, { nextAttackTick: this.world.tick + attackInterval(profile, squad.moved) });
    if (profile.projectile) {
      const weapon = scaledAttack(profile, 1000, 1000, squad.xp);
      this.fire(
        { ...squad, attackScale: attackStrength(squad.troops, 1000) },
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
    if (profile.channel === "ranged") this.volley(squad, p);
    let hit = damageAmount(
      profile,
      {
        ...STRUCTURE_DEFENCE,
        tags: "tile" in target ? ["structure"] : ["structure", "wall"],
      },
      squad.troops,
      squad.xp,
    );
    if (!("tile" in target) && this.diplomacy.state.betrayal[target.playerId])
      hit *= 2;
    this.structuralHit(target, squad.playerId, squad.id, hit);
  }
  advanceProjectiles(): void {
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
        damageAmount(attack, defence, 1000, 0, 1000, p.attackScale);
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
        this.spatial.query(
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
                ("troops" in s ? this.definition(s).tags : ["ship"]).includes(
                  tag,
                ),
              ),
          )
          .map((s) => {
            const t = circleSweepEntry(
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
              ? defenceOf(this.definition(directHit), this.cover(directHit))
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
      this.spatial.query(p.x, p.y, radius, this.nearby);
      this.naval.query(p.x, p.y, radius, this.nearbyShips);
      this.structures.query(p.x, p.y, radius, this.nearbyStructures);
      if (p.kind === "icbm" || p.kind === "warhead") {
        // Nuclear effects are per victim, independent of conventional armour,
        // shared damage budgets, or the ordinary 64-target splash envelope.
        const inside = (s: {playerId:number;x:number;y:number}) => this.diplomacy.hostile(s.playerId,p.playerId) && this.distance(s,p)<=radius**2;
        for (const target of this.nearby.filter(inside).sort((a,b)=>a.id-b.id)) {
          impacts.add(target.id,p.playerId,target.troops);
          this.contribution(contributions,target.id,p.sourceId,target.troops,p.sourceKind);
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
        for (const wall of this.forts.nearbyBarriers(p.x,p.y,radius)) if (this.diplomacy.hostile(wall.playerId,p.playerId)) {
          const distance=Math.min(...wall.tiles.map(tile=>Math.hypot(((tile%this.mapWidth)+0.5)*FIXED-p.x,(Math.floor(tile/this.mapWidth)+0.5)*FIXED-p.y)));
          if (distance<=radius) this.structuralHit(wall,p.playerId,p.sourceId,structuralDamage(wall.maxHealth,distance),p.sourceKind);
        }
        this.world.nuclearBlast?.(p.x,p.y,radius);
        continue;
      }
      let budget =
        (p.damage + Object.values(p.bonuses).reduce((sum, n) => sum + n, 0)) *
        4;
      const eligible = (s: { playerId: number; x: number; y: number }) =>
        this.diplomacy.hostile(s.playerId, p.playerId) &&
        this.distance(s, p) <= radius ** 2 &&
        (p.kind !== "shell" || this.forts.clear(p, s, p.playerId));
      for (const target of this.nearby
        .filter(eligible)
        .sort((a, b) => a.id - b.id)
        .slice(0, 64)) {
        const hit = Math.min(
          budget,
          hitDamage(
            scaled(target),
            defenceOf(this.definition(target), this.cover(target)),
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
        .slice(0, 64)) {
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
            this.diplomacy.hostile(b.playerId, p.playerId) &&
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
          this.diplomacy.hostile(wall.playerId, p.playerId) &&
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
