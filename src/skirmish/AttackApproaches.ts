import { FIXED, type Squad } from "./Protocol";
import type { WorldPoint } from "./SpatialGrid";
import { meleeContact } from "./SquadGeometry";

/** One bounded polar assignment per combat batch, shared by player and AI. */
export class AttackApproaches {
  private readonly cache = new Map<
    string,
    { signature: string; points: Map<number, WorldPoint> }
  >();
  private readonly slots = new Map<number, WorldPoint>();
  private readonly loads = new Map<string, number>();
  load(playerId: number, targetId: number): number {
    return this.loads.get(`${playerId}:${targetId}`) ?? 0;
  }
  changed(
    playerId: number,
    previous: number | undefined,
    next: number | undefined,
  ): void {
    if (previous !== undefined) {
      const key = `${playerId}:${previous}`;
      this.loads.set(key, Math.max(0, (this.loads.get(key) ?? 0) - 1));
    }
    if (next !== undefined) {
      const key = `${playerId}:${next}`;
      this.loads.set(key, (this.loads.get(key) ?? 0) + 1);
    }
  }
  rebuild(
    squads: readonly Squad[],
    melee: (s: Squad) => boolean,
    valid: (s: Squad, p: WorldPoint) => boolean = () => true,
    environment?: (target: Squad, owner: number) => string,
  ): void {
    this.slots.clear();
    this.loads.clear();
    for (const s of squads)
      if (s.order.type === "attack" && s.embarkedOn === null && s.troops > 0) {
        const key = `${s.playerId}:${s.order.targetId}`;
        this.loads.set(key, (this.loads.get(key) ?? 0) + 1);
      }
    const targets = new Map(squads.map((s) => [s.id, s]));
    const groups = new Map<string, Squad[]>();
    for (const s of squads)
      if (
        s.order.type === "attack" &&
        s.embarkedOn === null &&
        !s.charge &&
        melee(s)
      ) {
        const key = `${s.playerId}:${s.order.targetId}`,
          row = groups.get(key) ?? [];
        row.push(s);
        groups.set(key, row);
      }
    for (const key of this.cache.keys())
      if (!groups.has(key)) this.cache.delete(key);
    for (const [key, row] of groups) {
      const target = targets.get(
        (row[0].order as { targetId: number }).targetId,
      );
      if (!target || row.length < 2) continue;
      row.sort((a, b) => a.id - b.id);
      const signature = environment
        ? `${target.x}:${target.y}:${target.kind}:${row.map((s) => `${s.id}:${s.kind}`).join(",")}:${environment(target, row[0].playerId)}`
        : undefined;
      const cached = this.cache.get(key);
      if (signature !== undefined && cached?.signature === signature) {
        for (const [id, point] of cached.points) this.slots.set(id, point);
        continue;
      }
      const points = new Map<number, WorldPoint>();
      const sectors = Math.min(8, row.length);
      // World-fixed sectors avoid rotating the ring as its first member walks around it.
      const anchor = 0;
      const assigned: WorldPoint[] = [];
      row.forEach((s, i) => {
        // Certify a bounded set of local sectors; occupied sectors use an outer queue.
        // Do not assign positions inside another enemy's body or impassable terrain.
        for (let ring = 0; ring < 4; ring++)
          for (let offset = 0; offset < sectors; offset++) {
            const angle =
              anchor + (((i + offset) % sectors) * Math.PI * 2) / sectors;
            const radius =
              Math.max(1, meleeContact(s.kind, target.kind) - 4) + ring * FIXED;
            const point = {
              x: Math.round(target.x + Math.cos(angle) * radius),
              y: Math.round(target.y + Math.sin(angle) * radius),
            };
            if (
              !valid(s, point) ||
              assigned.some(
                (other) =>
                  (point.x - other.x) ** 2 + (point.y - other.y) ** 2 <
                  (0.75 * FIXED) ** 2,
              )
            )
              continue;
            this.slots.set(s.id, point);
            points.set(s.id, point);
            assigned.push(point);
            return;
          }
      });
      if (signature !== undefined) this.cache.set(key, { signature, points });
    }
  }
  point(squad: Squad): WorldPoint | undefined {
    return this.slots.get(squad.id);
  }
}
