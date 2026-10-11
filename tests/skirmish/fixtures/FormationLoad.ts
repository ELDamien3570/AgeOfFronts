import { GameMapImpl } from '../../../src/core/game/GameMap';
import { Skirmish } from '../../../src/skirmish/Simulation';
import { FIXED } from '../../../src/skirmish/Protocol';
import { UNIT } from '../../../src/skirmish/content/Units';
import { createFormation, TURN } from '../../../src/skirmish/domain/FormationGeometry';
import { createManpower } from '../../../src/skirmish/domain/Manpower';

export type FormationWorkload = 'distributed' | 'distributed-battles' | 'crowded';
/** Controlled core-simulation stress, separate from the real Mediterranean AI match.
 * Fifteen owners keep every faction below its 200-squad admission limit.
 * Crowded ranks alternate owners; all formations start with legal, non-overlapping bodies.
 * Production and AI decisions are disabled so population and engagement density are explicit.
 */
export function formationLoad(workload: FormationWorkload, count = 2000) {
  if (!Number.isInteger(count) || count < 15 || count > 2000) throw Error('Unsupported stress population');
  const width = 500, height = 250, terrain = new Uint8Array(width * height).fill(133);
  const options = { seed: 42, aiCount: 14, tribes: false, runAi: false,
    ruleset: 'ages-v1' as const, startingAge: 'Napoleonic' as const, deferredPlanning: true };
  const game = new Skirmish(new GameMapImpl(width, height, terrain, terrain.length), options);
  const templates = new Map(game.squads.map(s => [s.playerId, { ...s }]));
  for (const s of [...game.squads]) game.removeSquad(s.id);
  const unit = UNIT.get('napoleonic-infantry')!, capacity = unit.formationRecipe!.capacity;
  const columns = workload==='distributed-battles'?5:50, spacingX = 9, spacingY = workload === 'distributed' ? 5.8 : 2.8;
  for (let i = 0; i < count; i++) {
    const cluster=workload==='distributed-battles'?Math.floor(i/100):0,local=workload==='distributed-battles'?i%100:i;
    const row = Math.floor(local / columns), column = local % columns;
    const owner = (row + column + cluster*3) % 15 + 1, template = templates.get(owner);
    if (!template) throw Error(`Missing stress owner ${owner}`);
    game.addSquad({ ...template, id: game.allocateId(), definitionId: unit.id,
      kind: unit.line, troops: capacity, manpower: createManpower(unit),
      x: (12 + cluster%5*100 + column * spacingX) * FIXED, y: (8 + Math.floor(cluster/5)*60 + row * spacingY) * FIXED,
      formation: { ...createFormation(unit.id), shape: 'line',
        facing: row % 2 ? TURN / 2 : 0, layoutTroops: capacity },
      order: { type: 'hold' }, path: [], nextPathIndex: 0, queuedOrders: [],
      weaponState: undefined, charge: null, combatTargetId: null, fighting: false,
      meleeStrike: undefined, lastAttackTick: undefined, nextAttackTick: 0,
    });
  }
  return { game, terrain, options, width, height };
}
