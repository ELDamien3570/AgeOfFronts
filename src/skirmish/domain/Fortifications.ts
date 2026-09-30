import type { GameMap } from "../../core/game/GameMap";
import type { Building, Player } from "../Protocol";
import { FIXED } from "../Protocol";
import { AGES, type Age, type Barrier } from "./Definitions";
import type { Diplomacy } from "./Diplomacy";
export class Fortifications {
  readonly barriers: Barrier[] = [];
  version = 0;
  private readonly tileIndex = new Map<number, Barrier[]>();
  private nextId = 1;
  private towers = new Set<number>();
  private readonly repairs = new Map<
    string,
    { owner: number; remaining: number }
  >();
  constructor(
    private readonly map: GameMap,
    private readonly diplomacy: Diplomacy,
  ) {}
  get hasObstacles(): boolean {
    return !!(this.tileIndex.size || this.towers.size);
  }
  blocked(tile: number, owner: number): boolean {
    return (
      this.towers.has(tile) ||
      (this.tileIndex.get(tile) ?? []).some(
        (w) =>
          w.health > 0 &&
          !(w.gateTile === tile && this.diplomacy.allied(w.playerId, owner)),
      )
    );
  }
  private reindex(): void {
    this.tileIndex.clear();
    for (const wall of this.barriers)
      for (const tile of wall.tiles) {
        let list = this.tileIndex.get(tile);
        if (!list) this.tileIndex.set(tile, (list = []));
        list.push(wall);
      }
    this.version++;
  }
  segmentTiles(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): number[] {
    // Conservative supercover includes both side cells at exact corner crossings.
    let x = Math.floor(from.x / FIXED),
      y = Math.floor(from.y / FIXED);
    const ex = Math.floor(to.x / FIXED),
      ey = Math.floor(to.y / FIXED),
      dx = to.x - from.x,
      dy = to.y - from.y;
    const sx = Math.sign(dx),
      sy = Math.sign(dy),
      tx = dx ? Math.abs(FIXED / dx) : Infinity,
      ty = dy ? Math.abs(FIXED / dy) : Infinity;
    let nx = dx
      ? ((sx > 0 ? (x + 1) * FIXED : x * FIXED) - from.x) / dx
      : Infinity;
    let ny = dy
      ? ((sy > 0 ? (y + 1) * FIXED : y * FIXED) - from.y) / dy
      : Infinity;
    const tiles: number[] = [],
      add = (xx: number, yy: number) => {
        if (this.map.isValidCoord(xx, yy)) tiles.push(this.map.ref(xx, yy));
      };
    add(x, y);
    for (
      let i = 0;
      i < this.map.width() + this.map.height() + 2 && (x !== ex || y !== ey);
      i++
    ) {
      if (nx === ny) {
        add(x + sx, y);
        add(x, y + sy);
        x += sx;
        y += sy;
        nx += tx;
        ny += ty;
      } else if (nx < ny) {
        x += sx;
        nx += tx;
      } else {
        y += sy;
        ny += ty;
      }
      add(x, y);
    }
    return tiles;
  }
  clear(
    from: { x: number; y: number },
    to: { x: number; y: number },
    owner: number,
  ): boolean {
    if (!this.tileIndex.size && !this.towers.size) return true;
    return !this.segmentTiles(from, to).some((tile) =>
      this.blocked(tile, owner),
    );
  }
  towerPlan(
    tile: number,
    owner: number,
    age: Age,
    buildings: readonly Building[],
  ): { links: { a: number; tiles: number[] }[]; gold: number } {
    const links: { a: number; tiles: number[] }[] = [];
    const occupied = new Set(
      buildings.filter((b) => b.tile !== tile).map((b) => b.tile),
    );
    const nearby = buildings
      .filter(
        (b) =>
          b.type === "tower" &&
          b.playerId === owner &&
          !b.remainingTicks &&
          (b.age ?? "StoneAge") === age &&
          b.tile !== tile &&
          this.map.euclideanDistSquared(b.tile, tile) <= 144,
      )
      .sort(
        (a, b) =>
          this.map.euclideanDistSquared(a.tile, tile) -
            this.map.euclideanDistSquared(b.tile, tile) || a.id - b.id,
      );
    for (const other of nearby) {
      const tiles: number[] = [];
      let x = this.map.x(tile),
        y = this.map.y(tile);
      while (x !== this.map.x(other.tile)) {
        x += Math.sign(this.map.x(other.tile) - x);
        tiles.push(this.map.ref(x, y));
      }
      while (y !== this.map.y(other.tile)) {
        y += Math.sign(this.map.y(other.tile) - y);
        tiles.push(this.map.ref(x, y));
      }
      tiles.pop();
      if (
        tiles.length &&
        tiles.every(
          (t) =>
            this.map.isLand(t) &&
            !this.map.isImpassable(t) &&
            !occupied.has(t) &&
            !this.tileIndex.has(t) &&
            !links.some((l) => l.tiles.includes(t)),
        )
      )
        links.push({ a: other.id, tiles });
      if (links.length === 2) break;
    }
    return {
      links,
      gold: links.reduce(
        (sum, l) => sum + l.tiles.length * 25 * (AGES.indexOf(age) + 1),
        0,
      ),
    };
  }
  addTower(
    tower: Building,
    plan: ReturnType<Fortifications["towerPlan"]>,
  ): void {
    for (const link of plan.links) {
      const health = Math.round(
        2000 * 1.3 ** AGES.indexOf(tower.age ?? "StoneAge"),
      );
      this.barriers.push({
        id: this.nextId++,
        playerId: tower.playerId,
        age: tower.age ?? "StoneAge",
        a: link.a,
        b: tower.id,
        tiles: link.tiles,
        health,
        maxHealth: health,
        gateTile: null,
        remainingTicks: tower.remainingTicks,
      });
    }
    this.reindex();
  }
  gate(player: Player, id: number, tile: number): string | null {
    const wall = this.barriers.find((w) => w.id === id);
    if (
      !wall ||
      wall.health <= 0 ||
      wall.playerId !== player.id ||
      !wall.tiles.includes(tile) ||
      wall.remainingTicks ||
      wall.gateTile === tile
    )
      return "Choose a completed owned wall segment";
    if (player.gold < 250) return "Gate conversion needs 250 gold";
    player.gold -= 250;
    wall.gateTile = tile;
    this.reindex();
    return null;
  }
  repair(
    player: Player,
    building: Building | undefined,
    barrier: Barrier | undefined,
  ): string | null {
    const target = building ?? barrier;
    if (!target || target.playerId !== player.id || target.remainingTicks)
      return "Choose a completed owned structure";
    const missing = (target.maxHealth ?? 1200) - (target.health ?? 1200),
      key = `${building ? "b" : "w"}:${target.id}`;
    if (missing <= 0 || this.repairs.has(key))
      return "No repair needed or repair already in progress";
    const gold = Math.ceil(missing / 5);
    if (player.gold < gold) return "Not enough gold for repairs";
    player.gold -= gold;
    this.repairs.set(key, { owner: player.id, remaining: missing });
    return null;
  }
  step(tick: number, buildings: readonly Building[]): void {
    const byId = new Map(buildings.map((b) => [b.id, b]));
    let dirty = false;
    const towers = buildings
      .filter((b) => b.type === "tower" && (b.health ?? 1) > 0)
      .map((b) => b.tile);
    if (
      towers.length !== this.towers.size ||
      towers.some((t) => !this.towers.has(t))
    ) {
      this.towers = new Set(towers);
      dirty = true;
    }
    for (const wall of this.barriers) {
      const a = byId.get(wall.a),
        b = byId.get(wall.b);
      if (
        !a ||
        !b ||
        a.playerId !== wall.playerId ||
        b.playerId !== wall.playerId
      ) {
        wall.health = 0;
        dirty = true;
      }
      if (wall.remainingTicks > 0 && --wall.remainingTicks === 0) dirty = true;
    }
    if (this.barriers.some((w) => w.health <= 0)) {
      for (let i = this.barriers.length - 1; i >= 0; i--)
        if (this.barriers[i].health <= 0) this.barriers.splice(i, 1);
      dirty = true;
    }
    if (dirty) this.reindex();
    if (tick % 20) return;
    for (const [key, repair] of this.repairs) {
      const [kind, value] = key.split(":"),
        target =
          kind === "b"
            ? byId.get(Number(value))
            : this.barriers.find((w) => w.id === Number(value));
      if (!target || target.playerId !== repair.owner) {
        this.repairs.delete(key);
        continue;
      }
      const amount = Math.min(
        50,
        repair.remaining,
        (target.maxHealth ?? 1200) - (target.health ?? 1200),
      );
      target.health = (target.health ?? 1200) + amount;
      repair.remaining -= amount;
      if (repair.remaining <= 0 || amount <= 0) this.repairs.delete(key);
    }
  }
}
