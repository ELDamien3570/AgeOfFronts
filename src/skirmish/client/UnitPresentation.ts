import type { Snapshot, SquadType } from "../Protocol";
import { FIXED, TICKS_PER_SECOND } from "../Protocol";
import {
  ARCHER_CHARGE_REQUIRED,
  ARCHER_MOVING_CHARGE,
  ARCHER_STATIONARY_CHARGE,
} from "../Rules";
import { squadRadius } from "../SquadGeometry";
import { ARTWORK_CATALOG } from "./ArtworkCatalog";
import {
  animationFrame,
  meleeLungeRatio,
  RANGED_RELEASE_FRAME,
  UNIT_ANIMATIONS,
  type AnimationClip,
  type AnimationPose,
} from "./UnitAnimation";

interface UnitState {
  x: number;
  y: number;
  embarkedOn: number | null;
  angle: number;
  attackAngle?: number;
  shotAngle?: number;
  shotTick: number;
  shotRecoveryTicks: number;
  kind: SquadType;
  clip: AnimationClip;
  startedAt: number;
  tick: number;
  charge: number;
  moved: boolean;
  engaging: boolean;
  volleyTick: number;
  lastVolleyId: number;
  targetId: number | null;
  lungeSpace: number;
}

// Art starts facing down. Keep the last observed travel heading while stopped.
// This state cannot influence movement, targeting, or combat.
export class UnitPresentation {
  private readonly units = new Map<number, UnitState>();
  private readonly ships = new Map<
    number,
    { x: number; y: number; angle: number }
  >();

  reset(): void {
    this.units.clear();
    this.ships.clear();
  }

  update(snapshot: Snapshot): void {
    const live = new Set<number>();
    const byId = new Map(snapshot.squads.map((s) => [s.id, s]));
    const buildings = new Map(snapshot.buildings.map((b) => [b.id, b]));
    const barriers = new Map(
      (snapshot.expansion?.barriers ?? []).map((b) => [b.id, b]),
    );
    const shots = new Map<
      number,
      {
        tick: number;
        id: number;
        toX: number;
        toY: number;
        fromX: number;
        fromY: number;
      }
    >();
    const observeShot = (
      id: number,
      shot: {
        tick: number;
        id: number;
        toX: number;
        toY: number;
        fromX: number;
        fromY: number;
      },
    ) => {
      const previous = shots.get(id);
      if (
        !previous ||
        shot.tick > previous.tick ||
        (shot.tick === previous.tick && shot.id > previous.id)
      )
        shots.set(id, shot);
    };
    for (const shot of snapshot.volleys) observeShot(shot.squadId, shot);
    for (const shot of snapshot.expansion?.projectiles ?? [])
      if (shot.sourceKind === "squad") observeShot(shot.sourceId, shot);
    for (const squad of snapshot.squads) {
      live.add(squad.id);
      const old = this.units.get(squad.id);
      let angle = old?.angle ?? 0;
      if (
        old &&
        old.embarkedOn === null &&
        squad.embarkedOn === null &&
        (squad.x !== old.x || squad.y !== old.y)
      )
        angle = Math.atan2(squad.y - old.y, squad.x - old.x) - Math.PI / 2;
      const candidate =
        squad.embarkedOn === null
          ? byId.get(squad.combatTargetId ?? -1)
          : undefined;
      const target = candidate?.embarkedOn === null ? candidate : undefined;
      let aim: { x: number; y: number } | undefined = target;
      const structure = squad.structureTarget;
      const building = buildings.get(structure?.buildingId ?? -1);
      const barrier = barriers.get(structure?.barrierId ?? -1);
      const point = (tile: number) => ({
        x: ((tile % snapshot.width) + 0.5) * FIXED,
        y: (Math.floor(tile / snapshot.width) + 0.5) * FIXED,
      });
      if (squad.fighting && building && (building.health ?? 1) > 0)
        aim = point(building.tile);
      else if (squad.fighting && barrier && barrier.health > 0) {
        const tile = barrier.tiles.reduce<number | undefined>(
          (nearest, tile) => {
            if (nearest === undefined) return tile;
            const a = point(tile),
              b = point(nearest);
            return (a.x - squad.x) ** 2 + (a.y - squad.y) ** 2 <
              (b.x - squad.x) ** 2 + (b.y - squad.y) ** 2
              ? tile
              : nearest;
          },
          undefined,
        );
        if (tile !== undefined) aim = point(tile);
      }
      const shot = shots.get(squad.id);
      const attackAngle =
        aim && (aim.x !== squad.x || aim.y !== squad.y)
          ? Math.atan2(aim.y - squad.y, aim.x - squad.x) - Math.PI / 2
          : old?.attackAngle;
      const attackClip =
        ARTWORK_CATALOG[squad.definitionId ?? ""]?.clips?.attack;
      if (
        aim &&
        !squad.moved &&
        squad.embarkedOn === null &&
        (aim.x !== squad.x || aim.y !== squad.y)
      )
        angle = attackAngle ?? angle;
      const clip: AnimationClip =
        target && squad.kind !== "archer"
          ? "attack"
          : squad.moved
            ? "running"
            : "idle";
      this.units.set(squad.id, {
        x: squad.x,
        y: squad.y,
        embarkedOn: squad.embarkedOn,
        angle,
        attackAngle,
        shotAngle: shot
          ? Math.atan2(shot.toY - shot.fromY, shot.toX - shot.fromX) -
            Math.PI / 2
          : old?.shotAngle,
        shotTick: shot?.tick ?? old?.shotTick ?? -Infinity,
        shotRecoveryTicks: attackClip
          ? ((attackClip.frames - Math.min(5, attackClip.frames - 1)) *
              TICKS_PER_SECOND) /
            attackClip.fps
          : 0,
        kind: squad.kind,
        clip,
        startedAt:
          clip === "attack" && squad.lastAttackTick !== undefined
            ? squad.lastAttackTick
            : old?.clip === clip &&
                (clip !== "attack" || old.targetId === target?.id)
              ? old.startedAt
              : snapshot.tick,
        tick: snapshot.tick,
        charge: squad.firingCharge,
        moved: squad.moved,
        engaging: !!target,
        volleyTick:
          squad.embarkedOn === null
            ? (old?.volleyTick ?? -Infinity)
            : -Infinity,
        lastVolleyId: old?.lastVolleyId ?? 0,
        targetId: target?.id ?? null,
        // Share the clearance between physical cores so opposing visual thrusts
        // meet at contact without passing through the target's center.
        lungeSpace:
          target && squad.kind !== "archer"
            ? Math.max(
                0,
                (Math.hypot(target.x - squad.x, target.y - squad.y) -
                  squadRadius(squad.kind) -
                  squadRadius(target.kind)) /
                  2,
              )
            : 0,
      });
    }
    for (const volley of snapshot.volleys) {
      const unit = this.units.get(volley.squadId);
      if (unit && volley.id > unit.lastVolleyId) {
        unit.lastVolleyId = volley.id;
        if (unit.embarkedOn === null) unit.volleyTick = volley.tick;
      }
    }
    for (const id of this.units.keys())
      if (!live.has(id)) this.units.delete(id);
    const liveShips = new Set<number>();
    for (const ship of snapshot.ships) {
      liveShips.add(ship.id);
      const old = this.ships.get(ship.id);
      const moved = old && (old.x !== ship.x || old.y !== ship.y);
      this.ships.set(ship.id, {
        x: ship.x,
        y: ship.y,
        // Ships and formation markers are authored facing up.
        angle: moved
          ? Math.atan2(ship.y - old.y, ship.x - old.x) + Math.PI / 2
          : (old?.angle ?? 0),
      });
    }
    for (const id of this.ships.keys())
      if (!liveShips.has(id)) this.ships.delete(id);
  }

  angle(id: number): number {
    return this.units.get(id)?.angle ?? 0;
  }

  firingAngle(id: number, tick = Infinity): number {
    const unit = this.units.get(id);
    if (
      unit?.shotAngle !== undefined &&
      tick >= unit.shotTick &&
      tick < unit.shotTick + unit.shotRecoveryTicks
    )
      return unit.shotAngle;
    return unit?.attackAngle ?? unit?.angle ?? 0;
  }

  shipAngle(id: number): number {
    return this.ships.get(id)?.angle ?? 0;
  }

  meleeLunge(id: number, tick: number, scale: number, spriteSize: number) {
    const unit = this.units.get(id);
    if (
      !unit ||
      unit.clip !== "attack" ||
      unit.moved ||
      unit.embarkedOn !== null ||
      scale <= 0 ||
      spriteSize <= 0
    )
      return { x: 0, y: 0 };
    const amount =
      spriteSize *
      meleeLungeRatio(
        unit.kind,
        tick - unit.startedAt,
        (unit.lungeSpace * scale) / FIXED / spriteSize,
      );
    return {
      x: -Math.sin(unit.angle) * amount,
      y: Math.cos(unit.angle) * amount,
    };
  }

  animation(id: number, tick: number): AnimationPose {
    const unit = this.units.get(id);
    if (!unit) return { clip: "idle", frame: 0 };
    if (unit.kind === "archer") {
      const clip = UNIT_ANIMATIONS.archer.animations.attack;
      const ticksPerFrame = TICKS_PER_SECOND / clip.suggestedFramesPerSecond;
      const sinceVolley = tick - unit.volleyTick;
      const recovery = (clip.frameCount - RANGED_RELEASE_FRAME) * ticksPerFrame;
      if (sinceVolley >= 0 && sinceVolley < recovery)
        return {
          clip: "attack",
          frame:
            RANGED_RELEASE_FRAME +
            animationFrame("archer", "attack", sinceVolley),
        };
      if (unit.engaging && unit.charge > 0) {
        const chargePerTick = unit.moved
          ? ARCHER_MOVING_CHARGE
          : ARCHER_STATIONARY_CHARGE;
        const untilVolley =
          (ARCHER_CHARGE_REQUIRED - unit.charge) / chargePerTick -
          Math.max(0, tick - unit.tick);
        const windup = RANGED_RELEASE_FRAME * ticksPerFrame;
        if (untilVolley <= windup)
          return {
            clip: "attack",
            frame: Math.min(
              RANGED_RELEASE_FRAME - 1,
              animationFrame(
                "archer",
                "attack",
                windup - Math.max(0, untilVolley),
              ),
            ),
          };
      }
    }
    return {
      clip: unit.clip,
      frame: animationFrame(
        unit.kind,
        unit.clip,
        tick - unit.startedAt,
        unit.clip === "attack",
      ),
    };
  }
}

export function visibleInViewport(
  position: { x: number; y: number },
  radius: number,
  width: number,
  height: number,
): boolean {
  return (
    position.x + radius >= 0 &&
    position.y + radius >= 0 &&
    position.x - radius <= width &&
    position.y - radius <= height
  );
}
