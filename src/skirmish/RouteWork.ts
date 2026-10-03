// Fair deterministic FIFO for background AI orders and navigation repair.
// Existing paths continue while waiting; browser time never controls the budget.
export class RouteWork<T = () => void> {
  private readonly pending = new Map<string, { units: number; task: T }>();
  constructor(
    private readonly execute: (task: T) => void = ((run: unknown) =>
      (run as () => void)()) as (task: T) => void,
  ) {}

  request(key: string, units: number, task: T): void {
    // Refresh a stale target without moving the request to the back of the line.
    this.pending.set(key, { units, task });
  }
  cancel(key: string): void {
    this.pending.delete(key);
  }

  /**
   * Runs queued jobs in FIFO order. `units` bounds the job count; `effort`
   * additionally stops the drain once the deterministic search effort spent
   * since it began reaches `limit` (at least one job always runs), so a handful
   * of long routes cannot stack into one very long tick.
   */
  drain(budget: number, effort?: { read: () => number; limit: number },priority?: (task:T)=>boolean,turn=0): void {
    const started = effort?.read() ?? 0;
    let interactive=false;
    if(priority)for(const work of this.pending.values())if(priority(work.task)){interactive=true;break;}
    while(this.pending.size&&budget>0){
      const preferred=turn++%3<2;
      let entry:[string,{units:number;task:T}]|undefined;
      if(interactive){
        for(const candidate of this.pending)if(candidate[1].units<=budget&&priority!(candidate[1].task)===preferred){entry=candidate;break;}
        if(!entry)for(const candidate of this.pending)if(candidate[1].units<=budget){entry=candidate;break;}
      }else entry=this.pending.entries().next().value;
      if(!entry)break;
      const [key,work]=entry;
      if (work.units > budget) break;
      this.pending.delete(key);
      budget -= work.units;
      this.execute(work.task);
      if (!budget) break;
      if (effort && effort.read() - started >= effort.limit) break;
    }
  }
  checkpoint(): [string, { units: number; task: T }][] {
    return structuredClone([...this.pending]);
  }
  restore(state: [string, { units: number; task: T }][]): void {
    this.pending.clear();
    for (const [key, work] of structuredClone(state))
      this.pending.set(key, work);
  }
}
