/** N6b (P14): coordinator-side ordering for publications that bypass the
 * simulation thread. Publications are delta-chained, so they are delivered in
 * sequence order (1, 2, 3, ...). A simulation-thread result that says it was
 * produced after `issued` publications (a join barrier, baseline or advance)
 * is held until those publications were delivered, and results keep their own
 * arrival order. After stop(), nothing is delivered. */
export class PublicationSequencer<P, R> {
  private delivered = 0;
  private stopped = false;
  private readonly early = new Map<number, P>();
  private readonly held: { issued: number; result: R }[] = [];
  /** At most this many publications may arrive ahead of a gap. */
  static readonly MAX_EARLY = 64;
  constructor(
    private readonly deliverPublication: (publication: P) => void,
    private readonly deliverResult: (result: R) => void,
  ) {}
  get deliveredPublications(): number { return this.delivered; }
  get heldResults(): number { return this.held.length; }
  publication(sequence: number, publication: P): void {
    if (this.stopped) return;
    if (!Number.isSafeInteger(sequence) || sequence <= this.delivered || this.early.has(sequence))
      throw new Error("Publication sequence out of order");
    if (this.early.size >= PublicationSequencer.MAX_EARLY) throw new Error("Publication sequence gap exceeded");
    this.early.set(sequence, publication);
    for (let next = this.early.get(this.delivered + 1); next !== undefined && !this.stopped; next = this.early.get(this.delivered + 1)) {
      this.early.delete(this.delivered + 1);
      this.delivered++;
      this.deliverPublication(next);
    }
    this.release();
  }
  result(issued: number, result: R): void {
    if (this.stopped) return;
    this.held.push({ issued, result });
    this.release();
  }
  stop(): void {
    this.stopped = true;
    this.early.clear();
    this.held.length = 0;
  }
  private release(): void {
    while (!this.stopped && this.held.length && this.held[0].issued <= this.delivered)
      this.deliverResult(this.held.shift()!.result);
  }
}
