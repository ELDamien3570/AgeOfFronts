import { availableGold } from "../domain/Gold";
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
import { resourceVisibleAtAge } from "../content/Resources";
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
  sites: Map<number, number>;
  owners?: Uint8Array;
  rescan?: boolean;
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
  private buildingGeometry = new Map<number, { tile: number; key: string }>();
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
    this.buildingGeometry.clear();
    this.troopTiles.clear();
  }
  private invalidate(key: number): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    // Retain legal sites while new work resumes; a packet cannot starve an
    // already-partial scan by restarting it.
    if (chunk.cursor === CHUNK * CHUNK) chunk.cursor = 0;
    else chunk.rescan = true;
    for (const tile of chunk.sites.keys()) {
      const quote = this.placement(this.type!, tile);
      this.diagnostics.tested++;
      if (quote.reason) chunk.sites.delete(tile);
      else chunk.sites.set(tile, quote.wallGold);
    }
  }
  private invalidateNear(tile: number, radius: number): void {
    const x = this.map.x(tile), y = this.map.y(tile);
    for (let cy = Math.max(0, Math.floor((y-radius)/CHUNK)); cy <= Math.min(Math.ceil(this.map.height()/CHUNK)-1, Math.floor((y+radius)/CHUNK)); cy++)
      for (let cx = Math.max(0, Math.floor((x-radius)/CHUNK)); cx <= Math.min(Math.ceil(this.map.width()/CHUNK)-1, Math.floor((x+radius)/CHUNK)); cx++)
        this.invalidate(cy * Math.ceil(this.map.width()/CHUNK) + cx);
  }
  update(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    if (!this.type) return;
    const resourceChanged = this.resources.update(
      snapshot.expansion?.deposits ?? [],
      snapshot.expansion?.depositGeometryRevision,
      snapshot.expansion?.depositOwnershipRevision,
    );
    const nextBuildings = new Map(snapshot.buildings.map(b => [b.id, {
      tile: b.tile,
      key: [b.tile,b.playerId,b.type,b.age ?? "StoneAge",!b.remainingTicks,(b.health ?? 1)>0].join(":"),
    }]));
    const changedBuildings = [...new Set([...this.buildingGeometry.keys(), ...nextBuildings.keys()])]
      .filter(id => this.buildingGeometry.get(id)?.key !== nextBuildings.get(id)?.key);
    const geometry = (snapshot.expansion?.progression[this.playerId]?.age ?? "StoneAge") + "/" +
      JSON.stringify(snapshot.expansion?.barriers.filter(b => b.health > 0).map(b => [b.id,b.playerId,b.kind,b.tiles]) ?? []) + "/" +
      JSON.stringify(snapshot.expansion?.diplomacy.alliances.map(t => [t.a,t.b]) ?? []);
    const globalChange = geometry !== this.geometry || resourceChanged;
    if (globalChange || changedBuildings.length) {
      this.buildings.rebuild(snapshot.buildings);
      this.blocked.clear();
      this.wallTiles.clear();
      const diplomacy = new Diplomacy();
      if (snapshot.expansion) diplomacy.state.alliances = snapshot.expansion.diplomacy.alliances;
      for (const barrier of snapshot.expansion?.barriers ?? [])
        if (barrier.health > 0) for (const tile of barrier.tiles) {
          this.wallTiles.add(tile);
          if (barrier.kind !== "trench" && !diplomacy.allied(barrier.playerId, this.playerId)) this.blocked.add(tile);
        }
      for (const building of snapshot.buildings)
        if (building.type === "tower" && (building.health ?? 1) > 0 && !diplomacy.allied(building.playerId, this.playerId))
          this.blocked.add(building.tile);
      if (globalChange) for (const key of this.chunks.keys()) this.invalidate(key);
      else for (const id of changedBuildings) {
        const before = this.buildingGeometry.get(id), after = nextBuildings.get(id);
        if (before) this.invalidateNear(before.tile, this.type === "tower" || this.type === "trench" ? 12 : 3);
        if (after) this.invalidateNear(after.tile, this.type === "tower" || this.type === "trench" ? 12 : 3);
      }
      this.diagnostics.invalidations++;
    }
    this.geometry = geometry;
    this.buildingGeometry = nextBuildings;
    // Compare ownership only inside retained visible chunks, including full
    // solo snapshots without changedTiles. Never reset the grid every packet.
    const columns = Math.ceil(this.map.width()/CHUNK);
    for (const [key, chunk] of this.chunks) {
      const owners = new Uint8Array(CHUNK*CHUNK);
      let changed = false;
      for (let at=0; at<owners.length; at++) {
        const x=(key%columns)*CHUNK+at%CHUNK, y=Math.floor(key/columns)*CHUNK+Math.floor(at/CHUNK);
        owners[at] = this.map.isValidCoord(x,y) ? snapshot.owners[this.map.ref(x,y)] : 0;
        if (chunk.owners && owners[at] !== chunk.owners[at]) changed=true;
      }
      chunk.owners=owners;
      if (changed) this.invalidate(key);
    }
    if (this.type === "tower" && snapshot.expansion) {
      const occupied = new Set(
        snapshot.squads
          .filter((s) => s.embarkedOn === null)
          .map((s) =>
            this.map.ref(Math.floor(s.x / FIXED), Math.floor(s.y / FIXED)),
          ),
      );
      const previous = this.troopTiles;
      this.troopTiles = occupied;
      for (const tile of new Set([...previous, ...occupied])) {
        if (previous.has(tile) === occupied.has(tile)) continue;
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
            this.invalidate(cy * Math.ceil(this.map.width() / CHUNK) + cx);
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
      return availableGold(player) <
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
      const visible = node && resourceVisibleAtAge(node.resource, snapshot.expansion.progression[this.playerId].age);
      if (
        type === "mine" &&
        (!node || !visible || ["horses", "oil"].includes(node.resource))
      )
        return { reason: "Choose a mineral deposit", wallGold: 0 };
      if (["oil-well", "oil-rig"].includes(type) && (!visible || node?.resource !== "oil"))
        return { reason: "Choose an oil deposit", wallGold: 0 };
      if (this.blocked.has(tile))
        return { reason: "Intact wall occupies this site", wallGold: 0 };
      if (type === "tower" || type === "trench") {
        const age =
          this.age ?? snapshot.expansion.progression[this.playerId].age;
        const plan = quoteTowerPlan(
          this.map,
          tile,
          this.playerId,
          age,
          {
            at: (t) => this.buildings.at(t),
            nearby: (t, radius) => type === "tower" ? this.buildings.towersNearby(t, radius) : this.buildings.nearby(t, radius),
          },
          (t) => this.wallTiles.has(t) || (type === "trench" && snapshot.owners[t] !== this.playerId),
          type,
        );
        wallGold = plan.gold;
        if (
          type === "tower" && (this.troopTiles.has(tile) ||
          plan.links.some((link) =>
            link.tiles.some((t) => this.troopTiles.has(t)),
          ))
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
          chunk = this.chunks.get(key) ?? { cursor: 0, sites: new Map<number, number>() };
        this.chunks.set(key, chunk);
        if (!chunk.owners) {
          chunk.owners = new Uint8Array(CHUNK * CHUNK);
          for (let at=0; at<chunk.owners.length; at++) {
            const x=cx*CHUNK+at%CHUNK, y=cy*CHUNK+Math.floor(at/CHUNK);
            chunk.owners[at]=this.map.isValidCoord(x,y)?this.snapshot.owners[this.map.ref(x,y)]:0;
          }
        }
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
              chunk.sites.set(tile, placement.wallGold);
            else chunk.sites.delete(tile);
          }
        }
        if (chunk.cursor === CHUNK * CHUNK && chunk.rescan) {chunk.cursor=0;chunk.rescan=false;}
        for (const [tile, wallGold] of chunk.sites)
          if (
            (!expansion || availableGold(player) >= baseGold + wallGold) &&
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
