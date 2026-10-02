import type { GameMap } from "../core/game/GameMap";
import type { Building } from "./Protocol";
import { BUILDING_RULES } from "./Rules";
const EMPTY_BUILDINGS: readonly Building[] = Object.freeze([]);

// Derived domain index. The simulation remains the owner of every independent
// building, its cost, construction timer and capture lifecycle.
export class BuildingIndex {
  private readonly tiles = new Map<number, Building[]>();
  private readonly ids = new Map<number, Building>();
  private readonly towerSectors = new Map<number, Building[]>();
  private readonly representatives = new Map<
    number,
    Map<Building["type"], Building>
  >();
  private readonly income = new Map<
    number,
    { reserves: number; gold: number }
  >();
  private readonly playerCounts = new Map<
    number,
    Map<Building["type"], number>
  >();
  private count = 0;
  constructor(private readonly map: GameMap) {}
  rebuild(buildings: readonly Building[]): void {
    this.tiles.clear();
    this.ids.clear();
    this.towerSectors.clear();
    this.representatives.clear();
    this.income.clear();
    this.playerCounts.clear();
    this.count = 0;
    for (const building of buildings) this.add(building);
  }
  ensure(buildings: readonly Building[]): void {
    if (this.count !== buildings.length) this.rebuild(buildings);
  }
  add(building: Building): void {
    this.ids.set(building.id, building);
    let stack = this.tiles.get(building.tile);
    if (!stack) this.tiles.set(building.tile, (stack = []));
    stack.push(building);
    if (building.type === "tower") {
      const key = this.towerSector(
        this.map.x(building.tile),
        this.map.y(building.tile),
      );
      const bucket = this.towerSectors.get(key);
      if (bucket) bucket.push(building);
      else this.towerSectors.set(key, [building]);
    }
    this.count++;
    let representatives = this.representatives.get(building.tile);
    if (!representatives)
      this.representatives.set(building.tile, (representatives = new Map()));
    representatives.set(building.type, building);
    let playerMap = this.playerCounts.get(building.playerId);
    if (!playerMap)
      this.playerCounts.set(building.playerId, (playerMap = new Map()));
    playerMap.set(building.type, (playerMap.get(building.type) ?? 0) + 1);
    if (building.remainingTicks) return;
    let income = this.income.get(building.playerId);
    if (!income)
      this.income.set(building.playerId, (income = { reserves: 0, gold: 0 }));
    income.reserves += BUILDING_RULES[building.type].reserveIncome;
    income.gold += BUILDING_RULES[building.type].goldIncome;
  }
  countOfType(playerId: number, type: Building["type"]): number {
    return this.playerCounts.get(playerId)?.get(type) ?? 0;
  }
  at(tile: number): readonly Building[] {
    return this.tiles.get(tile) ?? EMPTY_BUILDINGS;
  }
  byId(id: number): Building | undefined {
    return this.ids.get(id);
  }
  production(owner: number) {
    return this.income.get(owner) ?? { reserves: 0, gold: 0 };
  }
  /** Exact local stacks for endpoint rules that distinguish completion/tier. */
  private towerSector(x: number, y: number): number {
    return (
      Math.floor(y / 16) * Math.ceil(this.map.width() / 16) + Math.floor(x / 16)
    );
  }
  *towersNearby(tile: number, radius: number): Iterable<Building> {
    const x = this.map.x(tile),
      y = this.map.y(tile);
    for (
      let sy = Math.max(0, Math.floor((y - radius) / 16));
      sy <=
      Math.min(
        Math.ceil(this.map.height() / 16) - 1,
        Math.floor((y + radius) / 16),
      );
      sy++
    )
      for (
        let sx = Math.max(0, Math.floor((x - radius) / 16));
        sx <=
        Math.min(
          Math.ceil(this.map.width() / 16) - 1,
          Math.floor((x + radius) / 16),
        );
        sx++
      )
        for (const tower of this.towerSectors.get(
          this.towerSector(sx * 16, sy * 16),
        ) ?? EMPTY_BUILDINGS)
          if (this.map.euclideanDistSquared(tile, tower.tile) <= radius ** 2)
            yield tower;
  }
  /** Exact local stacks for callers needing every independent building. */
  *allNearby(tile: number, radius: number): Iterable<Building> {
    const x = this.map.x(tile),
      y = this.map.y(tile),
      extent = Math.ceil(radius);
    for (
      let yy = Math.max(0, y - extent);
      yy <= Math.min(this.map.height() - 1, y + extent);
      yy++
    )
      for (
        let xx = Math.max(0, x - extent);
        xx <= Math.min(this.map.width() - 1, x + extent);
        xx++
      )
        yield* this.tiles.get(this.map.ref(xx, yy)) ?? EMPTY_BUILDINGS;
  }
  *nearby(tile: number, radius: number): Iterable<Building> {
    const x = this.map.x(tile),
      y = this.map.y(tile),
      extent = Math.ceil(radius);
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
        const stack = this.representatives.get(this.map.ref(xx, yy));
        // Legal stacks contain only one type. Keep invalid fixture mixtures
        // detectable too, without checking every duplicate building.
        if (stack) yield* stack.values();
      }
  }
}
