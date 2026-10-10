import type { ArcherVolley, Snapshot } from "../Protocol";
import { FIXED } from "../Protocol";
import { UNIT } from "../content/Units";
import type { Projectile } from "../domain/Definitions";
import { ARTWORK_CATALOG } from "./ArtworkCatalog";

export type WeaponVisual =
  | "javelin"
  | "arrow"
  | "bolt"
  | "bullet"
  | "stone"
  | "shell"
  | "rocket"
  | "bomb";
export interface Point {
  x: number;
  y: number;
}
export function squadArtworkPose(
  squad: Snapshot["squads"][number],
  tick: number,
) {
  const clip = ARTWORK_CATALOG[squad.definitionId ?? ""]?.clips?.attack;
  const since = tick - (squad.lastAttackTick ?? -Infinity);
  if (UNIT.get(squad.definitionId ?? "")?.attack.channel === "ranged" && clip) {
    // Start recovery at the release pose on the authoritative shot tick; show
    // the wind-up before the next ready shot. Art never delays domain damage.
    const release = (Math.min(5, clip.frames - 1) * 20) / clip.fps;
    const recovery = (clip.frames * 20) / clip.fps - release;
    if (since >= 0 && since < recovery)
      return { clip: "attack", elapsed: release + since };
    const until = (squad.nextAttackTick ?? Infinity) - tick;
    if (squad.fighting && until > 0 && until <= release)
      return { clip: "attack", elapsed: release - until };
  } else if (since >= 0 && since < 20)
    return { clip: "attack", elapsed: since };
  return { clip: squad.moved ? "running" : "idle", elapsed: tick };
}
export function weaponVisual(id?: string): WeaponVisual {
  if (
    id === "modern-anti-air" ||
    id === "naval-air-defence" ||
    ["mirv", "icbm", "hydrogen", "mirv-warhead"].includes(id ?? "")
  )
    return "rocket";
  if (id === "modern-gun-nest") return "bullet";
  if (id === "bomb") return "bomb";
  if (id === "earlymedieval-field-support") return "bolt";
  if (
    [
      "classicalage-siege",
      "classicalage-field-support",
      "earlymedieval-siege",
    ].includes(id ?? "")
  )
    return "stone";
  const unit = UNIT.get(id ?? "");
  if (
    unit?.troopClass &&
    [
      "StoneAge",
      "BronzeAge",
      "ClassicalAge",
      "EarlyMedieval",
      "LateMedieval",
    ].includes(unit.age)
  )
    return unit.age === "LateMedieval" && unit.troopClass === "rangedInfantry"
      ? "bolt"
      : unit.age === "StoneAge" && unit.troopClass === "rangedInfantry"
        ? "javelin"
        : "arrow";
  if (unit?.attack.projectile || id?.endsWith("-warship")) return "shell";
  if (
    unit &&
    ((unit.age === "Napoleonic" && unit.attack.channel === "ranged") ||
      unit.age === "EarlyModern" ||
      unit.age === "Modern" ||
      id === "latemedieval-field-support")
  )
    return "bullet";
  if (id === "latemedieval-archer") return "bolt";
  if (!id || id === "stoneage-archer") return "javelin";
  return "arrow";
}

// Calibrated to the five weapon positions in the top-down squad sheets. Art
// uses a downward local heading; emitters rotate with the firing artwork.
export function weaponEmitters(
  from: Point,
  angle: number,
  spriteSize: number,
  style: WeaponVisual,
  single = false,
): Point[] {
  const points = single
    ? [[0, 0.3]]
    : [
        [-0.2, -0.04],
        [0.2, -0.04],
        [-0.27, 0.37],
        [0, 0.37],
        [0.27, 0.37],
      ];
  const reach = style === "arrow" ? 0.04 : style === "bullet" ? 0.08 : 0;
  return points.map(([x, y]) => ({
    x:
      from.x +
      spriteSize * (x * Math.cos(angle) - (y + reach) * Math.sin(angle)),
    y:
      from.y +
      spriteSize * (x * Math.sin(angle) + (y + reach) * Math.cos(angle)),
  }));
}

export function volleyVisual(
  volley: ArcherVolley,
  tick: number,
  from: Point,
  to: Point,
  size: number,
) {
  const style = weaponVisual(volley.definitionId),
    duration = style === "bullet" ? 4 : style === "rocket" ? 8 : 12;
  const progress = (tick - volley.tick) / duration;
  if (progress < 0 || progress >= 1) return null;
  const angle = Math.atan2(to.y - from.y, to.x - from.x) - Math.PI / 2;
  const emitters = weaponEmitters(
    from,
    angle,
    size,
    style,
    ["artillery", "anti-air"].includes(
      UNIT.get(volley.definitionId ?? "")?.role ?? "",
    ) || volley.definitionId === "modern-gun-nest",
  );
  const arc =
    style === "arrow" || style === "javelin"
      ? Math.min(18, Math.hypot(to.x - from.x, to.y - from.y) / 6)
      : 0;
  return {
    style,
    progress,
    emitters,
    points: emitters.map((start, i) => {
      const spread = (i - (emitters.length - 1) / 2) * Math.min(2, size / 20);
      const end = {
        x: to.x + Math.cos(angle) * spread,
        y: to.y + Math.sin(angle) * spread,
      };
      const x = start.x + (end.x - start.x) * progress,
        y =
          start.y +
          (end.y - start.y) * progress -
          Math.sin(Math.PI * progress) * arc;
      return {
        x,
        y,
        angle: Math.atan2(
          end.y - start.y - Math.PI * arc * Math.cos(Math.PI * progress),
          end.x - start.x,
        ),
      };
    }),
  };
}

export function shellVisual(
  projectile: Projectile,
  tick: number,
  from: Point,
  to: Point,
  size: number,
) {
  const style = weaponVisual(
    projectile.kind === "shell"
      ? (projectile.definitionId ?? "naval-warship")
      : projectile.kind === "bomb"
        ? "bomb"
        : "icbm",
  );
  const progress = Math.max(
    0,
    Math.min(
      1,
      (tick - projectile.tick) /
        Math.max(1, projectile.impactTick - projectile.tick),
    ),
  );
  const heading = Math.atan2(to.y - from.y, to.x - from.x) - Math.PI / 2;
  const start =
    projectile.sourceKind === "squad"
      ? weaponEmitters(from, heading, size, style, true)[0]
      : from;
  const lift =
    style === "stone"
      ? Math.min(32, Math.hypot(to.x - from.x, to.y - from.y) / 5)
      : 0;
  return {
    style,
    progress,
    x: start.x + (to.x - start.x) * progress,
    y:
      start.y +
      (to.y - start.y) * progress -
      Math.sin(Math.PI * progress) * lift,
    angle: Math.atan2(
      to.y - start.y - Math.PI * lift * Math.cos(Math.PI * progress),
      to.x - start.x,
    ),
  };
}

export interface TargetMarker extends Point {
  kind: "missile" | "bombing" | "siege";
}
export function combatTargets(
  snapshot: Snapshot,
  playerId = 1,
): TargetMarker[] {
  const markers = new Map<string, TargetMarker>(),
    buildings = new Map(snapshot.buildings.map((b) => [b.id, b])),
    barriers = new Map(
      (snapshot.expansion?.barriers ?? []).map((b) => [b.id, b]),
    ),
    squads = new Map(snapshot.squads.map((s) => [s.id, s]));
  const add = (kind: TargetMarker["kind"], x: number, y: number) => {
    if (markers.size < 128)
      markers.set(`${kind}:${Math.round(x / FIXED)}:${Math.round(y / FIXED)}`, {
        kind,
        x,
        y,
      });
  };
  for (const aircraft of snapshot.expansion?.aircraft ?? [])
    if (
      aircraft.playerId === playerId &&
      aircraft.state === "outbound" &&
      aircraft.target
    )
      add("bombing", aircraft.target.x, aircraft.target.y);
  for (const projectile of snapshot.expansion?.projectiles ?? [])
    if (
      projectile.playerId === playerId &&
      !projectile.impacted &&
      ["icbm", "mirv", "warhead"].includes(projectile.kind)
    )
      add("missile", projectile.toX, projectile.toY);
  for (const squad of snapshot.squads) {
    if (
      squad.playerId !== playerId ||
      !["siege", "artillery"].includes(
        UNIT.get(squad.definitionId ?? "")?.role ?? "",
      )
    )
      continue;
    const target = squad.structureTarget;
    const tile = target?.buildingId
      ? buildings.get(target.buildingId)?.tile
      : target?.barrierId
        ? barriers.get(target.barrierId)?.a
        : undefined;
    if (tile !== undefined)
      add(
        "siege",
        ((tile % snapshot.width) + 0.5) * FIXED,
        (Math.floor(tile / snapshot.width) + 0.5) * FIXED,
      );
    if (squad.order.type === "attack") {
      const enemy = squads.get(squad.order.targetId);
      if (enemy) add("siege", enemy.x, enemy.y);
    }
  }
  return [...markers.values()];
}

export function impactSize(
  artworkId: string,
  radius: number,
  scale: number,
): number {
  return artworkId === "impact-bomb"
    ? Math.max(36, (radius / FIXED) * scale * 3.6)
    : Math.max(12, (radius / FIXED) * scale * 2);
}
