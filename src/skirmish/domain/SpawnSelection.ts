import type { GameMap } from "../../core/game/GameMap";
import { PseudoRandom } from "../../core/PseudoRandom";
import { TRIBE_BASE_RADIUS, matchTribeCount } from "../FactionRules";
import { LandPaths } from "../Pathfinding";
import type { MatchOptions, SpawnState } from "../Protocol";
import { StartingPositions } from "../StartingPositions";

export const SPAWN_SECONDS = 10;
export const CAMP_RADIUS = 6;

/** Map-backed spawn rules shared by solo setup, the coordinator and presentation. */
export class SpawnSelection {
  readonly candidates: number[] = [];
  readonly viable: Uint8Array;
  private readonly reservations = new Map<number, number>();
  readonly humanCount: number;
  constructor(
    readonly map: GameMap,
    readonly options: MatchOptions,
    paths = new LandPaths(map, false),
  ) {
    this.humanCount = options.humanNames?.length ?? 1;
    this.viable = new Uint8Array(map.width() * map.height());
    const sizes = new Map<number, number>();
    for (const component of paths.component)
      if (component) sizes.set(component, (sizes.get(component) ?? 0) + 1);
    // A 3x3 passable patch holds the three starting squads; the connected
    // landmass must also support a camp and subsequent construction.
    for (let y = CAMP_RADIUS; y < map.height() - CAMP_RADIUS; y++)
      for (let x = CAMP_RADIUS; x < map.width() - CAMP_RADIUS; x++) {
        const tile = map.ref(x, y);
        if ((sizes.get(paths.component[tile]) ?? 0) < 80) continue;
        let clear = true;
        for (let dy = -1; dy <= 1 && clear; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (!paths.walkable(map.ref(x + dx, y + dy))) {
              clear = false;
              break;
            }
        if (clear) {
          this.candidates.push(tile);
          this.viable[tile] = 1;
        }
      }
    if (!this.candidates.length)
      throw new Error("No viable land for starting camps");
    for (const choice of options.humanSpawns ?? []) {
      if (this.reservations.has(choice.playerId))
        throw new Error("Duplicate human spawn seat");
      const rejection = this.rejection(choice.playerId, choice.tile);
      if (rejection) throw new Error(rejection);
      this.reservations.set(choice.playerId, choice.tile);
    }
  }

  rejection(
    playerId: number,
    tile: number,
    reservations: readonly { playerId: number; tile: number }[] = this.choices,
  ): string | null {
    if (
      !Number.isSafeInteger(playerId) ||
      playerId < 1 ||
      playerId > this.humanCount
    )
      return "Invalid human spawn seat";
    if (!Number.isSafeInteger(tile) || !this.viable[tile])
      return "Choose viable land with room for your starting force";
    if (
      reservations.some(
        (choice) =>
          choice.playerId !== playerId &&
          this.map.euclideanDistSquared(tile, choice.tile) <
            (2 * CAMP_RADIUS + 4) ** 2,
      )
    )
      return "Choose a spawn farther from another player's reservation";
    return null;
  }

  select(playerId: number, tile: number): string | null {
    const rejection = this.rejection(playerId, tile);
    if (rejection) return rejection;
    const previous = this.reservations.get(playerId);
    this.reservations.set(playerId, tile);
    try {
      this.resolve();
    } catch {
      if (previous === undefined) this.reservations.delete(playerId);
      else this.reservations.set(playerId, previous);
      return "This choice leaves too little room for the remaining factions";
    }
    return null;
  }

  get choices(): { playerId: number; tile: number }[] {
    return [...this.reservations]
      .sort(([a], [b]) => a - b)
      .map(([playerId, tile]) => ({ playerId, tile }));
  }

  state(remainingMs: number): SpawnState {
    return {
      remainingMs: Math.max(0, remainingMs),
      reservations: this.choices,
    };
  }

  resolve(): number[] {
    let error: unknown;
    // Retry packing without moving human reservations. Each attempt is seeded,
    // so every executor constructs the same completed spawn plan.
    for (let attempt = 0; attempt < 16; attempt++) {
      const random = new PseudoRandom(
        this.options.seed + Math.imul(attempt, 104729),
      );
      const placement = new StartingPositions(
        this.map,
        this.candidates,
        random,
      );
      const bases: number[] = [];
      for (const { playerId, tile } of this.choices) {
        const rejection = this.rejection(playerId, tile);
        if (rejection) throw new Error(rejection);
        bases[playerId - 1] = tile;
        placement.add(tile, CAMP_RADIUS);
      }
      try {
        for (let i = 0; i < this.humanCount + this.options.aiCount; i++)
          bases[i] ??= placement.next(CAMP_RADIUS);
        const tribes = matchTribeCount(
          this.options,
          this.map.width(),
          this.map.height(),
        );
        for (let i = 0; i < tribes; i++)
          bases.push(placement.next(TRIBE_BASE_RADIUS));
        return bases;
      } catch (failure) {
        error = failure;
      }
    }
    throw error;
  }
}
