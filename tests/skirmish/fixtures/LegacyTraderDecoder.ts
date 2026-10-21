// Frozen decoder from ea9514b1. Compatibility fixture: do not modernize.
import type { ExpansionSnapshot } from "../../../src/skirmish/domain/Definitions";
import type { TraderChanges } from "../../../src/skirmish/TraderStream";
type Trader = ExpansionSnapshot["traders"][number];
type Detail = Omit<Trader, "x" | "y" | "waitTicks">;
const STRIDE = 4, MAX_TRADERS = 65_536;
function copy(row: Detail): Detail {
  const output = { ...row };
  for (const key of Object.keys(output)) {
    const value = (output as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) (output as unknown as Record<string, unknown>)[key] = value.slice();
  }
  return output;
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
