import type { GameMap } from "../../core/game/GameMap";
import type { Building, Player } from "../Protocol";
import { FIXED } from "../Protocol";
import { restoreArray, restoreMap } from "../StateTransfer";
import { AGES, type Age, type Barrier } from "./Definitions";
import type { Diplomacy } from "./Diplomacy";
import { boxSweepEntry } from "./ProjectileCollision";
const NO_BARRIERS: readonly Barrier[] = [];
// Coarse occupancy blocks let segment tests skip obstacle-free neighbourhoods.
const BLOCK_SHIFT = 3;
import { quoteTowerPlan, type TowerSiteIndex } from "./TowerPlacement";
export type { TowerSiteIndex } from "./TowerPlacement";

export class Fortifications {
  checkpoint() {
    return structuredClone({
      barriers: this.barriers,
      nextId: this.nextId,
      towers: this.towers,
      repairs: this.repairs,
      version: this.version,
    });
  }
  restore(saved: ReturnType<Fortifications["checkpoint"]>): void {
    const state = structuredClone(saved);
    restoreArray(this.barriers, state.barriers);
    this.nextId = state.nextId;
    restoreMap(this.towers, state.towers);
    restoreMap(this.repairs, state.repairs);
    this.version = state.version;
    const version = this.version;
    this.reindex();
    this.version = version;
  }

  readonly barriers: Barrier[] = [];
  version = 0;
  private readonly tileIndex = new Map<number, Barrier[]>();
  private readonly barrierIds = new Map<number, Barrier>();
  private readonly barrierOrder = new Map<number, number>();
  readonly queryDiagnostics = {nearbyTiles: 0, nearbyCandidates: 0};
  private nextId = 1;
  private towers = new Map<number, Set<number>>();
  private occupancy = new Uint8Array(0);
  private blockColumns = 0;
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
  barrier(id: number): Barrier | undefined { return this.barrierIds.get(id); }
  barriersAt(tile: number): readonly Barrier[] { return this.tileIndex.get(tile) ?? NO_BARRIERS; }
  /** Exact circle candidates in canonical barrier order. A wall touching several
   * cells is returned once; damage budgets retain their original ordering. */
  nearbyBarriers(x: number, y: number, radius: number): readonly Barrier[] {
    const found = new Map<number, Barrier>();
    const left = Math.max(0, Math.ceil((x - radius) / FIXED - 0.5));
    const right = Math.min(this.map.width() - 1, Math.floor((x + radius) / FIXED - 0.5));
    const top = Math.max(0, Math.ceil((y - radius) / FIXED - 0.5));
    const bottom = Math.min(this.map.height() - 1, Math.floor((y + radius) / FIXED - 0.5));
    for (let cy = top; cy <= bottom; cy++)
      for (let cx = left; cx <= right; cx++) {
        this.queryDiagnostics.nearbyTiles++;
        if (((cx + 0.5) * FIXED - x) ** 2 + ((cy + 0.5) * FIXED - y) ** 2 > radius ** 2) continue;
        for (const wall of this.barriersAt(this.map.ref(cx, cy))) found.set(wall.id, wall);
      }
    this.queryDiagnostics.nearbyCandidates += found.size;
    return [...found.values()].sort((a, b) => this.barrierOrder.get(a.id)! - this.barrierOrder.get(b.id)!);
  }
  intactWallAt(tile: number): boolean {
    return (this.tileIndex.get(tile) ?? NO_BARRIERS).some(w=>w.health>0);
  }
  blocked(tile: number, owner: number): boolean {
    const towerOwners = this.towers.get(tile);
    if (towerOwners)
      for (const towerOwner of towerOwners)
        if (!this.diplomacy.allied(towerOwner, owner)) return true;
    return (this.tileIndex.get(tile) ?? NO_BARRIERS).some(
      (w) => w.health > 0 && !this.diplomacy.allied(w.playerId, owner),
    );
  }
  private reindex(): void {
    this.tileIndex.clear(); this.barrierIds.clear(); this.barrierOrder.clear();
    for (let i = 0; i < this.barriers.length; i++) {
      const wall = this.barriers[i];
      this.barrierIds.set(wall.id, wall); this.barrierOrder.set(wall.id, i);
    }
    for (const wall of this.barriers)
      for (const tile of wall.tiles) {
        let list = this.tileIndex.get(tile);
        if (!list) this.tileIndex.set(tile, (list = []));
        list.push(wall);
      }
    this.rebuildOccupancy();
    this.version++;
  }
  // Conservative superset: any block holding a tower, wall tile or gate. A
  // segment whose bounding blocks are all empty cannot cross an obstacle.
  private rebuildOccupancy(): void {
    this.blockColumns = (this.map.width() >> BLOCK_SHIFT) + 1;
    const rows = (this.map.height() >> BLOCK_SHIFT) + 1;
    if (this.occupancy.length !== this.blockColumns * rows)
      this.occupancy = new Uint8Array(this.blockColumns * rows);
    else this.occupancy.fill(0);
    const mark = (tile: number) => {
      this.occupancy[
        (this.map.x(tile) >> BLOCK_SHIFT) +
          (this.map.y(tile) >> BLOCK_SHIFT) * this.blockColumns
      ] = 1;
    };
    for (const tile of this.towers.keys()) mark(tile);
    for (const tile of this.tileIndex.keys()) mark(tile);
  }
  private mayBlock(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): boolean {
    const rows = this.occupancy.length / this.blockColumns;
    const bx0 = Math.max(
        0,
        Math.floor(Math.min(from.x, to.x) / FIXED) >> BLOCK_SHIFT,
      ),
      bx1 = Math.min(
        this.blockColumns - 1,
        Math.floor(Math.max(from.x, to.x) / FIXED) >> BLOCK_SHIFT,
      ),
      by0 = Math.max(
        0,
        Math.floor(Math.min(from.y, to.y) / FIXED) >> BLOCK_SHIFT,
      ),
      by1 = Math.min(
        rows - 1,
        Math.floor(Math.max(from.y, to.y) / FIXED) >> BLOCK_SHIFT,
      );
    for (let by = by0; by <= by1; by++)
      for (let bx = bx0; bx <= bx1; bx++)
        if (this.occupancy[bx + by * this.blockColumns]) return true;
    return false;
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
    if (!this.mayBlock(from, to)) return true;
    return !this.segmentTiles(from, to).some((tile) =>
      this.blocked(tile, owner),
    );
  }
  blockingTilesOnSweep(
    from: { x: number; y: number },
    to: { x: number; y: number },
    owner: number,
    radius: number,
    originTile?: number,
  ): number[] {
    if (!this.hasObstacles) return [];
    const candidates = new Set<number>(),
      extent = Math.ceil(radius / FIXED);
    for (const centre of this.segmentTiles(from, to)) {
      const x = this.map.x(centre),
        y = this.map.y(centre);
      for (
        let yy = Math.max(0, y - extent);
        yy <= Math.min(this.map.height() - 1, y + extent);
        yy++
      )
        for (
          let xx = Math.max(0, x - extent);
          xx <= Math.min(this.map.width() - 1, x + extent);
          xx++
        ) {
          const tile = this.map.ref(xx, yy);
          if (tile !== originTile && this.blocked(tile, owner))
            candidates.add(tile);
        }
    }
    return [...candidates];
  }
  /** Physical clearance uses a squad's swept radius. Weapon rays retain clear(). */
  clearMovement(from:{x:number;y:number},to:{x:number;y:number},owner:number,radius:number):boolean {
    return !this.blockingTilesOnSweep(from,to,owner,radius).some(tile =>
      boxSweepEntry(from,to,{x:this.map.x(tile)*FIXED,y:this.map.y(tile)*FIXED},FIXED,radius)!==null);
  }
  towerPlan(
    tile: number,
    owner: number,
    age: Age,
    buildings: readonly Building[] | TowerSiteIndex,
  ): { links: { a: number; tiles: number[] }[]; gold: number } {
    return quoteTowerPlan(this.map, tile, owner, age, buildings, t => this.intactWallAt(t));
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
        remainingTicks: tower.remainingTicks,
      });
    }
    this.reindex();
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
  repairing(kind:"building"|"wall",id:number):boolean {
    return this.repairs.has(`${kind==="building"?"b":"w"}:${id}`);
  }
  step(tick: number, buildings: readonly Building[],
    updateBuilding?: (id: number, health: number) => void): void {
    const byId = new Map(buildings.map((b) => [b.id, b]));
    let dirty = false;
    const towers = new Map<number, Set<number>>();
    for (const b of buildings) {
      if (b.type !== "tower" || (b.health ?? 1) <= 0) continue;
      let owners = towers.get(b.tile);
      if (!owners) towers.set(b.tile, (owners = new Set()));
      owners.add(b.playerId);
    }
    if (
      towers.size !== this.towers.size ||
      [...towers].some(([tile, owners]) => {
        const previous = this.towers.get(tile);
        return (
          !previous ||
          previous.size !== owners.size ||
          [...owners].some((owner) => !previous.has(owner))
        );
      })
    ) {
      this.towers = towers;
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
      const health = (target.health ?? 1200) + amount;
      if ("tile" in target) {
        if (!updateBuilding) throw new Error("Building repairs require their lifecycle owner");
        updateBuilding(target.id, health);
      } else target.health = health;
      repair.remaining -= amount;
      if (repair.remaining <= 0 || amount <= 0) this.repairs.delete(key);
    }
  }
}
