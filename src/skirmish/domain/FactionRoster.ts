import { PseudoRandom } from "../../core/PseudoRandom";
import type { AiPersonalityId } from "./AiPersonality";

export type FactionOrigin = "historical" | "middle-earth" | "westeros";
export type FactionKind = "regular" | "tribe";
export interface FactionIdentity {
  readonly id: string;
  readonly name: string;
  readonly kind: FactionKind;
  readonly origin: FactionOrigin;
  readonly region: string;
  readonly personalities: readonly AiPersonalityId[];
  readonly references: readonly string[];
}

// Dedicated streams keep naming from changing camp placement or AI randomness.
// Interleaving gives fiction room to appear even in a large historical catalog.
export class FactionRoster {
  private readonly decks = new Map<FactionKind, FactionIdentity[]>();
  private readonly random = new Map<FactionKind, PseudoRandom>();
  private readonly used = new Set<string>();
  constructor(seed: number, identities: readonly FactionIdentity[]) {
    for (const kind of ["regular", "tribe"] as const) {
      const random = new PseudoRandom(
        seed ^ (kind === "regular" ? 0x4e414d45 : 0x434c414e),
      );
      this.random.set(kind, random);
      const origins: FactionOrigin[] = [
        "historical",
        "middle-earth",
        "westeros",
      ];
      const pools = new Map(
        origins.map((origin) => {
          const pool = identities.filter(
            (f) => f.kind === kind && f.origin === origin,
          );
          for (let i = pool.length - 1; i > 0; i--) {
            const j = random.nextInt(0, i + 1);
            [pool[i], pool[j]] = [pool[j], pool[i]];
          }
          return [origin, pool];
        }),
      );
      // Approximately half historical, a quarter from each fictional setting.
      const cycle: FactionOrigin[] = [
        "historical",
        "middle-earth",
        "historical",
        "westeros",
      ];
      const start = random.nextInt(0, cycle.length),
        deck: FactionIdentity[] = [];
      while ([...pools.values()].some((pool) => pool.length))
        for (let i = 0; i < cycle.length; i++) {
          const next = pools.get(cycle[(start + i) % cycle.length])!.pop();
          if (next) deck.push(next);
        }
      this.decks.set(kind, deck);
    }
  }
  take(kind: FactionKind): {
    identity: FactionIdentity;
    personalityId: AiPersonalityId;
  } {
    const deck = this.decks.get(kind)!;
    let identity: FactionIdentity | undefined;
    while ((identity = deck.shift())) {
      if (this.used.has(identity.id)) continue;
      this.used.add(identity.id);
      return {
        identity,
        personalityId:
          identity.personalities[
            this.random.get(kind)!.nextInt(0, identity.personalities.length)
          ],
      };
    }
    throw new Error(`The ${kind} faction-name catalog is exhausted`);
  }
}
