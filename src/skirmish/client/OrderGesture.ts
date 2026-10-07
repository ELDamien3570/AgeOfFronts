interface PendingOrder {
  time: number;
  x: number;
  y: number;
  context: string;
  single: () => void;
}
/** Resolves one pointer intent before dispatch. This holds no simulation state.
 * The ordinary order is sent at once; a second nearby click on the same
 * selection within the interval upgrades it to a charge, which supersedes the
 * order already sent. Nothing is held back waiting for a possible double click. */
export class OrderGesture {
  private recent?: PendingOrder;
  constructor(
    readonly interval = 350,
    readonly distance = 10,
  ) {}
  cancel(): void {
    this.recent = undefined;
  }
  submit(order: PendingOrder, charge?: () => void): void {
    const previous = this.recent;
    if (
      previous &&
      charge &&
      previous.context === order.context &&
      order.time - previous.time < this.interval &&
      (previous.x - order.x) ** 2 + (previous.y - order.y) ** 2 <
        this.distance ** 2
    ) {
      // A third click starts a fresh gesture rather than charging again.
      this.recent = undefined;
      charge();
      return;
    }
    order.single();
    this.recent = order;
  }
}
