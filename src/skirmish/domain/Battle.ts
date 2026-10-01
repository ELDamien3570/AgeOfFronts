import { DamageLedger } from "../Conquest";
import { GUN_NEST_ATTACK, TRENCH_COVER } from "../content/Defences";
import { UNIT, defaultUnit } from "../content/Units";
import type { ArcherVolley, Building, Player, Ship, Squad } from "../Protocol";
import { FIXED } from "../Protocol";
import { SpatialGrid } from "../SpatialGrid";
import {
  attackInterval,
  damageAmount,
  defenceOf,
  effectiveDamageShares,
  scaledAttack,
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
export interface BattleWorld {
  tick: number;
  squads: Squad[];
  players: Player[];
  buildings: Building[];
  ships: Ship[];
  volleys: ArcherVolley[];
  allocateId(): number;
  resolveLandDamage(damage: DamageLedger): void;
  resolveNavalDamage(damage: DamageLedger): void;
  recordMilitaryLosses(
    victims: { id: number; playerId: number }[],
    damage: DamageLedger,
  ): void;
}
type Position = { x: number; y: number };
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
  readonly projectiles: Projectile[] = [];
  private readonly spatial: SpatialGrid<Squad>;
  private readonly naval: SpatialGrid<Ship>;
  private readonly structures: SpatialGrid<Building & Position>;
  private readonly nearby: Squad[] = [];
  private readonly nearbyShips: Ship[] = [];
  private readonly nearbyStructures: (Building & Position)[] = [];
  private readonly structureById = new Map<number, Building>();
  private readonly covered = new Set<number>();
  private readonly definitions = new Map<
    string,
    { revision: number; unit: UnitDefinition }
  >();
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
    this.spatial = new SpatialGrid(
      width * FIXED,
      height * FIXED,
      4 * FIXED,
      (s) => s.playerId,
    );
    this.naval = new SpatialGrid(
      width * FIXED,
      height * FIXED,
      4 * FIXED,
      (s) => s.playerId,
    );
    this.structures = new SpatialGrid(
      width * FIXED,
      height * FIXED,
      4 * FIXED,
      (b) => b.playerId,
    );
  }
  setWidth(width: number): void {
    this.mapWidth = width;
  }
  definition(s: Squad): UnitDefinition {
    const base = UNIT.get(s.definitionId ?? "") ?? defaultUnit(s.kind),
      key = `${s.playerId}:${base.id}`,
      research = this.progression.states[s.playerId]?.completed ?? [],
      cached = this.definitions.get(key);
    if (cached?.revision === research.length) return cached.unit;
    const unit = unitEffects(base, research);
    this.definitions.set(key, { revision: research.length, unit });
    return unit;
  }
  position(b: Building): Position {
    return {
      x: ((b.tile % this.mapWidth) + 0.5) * FIXED,
      y: (Math.floor(b.tile / this.mapWidth) + 0.5) * FIXED,
    };
  }
  private distance(a: Position, b: Position): number {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  }
  private rebuild(): void {
    this.spatial.rebuild(
      this.world.squads.filter((s) => s.embarkedOn === null),
    );
    this.naval.rebuild(this.world.ships);
    this.structureById.clear();
    for (const b of this.world.buildings) this.structureById.set(b.id, b);
    this.structures.rebuild(
      this.world.buildings
        .filter((b) => (b.health ?? 1) > 0)
        .map((b) => ({ ...b, ...this.position(b) })),
    );
    this.covered.clear();
    for (const b of this.world.buildings)
      if (b.type === "trench" && !b.remainingTicks && (b.health ?? 1) > 0) {
        const p = this.position(b);
        this.spatial.query(p.x, p.y, FIXED, this.nearby);
        for (const s of this.nearby
          .filter(
            (s) =>
              s.playerId === b.playerId &&
              this.definition(s).tags.includes("infantry") &&
              this.distance(s, p) <= TRENCH_COVER.radius ** 2,
          )
          .sort((a, b) => a.id - b.id)
          .slice(0, TRENCH_COVER.slots))
          this.covered.add(s.id);
      }
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
      originTile?: number;
    },
    target: Position,
    profile: AttackProfile,
    damage: number,
    kind: Projectile["kind"] = "shell",
    flightTicks?: number,
    warheads = 0,
    definitionId?: string,
  ): boolean {
    if (this.projectiles.length >= 4096) return false;
    this.projectiles.push({
      id: this.world.allocateId(),
      playerId: source.playerId,
      sourceId: source.id,
      sourceKind: source.domain ?? "squad",
      definitionId,
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
  private scaled(s: Squad, profile: AttackProfile): AttackProfile {
    return scaledAttack(profile, s.troops, 1000, s.xp);
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
  awardDamage(damage: DamageLedger, contributions: Contributions): void {
    const byId = new Map<number, Squad | Ship>(
      [...this.world.squads, ...this.world.ships].map((s) => [s.id, s]),
    );
    const sources = new Map<string, Squad | Ship>([
      ...this.world.squads.map((s) => [`squad:${s.id}`, s] as const),
      ...this.world.ships.map((s) => [`ship:${s.id}`, s] as const),
    ]);
    for (const [id, list] of contributions) {
      const target = byId.get(id);
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
        const s = sources.get(attacker);
        if (s) s.xp = Math.min(20000, (s.xp ?? 0) + xp);
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
    target.health = (target.health ?? target.maxHealth ?? 1200) - applied;
    const s =
      kind === "squad"
        ? this.world.squads.find(
            (s) => s.id === source && s.playerId === attacker,
          )
        : kind === "ship"
          ? this.world.ships.find(
              (s) => s.id === source && s.playerId === attacker,
            )
          : undefined;
    if (s)
      s.xp = Math.min(
        20000,
        (s.xp ?? 0) + applied + (target.health <= 0 ? 50 : 0),
      );
    if (target.health <= 0) {
      const ledger = new DamageLedger();
      ledger.add(target.id, attacker, applied);
      this.world.recordMilitaryLosses([target], ledger);
    }
  }
  fight(aircraft: Aircraft[]): void {
    this.rebuild();
    const { tick, squads } = this.world,
      damage = new DamageLedger(),
      contributions: Contributions = new Map(),
      byId = new Map(squads.map((s) => [s.id, s]));
    for (const squad of squads
      .filter((s) => s.embarkedOn === null)
      .sort((a, b) => a.id - b.id)) {
      const definition = this.definition(squad),
        profile = definition.attack;
      squad.fighting = false;
      squad.combatTargetId = null;
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
          squad.charge.phase = "recovery";
          squad.chargeReadyTick = tick + charge.cooldownTicks;
          squad.order = { type: "hold" };
          squad.path = [];
          squad.queuedOrders = [];
        }
        continue;
      }
      if (squad.charge?.phase === "recovery") {
        if (
          tick >=
          (squad.chargeReadyTick ?? 0) - (definition.charge!.cooldownTicks - 10)
        )
          squad.charge = null;
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
          squad.xp = Math.min(20000, (squad.xp ?? 0) + hit);
          squad.lastAttackTick = tick;
          squad.nextAttackTick = tick + attackInterval(profile, squad.moved);
          squad.fighting = true;
          squad.lastCombatTick = tick;
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
      let target = this.nearby
        .filter(eligible)
        .sort(
          (a, b) =>
            this.distance(squad, a) - this.distance(squad, b) || a.id - b.id,
        )[0];
      if (squad.order.type === "attack") {
        const wanted = byId.get(squad.order.targetId);
        if (wanted && eligible(wanted)) target = wanted;
      }
      if (!target) continue;
      squad.fighting = true;
      squad.combatTargetId = target.id;
      squad.lastCombatTick = tick;
      target.lastCombatTick = tick;
      if (tick < (squad.nextAttackTick ?? 0)) continue;
      squad.lastAttackTick = tick;
      squad.nextAttackTick = tick + attackInterval(profile, squad.moved);
      if (profile.projectile) {
        const scaled = this.scaled(squad, profile);
        this.fire(squad, target, scaled, scaled.damage);
        continue;
      }
      if (profile.channel === "ranged" && this.world.volleys.length < 4096)
        this.world.volleys.push({
          id: this.world.allocateId(),
          tick,
          squadId: squad.id,
          playerId: squad.playerId,
          fromX: squad.x,
          fromY: squad.y,
          toX: target.x,
          toY: target.y,
        });
      const hit = damageAmount(
        profile,
        defenceOf(this.definition(target), this.cover(target)),
        squad.troops,
        squad.xp,
      );
      damage.add(target.id, squad.playerId, hit);
      this.contribution(contributions, target.id, squad.id, hit);
      squad.firingCharge = 0;
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
          b.nextAttackTick = tick + GUN_NEST_ATTACK.reloadTicks;
        }
      }
    this.awardDamage(damage, contributions);
    this.world.resolveLandDamage(damage);
  }
  private attackStructure(squad: Squad, profile: AttackProfile): void {
    const target =
      squad.structureTarget!.buildingId !== undefined
        ? this.world.buildings.find(
            (b) => b.id === squad.structureTarget!.buildingId,
          )
        : this.forts.barriers.find(
            (w) => w.id === squad.structureTarget!.barrierId,
          );
    if (
      !target ||
      !this.diplomacy.hostile(squad.playerId, target.playerId) ||
      (target.health ?? 1) <= 0
    ) {
      squad.structureTarget = null;
      return;
    }
    const tile =
      "tile" in target
        ? target.tile
        : target.tiles.slice().sort(
            (a, b) =>
              this.distance(squad, {
                x: ((a % this.mapWidth) + 0.5) * FIXED,
                y: (Math.floor(a / this.mapWidth) + 0.5) * FIXED,
              }) -
              this.distance(squad, {
                x: ((b % this.mapWidth) + 0.5) * FIXED,
                y: (Math.floor(b / this.mapWidth) + 0.5) * FIXED,
              }),
          )[0];
    const p = {
      x: ((tile % this.mapWidth) + 0.5) * FIXED,
      y: (Math.floor(tile / this.mapWidth) + 0.5) * FIXED,
    };
    if (
      this.distance(squad, p) > profile.range ** 2 ||
      this.forts
        .segmentTiles(squad, p)
        .some((t) => t !== tile && this.forts.blocked(t, squad.playerId))
    )
      return;
    squad.fighting = true;
    squad.lastCombatTick = this.world.tick;
    if (this.world.tick < (squad.nextAttackTick ?? 0)) return;
    squad.lastAttackTick = this.world.tick;
    squad.nextAttackTick =
      this.world.tick + attackInterval(profile, squad.moved);
    if (profile.projectile) {
      const scaled = this.scaled(squad, profile);
      this.fire(squad, p, scaled, scaled.damage);
      return;
    }
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
    this.rebuild();
    const { tick } = this.world,
      impacts = new DamageLedger(),
      naval = new DamageLedger(),
      contributions: Contributions = new Map();
    for (const p of [...this.projectiles].sort((a, b) => a.id - b.id)) {
      if (p.impacted) continue;
      const progress = Math.min(1, (tick - p.tick) / (p.impactTick - p.tick)),
        old = { x: p.x, y: p.y };
      p.x = Math.round(p.fromX + (p.toX - p.fromX) * progress);
      p.y = Math.round(p.fromY + (p.toY - p.fromY) * progress);
      if (["icbm", "mirv", "warhead"].includes(p.kind)) {
        const interceptor = this.world.buildings
          .filter(
            (b) =>
              b.type === "missile-defence" &&
              !b.remainingTicks &&
              (b.health ?? 1) > 0 &&
              this.diplomacy.hostile(b.playerId, p.playerId) &&
              this.distance(this.position(b), p) <= (14 * FIXED) ** 2 &&
              tick >= (b.nextAttackTick ?? 0),
          )
          .sort((a, b) => a.id - b.id)[0];
        if (interceptor) {
          interceptor.nextAttackTick = tick + 60;
          p.impacted = true;
          p.impactAt = tick;
          p.damage = 0;
          continue;
        }
      }
      if (p.kind === "mirv" && progress >= 0.5) {
        p.impacted = true;
        p.impactAt = tick;
        for (let i = 0; i < p.warheads; i++) {
          const angle = (i * Math.PI * 2) / p.warheads;
          this.fire(
            {
              id: p.sourceId,
              playerId: p.playerId,
              x: p.x,
              y: p.y,
              domain: p.sourceKind,
            },
            {
              x: p.toX + Math.round(Math.cos(angle) * FIXED * 2),
              y: p.toY + Math.round(Math.sin(angle) * FIXED * 2),
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
            this.forts.barriers.find(
              (b) =>
                b.tiles.includes(wall.tile) &&
                b.health > 0 &&
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
          const hit = damageAmount(
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
          let hit = damageAmount(
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
          damageAmount(
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
          damageAmount(scaled(target), {
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
          damageAmount(scaled(this.position(b)), STRUCTURE_DEFENCE),
        );
        this.structuralHit(b, p.playerId, p.sourceId, hit, p.sourceKind);
        budget -= hit;
      }
      for (const wall of this.forts.barriers)
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
            damageAmount(profile, {
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
