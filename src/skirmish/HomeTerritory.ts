import { restoreMap } from "./StateTransfer";
import type { GameMap } from "../core/game/GameMap";

interface HomeFrontier {
  tick: number;
  baseOwned: boolean;
  tiles: number[];
}

// A bounded strategic read model of land connected to the starting camp.
// Disconnected captures never become origins for random outward exploration.
export class HomeTerritory {
  checkpoint() { return structuredClone({cache:this.cache}); }
  restore(saved: ReturnType<HomeTerritory["checkpoint"]>): void {
    const state=structuredClone(saved);
    restoreMap(this.cache,state.cache);
    this.visited.fill(0); this.stamp=0;
  }

  private readonly visited: Uint32Array;
  private stamp = 0;
  private readonly cache = new Map<number, HomeFrontier>();
  constructor(private readonly map: GameMap) {
    this.visited = new Uint32Array(map.width() * map.height());
  }
  frontier(
    playerId: number,
    base: number,
    owners: Uint8Array,
    tick: number,
  ): readonly number[] {
    const previous = this.cache.get(playerId),
      baseOwned = owners[base] === playerId;
    if (
      previous &&
      previous.baseOwned === baseOwned &&
      tick - previous.tick < 60
    )
      return previous.tiles;
    if (++this.stamp === 0xffffffff) {
      this.visited.fill(0);
      this.stamp = 1;
    }
    const queue = baseOwned ? [base] : [],
      frontier: number[] = [];
    this.visited[base] = this.stamp;
    for (let at = 0; at < queue.length; at++)
      for (const tile of this.map.neighbors(queue[at])) {
        if (this.visited[tile] === this.stamp) continue;
        this.visited[tile] = this.stamp;
        if (!this.map.isLand(tile) || this.map.isImpassable(tile)) continue;
        if (owners[tile] === playerId) queue.push(tile);
        else frontier.push(tile);
      }
    frontier.sort(
      (a, b) =>
        this.map.euclideanDistSquared(base, a) -
          this.map.euclideanDistSquared(base, b) || a - b,
    );
    this.cache.set(playerId, { tick, baseOwned, tiles: frontier });
    return frontier;
  }
  goal(
    playerId: number,
    base: number,
    current: number,
    owners: Uint8Array,
    frontier: readonly number[],
    reserved: Set<number>,
    eligible: (tile: number) => boolean = () => true,
  ): number | undefined {
    let goal: number | undefined,
      best = Infinity,
      considered = 0;
    for (const tile of frontier) {
      if (owners[tile] === playerId || reserved.has(tile) || !eligible(tile)) continue;
      // Neutral ground is preferred; nearby enemy pockets are still eligible.
      const score =
        this.map.euclideanDistSquared(base, tile) * 2 +
        this.map.euclideanDistSquared(current, tile) * 0.25 +
        (owners[tile] ? 32 : 0);
      if (score < best) {
        best = score;
        goal = tile;
      }
      if (++considered >= 128) break;
    }
    if (goal !== undefined) reserved.add(goal);
    return goal;
  }
}
