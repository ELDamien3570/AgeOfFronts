import type { Building, Player } from "../Protocol";
import type { AiNavalFacts } from "./AiNavalFacts";
import type { ExpansionWorld } from "./Expansion";

interface PortRecord { cursor?: number; ports: number[] }
/** Nearby land or shared, nearby usable coasts qualify strategic diplomacy.
 * Coast discovery resumes actual maintained records and shares 32 reads/tick. */
export class DiplomaticGeography {
  private readonly records = new Map<number, PortRecord>();
  private workTick = -1;
  private work = 0;
  constructor(private readonly world: ExpansionWorld, private readonly facts: AiNavalFacts) {}
  checkpoint() { return structuredClone({ records: [...this.records], workTick: this.workTick, work: this.work }); }
  restore(saved: ReturnType<DiplomaticGeography["checkpoint"]>): void {
    this.records.clear(); for (const [id, record] of structuredClone(saved.records)) this.records.set(id, record);
    this.workTick = saved.workTick; this.work = saved.work;
  }
  private ports(playerId: number): Building[] {
    if (this.workTick !== this.world.tick) { this.workTick = this.world.tick; this.work = 0; }
    const record = this.records.get(playerId) ?? { ports: [] };
    this.records.set(playerId, record);
    for (let i = 0; i < 8 && this.work < 32; i++) {
      const read = this.facts.readOwnedBuilding(playerId, record.cursor); this.work++;
      record.cursor = read.next ?? undefined;
      if (read.value?.type === "port" && !record.ports.includes(read.value.id)) {
        record.ports.push(read.value.id); if (record.ports.length > 8) record.ports.shift();
      }
      if (read.next === null) break;
    }
    return record.ports.flatMap(id => {
      const b = this.world.building(id);
      return b && b.type === "port" && b.playerId === playerId && this.world.owners[b.tile] === playerId &&
        !b.remainingTicks && (b.health ?? 1) > 0 ? [b] : [];
    });
  }
  eligible(a: Player, b: Player): boolean {
    if (a.id === b.id || a.eliminated || b.eliminated) return false;
    if (this.world.factionAdjacent(a.id, b.id)) return true;
    if (this.world.map.euclideanDistSquared(a.base, b.base) <= 64 ** 2 && this.world.paths.connected(a.base, b.base)) return true;
    const left = this.ports(a.id), right = this.ports(b.id);
    for (const first of left) for (const second of right) {
      if (this.world.map.euclideanDistSquared(first.tile, second.tile) > 96 ** 2) continue;
      const origin = this.world.map.neighbors(first.tile).find(t => this.world.waterPaths.walkable(t));
      const destination = this.world.map.neighbors(second.tile).find(t => this.world.waterPaths.walkable(t));
      if (origin !== undefined && destination !== undefined && this.world.waterPaths.connected(origin, destination)) return true;
    }
    return false;
  }
  get workUsed(): number { return this.work; }
}
