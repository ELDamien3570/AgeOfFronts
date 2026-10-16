import { FIXED, type Squad } from "../Protocol";
import {
  formationFootprints,
  polygonContact,
} from "../domain/FormationContact";
import { formationEnvelope, formationSlots } from "../domain/FormationGeometry";
export interface FormationRenderPose {
  root: { x: number; y: number };
  tick: number;
  geometry: ReturnType<typeof formationEnvelope>;
  slots: ReturnType<typeof formationSlots>;
  bounds: { left: number; right: number; top: number; bottom: number };
  anchors: { front: { x: number; y: number }; rear: { x: number; y: number } };
  liveSlots?: readonly {
    id: number;
    x: number;
    y: number;
    scale: number;
    angle: number;
  }[];
  lodValid: boolean;
  footprints: readonly (readonly { x: number; y: number }[])[];
  /** Footprints relative to `root`, when the pose came from FormationPoseMemo. */
  relativeFootprints?: readonly (readonly { x: number; y: number }[])[];
}
/** Root and tick are shared by labels, selection, anchors and detailed actors. */
export function formationRenderPose(
  squad: Pick<
    Squad,
    | "id"
    | "troops"
    | "manpower"
    | "formation"
    | "definitionId"
    | "charge"
    | "kind"
    | "x"
    | "y"
  >,
  tick: number,
  root = { x: squad.x / FIXED, y: squad.y / FIXED },
  visualAngle?: number,
): FormationRenderPose {
  const canonical = formationEnvelope(squad, tick),
    angle = visualAngle ?? canonical.angle,
    geometry = {
      ...canonical,
      angle,
      halfX:
        Math.abs(Math.cos(angle - canonical.angle)) * canonical.halfX +
        Math.abs(Math.sin(angle - canonical.angle)) * canonical.halfY,
      halfY:
        Math.abs(Math.sin(angle - canonical.angle)) * canonical.halfX +
        Math.abs(Math.cos(angle - canonical.angle)) * canonical.halfY,
    },
    reach = geometry.depth / (2 * FIXED);
  const slots = formationSlots(squad, tick),
    tail = slots[slots.length - 1];
  const reformFront =
    squad.formation?.transition?.from === "column"
      ? slots.reduce(
          (front, slot) => (slot.y > front.y ? slot : front),
          slots[0],
        )
      : undefined;
  const footprints = formationFootprints(squad, tick).map((poly) =>
    poly.map((p) => ({
      x:
        root.x +
        ((p.x - squad.x) * Math.cos(angle - canonical.angle) -
          (p.y - squad.y) * Math.sin(angle - canonical.angle)) /
          FIXED,
      y:
        root.y +
        ((p.x - squad.x) * Math.sin(angle - canonical.angle) +
          (p.y - squad.y) * Math.cos(angle - canonical.angle)) /
          FIXED,
    })),
  );
  const bounds = {
    left: Infinity,
    right: -Infinity,
    top: Infinity,
    bottom: -Infinity,
  };
  for (const poly of footprints)
    for (const p of poly) {
      bounds.left = Math.min(bounds.left, p.x);
      bounds.right = Math.max(bounds.right, p.x);
      bounds.top = Math.min(bounds.top, p.y);
      bounds.bottom = Math.max(bounds.bottom, p.y);
    }
  if (!Number.isFinite(bounds.left))
    Object.assign(bounds, {
      left: root.x - geometry.halfX / FIXED,
      right: root.x + geometry.halfX / FIXED,
      top: root.y - geometry.halfY / FIXED,
      bottom: root.y + geometry.halfY / FIXED,
    });
  return {
    root,
    tick,
    geometry,
    slots,
    footprints,
    bounds,
    anchors: {
      front: {
        x:
          geometry.shape === "column"
            ? root.x
            : reformFront
              ? root.x +
                (reformFront.x * Math.cos(angle) -
                  reformFront.y * Math.sin(angle)) /
                  FIXED
              : root.x - Math.sin(angle) * reach,
        y:
          geometry.shape === "column"
            ? root.y
            : reformFront
              ? root.y +
                (reformFront.x * Math.sin(angle) +
                  reformFront.y * Math.cos(angle)) /
                  FIXED
              : root.y + Math.cos(angle) * reach,
      },
      rear: {
        x:
          geometry.shape === "column"
            ? root.x +
              (tail.x * Math.cos(angle) - tail.y * Math.sin(angle)) / FIXED
            : root.x + Math.sin(angle) * reach,
        y:
          geometry.shape === "column"
            ? root.y +
              (tail.x * Math.sin(angle) + tail.y * Math.cos(angle)) / FIXED
            : root.y - Math.cos(angle) * reach,
      },
    },
    lodValid: true,
  };
}
export function formationPoseContains(
  pose: FormationRenderPose,
  point: { x: number; y: number },
): boolean {
  if (pose.geometry.shape === "column" || pose.footprints.length > 1)
    return pose.footprints.some(
      (poly) => polygonContact([point], poly).gap <= 0.35,
    );
  const dx = point.x - pose.root.x,
    dy = point.y - pose.root.y,
    c = Math.cos(pose.geometry.angle),
    s = Math.sin(pose.geometry.angle);
  return (
    Math.abs(dx * c + dy * s) <= pose.geometry.width / (2 * FIXED) + 0.35 &&
    Math.abs(-dx * s + dy * c) <= pose.geometry.depth / (2 * FIXED) + 0.35
  );
}
/** Oriented strategic pad follows actual current polygons, including a column's
 * trailing body and moving reforms. No screen-size floor changes the footprint. */
export function strategicFormationBox(
  pose: FormationRenderPose,
  scale: number,
) {
  const c = Math.cos(pose.geometry.angle),
    s = Math.sin(pose.geometry.angle);
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  // A memoised pose keeps root-relative footprints: no per-frame translation.
  const relative = pose.relativeFootprints,
    ox = relative ? 0 : pose.root.x,
    oy = relative ? 0 : pose.root.y;
  for (const poly of relative ?? pose.footprints)
    for (const p of poly) {
      const dx = p.x - ox,
        dy = p.y - oy,
        x = dx * c + dy * s,
        y = -dx * s + dy * c;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  if (!Number.isFinite(left)) {
    left = -pose.geometry.width / (2 * FIXED);
    right = -left;
    top = -pose.geometry.depth / (2 * FIXED);
    bottom = -top;
  }
  const x = (left + right) / 2,
    y = (top + bottom) / 2;
  return {
    x: pose.root.x + x * c - y * s,
    y: pose.root.y + x * s + y * c,
    width: (right - left) * scale,
    height: (bottom - top) * scale,
    angle: pose.geometry.angle,
  };
}
type PoseSquad = Parameters<typeof formationRenderPose>[0];
interface PoseMemoEntry {
  formation: PoseSquad["formation"];
  troops: number;
  manpower: PoseSquad["manpower"];
  definitionId: PoseSquad["definitionId"];
  charge: PoseSquad["charge"];
  kind: PoseSquad["kind"];
  time: number;
  broadRadius?: number;
  local?: FormationRenderPose;
}
const translate = (p: { x: number; y: number }, root: { x: number; y: number }) => ({ x: p.x + root.x, y: p.y + root.y });
/** U4 (R2-P9): per-squad memo of the formation pose. A pose depends on the
 * root only by translation, so the memo stores the pose computed at root
 * (0, 0) and translates it per frame. It is keyed on the inputs of
 * formationRenderPose by identity (formation, manpower and charge records are
 * immutable domain values) and, like formationEnvelope, on the tick only
 * during a formation transition. Interpolated presentation objects reuse the
 * formation record, so a moving squad keeps its entry. */
export class FormationPoseMemo {
  private readonly entries = new Map<number, PoseMemoEntry>();
  readonly diagnostics = { hits: 0, misses: 0 };
  private entry(squad: PoseSquad, tick: number): PoseMemoEntry {
    const time = squad.formation?.transition ? tick : 0;
    const old = this.entries.get(squad.id);
    if (old && old.formation === squad.formation && old.troops === squad.troops && old.manpower === squad.manpower &&
      old.definitionId === squad.definitionId && old.charge === squad.charge && old.kind === squad.kind && old.time === time) {
      this.diagnostics.hits++;
      return old;
    }
    this.diagnostics.misses++;
    const entry: PoseMemoEntry = { formation: squad.formation, troops: squad.troops, manpower: squad.manpower,
      definitionId: squad.definitionId, charge: squad.charge, kind: squad.kind, time };
    this.entries.set(squad.id, entry);
    return entry;
  }
  /** Pre-cull radius without building the pose. */
  broadRadius(squad: PoseSquad, tick: number): number {
    const entry = this.entry(squad, tick);
    return entry.broadRadius ??= entry.local?.geometry.broadRadius ?? formationEnvelope(squad, tick).broadRadius;
  }
  pose(squad: PoseSquad, tick: number, root = { x: squad.x / FIXED, y: squad.y / FIXED }): FormationRenderPose {
    const entry = this.entry(squad, tick);
    const local = entry.local ??= formationRenderPose(squad, tick, { x: 0, y: 0 });
    let footprints: FormationRenderPose["footprints"] | undefined;
    // A fresh object per call: consumers attach per-frame liveSlots to it.
    return {
      root,
      tick,
      geometry: local.geometry,
      slots: local.slots,
      get footprints() { return footprints ??= local.footprints.map(poly => poly.map(p => translate(p, root))); },
      relativeFootprints: local.footprints,
      bounds: { left: local.bounds.left + root.x, right: local.bounds.right + root.x, top: local.bounds.top + root.y, bottom: local.bounds.bottom + root.y },
      anchors: { front: translate(local.anchors.front, root), rear: translate(local.anchors.rear, root) },
      lodValid: local.lodValid,
    };
  }
  /** Drop squads that left the presented snapshot. */
  retain(ids: Iterable<number>): void {
    const keep = new Set(ids);
    for (const id of this.entries.keys()) if (!keep.has(id)) this.entries.delete(id);
  }
  get size(): number { return this.entries.size; }
}
export function strategicFormationContains(
  box: ReturnType<typeof strategicFormationBox>,
  point: { x: number; y: number },
  scale: number,
) {
  const dx = (point.x - box.x) * scale,
    dy = (point.y - box.y) * scale,
    c = Math.cos(box.angle),
    s = Math.sin(box.angle);
  return (
    Math.abs(dx * c + dy * s) <= box.width / 2 &&
    Math.abs(-dx * s + dy * c) <= box.height / 2
  );
}
