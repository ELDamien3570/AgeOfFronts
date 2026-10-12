import type { Squad } from "../Protocol";
import type { Army } from "./Definitions";
export type Controller = "domain" | "player" | "army" | "stance" | "none";
export interface ControlWorld {
  armyOf(id: number): Army | undefined;
  directArmyAction?(id: number): boolean;
  human?(playerId: number): boolean;
  stance?(id: number): boolean;
}
/** Manual army attacks are army orders; external direct actions suspend coordination. */
export function controllerOf(world: ControlWorld, squad: Squad): Controller {
  if (
    squad.occupancy && squad.occupancy.phase!=="leaving" ||
    squad.troops <= 0 ||
    squad.embarkedOn !== null ||
    squad.afloat ||
    squad.refit ||
    squad.manpower?.enlargement ||
    squad.cavalryEngagement?.phase === "penetrating" ||
    squad.cavalryEngagement?.phase === "withdrawing" ||
    squad.charge?.phase === "preparing" ||
    squad.charge?.phase === "committed" ||
    squad.structureTarget
  )
    return "domain";
  const army = world.armyOf(squad.id);
  if (army && world.directArmyAction?.(army.id)) return "player";
  if(world.stance?.(squad.id))return "stance";
  if (army) return "army";
  if (world.human?.(squad.playerId)) return "player";
  if (world.stance?.(squad.id)) return "stance";
  return "none";
}
export function mayWrite(
  world: ControlWorld,
  squad: Squad,
  writer: "player" | "army" | "stance",
): boolean {
  const owner = controllerOf(world, squad);
  return (
    owner === writer ||
    owner === "none" ||
    (writer === "player" && owner !== "domain")
  );
}

/** Army navigation supplies destinations while the transport domain retains
 * hull state, shoreline handoff and physical movement. Other domain locks still
 * suspend coordination, and combat writers continue to use mayWrite. */
export function mayNavigateArmy(world: ControlWorld, squad: Squad): boolean {
  return mayWrite(world, squad.afloat ? { ...squad, afloat: null } : squad, "army");
}
