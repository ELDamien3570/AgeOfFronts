import type { ExpansionSnapshot, TradeActor } from "./domain/Definitions";
import { tradeDetailRevision } from "./domain/TradePublication";

type Trader = ExpansionSnapshot["traders"][number];
type Detail = Omit<Trader, "x" | "y" | "waitTicks">;
const STRIDE = 4, MAX_TRADERS = 65_536;
export interface TraderChanges {
  version: 1;
  reset: boolean;
  motion: Float64Array;
  upserts: Detail[];
  removed: Int32Array;
}
const privateFields = new Set(["path", "nextPathIndex", "supplyWaitTicks", "supplyWaitStartedTick", "tripSupplyTicks", "routeOriginOwner"]);
function details(row: Trader | TradeActor, borrowed: boolean): Detail {
  if (borrowed) {
    const { path: _path, nextPathIndex: _index, supplyWaitTicks: _supplyWait,
      supplyWaitStartedTick: _waitStart, tripSupplyTicks: _tripSupply, routeOriginOwner: _routeOwner,
      x: _x, y: _y, waitTicks: _wait, ...rest } = row as TradeActor;
    return { ...rest, waitingForCargo: row.state === "loading" && _waitStart !== undefined };
  }
  const { x: _x, y: _y, waitTicks: _wait, ...rest } = row;
  return rest;
}
// Trade DTOs have scalar fields and numeric lists. A saved copy is essential:
// lists such as visited/stops mutate in place in the authoritative domain.
function same(a: Detail, keys: readonly string[], b: Trader | TradeActor, borrowed: boolean): boolean {
  let count = 0;
  for (const key of Object.keys(b)) if (!borrowed || !privateFields.has(key)) count++;
  if (keys.length + 3 !== count + Number(borrowed)) return false;
  for (const key of keys) {
    const x = (a as unknown as Record<string, unknown>)[key], y = borrowed && key === "waitingForCargo"
      ? b.state === "loading" && (b as TradeActor).supplyWaitStartedTick !== undefined
      : (b as unknown as Record<string, unknown>)[key];
    if (Array.isArray(x)) {
      if (!Array.isArray(y) || x.length !== y.length || x.some((v, i) => v !== y[i])) return false;
    } else if (!Object.is(x, y) || x === undefined && !Object.prototype.hasOwnProperty.call(b, key)) return false;
  }
  return true;
}
function copy(row: Detail): Detail {
  const output = { ...row };
  for (const key of Object.keys(output)) {
    const value = (output as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) (output as unknown as Record<string, unknown>)[key] = value.slice();
  }
  return output;
}
export class TraderEncoder {
  private readonly retained = new Map<number, { detail: Detail; keys: string[]; revision?: number; owner?: TradeActor }>();
  encode(rows: readonly (Trader | TradeActor)[], reset: boolean, borrowed = false): TraderChanges {
    if (reset) this.retained.clear();
    const motion = new Float64Array(rows.length * STRIDE), upserts: Detail[] = [], live = new Set<number>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], at = i * STRIDE, old = this.retained.get(row.id);
      const revision = borrowed ? tradeDetailRevision(row as TradeActor) : undefined;
      live.add(row.id);
      motion[at] = row.id; motion[at + 1] = row.x; motion[at + 2] = row.y; motion[at + 3] = row.waitTicks;
      const needsCheck = !old || revision === undefined || old.owner !== row || old.revision !== revision;
      if (needsCheck && (!old || !same(old.detail, old.keys, row, borrowed))) {
        const saved = copy(details(row, borrowed)); this.retained.set(row.id, { detail: saved, keys: Object.keys(saved), revision, owner: revision === undefined ? undefined : row as TradeActor }); upserts.push(saved);
      } else if (old) { old.revision = revision; old.owner = revision === undefined ? undefined : row as TradeActor; }
    }
    const removed: number[] = [];
    for (const id of this.retained.keys()) if (!live.has(id)) { removed.push(id); this.retained.delete(id); }
    return { version: 1, reset, motion, upserts, removed: new Int32Array(removed) };
  }
}
interface StagedTraders { records: Map<number, Detail>; rows: Trader[] }
export class TraderDecoder {
  private retained = new Map<number, Detail>();
  private initialized = false;
  clear(): void { this.retained.clear(); this.initialized = false; }
  stage(changes: TraderChanges): StagedTraders {
    const fail = () => { throw Error("Invalid trader stream"); };
    if (changes.version !== 1 || typeof changes.reset !== "boolean" ||
      !(changes.motion instanceof Float64Array) || changes.motion.length % STRIDE || changes.motion.length / STRIDE > MAX_TRADERS ||
      !(changes.removed instanceof Int32Array) || !Array.isArray(changes.upserts) || changes.upserts.length > MAX_TRADERS ||
      changes.removed.length > MAX_TRADERS || (!changes.reset && !this.initialized)) fail();
    const updates = new Map<number, Detail>(), removed = new Set<number>();
    const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
    for (const id of changes.removed) { if (!validId(id) || removed.has(id)) fail(); removed.add(id); }
    for (const row of changes.upserts) {
      if (!row || !validId(row.id) || updates.has(row.id) || removed.has(row.id)) fail();
      for (const [key, value] of Object.entries(row)) {
        if (["x", "y", "waitTicks"].includes(key)) fail();
        if (Array.isArray(value)) { if (value.length > MAX_TRADERS || value.some(v => !Number.isFinite(v))) fail(); }
        else if (value !== undefined && value !== null && !["number", "string", "boolean"].includes(typeof value)) fail();
        else if (typeof value === "number" && !Number.isFinite(value)) fail();
      }
      if (!validId(row.playerId) || typeof row.definitionId !== "string" || typeof row.naval !== "boolean" ||
        !["loading", "outbound", "returning", "prize", "waiting"].includes(row.state) ||
        !Array.isArray(row.stops) || !Array.isArray(row.visited) || !Array.isArray(row.quoteAllies)) fail();
      for (const key of ["factoryId", "cargo", "loaded", "delivered", "lost", "returned", "valuePerGood", "originTile", "capacity", "shipmentId"] as const)
        if (typeof row[key] !== "number" || !Number.isFinite(row[key])) fail();
      if (row.destination !== null && !Number.isSafeInteger(row.destination)) fail();
      if (row.waitingForCargo !== undefined && typeof row.waitingForCargo !== "boolean") fail();
      if (row.waitingReason !== undefined && !["cargo", "planning", "no-receiver", "unreachable", "handling", "capacity"].includes(row.waitingReason)) fail();
      updates.set(row.id, copy(row));
    }
    const records = new Map<number, Detail>(), rows: Trader[] = [];
    for (let at = 0; at < changes.motion.length; at += STRIDE) {
      const id = changes.motion[at], x = changes.motion[at + 1], y = changes.motion[at + 2], waitTicks = changes.motion[at + 3];
      if (!validId(id) || records.has(id) || removed.has(id) || !Number.isFinite(x) || !Number.isFinite(y) ||
        !Number.isSafeInteger(waitTicks) || waitTicks < 0) fail();
      const detail = updates.get(id) ?? (!changes.reset ? this.retained.get(id) : undefined);
      if (!detail) fail();
      records.set(id, detail!); rows.push({ ...detail!, x, y, waitTicks });
    }
    for (const id of updates.keys()) if (!records.has(id)) fail();
    // A complete ordered motion roster is authoritative for retained lifetime.
    // Requiring explicit removals catches truncated deltas instead of dropping actors.
    if (!changes.reset) for (const id of this.retained.keys()) if (!records.has(id) && !removed.has(id)) fail();
    return { records, rows };
  }
  commit(staged: StagedTraders): void { this.retained = staged.records; this.initialized = true; }
}
