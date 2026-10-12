import { GameMapImpl } from "../../../src/core/game/GameMap";
import { FIXED, type Squad } from "../../../src/skirmish/Protocol";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { TECHNOLOGIES } from "../../../src/skirmish/content/Technology";
import { UNIT } from "../../../src/skirmish/content/Units";
import {
  createFormation,
  TURN,
} from "../../../src/skirmish/domain/FormationGeometry";
import { createManpower } from "../../../src/skirmish/domain/Manpower";
export function trenchLineScene(skirmish = false) {
  const cells = new Uint8Array(64 * 64).fill(133),
    map = new GameMapImpl(64, 64, cells, cells.length);
  const game = new Skirmish(map, {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
    startingAge: "Modern",
    deferredPlanning: true,
  });
  const e = game.expansion!,
    template = structuredClone(game.squads[0]);
  for (const s of [...game.squads]) game.removeSquad(s.id);
  for (const b of [...game.buildings]) game.removeBuilding(b.id);
  for (const p of game.players) {
    p.base = map.ref(32, p.id === 2 ? 8 : 56);
    p.gold = 500000;
    e.progression.states[p.id].completed = TECHNOLOGIES.map((t) => t.id);
  }
  for (let tile = 0; tile < cells.length; tile++)
    game.owners[tile] = map.y(tile) <= 32 ? 2 : 1;
  const add = (id: string, owner: number, x: number, y: number): Squad => {
    const unit = UNIT.get(id)!;
    if (!unit) throw Error("Unknown fixture unit " + id);
    return game.addSquad({
      ...template,
      id: game.allocateId(),
      playerId: owner,
      definitionId: id,
      kind: unit.line,
      troops: unit.formationRecipe!.capacity,
      manpower: createManpower(unit),
      formation: { ...createFormation(id), facing: owner === 2 ? TURN / 2 : 0 },
      x: Math.round(x * FIXED),
      y: Math.round(y * FIXED),
      order: { type: "hold" },
      path: [],
      queuedOrders: [],
      charge: null,
      combatTargetId: null,
      weaponState: undefined,
    });
  };
  const defenders = [
    add("modern-infantry", 2, 29.5, 28.5),
    add("modern-infantry", 2, 34.5, 28.5),
  ];
  const riders = [
    add("latemedieval-infantry", 1, 29.5, 43.5),
    add("latemedieval-infantry", 1, 34.5, 43.5),
  ];
  if (!skirmish) {
    const a = game.addBuilding({
      id: game.allocateId(),
      playerId: 2,
      type: "trench",
      tile: map.ref(24, 32),
      age: "Modern",
      health: 50000,
      maxHealth: 50000,
      remainingTicks: 0,
    });
    const b = game.addBuilding({
      id: game.allocateId(),
      playerId: 2,
      type: "trench",
      tile: map.ref(41, 32),
      age: "Modern",
      health: 50000,
      maxHealth: 50000,
      remainingTicks: 0,
    });
    e.fortifications.addBarrier({
      a: a.id,
      b: b.id,
      id: game.allocateId(),
      kind: "trench",
      playerId: 2,
      age: "Modern",
      tiles: Array.from({ length: 16 }, (_, i) => map.ref(25 + i, 32)),
      health: 50000,
      maxHealth: 50000,
      remainingTicks: 0,
    });
  }
  let launched = false;
  const launch = () => {
    if (launched) return;
    launched = true;
    if (skirmish) {
      for (const s of defenders)
        game.applyCommand({
          type: "stance",
          playerId: 2,
          squadIds: [s.id],
          stance: "skirmish",
        });
    } else
      game.applyCommand({
        type: "occupy",
        playerId: 2,
        squadIds: defenders.map((s) => s.id),
        tile: map.ref(30, 32),
      });
    for (let i = 0; i < riders.length; i++)
      game.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [riders[i].id],
        order: { type: "attack", targetId: defenders[i].id },
      });
  };
  return { game, defenders, riders, launch, add };
}
