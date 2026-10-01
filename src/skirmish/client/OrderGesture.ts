interface PendingOrder {
  time: number;
  x: number;
  y: number;
  context: string;
  single: () => void;
}
/** Resolves one pointer intent before dispatch. This holds no simulation state. */
export class OrderGesture {
  private pending?: PendingOrder;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    readonly interval = 350,
    readonly distance = 10,
  ) {}
  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }
  submit(order: PendingOrder, charge?: () => void): void {
    const previous = this.pending;
    this.cancel();
    if (
      previous &&
      charge &&
      previous.context === order.context &&
      order.time - previous.time < this.interval &&
      (previous.x - order.x) ** 2 + (previous.y - order.y) ** 2 <
        this.distance ** 2
    ) {
      charge();
      return;
    }
    if (previous?.context === order.context) previous.single();
    if (!charge) {
      order.single();
      return;
    }
    this.pending = order;
    this.timer = setTimeout(() => {
      const pending = this.pending;
      this.cancel();
      pending?.single();
    }, this.interval);
  }
}
