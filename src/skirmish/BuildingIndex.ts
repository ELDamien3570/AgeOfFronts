import type { GameMap } from "../core/game/GameMap";
import type { Building } from "./Protocol";
import { BUILDING_RULES } from "./Rules";
const EMPTY_BUILDINGS: readonly Building[] = Object.freeze([]);

// Derived domain index. The simulation remains the owner of every independent
// building, its cost, construction timer and capture lifecycle.
export class BuildingIndex {
  private readonly tiles = new Map<number, Building[]>();
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
    let stack = this.tiles.get(building.tile);
    if (!stack) this.tiles.set(building.tile, (stack = []));
    stack.push(building);
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
  production(owner: number) {
    return this.income.get(owner) ?? { reserves: 0, gold: 0 };
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
