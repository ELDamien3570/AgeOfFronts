import type { GameMap } from "../../core/game/GameMap";
import type { WaterPaths } from "../Pathfinding";
import type { Building } from "../Protocol";
import { portWaterTiles } from "../PortWaterAccess";
import { SeaWorkHeap } from "./SeaTradeWork";
import type { SeaCandidate } from "./SeaTradePolicy";

interface CatalogBuild {
  inputIds: number[]; gathered: number; a: Int32Array; b: Int32Array;
  width: number; block: number; left: number; right: number; write: number;
  stage: "gather" | "merge"; followupDirty: boolean; initialPublished: boolean;
  bootstrapInput: number[]; bootstrapOutput?: Int32Array; bootstrapOffset: number; bootstrap: boolean;
}
interface Catalog { component: number; version: number; receiverIds: Int32Array; build?: CatalogBuild }
export interface SeaPolicyView {
  key: string; owner: number; departurePortTile: number; component: number;
  scanAfterReceiverId?: number; passUpperId?: number; explorationStart: number;
  nearest: SeaCandidate[]; exploration: SeaCandidate[]; lastCommittedPortTile?: number;
  passComplete: boolean; catalogVersion: number; passOrdinal: number; pruneIndex: number; pruneRemaining: number;
}
export interface SeaPortsCheckpoint {
  catalogs: [number, Catalog][]; policies: [string, SeaPolicyView][];
  actors: [number, string][]; order: { catalogs: number[]; policies: string[] };
  catalogCursor: number; policyCursor: number;
  sourceHints?: [string, number[]][];
}
const upperBound = (rows: Int32Array, value: number) => {
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (rows[mid] <= value) lo = mid + 1; else hi = mid; }
  return lo;
};
/** Incremental indexes over existing coherent market membership; never owns buildings. */
export class SeaTradePorts {
  private catalogs = new Map<number, Catalog>();
  private sourceHints = new Map<string, number[]>();
  private policies = new Map<string, SeaPolicyView>();
  private actors = new Map<number, string>();
  private users = new Map<string, Set<number>>();
  private catalogOrder: number[] = [];
  private policyOrder: string[] = [];
  private catalogPositions = new Map<number, number>();
  private policyPositions = new Map<string, number>();
  private catalogCursor = 0;
  private policyCursor = 0;
  private berthCache = new Map<number, { tile: number; rows: number[] }>();
  readonly diagnostics = { catalogWork: 0, policyWork: 0 };
  constructor(private readonly map: GameMap, private readonly water: WaterPaths,
    private readonly building: (id: number) => Building | undefined,
    private readonly eligible: (owner: number, building: Building) => boolean) {}
  access(port: Building, component: number): number[] {
    return portWaterTiles(this.map, port.tile).filter(tile => this.water.component[tile] === component);
  }
  berth(port: Building, component: number): number | undefined {
    let cached = this.berthCache.get(port.id);
    if (!cached || cached.tile !== port.tile) {
      cached = { tile: port.tile, rows: portWaterTiles(this.map, port.tile) }; this.berthCache.set(port.id, cached);
    }
    return cached.rows.find(tile => this.water.component[tile] === component);
  }
  /** Called only when Trade publishes a changed coherent seaMarkets map. */
  marketsChanged(markets: ReadonlyMap<number, readonly Building[]>): void {
    for (const [component, rows] of markets) {
      let catalog = this.catalogs.get(component);
      if (!catalog) {
        catalog = { component, version: 0, receiverIds: new Int32Array() };
        this.catalogs.set(component, catalog); this.catalogPositions.set(component, this.catalogOrder.length); this.catalogOrder.push(component);
      }
      if (catalog.build) { catalog.build.followupDirty = true; continue; }
      // Membership capture is shared with the existing market refresh; conversion
      // to numeric IDs is charged by gather below, not by each source view.
      this.beginBuild(catalog, rows);
    }
    for (const [component, catalog] of this.catalogs) if (!markets.has(component) && !catalog.build) this.beginBuild(catalog, []);
    for (const [id] of this.berthCache) if (!this.building(id)) this.berthCache.delete(id);
  }
  private bootstrapHeaps = new Map<number, SeaWorkHeap<number>>();
  private inputs = new Map<number, readonly Building[]>();
  private beginBuild(catalog: Catalog, rows: readonly Building[]): void {
    this.inputs.set(catalog.component, rows);
    catalog.build = { inputIds: [], gathered: 0, a: new Int32Array(rows.length), b: new Int32Array(rows.length),
      width: 1, block: 0, left: 0, right: 1, write: 0, stage: "gather", followupDirty: false, initialPublished: false,
      bootstrapInput: [], bootstrapOffset: 0, bootstrap: catalog.receiverIds.length === 0 };
  }
  view(actorId: number, owner: number, departurePortTile: number, component: number): SeaPolicyView {
    const key = `${owner}:${departurePortTile}:${component}`;
    if (this.actors.get(actorId) !== key) {
      this.releaseActor(actorId); this.actors.set(actorId, key);
      let users = this.users.get(key); if (!users) { users = new Set(); this.users.set(key, users); } users.add(actorId);
    }
    let view = this.policies.get(key);
    if (!view) {
      view = { key, owner, departurePortTile, component, explorationStart: 0, nearest: [], exploration: [],
        passComplete: false, catalogVersion: -1, passOrdinal: 0, pruneIndex: 0, pruneRemaining: 0 };
      this.policies.set(key, view); this.policyPositions.set(key, this.policyOrder.length); this.policyOrder.push(key);
    }
    return view;
  }
  releaseActor(id: number): void {
    const key = this.actors.get(id); if (!key) return;
    this.actors.delete(id); const users = this.users.get(key)!; users.delete(id);
    if (users.size) return;
    this.users.delete(key); this.policies.delete(key);
    const at = this.policyPositions.get(key)!, last = this.policyOrder.pop()!;
    this.policyPositions.delete(key);
    if (at < this.policyOrder.length) { this.policyOrder[at] = last; this.policyPositions.set(last, at); }
    this.policyCursor = this.policyOrder.length ? this.policyCursor % this.policyOrder.length : 0;
  }
  private candidate(view: SeaPolicyView, id: number): SeaCandidate | undefined {
    const port = this.building(id);
    if (!port || !this.eligible(view.owner, port)) return undefined;
    const berth = this.berth(port, view.component); if (berth === undefined) return undefined;
    return { receiverId: id, portTile: port.tile, owner: port.playerId, berth,
      distanceSquared: this.map.euclideanDistSquared(view.departurePortTile, port.tile) };
  }
  actorView(id: number): SeaPolicyView | undefined { const key = this.actors.get(id); return key === undefined ? undefined : this.policies.get(key); }
  /** Source policy metadata survives the last idle courier leaving its view. */
  rememberSource(view: SeaPolicyView, receiverId: number): void {
    const rows = this.sourceHints.get(view.key) ?? [];
    const at = rows.indexOf(receiverId); if (at >= 0) rows.splice(at, 1);
    rows.push(receiverId); if (rows.length > 2) rows.shift();
    this.sourceHints.set(view.key, rows);
  }
  retainSources(active: ReadonlySet<string>): void {
    for (const key of this.sourceHints.keys()) {
      const [owner, tile] = key.split(":");
      if (!active.has(`${owner}:1:${tile}`)) this.sourceHints.delete(key);
    }
  }
  candidates(view: SeaPolicyView, pendingReceiverId?: number): SeaCandidate[] {
    const result: SeaCandidate[] = [], seen = new Set<number>();
    // Retained sources use up to two of the same eight descriptor slots.
    const hints = this.sourceHints.get(view.key) ?? [];
    const initial = [...new Set([...hints, ...view.nearest.map(row => row.receiverId), ...view.exploration.map(row => row.receiverId)])].slice(0, 8);
    const reservePending = pendingReceiverId !== undefined && !initial.includes(pendingReceiverId);
    // A pending target replaces a nearest slot, never the guaranteed rotating
    // exploration width. Otherwise a persistent pending target skips residues.
    const nearest = reservePending ? view.nearest.slice(0, 3) : view.nearest;
    const ids = reservePending ? [...new Set([pendingReceiverId, ...hints, ...nearest.map(row => row.receiverId),
      ...view.exploration.map(row => row.receiverId)])].slice(0, 8) : initial;
    for (const id of ids) {
      const live = this.candidate(view, id);
      if (live && !seen.has(live.portTile)) { seen.add(live.portTile); result.push(live); }
    }
    return result;
  }
  private catalogUnit(markets: ReadonlyMap<number, readonly Building[]>): boolean {
    if (!this.catalogOrder.length) return false;
    // A visit inspects one catalog. Empty visits still consume one bounded unit.
    const component = this.catalogOrder[this.catalogCursor++ % this.catalogOrder.length];
    this.catalogCursor %= this.catalogOrder.length;
    const catalog = this.catalogs.get(component)!, build = catalog.build;
    if (!build) return false;
    const count = build.a.length;
    if (build.stage === "gather") {
      if (build.bootstrapOutput) {
        const heap = this.bootstrapHeaps.get(component);
        if (!heap) throw Error("Missing sea bootstrap work index");
        if (build.bootstrapOffset < build.bootstrapOutput.length) {
          build.bootstrapOutput[build.bootstrapOffset++] = heap.pop()!; return true;
        }
        // Publish one complete sorted bootstrap chunk. A source can discover
        // foreign ports while the rest of this basin is still being gathered.
        catalog.receiverIds = build.bootstrapOutput; catalog.version++;
        build.bootstrapInput = []; build.bootstrapOutput = undefined; build.bootstrapOffset = 0;
        this.bootstrapHeaps.delete(component); build.initialPublished = true; return true;
      }
      const source = this.inputs.get(component);
      if (build.gathered < count) {
        const id = source ? source[build.gathered].id : build.inputIds[build.gathered];
        build.a[build.gathered++] = id;
        if (source) build.inputIds.push(id);
        if (build.bootstrap) {
          let heap = this.bootstrapHeaps.get(component);
          if (!heap) { heap = new SeaWorkHeap<number>((a, b) => a < b); this.bootstrapHeaps.set(component, heap); }
          heap.update(id); build.bootstrapInput.push(id);
          if (build.bootstrapInput.length === 32 || build.gathered === count) build.bootstrapOutput = new Int32Array(build.bootstrapInput.length);
        }
        return true;
      }
      build.stage = "merge"; return true;
    }
    if (build.width >= count) {
      catalog.receiverIds = build.a; catalog.version++;
      const dirty = build.followupDirty;
      catalog.build = undefined; this.inputs.delete(component);
      if (dirty) this.beginBuild(catalog, markets.get(component) ?? []);
      else if (!count && !markets.has(component)) {
        const at = this.catalogPositions.get(component)!, last = this.catalogOrder.pop()!;
        this.catalogs.delete(component); this.catalogPositions.delete(component);
        if (at < this.catalogOrder.length) { this.catalogOrder[at] = last; this.catalogPositions.set(last, at); }
        this.catalogCursor = this.catalogOrder.length ? this.catalogCursor % this.catalogOrder.length : 0;
      }
      return true;
    }
    const middle = Math.min(build.block + build.width, count), end = Math.min(build.block + 2 * build.width, count);
    if (build.write < end) {
      if (build.left < middle && (build.right >= end || build.a[build.left] <= build.a[build.right])) build.b[build.write++] = build.a[build.left++];
      else build.b[build.write++] = build.a[build.right++];
      return true;
    }
    // Publish the first sorted run early during initial bootstrap. Later catalog
    // replacements are atomic; churn cannot reset an in-progress finite build.
    if (!catalog.receiverIds.length && !build.initialPublished && build.block === 0 && (build.width >= 16 || end === count)) {
      catalog.receiverIds = build.b.slice(0, end); catalog.version++; build.initialPublished = true;
    }
    build.block = end;
    if (end === count) { [build.a, build.b] = [build.b, build.a]; build.width *= 2; build.block = 0; }
    build.left = build.block; build.right = Math.min(build.block + build.width, count); build.write = build.block;
    return true;
  }
  private policyUnit(): boolean {
    if (!this.policyOrder.length) return false;
    const key = this.policyOrder[this.policyCursor++ % this.policyOrder.length];
    this.policyCursor %= this.policyOrder.length;
    const view = this.policies.get(key)!, catalog = this.catalogs.get(view.component);
    if (!catalog?.receiverIds.length) return false;
    const rows = catalog.receiverIds;
    if (view.passUpperId === undefined) {
      view.passUpperId = rows[rows.length - 1]; view.passOrdinal = 0;
      view.scanAfterReceiverId = undefined; view.exploration = [];
      view.pruneIndex = 0; view.pruneRemaining = view.nearest.length;
      return true;
    }
    if (view.pruneRemaining) {
      const row = view.nearest[view.pruneIndex], current = this.candidate(view, row.receiverId);
      if (!current) view.nearest.splice(view.pruneIndex, 1);
      else { view.nearest[view.pruneIndex] = current; view.pruneIndex++; }
      view.pruneRemaining--; return true;
    }
    const at = upperBound(rows, view.scanAfterReceiverId ?? -1);
    if (at >= rows.length || rows[at] > view.passUpperId) {
      view.passComplete = true; view.passUpperId = undefined;
      // Hints occupy up to two candidate slots. Advance only the guaranteed
      // visible exploration width; a stride of four would skip whole residues.
      const explorationWidth = 4 - (this.sourceHints.get(view.key)?.length ?? 0);
      view.explorationStart = (view.explorationStart + explorationWidth) % Math.max(1, view.passOrdinal);
      view.catalogVersion = catalog.version; return true;
    }
    const id = rows[at]; view.scanAfterReceiverId = id;
    const candidate = this.candidate(view, id); if (!candidate) return true;
    const ordinal = view.passOrdinal++;
    if (!view.nearest.some(row => row.portTile === candidate.portTile)) {
      let insert = 0;
      while (insert < view.nearest.length && (view.nearest[insert].distanceSquared < candidate.distanceSquared ||
        view.nearest[insert].distanceSquared === candidate.distanceSquared && view.nearest[insert].receiverId < id)) insert++;
      if (insert < 4) { view.nearest.splice(insert, 0, candidate); view.nearest.length = Math.min(4, view.nearest.length); }
    }
    if (ordinal >= view.explorationStart && view.exploration.length < 4 &&
      !view.exploration.some(row => row.portTile === candidate.portTile)) view.exploration.push(candidate);
    return true;
  }
  step(budget: number, markets: ReadonlyMap<number, readonly Building[]>): number {
    let catalogUsed = 0, policyUsed = 0;
    // Each inspected catalog/view is charged even when idle; no full-list scan
    // can hide in one work unit. Borrow only when the other class is empty.
    const catalogLimit = this.policyOrder.length ? Math.min(512, budget) : budget;
    for (; catalogUsed + 4 <= catalogLimit && this.catalogOrder.length; catalogUsed += 4) this.catalogUnit(markets);
    for (; catalogUsed + policyUsed < budget && this.policyOrder.length; policyUsed++) this.policyUnit();
    this.diagnostics.catalogWork += catalogUsed; this.diagnostics.policyWork += policyUsed;
    return catalogUsed + policyUsed;
  }
  checkpoint(): SeaPortsCheckpoint {
    const saved = structuredClone({ catalogs: [...this.catalogs] as [number, Catalog][], policies: [...this.policies] as [string, SeaPolicyView][],
      actors: [...this.actors] as [number, string][], order: { catalogs: this.catalogOrder, policies: this.policyOrder },
      catalogCursor: this.catalogCursor, policyCursor: this.policyCursor, sourceHints: [...this.sourceHints] as [string, number[]][] });
    for (const [component, catalog] of saved.catalogs) {
      const source = this.inputs.get(component);
      if (catalog.build && source) catalog.build.inputIds = source.map(row => row.id);
    }
    return saved;
  }
  restore(saved: SeaPortsCheckpoint): void {
    validateSeaPortsMetadata(saved, this.map.width() * this.map.height());
    this.catalogs.clear(); this.policies.clear(); this.actors.clear(); this.users.clear(); this.inputs.clear(); this.bootstrapHeaps.clear(); this.berthCache.clear();
    this.catalogPositions.clear(); this.policyPositions.clear(); this.sourceHints.clear();
    const s = structuredClone(saved);
    for (const [component, catalog] of s.catalogs) {
      if (this.catalogs.has(component) || component !== catalog.component || !Number.isSafeInteger(component) || component <= 0 ||
        !(catalog.receiverIds instanceof Int32Array)) throw Error("Invalid sea basin catalog");
      for (let i = 0; i < catalog.receiverIds.length; i++) if (catalog.receiverIds[i] < 0 || i && catalog.receiverIds[i] <= catalog.receiverIds[i - 1]) throw Error("Unsorted sea catalog");
      const b = catalog.build;
      if (b && (!(b.a instanceof Int32Array) || !(b.b instanceof Int32Array) || b.a.length !== b.b.length ||
        b.inputIds.length !== b.a.length || ![b.gathered, b.width, b.block, b.left, b.right, b.write].every(n => Number.isSafeInteger(n) && n >= 0) ||
        !b.width || b.gathered > b.a.length || b.block > b.a.length || b.left > b.a.length || b.right > b.a.length || b.write > b.a.length ||
        !["gather", "merge"].includes(b.stage) || !Array.isArray(b.bootstrapInput) || b.bootstrapInput.length > 32 ||
        !Number.isSafeInteger(b.bootstrapOffset) || b.bootstrapOffset < 0 || b.bootstrapOffset > (b.bootstrapOutput?.length ?? 0) ||
        b.bootstrapOutput && (!(b.bootstrapOutput instanceof Int32Array) || b.bootstrapOutput.length !== b.bootstrapInput.length))) throw Error("Invalid sea catalog continuation");
      this.catalogs.set(component, catalog);
      if (b?.bootstrapInput.length) {
        const heap = new SeaWorkHeap<number>((a, b) => a < b);
        for (const id of b.bootstrapInput) heap.update(id);
        for (let i = 0; i < b.bootstrapOffset; i++) heap.remove(b.bootstrapOutput![i]);
        this.bootstrapHeaps.set(component, heap);
      }
    }
    for (const [key, rows] of s.sourceHints ?? []) {
      const parts = key.split(":").map(Number);
      if (this.sourceHints.has(key) || parts.length !== 3 || parts.some(n => !Number.isSafeInteger(n) || n < 0) ||
        key !== parts.join(":") || !parts[0] || parts[1] >= this.map.width() * this.map.height() || !parts[2] ||
        rows.length > 2 || new Set(rows).size !== rows.length || rows.some(id => !Number.isSafeInteger(id) || id <= 0)) throw Error("Invalid sea source hints");
      this.sourceHints.set(key, rows);
    }
    for (const [key, view] of s.policies) {
      if (this.policies.has(key) || view.key !== key || key !== `${view.owner}:${view.departurePortTile}:${view.component}` ||
        view.nearest.length > 4 || view.exploration.length > 4 ||
        !Number.isSafeInteger(view.pruneIndex) || !Number.isSafeInteger(view.pruneRemaining) ||
        view.pruneIndex < 0 || view.pruneRemaining < 0 || view.pruneIndex + view.pruneRemaining > view.nearest.length) throw Error("Invalid sea policy view");
      this.policies.set(key, view); this.users.set(key, new Set());
    }
    for (const [id, key] of s.actors) {
      if (this.actors.has(id) || !this.users.has(key)) throw Error("Invalid sea policy user");
      this.actors.set(id, key); this.users.get(key)!.add(id);
    }
    this.catalogOrder = s.order.catalogs; this.policyOrder = s.order.policies;
    for (const [rows, entries, positions] of [[this.catalogOrder, this.catalogs, this.catalogPositions], [this.policyOrder, this.policies, this.policyPositions]] as const) {
      if (rows.length !== entries.size || new Set<string | number>(rows).size !== rows.length) throw Error("Invalid sea discovery order");
      rows.forEach((id, i) => { if (!(entries as Map<string | number, unknown>).has(id)) throw Error("Unknown sea discovery entry"); (positions as Map<string | number, number>).set(id, i); });
    }
    this.catalogCursor = s.catalogCursor; this.policyCursor = s.policyCursor;
    if (![this.catalogCursor, this.policyCursor].every(n => Number.isSafeInteger(n) && n >= 0) ||
      this.catalogCursor >= Math.max(1, this.catalogOrder.length) || this.policyCursor >= Math.max(1, this.policyOrder.length)) throw Error("Invalid sea discovery cursor");
  }
}


/** Validate small index metadata before cloning checkpoint payloads. Stale
 * building identities are legitimate; malformed numeric cursors are not. */
export function validateSeaPortsMetadata(saved: SeaPortsCheckpoint, cells: number): void {
  const integer = (value: unknown, minimum = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
  const tile = (value: unknown) => integer(value) && value < cells;
  const optionalId = (value: unknown) => value === undefined || integer(value, 1);
  const candidate = (row: SeaCandidate) => !!row && integer(row.receiverId, 1) && integer(row.owner, 1) &&
    tile(row.portTile) && tile(row.berth) && integer(row.distanceSquared);
  for (const [component, catalog] of saved.catalogs) {
    if (!integer(component, 1) || component !== catalog.component || !integer(catalog.version) ||
      !(catalog.receiverIds instanceof Int32Array) || catalog.receiverIds.some(id => id <= 0)) throw Error("Invalid sea port metadata");
    const build = catalog.build;
    if (build && (typeof build.followupDirty !== "boolean" || typeof build.initialPublished !== "boolean" || typeof build.bootstrap !== "boolean" ||
      !Array.isArray(build.inputIds) || build.inputIds.some(id => !integer(id, 1)) ||
      !Array.isArray(build.bootstrapInput) || build.bootstrapInput.some(id => !integer(id, 1)))) throw Error("Invalid sea port metadata");
  }
  for (const [key, view] of saved.policies) {
    if (!integer(view.owner, 1) || !tile(view.departurePortTile) || !integer(view.component, 1) ||
      key !== view.key || key !== `${view.owner}:${view.departurePortTile}:${view.component}` ||
      !integer(view.catalogVersion, -1) || !integer(view.explorationStart) || !integer(view.passOrdinal) ||
      typeof view.passComplete !== "boolean" || !optionalId(view.scanAfterReceiverId) || !optionalId(view.passUpperId) ||
      view.scanAfterReceiverId !== undefined && view.passUpperId !== undefined && view.scanAfterReceiverId > view.passUpperId ||
      view.lastCommittedPortTile !== undefined && !tile(view.lastCommittedPortTile) ||
      !Array.isArray(view.nearest) || view.nearest.length > 4 || !view.nearest.every(candidate) ||
      !Array.isArray(view.exploration) || view.exploration.length > 4 || !view.exploration.every(candidate)) throw Error("Invalid sea port metadata");
  }
  for (const [id, key] of saved.actors) if (!integer(id, 1) || typeof key !== "string") throw Error("Invalid sea port metadata");
}
