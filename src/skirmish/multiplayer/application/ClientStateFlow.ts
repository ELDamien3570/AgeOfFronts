/** A small publication window absorbs worker/network latency without retaining
 * unbounded frames. Skipped deltas require a fresh
 * baseline; a credit never authorizes resuming a broken incremental cursor.
 */
export class ClientStateFlow {
  epoch = 1;
  private readonly outstanding: number[] = [];
  constructor(private readonly window = 4) {
    if (!Number.isInteger(window) || window < 1 || window > 4)
      throw new Error("Invalid client publication window");
  }
  get pending(): number | undefined {
    return this.outstanding[this.outstanding.length - 1];
  }
  dirty = false;
  recovering = false;
  offer(sequence: number): boolean {
    if (
      this.dirty ||
      this.outstanding.length >= this.window ||
      this.recovering
    ) {
      this.dirty = true;
      return false;
    }
    this.outstanding.push(sequence);
    return true;
  }
  applied(sequence: number, epoch: number): "ignored" | "credit" | "baseline" {
    const at = this.outstanding.indexOf(sequence);
    if (epoch !== this.epoch || at < 0) return "ignored";
    // Canonical application is ordered. An acknowledgement of a sent frame
    // also proves the preceding frames in this epoch were consumed.
    this.outstanding.splice(0, at + 1);
    return this.dirty && !this.outstanding.length ? "baseline" : "credit";
  }
  beginBaseline(replace = false): boolean {
    if (this.recovering && !replace) return false;
    this.recovering = true;
    this.outstanding.length = 0;
    this.dirty = false;
    this.epoch++;
    return true;
  }
  baseline(sequence: number, changedSinceCapture: boolean): void {
    this.recovering = false;
    this.outstanding.length = 0;
    this.outstanding.push(sequence);
    this.dirty ||= changedSinceCapture;
  }
}
