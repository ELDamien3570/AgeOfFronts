import { restoreMap } from "./StateTransfer";
import type { GameMap } from "../core/game/GameMap";
import type { MovementIntent } from "./LocalAvoidance";
import type { LandPaths } from "./Pathfinding";
import { FIXED } from "./Protocol";
import type { WorldPoint } from "./SpatialGrid";
import {
  distanceSquared,
  squadRadius,
  standable,
  tilePoint,
} from "./SquadGeometry";

interface Passage {
  id: number;
  axis: number;
  low: WorldPoint;
  high: WorldPoint;
}
interface Crossing {
  passage: Passage;
  direction: number;
  entry: WorldPoint;
  exit: WorldPoint;
}
interface Ticket extends Crossing {
  intent: MovementIntent;
}

// Terrain passages own traffic priority; avoidance still owns physical movement.
// Adjacent one-cell corridor tiles share one reservation, held until fully clear.
export class PassageTraffic {
  checkpoint() { return structuredClone({leaders:this.leaders}); }
  restore(saved: ReturnType<PassageTraffic["checkpoint"]>): void {
    const state=structuredClone(saved);
    restoreMap(this.leaders,state.leaders);

  }

  private readonly tiles: (Passage | undefined)[];
  private readonly leaders = new Map<string, number>();
  private readonly routes = new WeakMap<number[], Crossing[]>();

  constructor(
    private readonly map: GameMap,
    private readonly paths: LandPaths,
  ) {
    const size = map.width() * map.height(),
      axes = new Uint8Array(size);
    this.tiles = new Array(size);
    const land = (x: number, y: number) =>
      map.isValidCoord(x, y) && paths.walkable(map.ref(x, y));
    for (let tile = 0; tile < size; tile++) {
      if (!paths.walkable(tile)) continue;
      const x = map.x(tile),
        y = map.y(tile);
      if (
        land(x - 1, y) &&
        land(x + 1, y) &&
        !land(x, y - 1) &&
        !land(x, y + 1)
      )
        axes[tile] = 1;
      else if (
        land(x, y - 1) &&
        land(x, y + 1) &&
        !land(x - 1, y) &&
        !land(x + 1, y)
      )
        axes[tile] = 2;
    }
    for (let tile = 0; tile < size; tile++) {
      if (!axes[tile] || this.tiles[tile]) continue;
      const passage: Passage = {
        id: tile,
        axis: axes[tile],
        low: tilePoint(map, tile),
        high: tilePoint(map, tile),
      };
      const pending = [tile];
      this.tiles[tile] = passage;
      for (let i = 0; i < pending.length; i++) {
        const current = pending[i],
          point = tilePoint(map, current);
        passage.low.x = Math.min(passage.low.x, point.x);
        passage.low.y = Math.min(passage.low.y, point.y);
        passage.high.x = Math.max(passage.high.x, point.x);
        passage.high.y = Math.max(passage.high.y, point.y);
        for (const next of map.neighbors(current))
          if (!this.tiles[next] && axes[next] === passage.axis) {
            this.tiles[next] = passage;
            pending.push(next);
          }
      }
    }
  }

  private crossings(path: number[]): Crossing[] {
    const cached = this.routes.get(path);
    if (cached) return cached;
    const result: Crossing[] = [],
      seen = new Set<number>();
    for (let i = 0; i < path.length; i++) {
      const passage = this.tiles[path[i]];
      if (!passage || seen.has(passage.id)) continue;
      seen.add(passage.id);
      const previous = tilePoint(this.map, path[Math.max(0, i - 1)]);
      const next = tilePoint(this.map, path[Math.min(path.length - 1, i + 1)]);
      const direction = Math.sign(
        passage.axis === 1 ? next.x - previous.x : next.y - previous.y,
      );
      if (!direction) continue;
      result.push({
        passage,
        direction,
        entry: direction > 0 ? passage.low : passage.high,
        exit: direction > 0 ? passage.high : passage.low,
      });
    }
    this.routes.set(path, result);
    return result;
  }

  coordinate(intents: MovementIntent[]): void {
    const queues = new Map<string, Ticket[]>();
    for (const intent of intents) {
      const squad = intent.squad;
      const crossing = this.crossings(squad.path).find((c) => {
        const ahead =
          c.passage.axis === 1 ? squad.x - c.exit.x : squad.y - c.exit.y;
        return ahead * c.direction < FIXED / 2 + squadRadius(squad.kind);
      });
      if (!crossing) continue;
      // Reserving distant traffic too early would force an army to retreat just
      // to join a long queue. Begin when approaching the entrance neighborhood.
      if (distanceSquared(squad, crossing.entry) > (12 * FIXED) ** 2) continue;
      const key = `${crossing.passage.id}:${squad.playerId}`;
      const queue = queues.get(key) ?? [];
      queue.push({ ...crossing, intent });
      queues.set(key, queue);
    }
    for (const id of this.leaders.keys())
      if (!queues.has(id)) this.leaders.delete(id);
    for (const [id, queue] of queues) {
      queue.sort(
        (a, b) =>
          distanceSquared(a.intent.squad, a.entry) -
            distanceSquared(b.intent.squad, b.entry) ||
          a.intent.squad.id - b.intent.squad.id,
      );
      let leader = queue.find(
        (t) => t.intent.squad.id === this.leaders.get(id),
      );
      if (!leader) {
        leader = queue[0];
        this.leaders.set(id, leader.intent.squad.id);
      }
      for (const direction of [-1, 1]) {
        let slot = 0;
        for (const ticket of queue) {
          if (ticket.direction !== direction || ticket === leader) continue;
          const depth = (2 + slot++ * 1.25) * FIXED;
          const point = {
            x:
              ticket.entry.x -
              (ticket.passage.axis === 1 ? depth * direction : 0),
            y:
              ticket.entry.y -
              (ticket.passage.axis === 2 ? depth * direction : 0),
          };
          if (
            standable(this.map, point, squadRadius(ticket.intent.squad.kind)) &&
            this.paths.connected(
              ticket.intent.squad.path[0],
              this.map.ref(
                Math.floor(point.x / FIXED),
                Math.floor(point.y / FIXED),
              ),
            )
          ) {
            ticket.intent.goal = point;
            ticket.intent.stopDistance = 0;
          }
        }
      }
    }
  }
}
