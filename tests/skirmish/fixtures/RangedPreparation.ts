import type { Skirmish } from "../../../src/skirmish/Simulation";
import type { Aircraft } from "../../../src/skirmish/domain/Definitions";

/** Finish an already announced aim while keeping geometry fixed for combat
 * contract tests. Every intervening tick still revalidates the real attack. */
export function finishRangedPreparation(
  game: Skirmish,
  squadId: number,
  aircraft: Aircraft[] = [],
): void {
  const action = game.squad(squadId)?.weaponState?.rangedAction;
  if (!action || action.phase !== "preparing")
    throw new Error("Expected a ranged preparation");
  while (game.tick < action.releaseTick) {
    game.tick++;
    game.expansion!.battle.fight(aircraft);
  }
}
