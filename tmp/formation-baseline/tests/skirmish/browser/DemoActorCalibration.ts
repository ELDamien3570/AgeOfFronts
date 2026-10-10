import type { DemoTroopName } from "./DemoTroops";

/** Manual first-idle-frame upper-body span audit; excludes weapons, shields and mounts.
 * Approximate visual registration, not alpha-bound fitting or skeletal measurement.
 * Keep one correction across all poses and formations. Clubman's size is unchanged.
 */
export const DEMO_BODY_WIDTH_PIXELS: Record<DemoTroopName, number> = {
  Clubman: 340,
  Javelinist: 330,
  Scout: 160,
  ShieldWarrior: 300,
  Pikeman: 220,
  RecurveArcher: 260,
  LightCavalry: 164,
  HorseArcher: 168,
};
export const CLUBMAN_MEMBER_SCALE = 0.24;
export const demoActorSizeCorrection = (name: DemoTroopName) =>
  DEMO_BODY_WIDTH_PIXELS.Clubman / DEMO_BODY_WIDTH_PIXELS[name];
export const demoActorMemberScale = (name: DemoTroopName) =>
  CLUBMAN_MEMBER_SCALE * demoActorSizeCorrection(name);
