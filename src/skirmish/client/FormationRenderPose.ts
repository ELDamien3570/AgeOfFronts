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
  for (const poly of pose.footprints)
    for (const p of poly) {
      const dx = p.x - pose.root.x,
        dy = p.y - pose.root.y,
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
