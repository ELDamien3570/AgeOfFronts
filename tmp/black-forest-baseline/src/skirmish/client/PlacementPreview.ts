import type { GameMap } from "../../core/game/GameMap";
import {
  buildingFootprint,
  buildingGroundBounds,
  MAX_BUILDING_EXTENT,
} from "../BuildingFootprint";
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
import { availableGold } from "../domain/Gold";
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
const RECENT_CHUNKS = 128;
const CACHED_MODES = 4;
const WORK_MS = 2;
const MAX_EXAMINED = 65_536;
interface ModeScan {
  cursor: number;
  turn: number;
  sites: Map<number, number>;
  rescan?: boolean;
  dirty?: Set<number>;
}
interface Chunk {
  owners: Uint8Array;
  fringe: { tiles: Uint32Array; owners: Uint8Array };
  modes: Map<string, ModeScan>;
}
/** Visible, resumable presentation work. A canceled mode cannot publish stale sites. */
export class PlacementPreview {
  private snapshot?: Snapshot;
  private playerId = 0;
  private type?: BuildingType;
  private age?: Age;
  private mode = "";
  private readonly modes = new Set<string>();
  private nextTurn = 0;
  private readonly chunks = new Map<number, Chunk>();
  private readonly buildings: BuildingIndex;
  readonly resources: ResourceSiteIndex;
  private readonly blocked = new Set<number>();
  private readonly wallTiles = new Set<number>();
  private troopTiles = new Set<number>();
  private geometry = "";
  private buildingGeometry = new Map<number, { tile: number; key: string }>();
  readonly diagnostics = {
    tested: 0,
    examined: 0,
    invalidations: 0,
    workMs: 0,
    cachedChunks: 0,
  };
  constructor(
    private readonly map: GameMap,
    private readonly now = () => performance.now(),
  ) {
    this.buildings = new BuildingIndex(map);
    this.resources = new ResourceSiteIndex(map);
  }
  begin(
    snapshot: Snapshot,
    playerId: number,
    type: BuildingType,
    age?: Age,
  ): void {
    if (this.playerId !== playerId) {
      this.chunks.clear();
      this.modes.clear();
      this.geometry = "";
      this.buildingGeometry.clear();
      this.troopTiles.clear();
    }
    this.playerId = playerId;
    this.type = type;
    this.age = age;
    this.mode = `${type}/${age ?? "current"}`;
    this.modes.delete(this.mode);
    this.modes.add(this.mode);
    if (this.modes.size > CACHED_MODES) {
      const oldest = this.modes.values().next().value!;
      this.modes.delete(oldest);
      for (const chunk of this.chunks.values()) chunk.modes.delete(oldest);
    }
    this.update(snapshot);
  }
  cancel(): void {
    this.type = undefined;
  }
  get activeType(): BuildingType | undefined {
    return this.type;
  }
  private invalidate(key: number, fortificationsOnly = false): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    // Hide stale quotes immediately, but do not run placement validation in a
    // packet handler. Partial scans keep progressing even under frequent updates.
    for (const [mode, scan] of chunk.modes) {
      if (
        fortificationsOnly &&
        !mode.startsWith("tower/") &&
        !mode.startsWith("trench/")
      )
        continue;
      if (scan.cursor === CHUNK * CHUNK) scan.cursor = 0;
      else scan.rescan = true;
      scan.sites.clear();
      scan.dirty?.clear();
    }
  }
  private invalidateNear(
    tile: number,
    radius: number,
    fortificationsOnly = false,
  ): void {
    const x = this.map.x(tile),
      y = this.map.y(tile);
    for (
      let cy = Math.max(0, Math.floor((y - radius) / CHUNK));
      cy <=
      Math.min(
        Math.ceil(this.map.height() / CHUNK) - 1,
        Math.floor((y + radius) / CHUNK),
      );
      cy++
    )
      for (
        let cx = Math.max(0, Math.floor((x - radius) / CHUNK));
        cx <=
        Math.min(
          Math.ceil(this.map.width() / CHUNK) - 1,
          Math.floor((x + radius) / CHUNK),
        );
        cx++
      )
        this.invalidate(
          cy * Math.ceil(this.map.width() / CHUNK) + cx,
          fortificationsOnly,
        );
  }
  update(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    // Closed placement publishes nothing. Refresh retained facts once on begin,
    // rather than taxing every multiplayer packet while the tool is idle.
    if (!this.type) return;
    const resourceChanged = this.resources.update(
      snapshot.expansion?.deposits ?? [],
      snapshot.expansion?.depositGeometryRevision,
      snapshot.expansion?.depositOwnershipRevision,
    );
    const nextBuildings = new Map(
      snapshot.buildings.map((b) => [
        b.id,
        {
          tile: b.tile,
          key: [
            b.tile,
            b.playerId,
            b.type,
            b.age ?? "StoneAge",
            !b.remainingTicks,
            (b.health ?? 1) > 0,
          ].join(":"),
        },
      ]),
    );
    const changedBuildings = [
      ...new Set([...this.buildingGeometry.keys(), ...nextBuildings.keys()]),
    ].filter(
      (id) => this.buildingGeometry.get(id)?.key !== nextBuildings.get(id)?.key,
    );
    const geometry =
      (snapshot.expansion?.progression[this.playerId]?.age ?? "StoneAge") +
      "/" +
      JSON.stringify(
        snapshot.expansion?.barriers
          .filter((b) => b.health > 0)
          .map((b) => [b.id, b.playerId, b.kind, b.tiles]) ?? [],
      ) +
      "/" +
      JSON.stringify(
        snapshot.expansion?.diplomacy.alliances.map((t) => [t.a, t.b]) ?? [],
      );
    const globalChange = geometry !== this.geometry || resourceChanged;
    if (globalChange || changedBuildings.length) {
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
            if (
              barrier.kind !== "trench" &&
              !diplomacy.allied(barrier.playerId, this.playerId)
            )
              this.blocked.add(tile);
          }
      for (const building of snapshot.buildings)
        if (
          building.type === "tower" &&
          (building.health ?? 1) > 0 &&
          !diplomacy.allied(building.playerId, this.playerId)
        )
          this.blocked.add(building.tile);
      if (globalChange)
        for (const key of this.chunks.keys()) this.invalidate(key);
      else
        for (const id of changedBuildings) {
          const before = this.buildingGeometry.get(id),
            after = nextBuildings.get(id);
          for (const site of [before, after])
            if (site) {
              this.invalidateNear(site.tile, MAX_BUILDING_EXTENT + 2);
              this.invalidateNear(site.tile, 12, true);
            }
        }
      this.diagnostics.invalidations++;
    }
    this.geometry = geometry;
    this.buildingGeometry = nextBuildings;
    // Compare ownership only inside retained chunks, including full
    // solo snapshots without changedTiles. Never reset the grid every packet.
    const columns = Math.ceil(this.map.width() / CHUNK);
    for (const [key, chunk] of this.chunks) {
      const owners = chunk.owners;
      const changedTiles: number[] = [];
      for (let at = 0; at < owners.length; at++) {
        const x = (key % columns) * CHUNK + (at % CHUNK),
          y = Math.floor(key / columns) * CHUNK + Math.floor(at / CHUNK);
        const owner = this.map.isValidCoord(x, y)
          ? snapshot.owners[this.map.ref(x, y)]
          : 0;
        if (owners[at] !== owner && this.map.isValidCoord(x, y)) {
          changedTiles.push(this.map.ref(x, y));
        }
        owners[at] = owner;
      }
      chunk.owners = owners;
      for (let at = 0; at < chunk.fringe.tiles.length; at++) {
        const tile = chunk.fringe.tiles[at],
          owner = snapshot.owners[tile];
        if (chunk.fringe.owners[at] !== owner) changedTiles.push(tile);
        chunk.fringe.owners[at] = owner;
      }
      for (const tile of changedTiles) {
        const tx = this.map.x(tile),
          ty = this.map.y(tile);
        for (let y = Math.max(0, ty - MAX_BUILDING_EXTENT + 1); y <= ty; y++)
          for (
            let x = Math.max(0, tx - MAX_BUILDING_EXTENT + 1);
            x <= tx;
            x++
          ) {
            const affected = this.chunks.get(
              Math.floor(y / CHUNK) * columns + Math.floor(x / CHUNK),
            );
            for (const [mode, scan] of affected?.modes ?? []) {
              const shape = buildingFootprint(
                mode.split("/")[0] as BuildingType,
              );
              if (x + shape.width <= tx || y + shape.height <= ty) continue;
              scan.sites.delete(this.map.ref(x, y));
              const at = (y % CHUNK) * CHUNK + (x % CHUNK);
              if (at < scan.cursor) (scan.dirty ??= new Set()).add(at);
            }
          }
        this.invalidateNear(tile, 12, true);
      }
    }
    if (snapshot.expansion) {
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
            for (const [mode, scan] of this.chunks.get(
              cy * Math.ceil(this.map.width() / CHUNK) + cx,
            )?.modes ?? []) {
              if (!mode.startsWith("tower/")) continue;
              if (scan.cursor === CHUNK * CHUNK) scan.cursor = 0;
              else scan.rescan = true;
              scan.sites.clear();
            }
      }
      this.troopTiles = occupied;
    }
    // Funds can change between packets; cached geometry never grants payment.
    // If the selected type becomes unaffordable the renderer hides its sites.
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
      const visible =
        node &&
        resourceVisibleAtAge(
          node.resource,
          snapshot.expansion.progression[this.playerId].age,
        );
      if (
        type === "mine" &&
        (!node || !visible || ["horses", "oil"].includes(node.resource))
      )
        return { reason: "Choose a mineral deposit", wallGold: 0 };
      if (
        ["oil-well", "oil-rig"].includes(type) &&
        (!visible || node?.resource !== "oil")
      )
        return { reason: "Choose an oil deposit", wallGold: 0 };
      const bounds = buildingGroundBounds(this.map, tile, type);
      for (let y = bounds.top; y < bounds.bottom; y++)
        for (let x = bounds.left; x < bounds.right; x++)
          if (
            this.map.isValidCoord(x, y) &&
            this.blocked.has(this.map.ref(x, y))
          )
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
            nearby: (t, radius) =>
              type === "tower"
                ? this.buildings.towersNearby(t, radius)
                : this.buildings.nearby(t, radius),
          },
          (t) =>
            this.wallTiles.has(t) ||
            (type === "trench" && snapshot.owners[t] !== this.playerId),
          type,
        );
        wallGold = plan.gold;
        if (
          type === "tower" &&
          (this.troopTiles.has(tile) ||
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
  /** Numeric budgets are deterministic validation limits for callers/tests.
   * Rendering uses a CPU deadline, including discovery of friendly candidates. */
  sites(
    bounds: PreviewBounds,
    budget?: number,
    focus?: number | null,
  ): readonly number[] {
    if (!this.type || !this.snapshot || (budget !== undefined && budget <= 0))
      return [];
    if (this.funding(this.type)) return [];
    const started = this.now(),
      deadline = budget === undefined ? started + WORK_MS : Infinity;
    let remaining = budget ?? Infinity,
      examined = 0;
    const columns = Math.ceil(this.map.width() / CHUNK);
    const player = this.snapshot.players.find((p) => p.id === this.playerId)!,
      expansion = this.snapshot.expansion;
    const baseGold = expansion
      ? (buildingCost(
          this.type,
          this.age ?? expansion.progression[this.playerId].age,
          this.buildings.countOfType(this.playerId, this.type),
        ).gold ?? 0)
      : 0;
    const left = Math.max(0, Math.floor(bounds.left / CHUNK)),
      top = Math.max(0, Math.floor(bounds.top / CHUNK)),
      right = Math.min(columns - 1, Math.floor(bounds.right / CHUNK)),
      bottom = Math.min(
        Math.ceil(this.map.height() / CHUNK) - 1,
        Math.floor(bounds.bottom / CHUNK),
      );
    const keys: number[] = [];
    for (let cy = top; cy <= bottom; cy++)
      for (let cx = left; cx <= right; cx++) keys.push(cy * columns + cx);
    const visible = new Set(keys);
    // Visible chunks plus a fixed recent working set; panning cannot grow the
    // cache indefinitely. Modes share ownership facts and retain at most four scans.
    let recent = 0;
    for (const key of [...this.chunks.keys()].reverse()) {
      if (!visible.has(key) && ++recent > RECENT_CHUNKS)
        this.chunks.delete(key);
    }
    const focusX =
        typeof focus === "number" && this.map.isValidRef(focus)
          ? this.map.x(focus)
          : (bounds.left + bounds.right) / 2,
      focusY =
        typeof focus === "number" && this.map.isValidRef(focus)
          ? this.map.y(focus)
          : (bounds.top + bounds.bottom) / 2;
    const distance = (key: number) => {
      const dx = (key % columns) * CHUNK + CHUNK / 2 - focusX,
        dy = Math.floor(key / columns) * CHUNK + CHUNK / 2 - focusY;
      return dx * dx + dy * dy;
    };
    const turn = (key: number) => {
      const scan = this.chunks.get(key)?.modes.get(this.mode);
      return !scan
        ? -1
        : scan.cursor === CHUNK * CHUNK && !scan.dirty?.size
          ? Infinity
          : scan.turn;
    };
    // A region dirtied every packet must not monopolize the frame budget.
    // Cursor distance orders fresh work; completed passes move behind waiting work.
    keys.sort(
      (a, b) => turn(a) - turn(b) || distance(a) - distance(b) || a - b,
    );
    let exhausted = false;
    for (const key of keys) {
      if (
        !exhausted &&
        budget === undefined &&
        (examined >= MAX_EXAMINED || this.now() >= deadline)
      )
        exhausted = true;
      let chunk = this.chunks.get(key);
      if (!chunk && !exhausted) {
        const owners = new Uint8Array(CHUNK * CHUNK);
        for (let at = 0; at < owners.length; at++) {
          const x = (key % columns) * CHUNK + (at % CHUNK),
            y = Math.floor(key / columns) * CHUNK + Math.floor(at / CHUNK);
          owners[at] = this.map.isValidCoord(x, y)
            ? this.snapshot.owners[this.map.ref(x, y)]
            : 0;
        }
        // A visible anchor can occupy cells in a chunk that was never scanned.
        // Retain only its small east/south ownership fringe as well.
        const tiles: number[] = [];
        for (let dy = 0; dy < CHUNK + MAX_BUILDING_EXTENT - 1; dy++)
          for (let dx = 0; dx < CHUNK + MAX_BUILDING_EXTENT - 1; dx++) {
            if (dx < CHUNK && dy < CHUNK) continue;
            const x = (key % columns) * CHUNK + dx,
              y = Math.floor(key / columns) * CHUNK + dy;
            if (this.map.isValidCoord(x, y)) tiles.push(this.map.ref(x, y));
          }
        chunk = {
          owners,
          fringe: {
            tiles: new Uint32Array(tiles),
            owners: new Uint8Array(
              tiles.map((tile) => this.snapshot!.owners[tile]),
            ),
          },
          modes: new Map(),
        };
      }
      if (!chunk) continue;
      // Touch visible entries for eviction without discarding work on a pan.
      this.chunks.delete(key);
      this.chunks.set(key, chunk);
      let scan = chunk.modes.get(this.mode);
      if (!scan) {
        scan = { cursor: 0, turn: -1, sites: new Map() };
        chunk.modes.set(this.mode, scan);
      }
      const wasPending = scan.cursor < CHUNK * CHUNK;
      if (!exhausted && wasPending && !chunk.owners.includes(this.playerId)) {
        const skipped = Math.min(
          CHUNK * CHUNK - scan.cursor,
          budget === undefined ? MAX_EXAMINED - examined : Infinity,
        );
        examined += skipped;
        scan.cursor += skipped;
      }
      while (!exhausted && scan.cursor < CHUNK * CHUNK) {
        if (
          remaining <= 0 ||
          (budget === undefined && examined >= MAX_EXAMINED) ||
          this.now() >= deadline
        ) {
          exhausted = true;
          break;
        }
        const at = scan.cursor++,
          x = (key % columns) * CHUNK + (at % CHUNK),
          y = Math.floor(key / columns) * CHUNK + Math.floor(at / CHUNK);
        examined++;
        // Ownership and immutable terrain are cheap candidate filters. Rejected
        // cells never consume the expensive shared construction-validation quota.
        if (chunk.owners[at] !== this.playerId || !this.map.isValidCoord(x, y))
          continue;
        const tile = this.map.ref(x, y);
        if (
          this.map.isImpassable(tile) ||
          (this.type === "oil-rig"
            ? !this.map.isWater(tile)
            : !this.map.isLand(tile))
        )
          continue;
        if (
          expansion &&
          (this.type === "mine" ||
            this.type === "oil-well" ||
            this.type === "oil-rig")
        ) {
          const node = this.resources.at(tile);
          if (
            !node ||
            !resourceVisibleAtAge(
              node.resource,
              expansion.progression[this.playerId].age,
            )
          )
            continue;
          if (
            this.type === "mine"
              ? ["horses", "oil"].includes(node.resource)
              : node.resource !== "oil"
          )
            continue;
        }
        remaining--;
        this.diagnostics.tested++;
        const placement = this.placement(this.type, tile);
        if (!placement.reason) scan.sites.set(tile, placement.wallGold);
        else scan.sites.delete(tile);
      }
      if (scan.cursor === CHUNK * CHUNK) {
        for (const at of scan.dirty ?? []) {
          if (
            remaining <= 0 ||
            (budget === undefined && examined >= MAX_EXAMINED) ||
            this.now() >= deadline
          ) {
            exhausted = true;
            break;
          }
          scan.dirty!.delete(at);
          const x = (key % columns) * CHUNK + (at % CHUNK),
            y = Math.floor(key / columns) * CHUNK + Math.floor(at / CHUNK);
          examined++;
          if (
            !this.map.isValidCoord(x, y) ||
            chunk.owners[at] !== this.playerId
          )
            continue;
          remaining--;
          this.diagnostics.tested++;
          const tile = this.map.ref(x, y),
            quote = this.placement(this.type, tile);
          if (!quote.reason) scan.sites.set(tile, quote.wallGold);
        }
      }
      if (wasPending && scan.cursor === CHUNK * CHUNK && !exhausted) {
        scan.turn = ++this.nextTurn;
        if (scan.rescan) {
          scan.cursor = 0;
          scan.rescan = false;
        }
      }
    }
    const result: number[] = [];
    // Publish cached results even after the current frame's work deadline.
    // Sorting by tile preserves stable output independently of priority order.
    for (const key of visible)
      for (const [tile, wallGold] of this.chunks.get(key)?.modes.get(this.mode)
        ?.sites ?? [])
        if (
          (!expansion || availableGold(player) >= baseGold + wallGold) &&
          this.map.x(tile) >= bounds.left &&
          this.map.x(tile) <= bounds.right &&
          this.map.y(tile) >= bounds.top &&
          this.map.y(tile) <= bounds.bottom
        )
          result.push(tile);
    this.diagnostics.examined += examined;
    this.diagnostics.workMs = this.now() - started;
    this.diagnostics.cachedChunks = this.chunks.size;
    return result.sort((a, b) => a - b);
  }
}
