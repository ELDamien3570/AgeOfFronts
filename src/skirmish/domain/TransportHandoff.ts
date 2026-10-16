import { eligibleShape, frontageLayout } from "./FormationProfiles";
import type { Afloat, Squad } from "../Protocol";
import type { WorldPoint } from "../SpatialGrid";
import { deployedShape } from "./ColumnTravel";
import { remainingHealth } from "./Manpower";
import {
  createFormation,
  facingOf,
  formationDoctrine,
} from "./FormationGeometry";
export type TransportProposal = {
  kind: "ground" | "afloat" | "embark" | "land";
  changes?: Partial<Squad>;
};
/** Read-only candidate evaluation; the caller commits movement and these changes together. */
export function transportHandoff(
  s: Squad,
  end: WorldPoint,
  water: boolean,
  vessel: { id: string; health: number } | undefined,
  groundFits: (candidate: Squad) => boolean,
): TransportProposal | undefined {
  if (s.embarkedOn !== null) return undefined;
  if (water) {
    if (s.afloat) return { kind: "afloat" };
    if (!vessel || s.refit || s.manpower?.enlargement || s.charge)
      return undefined;
    const afloat: Afloat = {
      hull: vessel.health,
      maxHull: vessel.health,
      vesselId: vessel.id,
      passengerHealth: remainingHealth(s),
      passengerHullDamage: 0,
    };
    return {
      kind: "embark",
      changes: {
        afloat,
        formation: s.formation
          ? {
              ...s.formation,
              transition: undefined,
              trail: undefined,
              blocked: false,
              blockedSince: undefined,
            }
          : undefined,
      },
    };
  }
  if (!s.afloat) return { kind: "ground" };
  const old = s.formation;
  if (!old) return { kind: "land", changes: { afloat: null } };
  const intent = eligibleShape(s.troops,formationDoctrine(s.definitionId),old.shape==="column" && !old.automatic?"column":deployedShape(s)),
    facing = old.deploymentFacing ?? old.facing;
  const preferred = {
    ...createFormation(s.definitionId),
    shape: intent,
    frontage:frontageLayout(s.troops,formationDoctrine(s.definitionId),intent,old.preferredFrontage??old.frontage)?.width,
    preferredFrontage:frontageLayout(s.troops,formationDoctrine(s.definitionId),intent==="column"?old.deployedShape??formationDoctrine(s.definitionId).defaultShape:intent,old.preferredFrontage??old.frontage)?.width,
    shapeLock:old.shapeLock,
    mode: intent==="column"?"travel" as const:"deployed" as const,
    automatic:intent==="column"?false:undefined,
    facing,
    layoutTroops: s.troops,
    revision: old.revision + 1,
    // The width above is sized for the deployed shape; store that shape so the
    // validator (deployedShape ?? shape) reads the same one (R2-M11).
    deployedShape: intent==="column"?old.deployedShape??formationDoctrine(s.definitionId).defaultShape:intent,
    lastDeployTick: 0,
  };
  const candidate = { ...s, ...end, afloat: null, formation: preferred };
  if (groundFits(candidate))
    return { kind: "land", changes: { afloat: null, formation: preferred } };
  if (!formationDoctrine(s.definitionId).shapes.includes("column"))
    return undefined;
  // The tail points inland, away from the previous water position. It is a fresh
  // arrival layout, never a translated copy of the departure trail.
  const column = {
    ...preferred,
    shape: "column" as const,
    frontage:undefined,
    mode: "travel" as const,
    facing: facingOf(Math.atan2(s.y - end.y, s.x - end.x) - Math.PI / 2),
    automatic: old.shape === "column" && !old.automatic ? false : true,
    deploymentFacing: facing,
  };
  if (!groundFits({ ...candidate, formation: column })) return undefined;
  return { kind: "land", changes: { afloat: null, formation: column } };
}
