import type { GameMap } from "../../core/game/GameMap";
import { FIXED, type Afloat, type Ship, type Squad } from "../Protocol";
import { damageAmount, SHIP_DEFENCE } from "./Combat";
import type { Projectile } from "./Definitions";

export type NavalPriority = "transports" | "warships";
export const DEFAULT_NAVAL_PRIORITY: NavalPriority = "transports";
export const TRANSPORT_SPEED_PERCENT = 80;
export const PASSENGER_DAMAGE_PERCENT = 50;
export type NavalTarget = Ship | Squad;
export function navalHealth(target: NavalTarget): number {
  return "troops" in target ? (target.afloat?.hull ?? 0) : target.health;
}
export function navalRank(
  target: NavalTarget,
  priority: NavalPriority,
): number {
  return "troops" in target === (priority === "transports") ? 0 : 1;
}
export function validateTransportDamage(
  afloat: Readonly<Afloat> | null | undefined,
): void {
  if (!afloat) return;
  if (
    !Number.isFinite(afloat.hull) ||
    !Number.isFinite(afloat.maxHull) ||
    afloat.maxHull <= 0 ||
    afloat.hull < 0 ||
    afloat.hull > afloat.maxHull ||
    typeof afloat.vesselId !== "string" ||
    [afloat.passengerHealth, afloat.passengerHullDamage].some(
      (v) => v !== undefined && (!Number.isFinite(v) || v < 0),
    ) ||
    (afloat.passengerHullDamage ?? 0) > afloat.maxHull ||
    (afloat.passengerHullDamage !== undefined &&
      afloat.passengerHealth === undefined)
  )
    throw new Error("Invalid transport passenger damage");
}

/** Velocity from the current authoritative route, in fixed units per tick.
 * No previous-frame cache or presentation locomotion enters naval aiming. */
export function navalVelocity(
  map: GameMap,
  target: NavalTarget,
  speed: number,
) {
  if (
    target.refit ||
    ("troops" in target
      ? target.order.type !== "move" && target.order.type !== "attack"
      : target.destination === null)
  )
    return { x: 0, y: 0 };
  for (
    let i = target.nextPathIndex;
    i < Math.min(target.path.length, target.nextPathIndex + 24);
    i++
  ) {
    const tile = target.path[i];
    const dx = (map.x(tile) + 0.5) * FIXED - target.x;
    const dy = (map.y(tile) + 0.5) * FIXED - target.y;
    const length = Math.hypot(dx, dy);
    if (length > 1)
      return { x: (dx / length) * speed, y: (dy / length) * speed };
  }
  return { x: 0, y: 0 };
}

/** Constant-velocity intercept. Failure keeps the ordinary direct aim. */
export function navalAim(
  source: { x: number; y: number },
  target: { x: number; y: number },
  velocity: { x: number; y: number },
  speed: number,
) {
  const dx = target.x - source.x,
    dy = target.y - source.y;
  const a = velocity.x ** 2 + velocity.y ** 2 - speed ** 2;
  const b = 2 * (dx * velocity.x + dy * velocity.y),
    c = dx ** 2 + dy ** 2;
  const discriminant = b * b - 4 * a * c;
  const roots =
    Math.abs(a) < 1e-9
      ? b < 0
        ? [-c / b]
        : []
      : discriminant < 0
        ? []
        : [
            (-b - Math.sqrt(discriminant)) / (2 * a),
            (-b + Math.sqrt(discriminant)) / (2 * a),
          ];
  const time = Math.min(...roots.filter((t) => t >= 0 && Number.isFinite(t)));
  if (!Number.isFinite(time) || time > 200) return { x: target.x, y: target.y };
  // Projectiles resolve on integer ticks; match their flight duration.
  const ticks = Math.max(1, Math.ceil(time));
  return {
    x: Math.round(target.x + velocity.x * ticks),
    y: Math.round(target.y + velocity.y * ticks),
  };
}

/** Rebuilt from canonical projectiles, never persisted as a second ledger. */
export function incomingNavalDamage(
  projectiles: readonly Projectile[],
  tick: number,
  targetOf: (id: number) => NavalTarget | undefined,
  velocityOf: (target: NavalTarget) => { x: number; y: number },
  hostile: (a: number, b: number) => boolean,
): Map<number, number> {
  const committed = new Map<number, number>();
  for (const p of projectiles) {
    if (
      p.navalTargetId === undefined ||
      p.impacted ||
      p.impactTick < tick ||
      p.kind !== "shell"
    )
      continue;
    const target = targetOf(p.navalTargetId);
    if (
      !target ||
      navalHealth(target) <= 0 ||
      !(p.launchUnitOwners?.includes(target.playerId)??hostile(p.playerId, target.playerId))
    )
      continue;
    const velocity = velocityOf(target),
      remaining = p.impactTick - tick;
    // A turn or stop can invalidate an earlier shot. Do not reserve a known miss.
    const separation = Math.hypot(
      target.x + velocity.x * remaining - p.toX,
      target.y + velocity.y * remaining - p.toY,
    );
    const direct = separation <= FIXED * 0.45 + p.diameter / 2;
    if (!direct && separation > p.blastRadius) continue;
    const damage = direct
      ? p.damage
      : Math.floor(p.damage * (1 - (0.5 * separation) / p.blastRadius));
    const hit = damageAmount(
      {
        channel: p.channel,
        damage,
        penetration: p.penetration,
        bonuses: p.bonuses,
        targets: p.targets ?? ["ship"],
        range: 0,
        reloadTicks: 0,
        movingReloadPercent: 100,
      },
      SHIP_DEFENCE,
      1000,
      0,
      1000,
      p.attackScale,
    );
    committed.set(target.id, (committed.get(target.id) ?? 0) + hit);
  }
  return committed;
}
