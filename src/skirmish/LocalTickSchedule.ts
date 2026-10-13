/** Local coordinator clock. Every callback advances at most one canonical tick;
 * speed changes deadlines, never the domain timestep. Small overruns catch up,
 * while a suspended tab retains at most four ticks of coordinator debt. */
export class LocalTickSchedule {
  private deadline = 0;
  private interval: number;
  constructor(private readonly tickMs: number) { this.interval = tickMs; }
  reset(now: number, speed: 1 | 2 | 4): void {
    this.interval = this.tickMs / speed;
    this.deadline = now + this.interval;
  }
  advanced(now: number): void {
    this.deadline = Math.max(this.deadline + this.interval, now - this.interval * 4);
  }
  delay(now: number): number { return Math.max(0, this.deadline - now); }
}
