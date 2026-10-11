import { COLUMN } from "../content/TacticalRules";
import { type Squad } from "../Protocol";
import { formationDoctrine, type FormationShape } from "./FormationGeometry";

export const COLUMN_TRAVEL = COLUMN;

/** Advisory only: the simulation certifies geometry and remains the sole writer. */
export function columnDecision(
  s: Squad,
  tick: number,
  constrained: boolean,
  travel: { complete?: boolean; winding?: boolean } = {},
): "keep" | "fold" | "deploy" {
  const f = s.formation,
    d = formationDoctrine(s.definitionId);
  if (
    !f ||
    d.hull ||
    !d.shapes.includes("column") ||
    s.afloat ||
    s.embarkedOn !== null ||
    s.refit ||
    s.manpower?.enlargement ||
    s.charge ||
    f.transition ||
    (f.retryTick ?? 0) > tick
  )
    return "keep";
  const remaining = Math.max(0, s.path.length - s.nextPathIndex);
  // A deployed contact pose is stable. An automatic travel column may unfold
  // once for combat; an explicit move still owns necessary passage narrowing.
  const engaged=s.fighting || s.combatTargetId!==null;
  if(engaged && f.shape!=="column" && s.order.type!=="move")return "keep";
  if (f.autoFrontage && constrained && !travel.complete && (!engaged || s.order.type==="move"))
    return "fold";
  if (f.shape === "column" || f.autoFrontage)
    return (f.automatic || f.autoFrontage) &&
      ((travel.complete ?? (s.order.type === "hold" || remaining === 0)) || (f.shape==="column" && engaged && s.order.type!=="move"))
      ? "deploy"
      : "keep";
  if (s.fighting || s.order.type === "hold" || s.order.type === "replenish")
    return "keep";
  if (
    !constrained &&
    tick - (f.lastDeployTick ?? -COLUMN_TRAVEL.dwellTicks) <
      COLUMN_TRAVEL.dwellTicks
  )
    return "keep";
  return constrained ||
    (s.troops >= COLUMN_TRAVEL.longTravelTroops &&
      remaining >= COLUMN_TRAVEL.routeTiles &&
      travel.winding === true)
    ? "fold"
    : "keep";
}

export function deployedShape(
  s: Pick<Squad, "formation" | "definitionId">,
): FormationShape {
  const d = formationDoctrine(s.definitionId),
    f = s.formation;
  return f?.deployedShape && d.shapes.includes(f.deployedShape)
    ? f.deployedShape
    : d.defaultShape;
}
