interface Hits {
  total: number;
  first: number;
  firstDamage: number;
  others?: Map<number, number>;
}

// Combat stays simultaneous. Additional contributor maps are allocated only
// when more than one faction damages the same target in a combat step.
export class DamageLedger {
  private readonly hits = new Map<number, Hits>();
  get size(): number {
    return this.hits.size;
  }
  add(target: number, attacker: number, damage: number): void {
    const hit = this.hits.get(target);
    if (!hit) {
      this.hits.set(target, {
        total: damage,
        first: attacker,
        firstDamage: damage,
      });
      return;
    }
    hit.total += damage;
    if (hit.first === attacker) hit.firstDamage += damage;
    else {
      hit.others ??= new Map();
      hit.others.set(attacker, (hit.others.get(attacker) ?? 0) + damage);
    }
  }
  damage(target: number): number {
    return this.hits.get(target)?.total ?? 0;
  }
  *contributions(target: number): Iterable<[number, number]> {
    const hit = this.hits.get(target);
    if (!hit) return;
    yield [hit.first, hit.firstDamage];
    yield* hit.others ?? [];
  }
}

// Match-owned credit for the last building capture or lethal combat batch.
// Terminal eligibility is evaluated after combat and capture, by the aggregate.
export class ConquestCredit {
  private readonly credits = new Map<number, number>();
  capture(victim: number, captor: number): void {
    this.credits.set(victim, captor);
  }
  losses(
    victims: readonly { id: number; playerId: number }[],
    damage: DamageLedger,
  ): void {
    const factions = new Map<number, Map<number, number>>();
    for (const victim of victims) {
      let contributions = factions.get(victim.playerId);
      if (!contributions)
        factions.set(victim.playerId, (contributions = new Map()));
      for (const [attacker, amount] of damage.contributions(victim.id))
        contributions.set(
          attacker,
          (contributions.get(attacker) ?? 0) + amount,
        );
    }
    for (const [victim, contributions] of factions) {
      let killer = 0,
        largest = 0;
      for (const [attacker, amount] of contributions)
        if (amount > largest || (amount === largest && attacker < killer)) {
          killer = attacker;
          largest = amount;
        }
      if (killer) this.credits.set(victim, killer);
    }
  }
  beneficiary(victim: number, eliminated: ReadonlySet<number>): number {
    const seen = new Set([victim]);
    let beneficiary = this.credits.get(victim) ?? 0;
    while (beneficiary && eliminated.has(beneficiary)) {
      if (seen.has(beneficiary)) return 0;
      seen.add(beneficiary);
      beneficiary = this.credits.get(beneficiary) ?? 0;
    }
    return beneficiary;
  }
}
