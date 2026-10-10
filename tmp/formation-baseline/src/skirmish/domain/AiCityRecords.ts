import type { GameMap } from "../../core/game/GameMap";
import type { Building, BuildingType } from "../Protocol";

interface Site {
  tile: number;
  playerId: number;
  anchor: "city" | "core" | "outpost";
  buildings: number[];
  types: Set<BuildingType>;
}
export interface AiCityRecord {
  id: string;
  playerId: number;
  anchorTile: number;
  kind: Site["anchor"];
  sites: number[];
  siteSet: Set<number>;
  buildings: number[];
  bounds: { left: number; top: number; right: number; bottom: number };
  stableSince: number;
  revision: number;
  complete: boolean;
}
interface Search {
  site: Site;
  bucket: number;
  entry: number;
  candidates: { tile: number; distance: number }[];
  truncated: boolean;
  candidate: number;
  queue: number[];
  seen: Set<number>;
  cursor: number;
  phase: "candidates" | "connectivity";
}
interface Scan {
  cursor: number;
  sites: Map<string, Site>;
  list: Site[];
  anchors: Map<string, Site[]>;
  records: Map<string, AiCityRecord>;
  phase: "facts" | "anchors" | "assign" | "publish" | "remove";
  keys: string[];
  compare?: { at: number; sameProposal: boolean; samePrevious: boolean };
  search?: Search;
}
const excluded = new Set<BuildingType>([
  "tower",
  "trench",
  "gun-nest",
  "missile-defence",
  "missile-silo",
  "mirv-launcher",
]);
const cores = new Set<BuildingType>([
  "factory",
  "barracks",
  "blacksmith",
  "armory",
  "arms-factory",
  "depot",
  "airstrip",
]);

/** Productive sites attach directly to a nearby owned-connected anchor, never
 * to another member of a growing chain. The initial 24-tile extent is a tuning
 * value, not a capacity promise. Towers cannot recursively grow the footprint.
 */
export class AiCityRecords {
  private scan?: Scan;
  readonly records = new Map<string, AiCityRecord>();
  private readonly proposals = new Map<
    string,
    {
      sites: Set<number>;
      kind: AiCityRecord["kind"];
      complete: boolean;
      since: number;
    }
  >();
  private recordKeys: string[] = [];
  private nextScan = 0;
  readonly diagnostics = { work: 0, facts: 0, pending: false };
  constructor(
    private readonly map: GameMap,
    private readonly owners: Uint8Array,
    private readonly buildings: () => readonly Building[],
    readonly extent = 24,
  ) {}
  checkpoint() {
    return structuredClone({
      scan: this.scan,
      records: [...this.records],
      proposals: [...this.proposals],
      nextScan: this.nextScan,
      recordKeys: this.recordKeys,
    });
  }
  restore(saved: ReturnType<AiCityRecords["checkpoint"]>): void {
    const state = structuredClone(saved);
    this.scan = state.scan;
    this.nextScan = state.nextScan;
    this.recordKeys = state.recordKeys;
    this.records.clear();
    for (const [id, record] of state.records) this.records.set(id, record);
    this.proposals.clear();
    for (const [id, proposal] of state.proposals)
      this.proposals.set(id, proposal);
  }
  private key(owner: number, tile: number): string {
    return `${owner}:${tile}`;
  }
  private bucket(owner: number, x: number, y: number): string {
    return `${owner}:${x}:${y}`;
  }
  valid(record: AiCityRecord): boolean {
    return (
      record.complete &&
      record.sites.every((tile) => this.owners[tile] === record.playerId)
    );
  }
  private assign(
    scan: Scan,
    site: Site,
    anchor: number,
    complete: boolean,
    tick: number,
  ): void {
    const id = this.key(site.playerId, anchor),
      record = scan.records.get(id),
      x = this.map.x(site.tile),
      y = this.map.y(site.tile);
    if (record) {
      record.sites.push(site.tile);
      record.siteSet.add(site.tile);
      record.buildings.push(...site.buildings);
      record.complete &&= complete;
      record.bounds.left = Math.min(record.bounds.left, x);
      record.bounds.right = Math.max(record.bounds.right, x);
      record.bounds.top = Math.min(record.bounds.top, y);
      record.bounds.bottom = Math.max(record.bounds.bottom, y);
    } else {
      scan.keys.push(id);
      scan.records.set(id, {
        id,
        playerId: site.playerId,
        anchorTile: anchor,
        kind: scan.sites.get(this.key(site.playerId, anchor))!.anchor,
        sites: [site.tile],
        siteSet: new Set([site.tile]),
        buildings: [...site.buildings],
        bounds: { left: x, top: y, right: x, bottom: y },
        stableSince: tick,
        revision: 1,
        complete,
      });
    }
    scan.cursor++;
    scan.search = undefined;
  }
  step(tick: number, budget = 256, factBudget = 8): number {
    if (
      !Number.isInteger(budget) ||
      budget < 0 ||
      !Number.isInteger(factBudget) ||
      factBudget < 0
    )
      throw new Error("Invalid city planning budget");
    if (!this.scan && tick >= this.nextScan)
      this.scan = {
        cursor: 0,
        sites: new Map(),
        list: [],
        anchors: new Map(),
        records: new Map(),
        keys: [],
        phase: "facts",
      };
    let used = 0,
      facts = 0;
    const scan = this.scan;
    while (scan && used < budget) {
      if (scan.phase === "facts") {
        if (facts >= factBudget) break;
        const b = this.buildings()[scan.cursor++];
        used++;
        if (!b) {
          scan.phase = "anchors";
          scan.cursor = 0;
          continue;
        }
        facts++;
        if (
          (b.health ?? 1) <= 0 ||
          excluded.has(b.type) ||
          this.owners[b.tile] !== b.playerId
        )
          continue;
        const key = this.key(b.playerId, b.tile),
          site = scan.sites.get(key),
          anchor =
            b.type === "city" ? "city" : cores.has(b.type) ? "core" : "outpost";
        if (site) {
          site.buildings.push(b.id);
          site.types.add(b.type);
          if (
            anchor === "city" ||
            (site.anchor === "outpost" && anchor === "core")
          )
            site.anchor = anchor;
        } else {
          const next: Site = {
            tile: b.tile,
            playerId: b.playerId,
            buildings: [b.id],
            types: new Set([b.type]),
            anchor,
          };
          scan.sites.set(key, next);
          scan.list.push(next);
        }
      } else if (scan.phase === "anchors") {
        const site = scan.list[scan.cursor++];
        used++;
        if (!site) {
          scan.phase = "assign";
          scan.cursor = 0;
          continue;
        }
        if (site.anchor === "outpost") continue;
        const key = this.bucket(
            site.playerId,
            Math.floor(this.map.x(site.tile) / this.extent),
            Math.floor(this.map.y(site.tile) / this.extent),
          ),
          bucket = scan.anchors.get(key);
        if (bucket) bucket.push(site);
        else scan.anchors.set(key, [site]);
      } else if (scan.phase === "publish") {
        const id = scan.keys[scan.cursor],
          record = scan.records.get(id);
        used++;
        if (!record) {
          scan.phase = "remove";
          scan.cursor = 0;
          continue;
        }
        const proposal = this.proposals.get(id),
          previous = this.records.get(id);
        const compare = (scan.compare ??= {
          at: 0,
          sameProposal:
            !!proposal &&
            proposal.sites.size === record.sites.length &&
            proposal.kind === record.kind &&
            proposal.complete === record.complete,
          samePrevious:
            !!previous &&
            previous.siteSet.size === record.sites.length &&
            previous.kind === record.kind &&
            previous.complete === record.complete,
        });
        const tile = record.sites[compare.at++];
        if (tile !== undefined) {
          compare.sameProposal &&= !!proposal?.sites.has(tile);
          compare.samePrevious &&= !!previous?.siteSet.has(tile);
          continue;
        }
        if (!compare.sameProposal)
          this.proposals.set(id, {
            sites: record.siteSet,
            kind: record.kind,
            complete: record.complete,
            since: tick,
          });
        const stable = this.proposals.get(id)!;
        if (!previous || compare.samePrevious || tick - stable.since >= 100) {
          record.stableSince = stable.since;
          record.revision =
            (previous?.revision ?? 0) + Number(!compare.samePrevious);
          this.records.set(id, record);
        }
        scan.cursor++;
        scan.compare = undefined;
      } else if (scan.phase === "remove") {
        const id = this.recordKeys[scan.cursor++];
        used++;
        if (id === undefined) {
          this.recordKeys = scan.keys;
          this.scan = undefined;
          this.nextScan = tick + 20;
          break;
        }
        if (!scan.records.has(id)) {
          this.records.delete(id);
          this.proposals.delete(id);
        }
      } else {
        const site = scan.list[scan.cursor];
        if (!site) {
          // Geometry comparison/publication/removal also yield inside the pass.
          scan.phase = "publish";
          scan.cursor = 0;
          used++;
          continue;
        }
        scan.search ??= {
            site,
            bucket: 0,
            entry: 0,
            candidates: [],
            truncated: false,
            candidate: 0,
            queue: [],
            seen: new Set(),
            cursor: 0,
            phase: "candidates",
          };
        const search = scan.search;
        used++;
        if (search.phase === "candidates") {
          const cx = Math.floor(this.map.x(site.tile) / this.extent),
            cy = Math.floor(this.map.y(site.tile) / this.extent),
            bucket = scan.anchors.get(
              this.bucket(
                site.playerId,
                cx - 1 + (search.bucket % 3),
                cy - 1 + Math.floor(search.bucket / 3),
              ),
            ),
            anchor = bucket?.[search.entry++];
          if (!anchor) {
            search.bucket++;
            search.entry = 0;
          } else if (
            this.map.euclideanDistSquared(site.tile, anchor.tile) <=
              this.extent ** 2 &&
            (site.anchor !== "city" || anchor.tile === site.tile)
          ) {
            search.candidates.push({
              tile: anchor.tile,
              distance:
                this.map.euclideanDistSquared(site.tile, anchor.tile) +
                (anchor.anchor === "city" ? 0 : this.extent ** 2),
            });
            search.candidates.sort(
              (a, b) => a.distance - b.distance || a.tile - b.tile,
            );
            if (search.candidates.length > 8) {
              search.candidates.pop();
              search.truncated = true;
            }
          }
          if (search.bucket === 9) {
            search.phase = "connectivity";
            search.queue = [site.tile];
            search.seen.add(site.tile);
          }
        } else {
          const anchor = search.candidates[search.candidate]?.tile;
          if (anchor === undefined) {
            this.assign(scan, site, site.tile, !search.truncated, tick);
            continue;
          }
          const tile = search.queue[search.cursor++];
          if (tile === undefined) {
            search.candidate++;
            search.queue = [site.tile];
            search.seen = new Set([site.tile]);
            search.cursor = 0;
            continue;
          }
          if (this.owners[tile] !== site.playerId) continue;
          if (tile === anchor) {
            this.assign(scan, site, anchor, true, tick);
            continue;
          }
          for (const next of this.map.neighbors(tile))
            if (
              !search.seen.has(next) &&
              this.owners[next] === site.playerId &&
              this.map.isLand(next) &&
              !this.map.isImpassable(next) &&
              this.map.euclideanDistSquared(anchor, next) <= this.extent ** 2
            ) {
              search.seen.add(next);
              search.queue.push(next);
            }
        }
      }
    }
    this.diagnostics.work = used;
    this.diagnostics.facts = facts;
    this.diagnostics.pending = !!this.scan;
    return used;
  }
}
