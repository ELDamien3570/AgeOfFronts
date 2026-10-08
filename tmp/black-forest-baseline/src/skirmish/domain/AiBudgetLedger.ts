import type { Cost, Inventory } from "./Definitions";

export type AiPriority = "growth" | "committed" | "emergency";
export interface AiReservation {
  id: string;
  playerId: number;
  generation: number;
  claimant: string;
  priority: AiPriority;
  amounts: Cost;
  createdTick: number;
  progressTick: number;
  expiresTick: number;
}
const rank = { growth: 0, committed: 1, emergency: 2 };
const valid = (cost: Cost) =>
  [
    cost.gold ?? 0,
    cost.reserves ?? 0,
    ...Object.values(cost.items ?? {}),
  ].every((n) => Number.isSafeInteger(n) && n >= 0);
export const affordableAiCost = (liquid: Cost, cost: Cost) =>
  valid(cost) &&
  (liquid.gold ?? 0) >= (cost.gold ?? 0) &&
  (liquid.reserves ?? 0) >= (cost.reserves ?? 0) &&
  Object.entries(cost.items ?? {}).every(
    ([id, n]) => (liquid.items?.[id] ?? 0) >= n,
  );

// Only unpaid commitments live here. Supply/Recruitment remain payment owners.
export class AiBudgetLedger {
  readonly reservations = new Map<string, AiReservation>();
  checkpoint() {
    return structuredClone([...this.reservations]);
  }
  restore(saved: ReturnType<AiBudgetLedger["checkpoint"]>): void {
    this.reservations.clear();
    for (const [id, reservation] of structuredClone(saved))
      this.reservations.set(id, reservation);
  }
  protected(
    playerId: number,
    claimant?: string,
    minimumPriority?: AiPriority,
  ): Cost {
    const items: Inventory = {};
    const result: Cost = { gold: 0, reserves: 0, items };
    for (const r of this.reservations.values()) {
      if (
        r.playerId !== playerId ||
        r.claimant === claimant ||
        (minimumPriority && rank[r.priority] < rank[minimumPriority])
      )
        continue;
      result.gold! += r.amounts.gold ?? 0;
      result.reserves! += r.amounts.reserves ?? 0;
      for (const [id, n] of Object.entries(r.amounts.items ?? {}))
        items[id] = (items[id] ?? 0) + n;
    }
    return result;
  }
  spendable(
    playerId: number,
    liquid: Cost,
    claimant?: string,
    priority?: AiPriority,
  ): Cost {
    const held = this.protected(
        playerId,
        claimant,
        priority === "emergency" ? priority : undefined,
      ),
      items = { ...liquid.items };
    for (const [id, n] of Object.entries(held.items ?? {}))
      items[id] = Math.max(0, (items[id] ?? 0) - n);
    return {
      gold: Math.max(0, (liquid.gold ?? 0) - held.gold!),
      reserves: Math.max(0, (liquid.reserves ?? 0) - held.reserves!),
      items,
    };
  }
  tryReserve(reservation: AiReservation, liquid: Cost): boolean {
    if (!valid(reservation.amounts) || !valid(liquid)) return false;
    if (
      [...this.reservations.values()].some(
        (r) =>
          r.playerId === reservation.playerId &&
          r.claimant === reservation.claimant &&
          r.id !== reservation.id,
      )
    )
      return false;
    const available = this.spendable(
      reservation.playerId,
      liquid,
      reservation.claimant,
    );
    if (!affordableAiCost(available, reservation.amounts)) {
      if (reservation.priority !== "emergency") return false;
      // Do not discard valid commitments for an emergency that is itself unaffordable.
      if (!affordableAiCost(liquid, reservation.amounts)) return false;
      const retained = [...this.reservations.values()].filter(
        (r) =>
          r.playerId === reservation.playerId &&
          r.claimant !== reservation.claimant &&
          rank[r.priority] >= rank[reservation.priority],
      );
      const remaining: Cost = {
        gold: liquid.gold ?? 0,
        reserves: liquid.reserves ?? 0,
      };
      const items: Inventory = { ...liquid.items };
      for (const r of retained) {
        remaining.gold! -= r.amounts.gold ?? 0;
        remaining.reserves! -= r.amounts.reserves ?? 0;
        for (const [id, n] of Object.entries(r.amounts.items ?? {}))
          items[id] = (items[id] ?? 0) - n;
      }
      remaining.items = items;
      if (!affordableAiCost(remaining, reservation.amounts)) return false;
      for (const [id, r] of this.reservations)
        if (
          r.playerId === reservation.playerId &&
          rank[r.priority] < rank[reservation.priority]
        )
          this.reservations.delete(id);
    }
    this.reservations.set(reservation.id, structuredClone(reservation));
    return true;
  }
  release(id: string): void {
    this.reservations.delete(id);
  }
  releasePlayer(playerId: number): void {
    for (const [id, r] of this.reservations)
      if (r.playerId === playerId) this.reservations.delete(id);
  }
  reconcile(id: string, accepted: boolean): void {
    if (accepted) this.release(id);
  }
  expire(tick: number, generations: ReadonlyMap<number, number>): void {
    for (const [id, r] of this.reservations)
      if (tick >= r.expiresTick || generations.get(r.playerId) !== r.generation)
        this.reservations.delete(id);
  }
}
