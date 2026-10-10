import { describe, expect, it } from "vitest";
import {
  AiBudgetLedger,
  type AiReservation,
} from "../../src/skirmish/domain/AiBudgetLedger";

const reservation = (id: string, gold = 60): AiReservation => ({
  id,
  claimant: id,
  playerId: 2,
  generation: 1,
  amounts: { gold, items: { steel: 10 } },
  priority: "committed",
  createdTick: 0,
  progressTick: 0,
  expiresTick: 100,
});
describe("shared unpaid AI budget", () => {
  it("prevents double reservations and exposes an owner's own reserved funds", () => {
    const ledger = new AiBudgetLedger(),
      liquid = { gold: 100, items: { steel: 15 } };
    expect(ledger.tryReserve(reservation("port"), liquid)).toBe(true);
    expect(ledger.tryReserve(reservation("defense"), liquid)).toBe(false);
    expect(ledger.spendable(2, liquid)).toEqual({
      gold: 40,
      reserves: 0,
      items: { steel: 5 },
    });
    expect(ledger.spendable(2, liquid, "port")).toEqual({
      gold: 100,
      reserves: 0,
      items: { steel: 15 },
    });
    ledger.reconcile("port", true);
    expect(ledger.reservations.size).toBe(0);
  });
  it("allows affordable emergencies to preempt only unpaid lower-priority work", () => {
    const ledger = new AiBudgetLedger(),
      liquid = { gold: 100, items: { steel: 20 } };
    ledger.tryReserve(reservation("growth"), liquid);
    expect(ledger.spendable(2, liquid, "emergency", "emergency")).toEqual({
      gold: 100,
      reserves: 0,
      items: { steel: 20 },
    });
    expect(
      ledger.tryReserve(
        { ...reservation("emergency", 110), priority: "emergency" },
        liquid,
      ),
    ).toBe(false);
    expect(ledger.reservations.has("growth")).toBe(true);
    expect(
      ledger.tryReserve(
        { ...reservation("emergency", 80), priority: "emergency" },
        liquid,
      ),
    ).toBe(true);
    expect(ledger.reservations.has("growth")).toBe(false);
  });
  it("restores commitments and releases expiry, takeover and stale generations", () => {
    const ledger = new AiBudgetLedger(),
      liquid = { gold: 100, items: { steel: 20 } };
    ledger.tryReserve(reservation("port"), liquid);
    const restored = new AiBudgetLedger();
    restored.restore(ledger.checkpoint());
    expect(restored.spendable(2, liquid)).toEqual(ledger.spendable(2, liquid));
    restored.expire(99, new Map([[2, 1]]));
    expect(restored.reservations.size).toBe(1);
    restored.expire(99, new Map([[2, 2]]));
    expect(restored.reservations.size).toBe(0);
    ledger.expire(100, new Map([[2, 1]]));
    expect(ledger.reservations.size).toBe(0);
    ledger.tryReserve(reservation("port"), liquid);
    ledger.releasePlayer(2);
    expect(ledger.spendable(2, liquid)).toEqual({
      gold: 100,
      reserves: 0,
      items: { steel: 20 },
    });
  });
  it("rejects malformed costs and never spends incoming or forecast stock", () => {
    const ledger = new AiBudgetLedger();
    expect(
      ledger.tryReserve(
        { ...reservation("bad"), amounts: { gold: -1 } },
        { gold: 100 },
      ),
    ).toBe(false);
    expect(
      ledger.tryReserve(reservation("future"), {
        gold: 59,
        items: { steel: 9 },
      }),
    ).toBe(false);
    expect(ledger.reservations.size).toBe(0);
  });
});
