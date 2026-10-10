import type { AiEconomicDirector } from "./AiEconomicDirector";
import type { Expansion } from "./Expansion";

export interface AiFrontRecord {
  id: string;
  playerId: number;
  rival: number;
  anchor: number;
  direction: number;
  edges: number;
  revision: number;
  stableSince: number;
  observed: number;
}
export interface AiDefensiveRegion {
 id:string;playerId:number;rival:number;sectors:string[];representative:string;anchor:number;edges:number;since:number;observed:number;
}
interface Scan {
  id: string;
  revision: number;
  playerId: number;
  cell: number;
  best?: string;
  groups: Map<
    string,
    { rival: number; direction: number; edges: number; anchor: number }
  >;
}
/** Stable hostile sectors derived incrementally from shared ownership chunks.
 * A work unit inspects one 16x16 sector cell (at most four border edges). */
export class AiFrontRecords {
  readonly records = new Map<string, AiFrontRecord>();
  private readonly owned = new Map<number, string[]>();
  forPlayer(playerId: number): AiFrontRecord[] {
    return (this.owned.get(playerId) ?? []).flatMap((id) => {
      const r = this.records.get(id);
      return r ? [r] : [];
    });
  }
  private readonly regions=new Map<number,AiDefensiveRegion[]>();
  private readonly regionSignatures=new Map<number,string>();
  private regionSerial=0;
  regionsForPlayer(playerId:number):readonly AiDefensiveRegion[] {
    const records=this.forPlayer(playerId).filter(r=>this.valid(r));
    const signature=records.map(r=>`${r.id}:${r.revision}:${r.rival}:${r.anchor}`).join(";");
    if(this.regionSignatures.get(playerId)===signature)return this.regions.get(playerId)??[];
    const old=this.regions.get(playerId)??[],unused=new Set(old.map(r=>r.id)),pending=new Map(records.map(r=>[r.id,r])),result:AiDefensiveRegion[]=[];
    // The source envelope is eight stable sectors per faction, so connectivity
    // is bounded by 64 comparisons and never floods world terrain.
    while(pending.size){
      const first=pending.values().next().value!,group=[first];pending.delete(first.id);
      for(let cursor=0;cursor<group.length;cursor++){
        const current=group[cursor],chunk=this.economy.boundaries!.chunk(current.id)!;
        for(const [id,candidate] of pending){
          const other=this.economy.boundaries!.chunk(id)!;
          if(candidate.rival===first.rival && Math.abs(chunk.x-other.x)+Math.abs(chunk.y-other.y)<=1 &&
            this.expansion.world.paths.connected(current.anchor,candidate.anchor)){group.push(candidate);pending.delete(id);}
        }
      }
      group.sort((a,b)=>b.edges-a.edges || a.stableSince-b.stableSince || a.anchor-b.anchor);
      const ids=group.map(r=>r.id),matches=old.filter(r=>unused.has(r.id)&&r.rival===first.rival)
        .map(r=>({record:r,overlap:r.sectors.filter(id=>ids.includes(id)).length})).filter(r=>r.overlap>0)
        .sort((a,b)=>b.overlap-a.overlap||a.record.since-b.record.since||a.record.id.localeCompare(b.record.id));
      const previous=matches[0]?.record;if(previous)unused.delete(previous.id);
      const retained=previous&&group.find(r=>r.id===previous.representative),representative=retained??group[0];
      result.push({id:previous?.id??`region:${playerId}:${++this.regionSerial}`,playerId,rival:first.rival,sectors:ids,
        representative:representative.id,anchor:representative.anchor,edges:group.reduce((n,r)=>n+r.edges,0),since:previous?.since??this.expansion.world.tick,observed:this.expansion.world.tick});
    }
    result.sort((a,b)=>b.edges-a.edges||a.since-b.since||a.anchor-b.anchor);
    this.regions.set(playerId,result);this.regionSignatures.set(playerId,signature);return result;
  }
  private readonly cursors = new Map<number, string | undefined>();
  private player = 0;
  private scan?: Scan;
  workUsed = 0;
  constructor(
    private readonly expansion: Expansion,
    private readonly economy: AiEconomicDirector,
  ) {}
  checkpoint() {
    return structuredClone({
      records: [...this.records],
      cursors: [...this.cursors],
      player: this.player,
      scan: this.scan,
      regions:[...this.regions],regionSignatures:[...this.regionSignatures],regionSerial:this.regionSerial,
    });
  }
  restore(saved: ReturnType<AiFrontRecords["checkpoint"]>): void {
    this.records.clear();
    this.owned.clear();this.regions.clear();this.regionSignatures.clear();
    this.regionSerial=saved.regionSerial??0;
    for(const [id,regions] of structuredClone(saved.regions??[]))this.regions.set(id,regions);
    for(const [id,signature] of saved.regionSignatures??[])this.regionSignatures.set(id,signature);
    for (const [id, r] of structuredClone(saved.records)) {
      this.records.set(id, r);
      const own = this.owned.get(r.playerId) ?? [];
      own.push(id);
      this.owned.set(r.playerId, own);
    }
    this.cursors.clear();
    for (const [id, c] of saved.cursors) this.cursors.set(id, c);
    this.player = saved.player;
    this.scan = structuredClone(saved.scan);
  }
  release(playerId: number): void {
    for (const id of this.owned.get(playerId) ?? []) this.records.delete(id);
    this.owned.delete(playerId);this.regions.delete(playerId);this.regionSignatures.delete(playerId);
    this.cursors.delete(playerId);
    if (this.scan?.playerId === playerId) this.scan = undefined;
  }
  valid(record: AiFrontRecord): boolean {
    const { world } = this.expansion,
      chunk = this.economy.boundaries?.chunk(record.id);
    return (
      !!chunk &&
      world.owners[record.anchor] === record.playerId &&
      world.tick - record.observed <= 1800 &&
      [
        ...this.economy.boundaries!.hostileEdges(record.anchor, (a, b) =>
          world.hostile(a, b),
        ),
      ].some(
        (edge) =>
          world.owners[edge.neighbor] === record.rival &&
          edge.direction === record.direction,
      )
    );
  }
  step(budget: number): number {
    const { world } = this.expansion,
      boundary = this.economy.boundaries;
    this.workUsed = 0;
    if (!boundary?.ready || !world.players.length) return 0;
    while (this.workUsed < budget) {
      this.workUsed++;
      if (!this.scan) {
        const player = world.players[this.player++ % world.players.length];
        if (!this.economy.enabled(player)) {
          this.release(player.id);
          continue;
        }
        const next = boundary.readChunk(player.id, this.cursors.get(player.id));
        this.cursors.set(player.id, next.next ?? undefined);
        if (!next.value) {
          this.release(player.id);
          continue;
        }
        if (world.tick - next.value.changedTick < 100) continue;
        const previous = this.records.get(next.value.id);
        if (
          previous?.revision === next.value.revision &&
          this.valid(previous)
        ) {
          previous.observed = world.tick;
          continue;
        }
        const selected = this.forPlayer(player.id);
        // Equal-quality sectors must not churn the eight retained fronts.
        // Raw direction counts are an upper bound on any hostile-rival group.
        if (
          !previous &&
          selected.length >= 8 &&
          selected.every((front) => this.valid(front)) &&
          Math.max(...next.value.directions) <=
            Math.min(...selected.map((front) => front.edges))
        )
          continue;
        this.scan = {
          id: next.value.id,
          revision: next.value.revision,
          playerId: player.id,
          cell: 0,
          groups: new Map(),
        };
        continue;
      }
      const s = this.scan,
        chunk = boundary.chunk(s.id);
      if (
        !chunk ||
        chunk.revision !== s.revision ||
        world.tick - chunk.changedTick < 100
      ) {
        this.scan = undefined;
        continue;
      }
      if (s.cell < 256) {
        const index = s.cell++,
          x = chunk.x * 16 + (index % 16),
          y = chunk.y * 16 + Math.floor(index / 16);
        if (!world.map.isValidCoord(x, y)) continue;
        const tile = world.map.ref(x, y);
        if (!chunk.tiles.has(tile)) continue;
        for (const edge of boundary.hostileEdges(tile, (a, b) =>
          world.hostile(a, b),
        )) {
          const rival = world.owners[edge.neighbor],
            key = `${rival}:${edge.direction}`,
            existing = s.groups.get(key);
          if (existing) {
            existing.edges++;
            existing.anchor = Math.min(existing.anchor, tile);
          } else
            s.groups.set(key, {
              rival,
              direction: edge.direction,
              anchor: tile,
              edges: 1,
            });
          const group = s.groups.get(key)!,
            best = s.best ? s.groups.get(s.best) : undefined;
          if (
            !best ||
            group.edges > best.edges ||
            (group.edges === best.edges && group.anchor < best.anchor)
          )
            s.best = key;
        }
        continue;
      }
      const best = s.best ? s.groups.get(s.best) : undefined;
      if (best && best.edges >= 4) {
        const previous = this.records.get(s.id),
          unchanged =
            previous?.rival === best.rival &&
            previous.direction === best.direction &&
            previous.anchor === best.anchor;
        const own = this.forPlayer(s.playerId);
        if (!previous && own.length >= 8) {
          own.sort(
            (a, b) =>
              Number(this.valid(a)) - Number(this.valid(b)) ||
              a.edges - b.edges ||
              a.observed - b.observed ||
              a.anchor - b.anchor,
          );
          if (this.valid(own[0]) && own[0].edges >= best.edges) {
            this.scan = undefined;
            continue;
          }
          this.records.delete(own[0].id);
          this.owned.set(
            s.playerId,
            (this.owned.get(s.playerId) ?? []).filter((id) => id !== own[0].id),
          );
        }
        if (!previous)
          this.owned.set(s.playerId, [
            ...(this.owned.get(s.playerId) ?? []),
            s.id,
          ]);
        this.records.set(s.id, {
          id: s.id,
          playerId: s.playerId,
          ...best,
          revision: s.revision,
          stableSince: unchanged ? previous!.stableSince : world.tick,
          observed: world.tick,
        });
      } else {
        this.records.delete(s.id);
        this.owned.set(
          s.playerId,
          (this.owned.get(s.playerId) ?? []).filter((id) => id !== s.id),
        );
      }
      this.scan = undefined;
    }
    return this.workUsed;
  }
}
