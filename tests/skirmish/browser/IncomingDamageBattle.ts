import { compareSoldierDrawOrder, soldierDrawKey } from "../../../src/skirmish/client/SoldierDrawOrder";
import footLayout from "../../../Art/Cultures/Russians/FormationLayouts/Clubman.json";
import rangedLayout from "../../../Art/Cultures/Russians/FormationLayouts/Javelinist.json";
import mountedLayout from "../../../Art/Cultures/Russians/FormationLayouts/MountedSpearman.json";
import { FormationSoldierMotion } from "../../../src/skirmish/client/FormationSoldierMotion";
import { TroopChoreography } from "../../../src/skirmish/client/troops/TroopChoreography";
import { actorFormationSlots } from "../../../src/skirmish/client/troops/TroopPacking";
import audit from "./FormationScaleAudit.json";
import { AIM_TARGET_RADIUS, predictiveAim } from "./RangedAim";

export type BattleUnit = (typeof audit.rows)[number];
type Point = { x: number; y: number };
type Member = Point & {
  id: number;
  localId: number;
  hp: number;
  angle: number;
  nextAttack: number;
  attackAt: number;
  deadAt?: number;
  target?: number;
  moving?: boolean;
  desiredAngle?: number;
  vx?: number;
  vy?: number;
  corpseHits?: Hit[];
};
type Formation = Point & {
  id: string;
  drawId: number;
  side: number;
  ranged: boolean;
  row: BattleUnit;
  angle: number;
  members: Member[];
  motion: TroopChoreography;
  walkers: FormationSoldierMotion;
  depth: number;
  target?: string;
};
type Shot = {
  from: Point;
  to: Point;
  start: number;
  duration: number;
  kind: string;
  victim: Member;
  attacker: Member;
  row: BattleUnit;
  side: number;
  launched?: boolean;
  damage: number;
  index: number;
};
type Hit = {
  member: Member;
  from: Point;
  point: Point;
  at: number;
  kind: string;
  index: number;
  bodyAngle: number;
};
export type BattleHooks = {
  groundElevationAt?: (point: Point) => number;
  clip(row: BattleUnit, id: string): { duration: number; release: number };
  draw(
    row: BattleUnit,
    member: Point & { id: number },
    angle: number,
    pose: string,
    age: number,
    scale?: number,
  ): void;
  muzzle(
    row: BattleUnit,
    member: Point & { id: number; target?: number },
    angle: number,
    age: number,
  ): Point;
  blood(point: Point, age: number, seed: number): void;
  impact(
    kind: string,
    point: Point,
    from: Point,
    age: number,
    index: number,
    memberId: number,
    corpse?: boolean,
    underlay?: boolean,
  ): void;
  projectile(kind: string, from: Point, to: Point, progress: number): void;
  groundProjectile(kind: string, point: Point, from: Point, age: number): void;
  inspect(
    id: string,
    row: BattleUnit,
    points: Point[],
    hp: number,
    count: number,
  ): void;
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const alive = (f: Formation) => f.members.filter((m) => m.deadAt === undefined);
function approach(p: Point, goal: Point, step: number) {
  const d = distance(p, goal);
  if (d <= step) {
    p.x = goal.x;
    p.y = goal.y;
  } else {
    p.x += ((goal.x - p.x) * step) / d;
    p.y += ((goal.y - p.y) * step) / d;
  }
}
function turn(angle: number, goal: number, step: number) {
  const delta = Math.atan2(Math.sin(goal - angle), Math.cos(goal - angle));
  return angle + Math.max(-step, Math.min(step, delta));
}

/** Deterministic, local visual encounter. Never connected to gameplay/network state. */
export class IncomingDamageBattle {
  private formations: Formation[] = [];
  private shots: Shot[] = [];
  private hits: Hit[] = [];
  private missed: { kind: string; point: Point; from: Point; at: number }[] =
    [];
  private signature = "";
  private previous = -1;
  private remainder = 0;
  private time = 0;
  private nextId = 0;
  private retargets = 0;
  private impacts = 0;
  private shotSequence = 0;
  private rangedHits = 0;
  private rangedResolved = 0;
  constructor(private hooks: BattleHooks) {}

  private start(rows: [BattleUnit, BattleUnit, BattleUnit], signature: string) {
    this.signature = signature;
    this.time = 0;
    this.remainder = 0;
    this.shots = [];
    this.hits = [];
    this.missed = [];
    this.formations = [];
    this.nextId = 0;
    this.retargets = 0;
    this.impacts = 0;
    this.shotSequence = 0;
    this.rangedHits = 0;
    this.rangedResolved = 0;
    for (let side = 0; side < 2; side++) {
      const angle = side ? Math.PI / 2 : -Math.PI / 2;
      for (let i = 0; i < 5; i++) {
        const ranged = i >= 3,
          row = ranged ? rows[2] : rows[side];
        const x = ranged ? (side ? 1010 : 190) : side ? 840 : 360;
        const y = ranged ? 275 + (i - 3) * 185 : 210 + i * 170;
        const mounted = row.actor!.members === 6;
        const slots = actorFormationSlots(
          mounted ? mountedLayout : ranged ? rangedLayout : footLayout,
          mounted,
          "line",
          row.scale!.proposedScale,
          row.actor!,
        );
        const motion = new TroopChoreography(slots, side * 5 + i, 0);
        const extent = 64 * audit.reference.footprint;
        const points = motion.soldiers(0).map((p) => ({
          x: x + (p.x * Math.cos(angle) - p.y * Math.sin(angle)) * extent,
          y: y + (p.x * Math.sin(angle) + p.y * Math.cos(angle)) * extent,
          localId: p.id,
        }));
        this.formations.push({
          id: `battle:${side}:${i}`,
          drawId: this.formations.length + 1,
          side,
          ranged,
          row,
          x,
          y,
          angle,
          motion,
          walkers: new FormationSoldierMotion(side * 5 + i),
          depth:
            Math.max(...slots.map((p) => Math.abs(p.y))) * extent +
            row.scale!.proposedScale *
              extent *
              (mounted
                ? ((row.scale as { horseLengthPx128?: number })
                    .horseLengthPx128 ?? 90) / 256
                : 0.25),
          members: points.map((p, index) => ({
            ...p,
            id: this.nextId++,
            localId: p.localId,
            hp: 30 + ((index + i + side) % 4) * 3,
            angle,
            nextAttack: 700 + i * 170 + index * 23,
            attackAt: -10000,
          })),
        });
      }
    }
  }
  private strike(
    member: Member,
    from: Point,
    kind: string,
    damage: number,
    index: number,
  ) {
    if (member.deadAt !== undefined || member.hp <= 0) return;
    member.hp = Math.max(0, member.hp - damage);
    this.impacts++;
    const point = { x: member.x + Math.sin(index * 7.1) * 4, y: member.y + 5 };
    this.hits.push({
      member,
      from: { ...from },
      point,
      at: this.time,
      kind,
      index,
      bodyAngle: member.angle,
    });
    // HP requests a casualty; runtime choreography controls the visible fall.
    // Keep cosmetic history bounded even during long previews.
    if (this.hits.length > 512) this.hits.shift();
  }
  private present(f: Formation, advance: boolean) {
    if (advance) {
      const pending = f.members.find(
        (m) => m.hp <= 0 && m.deadAt === undefined,
      );
      f.motion.advance(
        this.time,
        f.members.filter((m) => m.hp > 0).length,
        pending ? { angle: 0, front: new Set([pending.localId]) } : undefined,
      );
    }
    const poses = f.motion.soldiers(this.time),
      ids = new Set(poses.map((p) => p.id));
    const positions = advance
      ? []
      : f.walkers.sample(
          this.time,
          { x: f.x / 64, y: f.y / 64 },
          f.angle,
          poses.map((p) => ({
            ...p,
            angle:
              (f.members.find((m) => m.localId === p.id)?.desiredAngle ??
                f.angle) - f.angle,
          })),
          {
            footprint: audit.reference.footprint,
            mounted: f.row.actor!.members === 6,
            engaged: !!f.target,
            combatFootwork: true,
            carrierRelative: true,
            reformInPlace: true,
          },
        );
    for (const m of f.members) {
      if (m.deadAt !== undefined) continue;
      if (!ids.has(m.localId)) {
        m.deadAt = this.time;
        m.corpseHits = this.hits
          .filter(
            (hit) =>
              hit.member === m &&
              this.time - hit.at < 5000 &&
              ["bow", "bolt", "javelin"].includes(hit.kind),
          )
          .slice(-4);
        continue;
      }
      if (advance) continue;
      const p = positions.find((p) => p.id === m.localId)!;
      const before = { x: m.x, y: m.y };
      m.x = p.x * 64;
      m.y = p.y * 64;
      m.angle = p.angle;
      m.vx = (m.vx ?? 0) * 0.5 + ((m.x - before.x) / 0.05) * 0.5;
      m.vy = (m.vy ?? 0) * 0.5 + ((m.y - before.y) / 0.05) * 0.5;
      m.moving = p.speed > 0.1 || distance(before, m) > 0.2;
    }
  }
  private step() {
    this.time += 50;
    const dt = 0.05;
    const reservations = new Map<number, number>();
    for (const shot of this.shots)
      if (shot.kind !== "melee" && shot.victim.hp > 0)
        reservations.set(
          shot.victim.id,
          (reservations.get(shot.victim.id) ?? 0) + 1,
        );
    for (const f of this.formations) {
      this.present(f, true);
      const members = alive(f);
      if (!members.length) continue;
      const enemies = this.formations.filter(
        (e) => e.side !== f.side && alive(e).length,
      );
      const old = enemies.find((e) => e.id === f.target);
      const target =
        old ?? enemies.sort((a, b) => distance(f, a) - distance(f, b))[0];
      if (target?.id !== f.target) {
        if (f.target) this.retargets++;
        f.target = target?.id;
      }
      if (!target) {
        this.present(f, false);
        continue;
      }
      const desiredAngle =
        Math.atan2(target.y - f.y, target.x - f.x) - Math.PI / 2;
      f.angle = turn(f.angle, desiredAngle, dt * 2.8);
      if (!f.ranged) {
        const mounted = f.row.actor!.members === 6;
        const reach = f.depth + target.depth;
        const d = distance(f, target);
        if (d > reach)
          approach(f, target, Math.min((mounted ? 65 : 48) * dt, d - reach));
      }
      this.present(f, false);
      const opponents = (
        f.ranged ? enemies.flatMap(alive) : alive(target)
      ).filter((m) => m.hp > 0);
      for (const m of members) {
        if (m.hp <= 0) continue;
        const committed =
          f.ranged && this.time < m.nextAttack
            ? opponents.find((e) => e.id === m.target)
            : undefined;
        const enemy =
          committed ??
          (f.ranged
            ? opponents.reduce<Member | undefined>((best, e) => {
                const score = (candidate: Member) =>
                  distance(m, candidate) +
                  (reservations.get(candidate.id) ?? 0) * 85 -
                  (candidate.id === m.target ? 10 : 0);
                return !best || score(e) < score(best) ? e : best;
              }, undefined)
            : (opponents.find((e) => e.id === m.target) ??
              opponents.reduce<Member | undefined>(
                (best, e) =>
                  !best || distance(m, e) < distance(m, best) ? e : best,
                undefined,
              )));
        if (!enemy) continue;
        if (m.target !== undefined && m.target !== enemy.id) this.retargets++;
        m.target = enemy.id;
        const aim = Math.atan2(enemy.y - m.y, enemy.x - m.x) - Math.PI / 2;
        m.desiredAngle = aim;
        if (this.time < m.nextAttack) continue;
        const clip = this.hooks.clip(f.row, "attack");
        if (f.ranged) {
          reservations.set(enemy.id, (reservations.get(enemy.id) ?? 0) + 1);
          m.attackAt = this.time;
          const projectile = f.row.actor!.projectile;
          const kind = f.row.actor!.key.includes("Crossbow")
            ? "bolt"
            : projectile === "arrow"
              ? "bow"
              : projectile;
          const origin = this.hooks.muzzle(f.row, m, m.angle, clip.release);
          const to = { x: enemy.x, y: enemy.y + 5 };
          this.shots.push({
            from: origin,
            to,
            start: this.time + clip.release,
            duration: Math.max(
              140,
              (distance(origin, to) / (kind === "bullet" ? 1500 : 520)) * 1000,
            ),
            kind,
            victim: enemy,
            attacker: m,
            row: f.row,
            side: f.side,
            damage: kind === "rocket" ? 12 : 6,
            index: m.id,
          });
          m.nextAttack =
            this.time +
            Math.max(
              clip.duration + 750,
              kind === "bullet" ? 2850 : kind === "rocket" ? 4100 : 2450,
            );
        } else if (
          distance(m, enemy) < (f.row.actor!.members === 6 ? 100 : 60)
        ) {
          m.attackAt = this.time;
          this.shots.push({
            from: { x: m.x, y: m.y },
            to: { x: enemy.x, y: enemy.y },
            start: this.time + Math.min(clip.release, clip.duration * 0.65),
            duration: 0,
            kind: "melee",
            victim: enemy,
            attacker: m,
            row: f.row,
            side: f.side,
            damage: 5 + (m.id % 3),
            index: m.id,
          });
          m.nextAttack = this.time + 1050 + (m.id % 5) * 65;
        }
      }
    }
    this.shots = this.shots.filter((shot) => {
      if (shot.kind !== "melee" && !shot.launched && this.time >= shot.start) {
        if (shot.attacker.deadAt !== undefined || shot.attacker.hp <= 0)
          return false;
        if (shot.victim.deadAt !== undefined || shot.victim.hp <= 0) {
          const next = this.formations
            .filter((f) => f.side !== shot.side)
            .flatMap(alive)
            .filter((m) => m.hp > 0)
            .sort(
              (a, b) => distance(shot.attacker, a) - distance(shot.attacker, b),
            )[0];
          if (!next) return false;
          shot.victim = next;
        }
        shot.from = this.hooks.muzzle(
          shot.row,
          shot.attacker,
          shot.attacker.angle,
          this.hooks.clip(shot.row, "attack").release,
        );
        const aimed = predictiveAim(
          shot.from,
          { x: shot.victim.x, y: shot.victim.y + 5 },
          { x: shot.victim.vx ?? 0, y: shot.victim.vy ?? 0 },
          shot.kind === "bullet" ? 1500 : 520,
          ++this.shotSequence,
        );
        shot.to = aimed.point;
        shot.duration = aimed.seconds * 1000;
        shot.start = this.time;
        shot.launched = true;
      }
      if (this.time < shot.start + shot.duration) return true;
      if (shot.kind === "melee") {
        if (
          shot.victim.deadAt === undefined &&
          distance(shot.victim, shot.to) < 32
        )
          this.strike(
            shot.victim,
            shot.from,
            shot.kind,
            shot.damage,
            shot.index,
          );
        return false;
      }
      this.rangedResolved++;
      // Fixed ballistic endpoint: actual observed position decides the hit, never a roll or homing correction.
      const struck = this.formations
        .filter((f) => f.side !== shot.side)
        .flatMap((f) =>
          alive(f).filter(
            (m) =>
              m.hp > 0 &&
              Math.hypot(m.x - shot.to.x, m.y + 5 - shot.to.y) <
                (f.row.actor!.members === 6 ? 18 : AIM_TARGET_RADIUS),
          ),
        )
        .sort((a, b) => distance(a, shot.to) - distance(b, shot.to))[0];
      if (struck) {
        this.strike(struck, shot.from, shot.kind, shot.damage, shot.index);
        this.rangedHits++;
      } else
        this.missed.push({
          kind: shot.kind,
          point: shot.to,
          from: shot.from,
          at: this.time,
        });
      return false;
    });
    this.hits = this.hits.filter((hit) => this.time - hit.at < 45000);
    this.missed = this.missed
      .filter((m) => this.time - m.at < 15000)
      .slice(-256);
  }
  private drawAttachment(hit: Hit, corpse: boolean, underlay = false) {
    const turn = hit.member.angle - hit.bodyAngle;
    const dx = Math.sin(hit.index * 7.1) * 4,
      dy = 5;
    const p = {
      x: hit.member.x + dx * Math.cos(turn) - dy * Math.sin(turn),
      y: hit.member.y + dx * Math.sin(turn) + dy * Math.cos(turn),
    };
    const direction =
      Math.atan2(hit.point.y - hit.from.y, hit.point.x - hit.from.x) + turn;
    const from = {
      x: p.x - Math.cos(direction) * 80,
      y: p.y - Math.sin(direction) * 80,
    };
    this.hooks.impact(
      hit.kind,
      p,
      from,
      this.time - hit.at,
      hit.index,
      hit.member.id,
      corpse,
      underlay,
    );
  }
  render(
    clock: number,
    rows: [BattleUnit, BattleUnit, BattleUnit],
    effects: boolean,
  ) {
    const signature = rows.map((r) => r.id).join(":");
    if (signature !== this.signature || clock < this.previous)
      this.start(rows, signature);
    if (this.previous >= 0 && clock >= this.previous)
      this.remainder += Math.min(250, clock - this.previous);
    this.previous = clock;
    while (this.remainder >= 50) {
      this.step();
      this.remainder -= 50;
    }
    if (effects)
      for (const hit of this.hits)
        this.hooks.blood(hit.point, this.time - hit.at, hit.index);
    if (effects)
      for (const miss of this.missed)
        this.hooks.groundProjectile(
          miss.kind,
          miss.point,
          miss.from,
          this.time - miss.at,
        );
    // Bodies stay at their death position; no fade or slot-following after death.
    for (const f of this.formations)
      for (const m of f.members) {
        if (m.deadAt === undefined || this.time - m.deadAt > 20000) continue;
        this.hooks.draw(f.row, m, m.angle, "death", this.time - m.deadAt, 1);
        if (effects)
          for (const hit of m.corpseHits ?? []) this.drawAttachment(hit, true);
      }
    // All live lodged shafts are below the entire living-soldier pass.
    if (effects)
      for (const hit of this.hits)
        if (hit.member.deadAt === undefined)
          this.drawAttachment(hit, false, true);
    const living = this.formations.flatMap(f => alive(f).map(m => ({
      f, m, elevation: this.hooks.groundElevationAt?.(m) ?? 0,
      squadId: f.drawId, soldierId: m.localId,
      drawKey: soldierDrawKey(f.drawId, m.localId),
    }))).sort(compareSoldierDrawOrder);
    for (const {f, m} of living) {
        const attackAge = this.time - m.attackAt;
        const attackDuration = this.hooks.clip(f.row, "attack").duration;
        this.hooks.draw(
          f.row,
          m,
          m.angle,
          attackAge < attackDuration ? "attack" : m.moving ? "running" : "idle",
          attackAge < attackDuration ? attackAge : this.time,
        );
    }
    for (const f of this.formations) {
      const members = alive(f);
      if (members.length)
        this.hooks.inspect(
          f.id,
          f.row,
          members,
          members.reduce((sum, m) => sum + m.hp, 0) / (f.members.length * 34.5),
          members.length,
        );
    }
    if (effects)
      for (const hit of this.hits) {
        if (hit.member.deadAt === undefined) this.drawAttachment(hit, false);
      }
    for (const shot of this.shots) {
      if (shot.kind === "melee" || !shot.launched) continue;
      const p = (this.time - shot.start) / shot.duration;
      if (p >= 0 && p < 1)
        this.hooks.projectile(shot.kind, shot.from, shot.to, p);
    }
    const sides = [0, 1].map((side) =>
      this.formations
        .filter((f) => f.side === side)
        .reduce((sum, f) => sum + alive(f).length, 0),
    );
    return {
      alive: sides,
      deaths: this.nextId - sides[0] - sides[1],
      retargets: this.retargets,
      impacts: this.impacts,
      seconds: this.time / 1000,
      rangedHits: this.rangedHits,
      rangedResolved: this.rangedResolved,
      finished: sides.some((n) => n === 0),
    };
  }
}
