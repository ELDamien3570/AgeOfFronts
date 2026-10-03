import type { GameMap } from "../../core/game/GameMap";
import type { BuildingType } from "../Protocol";
import { BUILDING_SPACING } from "../Rules";
import type { Deposit } from "./Definitions";

type Node = Readonly<Deposit>;
const EMPTY: readonly Node[] = Object.freeze([]);
interface OwnerBucket {
  rows: Node[];
  view?: readonly Node[];
}
/** Placement geometry is refreshed at generation/import/explicit geometry
 * mutation. Unversioned DTO callers retain exact content validation. */
export class ResourceSiteIndex {
  private readonly nodes = new Map<number, Node>();
  private readonly exclusion = new Set<number>();
  private readonly ownerGroups = new Map<number, OwnerBucket>();
  private readonly facts = new Map<
    number,
    { owner: number; ordinal: number }
  >();
  private signature?: string;
  private version?: number;
  private ownershipVersion?: number;
  private readonly counters = {
    geometryRebuilds: 0,
    geometryRows: 0,
    signatureRows: 0,
    ownerUpdates: 0,
  };
  constructor(private readonly map: GameMap) {}
  update(
    deposits: readonly Node[],
    geometryVersion?: number,
    ownershipVersion?: number,
  ): boolean {
    if (geometryVersion !== undefined && geometryVersion === this.version) {
      if (
        ownershipVersion !== undefined &&
        ownershipVersion !== this.ownershipVersion
      ) {
        this.refreshRecords(deposits);
        this.ownershipVersion = ownershipVersion;
      }
      return false;
    }
    let rebuild = true;
    if (geometryVersion === undefined) {
      this.counters.signatureRows += deposits.length;
      const signature = deposits
        .map((d) => `${d.id}:${d.tile}:${d.resource}`)
        .join("|");
      rebuild = signature !== this.signature;
      this.signature = signature;
    } else this.signature = undefined;
    this.version = geometryVersion;
    // Imported arrays may contain fresh records even with identical geometry.
    this.refreshRecords(deposits);
    this.ownershipVersion = ownershipVersion;
    if (!rebuild) return false;
    this.counters.geometryRebuilds++;
    this.counters.geometryRows += deposits.length;
    this.exclusion.clear();
    for (const node of deposits) {
      if (node.resource === "horses" || !this.map.isLand(node.tile)) continue;
      const x = this.map.x(node.tile),
        y = this.map.y(node.tile);
      for (let dy = -BUILDING_SPACING + 1; dy < BUILDING_SPACING; dy++)
        for (let dx = -BUILDING_SPACING + 1; dx < BUILDING_SPACING; dx++)
          if (
            dx * dx + dy * dy < BUILDING_SPACING ** 2 &&
            this.map.isValidCoord(x + dx, y + dy)
          )
            this.exclusion.add(this.map.ref(x + dx, y + dy));
    }
    return true;
  }
  private refreshRecords(deposits: readonly Node[]): void {
    this.nodes.clear();
    this.ownerGroups.clear();
    this.facts.clear();
    let ordinal = 0;
    for (const node of deposits) {
      this.nodes.set(node.tile, node);
      this.facts.set(node.id, { owner: node.owner, ordinal: ordinal++ });
      this.insertOwner(node);
    }
  }
  private insertOwner(node: Node): void {
    let bucket = this.ownerGroups.get(node.owner);
    if (!bucket) this.ownerGroups.set(node.owner, (bucket = { rows: [] }));
    const ordinal = this.facts.get(node.id)!.ordinal;
    let low = 0,
      high = bucket.rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.facts.get(bucket.rows[middle].id)!.ordinal < ordinal)
        low = middle + 1;
      else high = middle;
    }
    bucket.rows.splice(low, 0, node);
    bucket.view = undefined;
  }
  changedOwner(node: Node): void {
    const facts = this.facts.get(node.id)!;
    if (facts.owner === node.owner) return;
    const bucket = this.ownerGroups.get(facts.owner)!;
    bucket.rows.splice(
      bucket.rows.findIndex((row) => row.id === node.id),
      1,
    );
    bucket.view = undefined;
    if (!bucket.rows.length) this.ownerGroups.delete(facts.owner);
    facts.owner = node.owner;
    this.insertOwner(node);
    this.counters.ownerUpdates++;
  }
  byOwner(owner: number): readonly Node[] {
    const bucket = this.ownerGroups.get(owner);
    return bucket
      ? (bucket.view ??= Object.freeze(bucket.rows.slice()))
      : EMPTY;
  }
  diagnostics() {
    return {
      ...this.counters,
      indexedRows: this.facts.size,
      ownerGroups: this.ownerGroups.size,
    };
  }
  at(tile: number): Node | undefined {
    return this.nodes.get(tile);
  }
  rejection(type: BuildingType, tile: number): string | null {
    return !["mine", "oil-well", "oil-rig"].includes(type) &&
      this.exclusion.has(tile)
      ? "Leave room for resource extraction sites"
      : null;
  }
}
