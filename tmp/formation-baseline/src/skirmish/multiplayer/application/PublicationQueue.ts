/** Ordered, bounded off-thread publication. A full queue does not capture or
 * advance the delta cursor; the next admitted capture includes skipped changes. */
export class PublicationQueue<T, R> {
  private tail = Promise.resolve();
  private failure?: Error;
  pending = 0;
  skipped = 0;
  constructor(
    private readonly encode: (value: T) => Promise<R>,
    private readonly publish: (tick: number, value: R) => void,
    private readonly failed: (error: Error) => void,
    readonly capacity = 2,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4) throw new Error("Invalid publication capacity");
  }
  offer(tick: number, capture: () => T): boolean {
    if (this.failure) throw this.failure;
    if (this.pending >= this.capacity) { this.skipped++; return false; }
    const value = capture();
    this.pending++;
    // Start bounded pure work immediately, but observe both success/failure
    // immediately too; out-of-order rejections cannot become unhandled promises.
    let encoded: Promise<{ result: R } | { error: unknown }>;
    try { encoded = this.encode(value).then(result => ({ result }), error => ({ error })); }
    catch (error) { encoded = Promise.resolve({ error }); }
    this.tail = this.tail.then(async () => {
      const outcome = await encoded;
      if (this.failure) return;
      if ("error" in outcome) throw outcome.error;
      this.publish(tick, outcome.result);
    }).catch(error => {
      if (this.failure) return;
      this.failure = error instanceof Error ? error : new Error("Snapshot encoding failed");
      this.failed(this.failure);
    }).finally(() => { this.pending--; });
    return true;
  }
  async flush(): Promise<void> {
    await this.tail;
    if (this.failure) throw this.failure;
  }
}
