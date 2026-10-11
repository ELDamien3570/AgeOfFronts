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
  return {
    root,
    tick,
    geometry,
    slots,
    footprints: formationFootprints(squad, tick).map((poly) =>
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
    ),
    bounds: {
      left: root.x - geometry.halfX / FIXED - 1,
      right: root.x + geometry.halfX / FIXED + 1,
      top: root.y - geometry.halfY / FIXED - 1,
      bottom: root.y + geometry.halfY / FIXED + 1,
    },
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
