import { GameMapImpl } from "../../../src/core/game/GameMap";
import { FIXED } from "../../../src/skirmish/Protocol";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { UNIT } from "../../../src/skirmish/content/Units";
import {
  createFormation,
  TURN,
} from "../../../src/skirmish/domain/FormationGeometry";
import { createManpower } from "../../../src/skirmish/domain/Manpower";
export function transportScene(count = 72, research = true, island = false, seed = 47) {
  const size = 160,
    terrain = new Uint8Array(size * size).fill(133);
  for (let y = 0; y < size; y++)
    for (let x = 80; x < 96; x++) terrain[y * size + x] = 0;
  if(island)for(let y=0;y<size;y++)for(let x=80;x<size;x++)terrain[y*size+x]=x>=96&&x<99&&y>=63&&y<66?133:0;
  const map = new GameMapImpl(
    size,
    size,
    terrain,
    terrain.filter((v) => v & 128).length,
  );
  const options = {
    seed,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1" as const,
    deferredPlanning: true,
  };
  const game = new Skirmish(map, options),
    s = game.squads.find((s) => s.playerId === 1)!;
  for (const other of [...game.squads])
    if (other.id !== s.id) game.removeSquad(other.id);
  const state = game.expansion!.progression.states[1];
  state.completed = research ? ["rus-stoneage-cargo-canoes"] : [];
  state.research = {};
  const id =
      count === 12
        ? "stoneage-infantry"
        : count === 96
          ? "latemedieval-infantry"
          : "napoleonic-infantry",
    u = UNIT.get(id)!;
  game.updateSquad(s.id, {
    definitionId: id,
    kind: u.line,
    troops: count,
    manpower: createManpower(
      u,
      count > u.formationRecipe!.capacity ? "enlarged" : "base",
    ),
    formation: {
      ...createFormation(id),
      facing: (3 * TURN) / 4,
      layoutTroops: count,
    },
    x: 64.5 * FIXED,
    y: 64.5 * FIXED,
    order: { type: "hold" },
    path: [],
  });
  return { game, s: game.squad(s.id)!, map, terrain, size, options };
}
