// Fair deterministic FIFO for background AI orders and navigation repair.
// Existing paths continue while waiting; browser time never controls the budget.
export class RouteWork<T = () => void> {
  private readonly pending = new Map<
    string,
    { units: number; task: T }
  >();
  constructor(private readonly execute: (task: T) => void = ((run: unknown) => (run as () => void)()) as (task: T) => void) {}

  request(key: string, units: number, task: T): void {
    // Refresh a stale target without moving the request to the back of the line.
    this.pending.set(key, { units, task });
  }
  cancel(key: string): void {
    this.pending.delete(key);
  }

  drain(budget: number): void {
    for (const [key, work] of this.pending) {
      if (work.units > budget) break;
      this.pending.delete(key);
      budget -= work.units;
      this.execute(work.task);
      if (!budget) break;
    }
  }
  checkpoint(): [string, { units: number; task: T }][] { return structuredClone([...this.pending]); }
  restore(state: [string, { units: number; task: T }][]): void {
    this.pending.clear();
    for (const [key, work] of structuredClone(state)) this.pending.set(key, work);
  }
}
