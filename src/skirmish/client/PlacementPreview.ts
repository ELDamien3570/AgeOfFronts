import type { GameMap } from "../../core/game/GameMap";
import { BuildingIndex } from "../BuildingIndex";
import { constructionRejection } from "../Construction";
import type { BuildingType, Snapshot } from "../Protocol";
import { FIXED } from "../Protocol";
import { BUILDING_RULES } from "../Rules";
import {
  buildingCost,
  buildingCostMultiplier,
  buildingTechnology,
} from "../content/Buildings";
import type { Age } from "../domain/Definitions";
import { Diplomacy } from "../domain/Diplomacy";
import { ResourceSiteIndex } from "../domain/ResourceSiteIndex";
import { costRejection } from "../domain/Supply";
import { quoteTowerPlan } from "../domain/TowerPlacement";

export interface PreviewBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
const CHUNK = 16;
interface Chunk {
  cursor: number;
  sites: { tile: number; wallGold: number }[];
}
/** Visible, resumable presentation work. A canceled mode cannot publish stale sites. */
export class PlacementPreview {
  private snapshot?: Snapshot;
  private playerId = 0;
  private type?: BuildingType;
  private age?: Age;
  private readonly chunks = new Map<number, Chunk>();
  private readonly buildings: BuildingIndex;
  readonly resources: ResourceSiteIndex;
  private readonly blocked = new Set<number>();
  private readonly wallTiles = new Set<number>();
  private troopTiles = new Set<number>();
  private geometry = "";
  readonly diagnostics = { tested: 0, invalidations: 0 };
  constructor(private readonly map: GameMap) {
    this.buildings = new BuildingIndex(map);
    this.resources = new ResourceSiteIndex(map);
  }
  begin(
    snapshot: Snapshot,
    playerId: number,
    type: BuildingType,
    age?: Age,
  ): void {
    this.cancel();
    this.playerId = playerId;
    this.type = type;
    this.age = age;
    this.update(snapshot);
  }
  cancel(): void {
    this.type = undefined;
    this.chunks.clear();
    this.geometry = "";
  }
  update(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    if (!this.type) return;
    const resourceChanged = this.resources.update(
      snapshot.expansion?.deposits ?? [],
    );
    const geometry =
      snapshot.buildings
        .map(
          (b) =>
            `${b.id}:${b.tile}:${b.playerId}:${b.type}:${b.age ?? "StoneAge"}:${Number(!b.remainingTicks)}:${Number((b.health ?? 1) > 0)}`,
        )
        .join("|") +
      "/" +
      (snapshot.expansion?.barriers ?? [])
        .filter((b) => b.health > 0)
        .map((b) => `${b.id}:${b.playerId}:${b.tiles.join(",")}`)
        .join("|") +
      "/" +
      (snapshot.expansion?.diplomacy.alliances ?? [])
        .map((t) => `${t.a}:${t.b}`)
        .join("|");
    if (
      geometry !== this.geometry ||
      resourceChanged ||
      !snapshot.changedTiles
    ) {
      this.geometry = geometry;
      this.chunks.clear();
      this.buildings.rebuild(snapshot.buildings);
      this.blocked.clear();
      this.wallTiles.clear();
      const diplomacy = new Diplomacy();
      if (snapshot.expansion)
        diplomacy.state.alliances = snapshot.expansion.diplomacy.alliances;
      for (const barrier of snapshot.expansion?.barriers ?? [])
        if (barrier.health > 0)
          for (const tile of barrier.tiles) {
            this.wallTiles.add(tile);
            if (!diplomacy.allied(barrier.playerId, this.playerId))
              this.blocked.add(tile);
          }
      for (const building of snapshot.buildings)
        if (
          building.type === "tower" &&
          (building.health ?? 1) > 0 &&
          !diplomacy.allied(building.playerId, this.playerId)
        )
          this.blocked.add(building.tile);
      this.diagnostics.invalidations++;
    } else {
      for (const tile of snapshot.changedTiles)
        this.chunks.delete(this.chunkKey(this.map.x(tile), this.map.y(tile)));
    }
    if (this.type === "tower" && snapshot.expansion) {
      const occupied = new Set(
        snapshot.squads
          .filter((s) => s.embarkedOn === null)
          .map((s) =>
            this.map.ref(Math.floor(s.x / FIXED), Math.floor(s.y / FIXED)),
          ),
      );
      for (const tile of new Set([...this.troopTiles, ...occupied])) {
        if (this.troopTiles.has(tile) === occupied.has(tile)) continue;
        // A tower can link only within twelve tiles. A changed troop cell can
        // therefore affect only these neighbouring visible placement chunks.
        const x = this.map.x(tile),
          y = this.map.y(tile);
        for (
          let cy = Math.max(0, Math.floor((y - 12) / CHUNK));
          cy <=
          Math.min(
            Math.ceil(this.map.height() / CHUNK) - 1,
            Math.floor((y + 12) / CHUNK),
          );
          cy++
        )
          for (
            let cx = Math.max(0, Math.floor((x - 12) / CHUNK));
            cx <=
            Math.min(
              Math.ceil(this.map.width() / CHUNK) - 1,
              Math.floor((x + 12) / CHUNK),
            );
            cx++
          )
            this.chunks.delete(cy * Math.ceil(this.map.width() / CHUNK) + cx);
      }
      this.troopTiles = occupied;
    }
    // Funds can change between packets; cached geometry never grants payment.
    // If the selected type becomes unaffordable the renderer hides its sites.
  }
  private chunkKey(x: number, y: number): number {
    return (
      Math.floor(y / CHUNK) * Math.ceil(this.map.width() / CHUNK) +
      Math.floor(x / CHUNK)
    );
  }
  private funding(type: BuildingType, wallGold = 0): string | null {
    const snapshot = this.snapshot!,
      player = snapshot.players.find((p) => p.id === this.playerId);
    if (!player) return "Unknown player";
    if (!snapshot.expansion)
      return player.gold <
        Math.round(
          BUILDING_RULES[type].cost *
            buildingCostMultiplier(
              this.buildings.countOfType(this.playerId, type),
            ),
        )
        ? "Not enough gold for this building"
        : null;
    const state = snapshot.expansion.progression[this.playerId],
      age = this.age ?? state.age;
    const technology = buildingTechnology(type, age);
    if (!technology || !state.completed.includes(technology))
      return "Research this building's technology first";
    const cost = buildingCost(
      type,
      age,
      this.buildings.countOfType(this.playerId, type),
    );
    return costRejection(
      player,
      snapshot.expansion.inventories[this.playerId],
      { ...cost, gold: (cost.gold ?? 0) + wallGold },
    );
  }
  rejection(
    type: BuildingType,
    tile: number,
    checkFunds = true,
  ): string | null {
    const placement = this.placement(type, tile);
    return (
      placement.reason ??
      (checkFunds ? this.funding(type, placement.wallGold) : null)
    );
  }
  private placement(
    type: BuildingType,
    tile: number,
  ): { reason: string | null; wallGold: number } {
    const snapshot = this.snapshot;
    if (!snapshot) return { reason: "No active match", wallGold: 0 };
    const reason = constructionRejection(
      this.map,
      snapshot.owners,
      this.buildings,
      snapshot.players.find((p) => p.id === this.playerId),
      type,
      tile,
      false,
    );
    if (reason) return { reason, wallGold: 0 };
    let wallGold = 0;
    if (snapshot.expansion) {
      const exclusion = this.resources.rejection(type, tile);
      if (exclusion) return { reason: exclusion, wallGold: 0 };
      const node = this.resources.at(tile);
      if (
        type === "mine" &&
        (!node || ["horses", "oil"].includes(node.resource))
      )
        return { reason: "Choose a mineral deposit", wallGold: 0 };
      if (["oil-well", "oil-rig"].includes(type) && node?.resource !== "oil")
        return { reason: "Choose an oil deposit", wallGold: 0 };
      if (this.blocked.has(tile))
        return { reason: "Intact wall occupies this site", wallGold: 0 };
      if (type === "tower") {
        const age =
          this.age ?? snapshot.expansion.progression[this.playerId].age;
        const plan = quoteTowerPlan(
          this.map,
          tile,
          this.playerId,
          age,
          {
            at: (t) => this.buildings.at(t),
            nearby: (t, radius) => this.buildings.towersNearby(t, radius),
          },
          (t) => this.wallTiles.has(t),
        );
        wallGold = plan.gold;
        if (
          this.troopTiles.has(tile) ||
          plan.links.some((link) =>
            link.tiles.some((t) => this.troopTiles.has(t)),
          )
        )
          return {
            reason: "Move troops clear of the tower and planned wall tiles",
            wallGold,
          };
      }
    }
    return { reason: null, wallGold };
  }
  sites(bounds: PreviewBounds, budget = 256): readonly number[] {
    if (!this.type || !this.snapshot || budget <= 0) return [];
    if (this.funding(this.type)) return [];
    const result: number[] = [],
      columns = Math.ceil(this.map.width() / CHUNK);
    const player = this.snapshot.players.find((p) => p.id === this.playerId)!,
      expansion = this.snapshot.expansion;
    const baseGold = expansion
      ? (buildingCost(
          this.type,
          this.age ?? expansion.progression[this.playerId].age,
          this.buildings.countOfType(this.playerId, this.type),
        ).gold ?? 0)
      : 0;
    // Keep only visible work. Panning across the world cannot retain a second
    // map-sized placement mask; returning to a chunk resumes a fresh bounded job.
    for (const key of this.chunks.keys()) {
      const cx = key % columns,
        cy = Math.floor(key / columns);
      if (
        (cx + 1) * CHUNK <= bounds.left ||
        cx * CHUNK > bounds.right ||
        (cy + 1) * CHUNK <= bounds.top ||
        cy * CHUNK > bounds.bottom
      )
        this.chunks.delete(key);
    }
    const left = Math.max(0, Math.floor(bounds.left / CHUNK)),
      top = Math.max(0, Math.floor(bounds.top / CHUNK));
    const right = Math.min(columns - 1, Math.floor(bounds.right / CHUNK)),
      bottom = Math.min(
        Math.ceil(this.map.height() / CHUNK) - 1,
        Math.floor(bounds.bottom / CHUNK),
      );
    for (let cy = top; cy <= bottom; cy++)
      for (let cx = left; cx <= right; cx++) {
        const key = cy * columns + cx,
          chunk = this.chunks.get(key) ?? { cursor: 0, sites: [] };
        this.chunks.set(key, chunk);
        while (chunk.cursor < CHUNK * CHUNK && budget > 0) {
          const at = chunk.cursor++,
            x = cx * CHUNK + (at % CHUNK),
            y = cy * CHUNK + Math.floor(at / CHUNK);
          budget--;
          this.diagnostics.tested++;
          if (this.map.isValidCoord(x, y)) {
            const tile = this.map.ref(x, y);
            const placement = this.placement(this.type, tile);
            if (!placement.reason)
              chunk.sites.push({ tile, wallGold: placement.wallGold });
          }
        }
        for (const { tile, wallGold } of chunk.sites)
          if (
            (!expansion || player.gold >= baseGold + wallGold) &&
            this.map.x(tile) >= bounds.left &&
            this.map.x(tile) <= bounds.right &&
            this.map.y(tile) >= bounds.top &&
            this.map.y(tile) <= bounds.bottom
          )
            result.push(tile);
      }
    return result;
  }
}
