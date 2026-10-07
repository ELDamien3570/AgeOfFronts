export interface RenderSample<T> {
  current: T;
  /** Where the current segment starts: the position drawn when `current`
   * arrived, not the previous authoritative position. */
  previousX: number;
  previousY: number;
}

/** Disposable presentation state: one stable wrapper per live identity, one
 * current entity and only the coordinates required for interpolation.
 *
 * Each new tick starts a segment from where the entity is currently drawn and
 * runs for the server time that tick span represents. Publications arrive at a
 * mixed cadence (background every few ticks, immediately after orders); resetting
 * to the previous authoritative point made units snap back mid-glide, and an
 * averaged arrival interval misjudged speed whenever the cadence changed. */
export class RenderSamples<T extends { id: number; x: number; y: number }> {
  private readonly samples = new Map<number, RenderSample<T>>();
  private tick?: number;
  private segmentStart = 0;
  private segmentMs = 50;
  get size(): number {
    return this.samples.size;
  }
  get(id: number): RenderSample<T> | undefined {
    return this.samples.get(id);
  }
  clear(): void {
    this.samples.clear();
    this.tick = undefined;
  }
  /** Fraction of the current segment elapsed at `now`, in [0, 1]. */
  progress(now: number): number {
    return Math.min(1, Math.max(0, (now - this.segmentStart) / this.segmentMs));
  }
  /** Drawn position of a sample at `now`. */
  position(sample: RenderSample<T>, now: number): { x: number; y: number } {
    const t = this.progress(now);
    return {
      x: sample.previousX + (sample.current.x - sample.previousX) * t,
      y: sample.previousY + (sample.current.y - sample.previousY) * t,
    };
  }
  /** `now` is the arrival time; `segmentMs` the real time the new tick span
   * represents. Duplicate-tick publications refresh entities in place and keep
   * the running segment. */
  update(entities: readonly T[], tick: number, now = 0, segmentMs = 50): void {
    const live = new Set<number>(), advanced = tick !== this.tick;
    for (const entity of entities) {
      live.add(entity.id);
      const sample = this.samples.get(entity.id);
      if (sample) {
        if (advanced) {
          const drawn = this.position(sample, now);
          sample.previousX = drawn.x;
          sample.previousY = drawn.y;
        }
        sample.current = entity;
      } else
        this.samples.set(entity.id, {
          current: entity,
          previousX: entity.x,
          previousY: entity.y,
        });
    }
    for (const id of this.samples.keys())
      if (!live.has(id)) this.samples.delete(id);
    if (advanced) {
      this.segmentStart = now;
      this.segmentMs = Math.max(1, segmentMs);
    }
    this.tick = tick;
  }
}
