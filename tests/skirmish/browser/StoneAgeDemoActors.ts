import { TroopActors, type TroopActorOptions } from "../../../src/skirmish/client/troops/TroopActors";
import { DEMO_TROOPS } from "./DemoTroops";
import { demoActorMemberScale } from "./DemoActorCalibration";
export type { TroopActorDefinition, TroopActorOptions } from "../../../src/skirmish/client/troops/TroopActors";
export class StoneAgeDemoActors extends TroopActors {
  constructor(clock: () => number = () => performance.now(), options?: TroopActorOptions) {
    const troops = DEMO_TROOPS.map(t => ({ ...t, memberScale: demoActorMemberScale(t.name) }));
    super(clock, options ?? { troops, byDefinitionId: new Map(troops.map(t => [`demo-russian-${t.age.toLowerCase()}-${t.name.toLowerCase()}`, t])) });
  }
}
