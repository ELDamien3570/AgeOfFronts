export const REMAINS = {
  bodyLifetime: 20_000,
  bloodLifetime: 45_000,
  fallenScale: 0.95,
  bloodFadeStart: 5_000,
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
  add(troop: FallenTroop): void {
    if (!this.records.has(troop.key)) this.records.set(troop.key, { ...troop });
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
