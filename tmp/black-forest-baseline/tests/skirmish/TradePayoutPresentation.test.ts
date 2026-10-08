import { describe, expect, it } from "vitest";
import { TradePayoutPresentation } from "../../src/skirmish/client/TradePayoutPresentation";
describe("trade payout text", () => {
  it("shows only the earner, replaces the old amount, and expires two seconds after receipt", () => {
    const view = new TradePayoutPresentation();
    const own = { id: 1, tick: 20, playerId: 1, tile: 50, gold: 100 };
    view.update([own, { ...own, id: 2, playerId: 2, tile: 51 }], 1, 100);
    expect(view.amount(50, 100)).toBe(100);
    expect(view.amount(51, 100)).toBeUndefined();
    view.update([own], 1, 1000); // Repeated snapshots cannot extend the lifetime.
    expect(view.amount(50, 2100)).toBeUndefined();
    view.update([{ ...own, id: 3, gold: 250 }], 1, 2200);
    expect(view.amount(50, 2200)).toBe(250);
    view.update([{ ...own, id: 4, gold: 300 }], 1, 2300);
    expect(view.amount(50, 4200)).toBe(300);
    view.prune(4300);
    expect(view.amount(50, 4300)).toBeUndefined();
    view.reset();
    view.update([own], 1, 4400);
    expect(view.amount(50, 4400)).toBe(100);
    view.reset();
    expect(view.amount(50, 4400)).toBeUndefined();
  });
});
