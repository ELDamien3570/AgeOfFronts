import type { Snapshot } from "../Protocol";
import type { Age } from "../domain/Definitions";

export interface WallTile {
  tile: number;
  age: Age;
  playerId: number;
  mask: number;
  constructing: boolean;
  gate: boolean;
}
// Read-only topology for the wall layer. Parallel adjacent runs do not become
// connected merely because their tiles happen to touch.
export class WallPresentation {
  constructor(private readonly kind: "wall" | "trench" = "wall") {}
  tiles: readonly WallTile[] = [];
  private revision = -1;
  private width = 0;
  reset(): void {
    this.revision = -1;
    this.tiles = [];
  }
  update(snapshot: Snapshot): void {
    const expansion = snapshot.expansion;
    if (!expansion) {
      this.reset();
      return;
    }
    if (
      this.revision === expansion.fortificationRevision &&
      this.width === snapshot.width
    )
      return;
    this.revision = expansion.fortificationRevision;
    this.width = snapshot.width;
    const towers = new Map(
      snapshot.buildings
        .filter((b) => b.type === (this.kind === "wall" ? "tower" : "trench"))
        .map((b) => [b.id, b]),
    );
    const nodes = new Map<string, WallTile>();
    for (const wall of expansion.barriers) {
      if (wall.health <= 0 || (wall.kind ?? "wall") !== this.kind) continue;
      const node = (tile: number) => {
        const key = `${wall.playerId}:${wall.age}:${tile}`;
        let value = nodes.get(key);
        if (!value)
          nodes.set(
            key,
            (value = {
              tile,
              age: wall.age,
              playerId: wall.playerId,
              mask: 0,
              constructing: wall.remainingTicks > 0,
              gate: false,
            }),
          );
        value.constructing ||= wall.remainingTicks > 0;
        return value;
      };
      // towerPlan stores the run starting beside tower b, ending beside a.
      const from = towers.get(wall.b),
        to = towers.get(wall.a);
      const path = [
        ...(from ? [from.tile] : []),
        ...wall.tiles,
        ...(to ? [to.tile] : []),
      ];
      for (const tile of path) node(tile);
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1],
          b = path[i],
          dx = (b % snapshot.width) - (a % snapshot.width),
          dy = Math.floor(b / snapshot.width) - Math.floor(a / snapshot.width);
        if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
        const bit = dx === 1 ? 2 : dx === -1 ? 8 : dy === 1 ? 4 : 1;
        const reverse = dx === 1 ? 8 : dx === -1 ? 2 : dy === 1 ? 1 : 4;
        node(a).mask |= bit;
        node(b).mask |= reverse;
      }
      // A long run gets one automatic cosmetic gate on a straight cell.
      if (this.kind === "wall" && wall.tiles.length >= 5) {
        const centre = (wall.tiles.length - 1) / 2;
        const candidates = wall.tiles
          .map((tile, i) => ({
            value: node(tile),
            distance: Math.abs(i - centre),
          }))
          .filter(({ value }) => value.mask === 5 || value.mask === 10)
          .sort(
            (a, b) => a.distance - b.distance || a.value.tile - b.value.tile,
          );
        if (candidates[0]) candidates[0].value.gate = true;
      }
    }
    this.tiles = [...nodes.values()];
  }
}
