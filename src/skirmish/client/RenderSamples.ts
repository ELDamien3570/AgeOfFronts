export interface RenderSample<T> {
  current: T;
  previousX: number;
  previousY: number;
}

/** Disposable presentation state: one stable wrapper per live identity, one
 * current entity and only the coordinates required for interpolation. */
export class RenderSamples<T extends { id: number; x: number; y: number }> {
  private readonly samples = new Map<number, RenderSample<T>>();
  private tick?: number;
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
  update(entities: readonly T[], tick: number): void {
    const live = new Set<number>();
    for (const entity of entities) {
      live.add(entity.id);
      const sample = this.samples.get(entity.id);
      if (sample) {
        if (tick !== this.tick) {
          sample.previousX = sample.current.x;
          sample.previousY = sample.current.y;
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
    this.tick = tick;
  }
}
