export const REMAINS = {
  bodyLifetime: 20_000,
  bloodLifetime: 45_000,
  fallenScale: 1,
  bloodFadeStart: 5_000,
  /** Hard cap so records cannot accumulate while nothing samples them. */
  maxRecords: 4000,
} as const;

export interface FallenTroop {
  key: string;
  artwork: string;
  x: number;
  y: number;
  angle: number;
  /** Standing sprite extent in world tiles, including horse scale. */
  size: number;
  started: number;
  fallDuration: number;
  seed: number;
  color?: string;
  embedded?: readonly { kind: string; angle: number }[];
}
export interface PresentedRemains extends FallenTroop {
  age: number;
  bodyVisible: boolean;
  bodyScale: number;
  bloodGrowth: number;
  bloodOpacity: number;
}

/** Independent world-space cosmetics, retained after the owning squad retires. */
export class TroopRemains {
  private readonly records = new Map<string, FallenTroop>();
  clear(): void {
    this.records.clear();
  }
  get size(): number {
    return this.records.size;
  }
  add(troop: FallenTroop): void {
    if (this.records.has(troop.key)) return;
    // Map iterates in insertion order, so the first key is the oldest record.
    while (this.records.size >= REMAINS.maxRecords) {
      const oldest = this.records.keys().next();
      if (oldest.done) break;
      this.records.delete(oldest.value);
    }
    this.records.set(troop.key, { ...troop });
  }
  /** Drops fully faded records without drawing, so hidden remains stay bounded. */
  expire(now: number): void {
    for (const [key, troop] of this.records)
      if (now - troop.started >= REMAINS.bloodLifetime) this.records.delete(key);
  }
  sample(now: number): PresentedRemains[] {
    const result: PresentedRemains[] = [];
    for (const [key, troop] of this.records) {
      const age = Math.max(0, now - troop.started);
      if (age >= REMAINS.bloodLifetime) {
        this.records.delete(key);
        continue;
      }
      const fall = Math.min(1, age / Math.max(1, troop.fallDuration));
      const eased = fall * fall * (3 - 2 * fall);
      const fade = Math.max(
        0,
        Math.min(
          1,
          (age - REMAINS.bloodFadeStart) /
            (REMAINS.bloodLifetime - REMAINS.bloodFadeStart),
        ),
      );
      result.push({
        ...troop,
        age,
        bodyVisible: age < REMAINS.bodyLifetime,
        bodyScale: 1 - (1 - REMAINS.fallenScale) * eased,
        bloodGrowth: Math.max(0, Math.min(1, (age - 120) / 600)),
        bloodOpacity: 1 - fade * fade * (3 - 2 * fade),
      });
    }
    return result;
  }
}
