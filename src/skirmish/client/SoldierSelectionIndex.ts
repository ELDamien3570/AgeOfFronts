interface Point {
  x: number;
  y: number;
}
interface Member extends Point {
  radius: number;
}
interface Group {
  generation: number;
  count: number;
  pool: Member[];
}
interface Buffer {
  generation: number;
  groups: Map<number, Group>;
}
/** Double-buffered world positions from actual visible soldier draws. Input reads
 * the completed frame, never partially collected poses or hidden soldier state. */
export class SoldierSelectionIndex {
  private current: Buffer = { generation: 0, groups: new Map() };
  private pending: Buffer = { generation: 0, groups: new Map() };
  clear(): void {
    this.current.groups.clear();
    this.pending.groups.clear();
  }
  beginFrame(): void {
    this.pending.generation++;
  }
  add(squadId: number, x: number, y: number, radius: number): void {
    let group = this.pending.groups.get(squadId);
    if (!group) {
      group = { generation: this.pending.generation, count: 0, pool: [] };
      this.pending.groups.set(squadId, group);
    }
    if (group.generation !== this.pending.generation) {
      group.generation = this.pending.generation;
      group.count = 0;
    }
    const index = group.count++;
    const member = group.pool[index];
    if (member) {
      member.x = x;
      member.y = y;
      member.radius = radius;
    } else group.pool.push({ x, y, radius });
  }
  commit(): void {
    const old = this.current;
    this.current = this.pending;
    this.pending = old;
    for (const [id, group] of this.current.groups)
      if (group.generation !== this.current.generation)
        this.current.groups.delete(id);
  }
  private group(id: number): Group | undefined {
    const group = this.current.groups.get(id);
    return group?.generation === this.current.generation ? group : undefined;
  }
  hitTest(id: number, point: Point, pixelsPerCell: number): number | undefined {
    const group = this.group(id);
    let best = Infinity;
    if (group)
      for (let i = 0; i < group.count; i++) {
        const member = group.pool[i];
        const distance =
          ((point.x - member.x) ** 2 + (point.y - member.y) ** 2) *
          pixelsPerCell ** 2;
        const radius = Math.max(5, member.radius * pixelsPerCell);
        if (distance <= radius ** 2) best = Math.min(best, distance);
      }
    return best < Infinity ? best : undefined;
  }
  intersectsBox(
    id: number,
    box: { x1: number; y1: number; x2: number; y2: number },
  ): boolean {
    const group = this.group(id);
    if (group)
      for (let i = 0; i < group.count; i++) {
        const member = group.pool[i];
        const x = Math.max(box.x1, Math.min(box.x2, member.x));
        const y = Math.max(box.y1, Math.min(box.y2, member.y));
        if ((x - member.x) ** 2 + (y - member.y) ** 2 <= member.radius ** 2)
          return true;
      }
    return false;
  }
  viewRadius(id: number, root: Point): number {
    const group = this.group(id);
    let radius = 0;
    if (group)
      for (let i = 0; i < group.count; i++) {
        const member = group.pool[i];
        radius = Math.max(
          radius,
          Math.hypot(member.x - root.x, member.y - root.y) + member.radius * 3,
        );
      }
    return radius;
  }
}
