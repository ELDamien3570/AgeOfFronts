import type { ExecutorRequest } from "../application/MatchExecutor";

/** Limit for ordinary executor requests (advance, baseline, select-spawn, ...). */
export const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Prepare generates the map, resolves the spawn plan and hashes the result.
 * Black Forest at 1000 takes 18 s on desktop and an extrapolated 46 s on the
 * ARM host (R2-P1), and a retried bad seed (PREPARE_RETRY_BUDGET_MS) adds
 * attempts, so it gets its own limit.
 */
export const PREPARE_REQUEST_TIMEOUT_MS = 150_000;

/** Time a request may run once the worker begins it. */
export function requestTimeoutMs(type: ExecutorRequest["type"]): number {
  return type === "prepare" ? PREPARE_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}

interface Entry<T> {
  id: number;
  limitMs: number;
  meta: T;
}

/**
 * Deadlines for a strictly serial worker. Only the head request is the one
 * being processed, so only its timer runs. A queued request starts its clock
 * when the request ahead of it settles, not when it was posted, so selects
 * waiting behind a long prepare are not timed out for the wait.
 */
export class RequestDeadlines<T> {
  private readonly queue: Entry<T>[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly onExpire: (id: number, meta: T) => void) {}

  get size(): number {
    return this.queue.length;
  }
  /** Add a posted request. Starts its timer at once only when nothing is ahead of it. */
  enqueue(id: number, limitMs: number, meta: T): void {
    this.queue.push({ id, limitMs, meta });
    if (this.queue.length === 1) this.arm();
  }
  /** The request finished (result or error). The next request's timer starts now. */
  settle(id: number): void {
    const index = this.queue.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    this.queue.splice(index, 1);
    if (index === 0) {
      this.disarm();
      this.arm();
    }
  }
  clear(): void {
    this.queue.length = 0;
    this.disarm();
  }
  private arm(): void {
    const head = this.queue[0];
    if (!head) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.onExpire(head.id, head.meta);
    }, head.limitMs);
  }
  private disarm(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
