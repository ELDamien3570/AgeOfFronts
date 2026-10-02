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
    });
  }
  restore(saved: ReturnType<AiFrontRecords["checkpoint"]>): void {
    this.records.clear();
    this.owned.clear();
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
    this.owned.delete(playerId);
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
