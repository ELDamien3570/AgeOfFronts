import { describe, expect, it } from 'vitest';
import { GameMapImpl } from '../../src/core/game/GameMap';
import { LocalAvoidance } from '../../src/skirmish/LocalAvoidance';
import { FIXED, type Squad } from '../../src/skirmish/Protocol';
import { SpatialGrid } from '../../src/skirmish/SpatialGrid';

describe('root trajectory broad phase', () => {
  it.each(['formations', 'legacy', 'mixed'] as const)(
    'matches exhaustive hostile queries through movement and cancellation (%s)', mode => {
      const terrain = new Uint8Array(96 * 64).fill(133);
      const map = new GameMapImpl(96, 64, terrain, terrain.length);
      const initial = Array.from({ length: 48 }, (_, i) => ({
        id: i + 1, playerId: i % 4 + 1, x: 35 * FIXED + i % 8 * 90,
        y: 27 * FIXED + Math.floor(i / 8) * 90, kind: i % 3 ? 'infantry' : 'cavalry',
        troops: 48, embarkedOn: null, order: { type: i % 5 ? 'move' : 'hold', tile: 2700 },
        ...(mode === 'formations' || mode === 'mixed' && i % 2 ?
          { formation: { shape: 'mass', facing: 0, mode: 'deployed', revision: 0 } } : {}),
        ...(mode === 'mixed' && i % 7 === 0 ? { afloat: {} } : {}),
      } as Squad));
      const run = (exhaustive: boolean) => {
        const squads = structuredClone(initial), solver = new LocalAvoidance(map);
        const grid = new SpatialGrid<Squad>(96 * FIXED, 64 * FIXED, 2 * FIXED, s => s.playerId);
        if (exhaustive) {
          const query = grid.query.bind(grid);
          grid.query = (x, y, _radius, result, excluded) => query(x, y, 200 * FIXED, result, excluded);
        }
        return { squads, solver, grid };
      };
      const bounded = run(false), reference = run(true);
      for (let tick = 0; tick < 60; tick++) {
        for (const { squads, solver, grid } of [bounded, reference]) {
          if(tick===20) {
            const removed=squads.splice(5,1)[0];
            squads.unshift({...removed,id:49});
          }
          if(tick===40)solver.restore(solver.checkpoint());
          grid.rebuild(squads);
          const intents = squads.filter(s => s.order.type !== 'hold').map(s => ({
            squad: s, goal: { x: s.x + (s.id % 2 ? 600 : -600), y: s.y + (s.id % 3 - 1) * 250 },
            speed: 80, preferredVelocity: { x: s.id % 2 ? 70 : -70, y: (s.id % 3 - 1) * 30 },
          }));
          solver.step(squads, intents, grid, (id, changes) => Object.assign(squads.find(s=>s.id===id)!, changes), tick);
        }
        expect(bounded.squads).toEqual(reference.squads);
        expect(bounded.solver.checkpoint()).toEqual(reference.solver.checkpoint());
      }
    },
  );
});
