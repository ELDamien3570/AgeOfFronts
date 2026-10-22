import type { Squad } from "./Protocol";

/** Bounded decisions shared between fresh player moves and periodic adaptation.
 * Only stable ids/revisions are authoritative; no array index survives a tick. */
export class MovementReadiness {
  private readonly urgent = new Map<
    number,
    { playerId: number; revision: number; kind?: "input" | "blocked" }
  >();
  private cursor = 0;
  private lastPlayer = -1;
  request(
    squad: Squad,
    revision: number,
    kind: "input" | "blocked" = "input",
  ): void {
    const current = this.urgent.get(squad.id);
    if (
      current?.revision === revision &&
      current.playerId === squad.playerId &&
      ((current.kind ?? "input") === "input" || kind === "blocked")
    )
      return;
    this.urgent.set(squad.id, { playerId: squad.playerId, revision, kind });
  }
  cancel(id: number): void {
    this.urgent.delete(id);
  }
  checkpoint() {
    return {
      urgent: [...this.urgent],
      cursor: this.cursor,
      lastPlayer: this.lastPlayer,
    };
  }
  restore(saved?: ReturnType<MovementReadiness["checkpoint"]>): void {
    this.urgent.clear();
    this.cursor = 0;
    this.lastPlayer = -1;
    if (!saved) return;
    if (
      !Number.isSafeInteger(saved.cursor) ||
      saved.cursor < 0 ||
      !Number.isInteger(saved.lastPlayer) ||
      saved.lastPlayer < -1 ||
      saved.lastPlayer >= 255
    )
      throw Error("Invalid movement readiness cursor");
    for (const [id, item] of saved.urgent) {
      if (
        !Number.isSafeInteger(id) ||
        id < 0 ||
        this.urgent.has(id) ||
        !Number.isInteger(item.playerId) ||
        item.playerId < 1 ||
        item.playerId >= 255 ||
        !Number.isSafeInteger(item.revision) ||
        item.revision < 0 ||
        (item.kind !== undefined && !["input", "blocked"].includes(item.kind))
      )
        throw Error("Invalid movement readiness member");
      this.urgent.set(id, { ...item });
    }
    this.cursor = saved.cursor;
    this.lastPlayer = saved.lastPlayer;
  }
  select(
    land: readonly Squad[],
    revision: (id: number) => number,
    limit: number,
    lookup: (id: number) => Squad | undefined = (id) =>
      land.find((s) => s.id === id),
  ): Squad[] {
    const selected: Squad[] = [],
      seen = new Set<number>();
    for (const [id, item] of this.urgent)
      if (
        lookup(id)?.embarkedOn !== null ||
        lookup(id)?.playerId !== item.playerId ||
        revision(id) !== item.revision
      )
        this.urgent.delete(id);
    // Round-robin seats, FIFO within a seat. Four decisions remain periodic
    // even during a sustained stream of player input.
    const urgentLimit = Math.max(0, limit - Math.min(4, limit));
    while (this.urgent.size && selected.length < urgentLimit) {
      const fresh = [...this.urgent.values()].some(
        (item) => (item.kind ?? "input") === "input",
      );
      let first = Infinity,
        next = Infinity;
      for (const item of this.urgent.values())
        if (!fresh || (item.kind ?? "input") === "input") {
          first = Math.min(first, item.playerId);
          if (item.playerId > this.lastPlayer)
            next = Math.min(next, item.playerId);
        }
      const player = Number.isFinite(next) ? next : first;
      for (const [id, item] of this.urgent)
        if (
          item.playerId === player &&
          (!fresh || (item.kind ?? "input") === "input")
        ) {
          this.urgent.delete(id);
          selected.push(lookup(id)!);
          seen.add(id);
          break;
        }
      this.lastPlayer = player;
    }
    for (
      let attempts = 0;
      land.length && attempts < land.length && selected.length < limit;
      attempts++
    ) {
      this.cursor %= land.length;
      const squad = land[this.cursor++];
      if (!seen.has(squad.id)) {
        selected.push(squad);
        seen.add(squad.id);
        this.urgent.delete(squad.id);
      }
    }
    return selected;
  }
}
