import type { GameMap } from "../../core/game/GameMap";
import type { MatchOptions, SpawnState } from "../Protocol";
import { SpawnSelection } from "../domain/SpawnSelection";

/** Read-only setup presentation; only the worker/coordinator accepts a choice. */
export class SpawnSelectionViewModel {
  state: SpawnState;
  hoverTile: number | null = null;
  private receivedAt: number;
  private readonly rules: SpawnSelection;
  constructor(
    map: GameMap,
    options: MatchOptions,
    state: SpawnState,
    readonly playerId: number,
    now: number,
  ) {
    this.rules = new SpawnSelection(map, options);
    this.state = state;
    this.receivedAt = now;
  }
  update(state: SpawnState, now: number): void {
    this.state = state;
    this.receivedAt = now;
  }
  seconds(now: number): number {
    return Math.ceil(
      Math.max(0, this.state.remainingMs - (now - this.receivedAt)) / 1000,
    );
  }
  get chosenTile(): number | undefined {
    return this.state.reservations.find(
      (choice) => choice.playerId === this.playerId,
    )?.tile;
  }
  rejection(tile: number): string | null {
    return this.rules.rejection(this.playerId, tile, this.state.reservations);
  }
  hint(now: number): string {
    return `${this.seconds(now)}s · ${this.chosenTile === undefined ? "Click viable land on any landmass to choose your spawn. No choice: random spawn." : "Spawn reserved. Click another viable spot to change it."} AI and tribes deploy when the countdown ends.`;
  }
}
