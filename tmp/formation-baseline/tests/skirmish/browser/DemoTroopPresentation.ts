import { demoActorMemberScale } from "./DemoActorCalibration";
import type { DEMO_TROOPS } from "./DemoTroops";
import {
  formationSlots,
  type FormationLayout,
  type FormationShape,
} from "./TroopPrototypeModel";
import { actorFormationSlots } from "../../../src/skirmish/client/troops/TroopPacking";
type Troop = (typeof DEMO_TROOPS)[number];

export const demoSoldierCount = (troop: Troop) => (troop.mounted ? 6 : 12);

/** Fixed actor size and width; mounted rank depth permits a clear horse-length gap. */
export function demoFormationSlots(
  layout: FormationLayout,
  troop: Troop,
  shape: FormationShape,
) {
  return actorFormationSlots(
    layout,
    troop.mounted,
    shape,
    demoActorMemberScale(troop.name),
  );
}

export { actorFormationSlots } from "../../../src/skirmish/client/troops/TroopPacking";
