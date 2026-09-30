// Fair deterministic FIFO for background AI orders and navigation repair.
// Existing paths continue while waiting; browser time never controls the budget.
export class RouteWork {
  private readonly pending = new Map<
    string,
    { units: number; run: () => void }
  >();

  request(key: string, units: number, run: () => void): void {
    // Refresh a stale target without moving the request to the back of the line.
    this.pending.set(key, { units, run });
  }

  drain(budget: number): void {
    for (const [key, work] of this.pending) {
      if (work.units > budget) break;
      this.pending.delete(key);
      budget -= work.units;
      work.run();
      if (!budget) break;
    }
  }
}
