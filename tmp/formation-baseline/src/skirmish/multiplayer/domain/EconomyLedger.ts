export interface EconomyBalance {
  playerId: number;
  gold: number;
  reserves: number;
}
export interface SpendAuthorization {
  id: string;
  playerId: number;
  gold: number;
  reserves: number;
}
export type EconomyEvent =
  | { id: string; type: "spend"; authorizationId: string }
  | {
      id: string;
      type: "world-income";
      playerId: number;
      source:
        | "territory"
        | "trade"
        | "reserve-production"
        | "refund"
        | "host-world";
      gold: number;
      reserves: number;
    };
export interface EconomyLedgerState {
  balances: EconomyBalance[];
  consumedAuthorizations: string[];
  committedEvents: string[];
}

/** Balance authority. Income events are trusted world claims; spend prices come from server quotes. */
export class EconomyLedger {
  private state: EconomyLedgerState;
  constructor(
    balances: readonly EconomyBalance[],
    restored?: EconomyLedgerState,
  ) {
    this.state = structuredClone(
      restored ?? {
        balances: [...balances],
        consumedAuthorizations: [],
        committedEvents: [],
      },
    );
    for (const balance of this.state.balances)
      this.validate(balance.gold, balance.reserves);
    if (
      new Set(this.state.balances.map((balance) => balance.playerId)).size !==
      this.state.balances.length
    )
      throw new Error("Duplicate economy account.");
  }
  snapshot(): EconomyLedgerState {
    return structuredClone(this.state);
  }
  prepare(
    events: readonly EconomyEvent[],
    authorizations: readonly SpendAuthorization[],
    proposedBalances: readonly EconomyBalance[],
  ): EconomyLedgerState {
    const next = structuredClone(this.state);
    const accounts = new Map(
      next.balances.map((balance) => [balance.playerId, balance]),
    );
    const quotes = new Map(
      authorizations.map((authorization) => [authorization.id, authorization]),
    );
    if (quotes.size !== authorizations.length)
      throw new Error("Duplicate spend authorization.");
    const committed = new Set(next.committedEvents),
      consumed = new Set(next.consumedAuthorizations);
    for (const event of events) {
      if (!event.id || committed.has(event.id))
        throw new Error("Duplicate economy event.");
      committed.add(event.id);
      if (event.type === "spend") {
        const quote = quotes.get(event.authorizationId);
        if (!quote || consumed.has(quote.id))
          throw new Error("Missing or already paid spend authorization.");
        this.validate(quote.gold, quote.reserves);
        const balance = accounts.get(quote.playerId);
        if (
          !balance ||
          balance.gold < quote.gold ||
          balance.reserves < quote.reserves
        )
          throw new Error("Unpaid spending.");
        balance.gold -= quote.gold;
        balance.reserves -= quote.reserves;
        consumed.add(quote.id);
      } else {
        this.validate(event.gold, event.reserves);
        if (
          ![
            "territory",
            "trade",
            "reserve-production",
            "refund",
            "host-world",
          ].includes(event.source)
        )
          throw new Error("Unknown world income source.");
        const balance = accounts.get(event.playerId);
        if (!balance) throw new Error("Unknown economy account.");
        balance.gold += event.gold;
        balance.reserves += event.reserves;
        this.validate(balance.gold, balance.reserves);
      }
    }
    if (
      proposedBalances.length !== accounts.size ||
      new Set(proposedBalances.map((balance) => balance.playerId)).size !==
        accounts.size
    )
      throw new Error("Invalid economy account set.");
    for (const proposed of proposedBalances) {
      this.validate(proposed.gold, proposed.reserves);
      const expected = accounts.get(proposed.playerId);
      if (
        !expected ||
        proposed.gold !== expected.gold ||
        proposed.reserves !== expected.reserves
      )
        throw new Error("Unaccounted gold or reserve edit.");
    }
    next.committedEvents = [...committed];
    next.consumedAuthorizations = [...consumed];
    return next;
  }
  /** Application persists this state atomically with the matching world checkpoint before publishing. */
  commit(prepared: EconomyLedgerState): void {
    this.state = structuredClone(prepared);
  }
  private validate(gold: number, reserves: number): void {
    if (
      !Number.isSafeInteger(gold) ||
      !Number.isSafeInteger(reserves) ||
      gold < 0 ||
      reserves < 0
    )
      throw new Error("Invalid economy amount.");
  }
}
