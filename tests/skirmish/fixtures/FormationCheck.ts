import { validateFormation } from "../../../src/skirmish/domain/FormationGeometry";
import type { Skirmish } from "../../../src/skirmish/Simulation";

/** Every live squad formation must pass the validator that restore and the
 * client decode run (R2-M11). Returns the failures, empty when all are valid. */
export function invalidFormations(game: Skirmish): string[] {
  const failures: string[] = [];
  for (const s of game.squads) {
    if (!s.formation) continue;
    try {
      validateFormation(s.formation, s.definitionId, s.troops);
    } catch (error) {
      failures.push(`tick ${game.tick} squad ${s.id} ${s.definitionId}: ${(error as Error).message} ${JSON.stringify({ shape: s.formation.shape, deployedShape: s.formation.deployedShape, preferredFrontage: s.formation.preferredFrontage, frontage: s.formation.frontage })}`);
    }
  }
  return failures;
}
/** Step up to `ticks` times and collect formation failures at every tick boundary. */
export function stepValidated(game: Skirmish, ticks: number, until?: () => boolean): string[] {
  const failures: string[] = [];
  for (let i = 0; i < ticks; i++) {
    game.step();
    failures.push(...invalidFormations(game));
    if (until?.()) break;
  }
  return failures;
}
