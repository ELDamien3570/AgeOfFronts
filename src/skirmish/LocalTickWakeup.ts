interface WakeupChannel {
  port1: { onmessage: ((event: MessageEvent<number>) => void) | null };
  port2: { postMessage(token: number): void };
}

/** One cancellable coordinator task. Overdue ticks yield through a message
 * instead of accumulating the browser's nested zero-timeout clamp. */
export class LocalTickWakeup {
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private pending?: number;
  constructor(private readonly advance: () => void, private readonly channel: WakeupChannel = new MessageChannel()) {
    channel.port1.onmessage = event => this.fire(event.data);
  }
  private fire(token: number): void {
    if (this.pending !== token) return;
    this.pending = undefined;
    this.timer = undefined;
    this.advance();
  }
  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }
  schedule(delay: number): void {
    this.cancel();
    const token = ++this.generation;
    this.pending = token;
    if (delay <= 0) this.channel.port2.postMessage(token);
    else this.timer = setTimeout(() => this.fire(token), delay);
  }
}
