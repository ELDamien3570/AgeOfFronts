import { describe, expect, it } from "vitest";
import { EconomyLedger } from "../../src/skirmish/multiplayer/domain/EconomyLedger";
const balances = [{ playerId: 1, gold: 100, reserves: 1000 }];
describe("lightweight server economy ledger", () => {
  it("rejects direct balance edits and spends that have no server authorization", () => {
    const ledger = new EconomyLedger(balances);
    expect(() => ledger.prepare([], [], [{ playerId: 1, gold: 1000, reserves: 1000 }])).toThrow("edit");
    expect(() => ledger.prepare([{ type: "spend", id: "event-1", authorizationId: "fake" }], [], balances)).toThrow("authorization");
    expect(ledger.snapshot().balances).toEqual(balances);
  });
  it("applies trusted income and server-priced spending atomically, without charging twice", () => {
    const ledger = new EconomyLedger(balances);
    const events = [{ type: "world-income" as const, id: "income-1", playerId: 1, source: "trade" as const, gold: 20, reserves: 0 }, { type: "spend" as const, id: "spend-1", authorizationId: "quote-1" }];
    const quotes = [{ id: "quote-1", playerId: 1, gold: 80, reserves: 500 }];
    const prepared = ledger.prepare(events, quotes, [{ playerId: 1, gold: 40, reserves: 500 }]);
    expect(ledger.snapshot().balances).toEqual(balances);
    ledger.commit(prepared);
    expect(() => ledger.prepare(events, quotes, prepared.balances)).toThrow("Duplicate");
    expect(() => ledger.prepare([{ type: "spend", id: "spend-2", authorizationId: "quote-1" }], quotes, prepared.balances)).toThrow("already paid");
  });
  it("rejects overspending and invalid numeric claims", () => {
    const ledger = new EconomyLedger(balances);
    expect(() => ledger.prepare([{ type: "spend", id: "spend-1", authorizationId: "quote-1" }], [{ id: "quote-1", playerId: 1, gold: 101, reserves: 0 }], balances)).toThrow("Unpaid");
    expect(() => new EconomyLedger([{ playerId: 1, gold: Infinity, reserves: 0 }])).toThrow("amount");
  });
});
