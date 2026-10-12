import { GameMapImpl } from "../../../src/core/game/GameMap";
import { FIXED, type Squad } from "../../../src/skirmish/Protocol";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { UNIT } from "../../../src/skirmish/content/Units";
import { formationApproach } from "../../../src/skirmish/domain/FormationContact";
import {
  createFormation,
  TURN,
} from "../../../src/skirmish/domain/FormationGeometry";
import { createManpower } from "../../../src/skirmish/domain/Manpower";

/** Grenadiers keep an explicit rear target while defending physical contact. */
export function hybridCombatScene() {
  const cells = new Uint8Array(64 * 64).fill(133);
  const game = new Skirmish(new GameMapImpl(64, 64, cells, cells.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
    startingAge: "Napoleonic",
    deferredPlanning: true,
  });
  const template = structuredClone(game.squads[0]);
  for (const s of [...game.squads]) game.removeSquad(s.id);
  for (const b of [...game.buildings]) game.removeBuilding(b.id);
  const add = (id: string, playerId: number, x: number, y: number): Squad => {
    const unit = UNIT.get(id)!;
    return game.addSquad({
      ...template,
      id: game.allocateId(),
      playerId,
      definitionId: id,
      kind: unit.line,
      troops: unit.formationRecipe!.capacity,
      manpower: createManpower(unit),
      formation: {
        ...createFormation(id),
        facing: playerId === 1 ? 0 : TURN / 2,
      },
      x: x * FIXED,
      y: y * FIXED,
      path: [],
      queuedOrders: [],
      order: { type: "hold" },
      charge: null,
      weaponState: undefined,
      combatTargetId: null,
    });
  };
  const grenadiers = add("napoleonic-infantry", 1, 32, 36);
  const contact = add("latemedieval-infantry", 2, 32, 39);
  const rear = add("napoleonic-archer", 2, 32, 40.5);
  const p = formationApproach(contact, grenadiers, game.tick, 0);
  game.updateSquad(contact.id, { x: Math.round(p.x), y: Math.round(p.y) });
  game.updateSquad(grenadiers.id, {
    order: { type: "attack", targetId: rear.id },
  });
  return {
    game,
    grenadiers,
    contact,
    rear,
    riders: [grenadiers],
    defenders: [contact, rear],
    launch: () => {},
  };
}
