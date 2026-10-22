import type { MatchOptions } from "../Protocol";

/** New-match defaults shared by local and hosted skirmishes. Old replay options remain explicit. */
export const FORMATION_MOVEMENT: Pick<MatchOptions, "formationLocomotion" | "formationReorientation" | "formationFreeTravel" | "formationTravel"> = {
  formationLocomotion: true,
  formationReorientation: true,
  formationFreeTravel: true,
  formationTravel: "fixed-v1",
};
