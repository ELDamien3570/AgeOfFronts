import { FIXED, MAX_SQUADS } from "./Protocol";
import type { FormationState } from "./domain/FormationGeometry";

type Kind = "trail" | "slots";
type Point = Readonly<{ x: number; y: number; row?: number }>;
const LIMIT = MAX_SQUADS * 255 * 3;
export interface FormationSlotChanges {
  reset: boolean;
  upserts: { id: number; kind: Kind; coordinates: Float64Array }[];
  removed: Int32Array;
}
interface Entry { kind: Kind; points: readonly Point[] }

/** Encoder-owned immutable geometry, retained only by current squad rows. */
export class FormationSlotEncoder {
  private ids = new WeakMap<object, Partial<Record<Kind, number>>>();
  private inline = new WeakSet<object>();
  private readonly entries = new Map<number, Entry & { references: number }>();
  private readonly owners = new Map<number, Set<number>>();
  private readonly upserts = new Map<number, FormationSlotChanges["upserts"][number]>();
  private readonly removed = new Set<number>();
  private readonly retired = new Map<number, Entry>();
  private nextId = 1;
  private resetPending = true;
  get retainedEntries(): number { return this.entries.size; }
  clear(): void {
    this.ids = new WeakMap(); this.inline = new WeakSet(); this.entries.clear(); this.owners.clear();
    this.upserts.clear(); this.removed.clear(); this.retired.clear(); this.nextId = 1; this.resetPending = true;
  }
  private release(id: number): void {
    const entry = this.entries.get(id)!;
    if (--entry.references > 0) return;
    this.entries.delete(id);
    // An entry created and retired before publication needs no wire removal.
    if (!this.upserts.delete(id)) { this.removed.add(id); this.retired.set(id, entry); }
  }
  forget(owner: number): void {
    for (const id of this.owners.get(owner) ?? []) this.release(id);
    this.owners.delete(owner);
  }
  private reference(points: readonly Point[], kind: Kind, used: Set<number>): unknown {
    if (this.inline.has(points)) return points;
    let keys = this.ids.get(points);
    if (!keys) {
      // Preserve any extension fields through the existing JSON projection.
      const fields = kind === "trail" ? ["x", "y"] : ["x", "y", "row"];
      if (points.some(point => !point || Object.keys(point).some(key => !fields.includes(key)))) {
        this.inline.add(points); return points;
      }
      keys = {}; this.ids.set(points, keys);
    }
    let id = keys[kind];
    if (id === undefined) {
      if (this.nextId > 0x7ffffffe) throw new Error("Formation slot ID space exhausted; reset the encoder");
      keys[kind] = id = this.nextId++;
    }
    if (!this.entries.has(id)) {
      if (this.entries.size >= LIMIT) throw new Error("Formation slot table capacity exceeded");
      this.entries.set(id, { kind, points, references: 0 });
      // Resurrecting an entry removed earlier in this packet keeps its baseline.
      const restored = this.removed.delete(id);
      this.retired.delete(id);
      if (!restored) {
        const stride = kind === "trail" ? 2 : 3;
        const coordinates = new Float64Array(points.length * stride);
        for (let i = 0; i < points.length; i++) {
          // Preserve the former JSON projection's normalization of negative zero.
          coordinates[i * stride] = points[i].x === 0 ? 0 : points[i].x;
          coordinates[i * stride + 1] = points[i].y === 0 ? 0 : points[i].y;
          if (stride === 3) coordinates[i * stride + 2] = points[i].row === 0 ? 0 : points[i].row!;
        }
        this.upserts.set(id, { id, kind, coordinates });
      }
    }
    used.add(id);
    return { $formationSlots: id };
  }
  encode(owner: number, formation: FormationState | undefined): unknown {
    const used = new Set<number>();
    const result = formation ? {
      ...formation,
      ...(formation.trail ? { trail: this.reference(formation.trail, "trail", used) } : {}),
      ...(formation.occupationSlots ? { occupationSlots: this.reference(formation.occupationSlots, "slots", used) } : {}),
      ...(formation.transition ? { transition: { ...formation.transition,
        ...(formation.transition.fromSlots ? { fromSlots: this.reference(formation.transition.fromSlots, "slots", used) } : {}),
      } } : {}),
    } : undefined;
    const previous = this.owners.get(owner);
    for (const id of used) if (!previous?.has(id)) this.entries.get(id)!.references++;
    for (const id of previous ?? []) if (!used.has(id)) this.release(id);
    this.owners.set(owner, used);
    return result;
  }
  drain(): FormationSlotChanges {
    const result = { reset: this.resetPending, upserts: [...this.upserts.values()], removed: new Int32Array([...this.removed]) };
    this.resetPending = false; this.upserts.clear(); this.removed.clear(); this.retired.clear(); return result;
  }
  /** Copy this stream's IDs for a new subscriber without draining changes. */
  baseline(): FormationSlotChanges {
    // Include entries retired since the last shared capture: the next delta
    // still owes their removals, and a new subscriber must recognize them too.
    return { reset: true, removed: new Int32Array(), upserts: [...this.entries, ...this.retired].map(([id, entry]) => {
      const stride = entry.kind === "trail" ? 2 : 3;
      const coordinates = new Float64Array(entry.points.length * stride);
      for (let i = 0; i < entry.points.length; i++) {
        const point = entry.points[i];
        coordinates[i * stride] = point.x === 0 ? 0 : point.x;
        coordinates[i * stride + 1] = point.y === 0 ? 0 : point.y;
        if (stride === 3) coordinates[i * stride + 2] = point.row === 0 ? 0 : point.row!;
      }
      return { id, kind: entry.kind, coordinates };
    }) };
  }
}

export interface FormationSlotRead {
  readonly entries: ReadonlyMap<number, Entry>;
  readonly validated: WeakSet<object>;
}
/** Staged receiver state. Rejected packets cannot advance its dictionary. */
export class FormationSlotDecoder {
  private entries = new Map<number, Entry>();
  private baseline = false;
  private readonly validated = new WeakSet<object>();
  get retainedEntries(): number { return this.entries.size; }
  clear(): void { this.entries.clear(); this.baseline = false; }
  stage(changes: FormationSlotChanges | undefined): FormationSlotRead {
    if (!changes || typeof changes.reset !== "boolean" || !Array.isArray(changes.upserts) || !(changes.removed instanceof Int32Array))
      throw new Error("Invalid formation slot changes");
    if (!changes.reset && !this.baseline) throw new Error("Formation slot delta has no baseline");
    if (changes.upserts.length > LIMIT || changes.removed.length > LIMIT) throw new Error("Formation slot table capacity exceeded");
    const entries = changes.reset ? new Map<number, Entry>() : new Map(this.entries);
    const seen = new Set<number>();
    const identity = (id: number) => Number.isSafeInteger(id) && id > 0 && id <= 0x7ffffffe;
    for (const id of changes.removed) {
      if (!identity(id) || seen.has(id) || changes.reset || !entries.delete(id)) throw new Error("Invalid formation slot removal");
      seen.add(id);
    }
    for (const row of changes.upserts) {
      if (!row || !identity(row.id) || seen.has(row.id) || !["trail", "slots"].includes(row.kind) || !(row.coordinates instanceof Float64Array))
        throw new Error("Invalid formation slot update");
      seen.add(row.id);
      const stride = row.kind === "trail" ? 2 : 3, count = row.coordinates.length / stride;
      if (!Number.isInteger(count) || count < (row.kind === "trail" ? 2 : 1) || count > (row.kind === "trail" ? 256 : 144))
        throw new Error("Invalid formation slot length");
      const points: Point[] = [];
      for (let i = 0; i < count; i++) {
        const x = row.coordinates[i * stride], y = row.coordinates[i * stride + 1], rank = row.coordinates[i * stride + 2];
        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || Math.abs(x) > 128 * FIXED || Math.abs(y) > 128 * FIXED || stride === 3 && !Number.isSafeInteger(rank))
          throw new Error("Invalid formation slot coordinate");
        points.push(Object.freeze(stride === 3 ? { x, y, row: rank } : { x, y }));
      }
      const old = entries.get(row.id);
      if (old) {
        if (old.kind !== row.kind || old.points.length !== count || old.points.some((p, i) => p.x !== points[i].x || p.y !== points[i].y || p.row !== points[i].row))
          throw new Error("Immutable formation slot identity changed");
      } else {
        const immutable = Object.freeze(points);
        this.validated.add(immutable);
        entries.set(row.id, { kind: row.kind, points: immutable });
      }
    }
    if (entries.size > LIMIT) throw new Error("Formation slot table capacity exceeded");
    return { entries, validated: this.validated };
  }
  commit(read: FormationSlotRead): void { this.entries = new Map(read.entries); this.baseline = true; }
}

export function resolveFormationSlots(formation: FormationState | undefined, read: FormationSlotRead): void {
  if (!formation || typeof formation !== "object") return;
  const resolve = (value: unknown, kind: Kind): any => {
    if (value === undefined || Array.isArray(value)) return value;
    if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || !("$formationSlots" in value)) throw new Error("Invalid formation slot reference");
    const id = (value as { $formationSlots: number }).$formationSlots;
    const entry = read.entries.get(id);
    if (!entry || entry.kind !== kind) throw new Error("Formation slot reference has no baseline");
    return entry.points;
  };
  if (formation.trail !== undefined) formation.trail = resolve(formation.trail, "trail");
  if (formation.occupationSlots !== undefined) formation.occupationSlots = resolve(formation.occupationSlots, "slots");
  if (formation.transition?.fromSlots !== undefined) formation.transition.fromSlots = resolve(formation.transition.fromSlots, "slots");
}
