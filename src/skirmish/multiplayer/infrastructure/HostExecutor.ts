import { z } from "zod";
import { PublicationSequencer } from "../application/PublicationSequencer";
import type {
  ExecutorRequest,
  ExecutorResult,
  MatchExecutor,
  MatchPublication,
} from "../application/MatchExecutor";
import { HOST_LEFT_MESSAGE } from "../application/TerminalMessages";
import { encodeHostFrame } from "../HostWire";
import { RequestDeadlines, requestTimeoutMs } from "./RequestDeadlines";

/** The room owner's browser must open its host connection within this window. */
export const HOST_ATTACH_TIMEOUT_MS = 60_000;
/** Network slack added to every request deadline (the host is across the internet). */
export const HOST_REQUEST_SLACK_MS = 15_000;

/** The coordinator's end of one hosting browser's socket. */
export interface HostLink {
  send(frame: Uint8Array): void;
  close(): void;
}

const encodedState = z.object({ hash: z.string().max(128), payload: z.string(), binary: z.instanceof(Uint8Array).optional() }).passthrough();
const hostMessage = z.union([
  z.object({ fatal: z.string().max(200), failureCause: z.string().optional() }),
  z.object({ publication: z.object({ tick: z.number().int().nonnegative(), sequence: z.number().int().positive(), packet: encodedState }) }),
  z.object({ id: z.number().int().positive(), error: z.string().max(500) }),
  z.object({ id: z.number().int().positive(), result: z.unknown(), publicationsIssued: z.number().int().nonnegative().optional() }),
]);
type Settled = { id: number; result: ExecutorResult; error?: string };

/**
 * A MatchExecutor whose simulation runs in the custom room owner's browser.
 * It speaks the same request/result/publication protocol as a reserved
 * worker thread (ReservedMatchWorker), carried over the host's socket in
 * HostWire frames. The host is trusted with the simulation; when its
 * connection closes the match is over.
 */
export class HostExecutor implements MatchExecutor {
  readonly remote = true;
  readonly lifecycle: { state: "running" | "stopped"; message?: string; cause?: "closed" | "host-left" | "attach-timeout" | "timeout" | "protocol" | "fatal" } = { state: "running" };
  private link?: HostLink;
  private readonly outbox: Uint8Array[] = [];
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<number, { resolve: (value: ExecutorResult) => void; reject: (error: Error) => void }>();
  private readonly publications = new Set<(publication: MatchPublication) => void>();
  private readonly sequencer = new PublicationSequencer<MatchPublication, Settled>(
    publication => { if (!this.closed) for (const listener of this.publications) listener(publication); },
    message => this.settle(message),
  );
  private readonly deadlines = new RequestDeadlines<ExecutorRequest>((_id, request) =>
    this.fail(`The host did not answer in time (${request.type})`, "timeout"));
  private readonly attachTimer: ReturnType<typeof setTimeout>;

  constructor(readonly hostGuestId: string, options: { attachTimeoutMs?: number } = {}) {
    this.attachTimer = setTimeout(() => {
      if (!this.link) this.fail(HOST_LEFT_MESSAGE, "attach-timeout");
    }, options.attachTimeoutMs ?? HOST_ATTACH_TIMEOUT_MS);
    this.attachTimer.unref?.();
  }

  get attached(): boolean {
    return this.link !== undefined;
  }

  /** Bind the hosting browser's socket; queued requests are sent at once. */
  attach(link: HostLink): void {
    if (this.closed) throw new Error("This match is no longer waiting for its host");
    if (this.link) throw new Error("This match already has a host connection");
    clearTimeout(this.attachTimer);
    this.link = link;
    for (const frame of this.outbox.splice(0)) link.send(frame);
  }

  /** The host's socket closed: the simulation is gone with it. */
  detach(link: HostLink): void {
    if (this.link === link) this.fail(HOST_LEFT_MESSAGE, "host-left");
  }

  /** One decoded frame from the host. A malformed frame ends the match. */
  receive(raw: unknown): void {
    if (this.closed) return;
    const parsed = hostMessage.safeParse(raw);
    if (!parsed.success) { this.fail(HOST_LEFT_MESSAGE, "protocol"); return; }
    const message = parsed.data;
    try {
      if ("fatal" in message) { this.fail(HOST_LEFT_MESSAGE, "fatal"); return; }
      if ("publication" in message) {
        const { tick, sequence, packet } = message.publication;
        this.sequencer.publication(sequence, { tick, packet: packet as MatchPublication["packet"] });
        return;
      }
      if (!this.pending.has(message.id)) return;
      // A result never overtakes a publication issued before it (join
      // barriers and baselines continue the same delta chain).
      if ("error" in message) this.sequencer.result(0, { id: message.id, result: undefined as never, error: message.error });
      else this.sequencer.result(message.publicationsIssued ?? 0, { id: message.id, result: message.result as ExecutorResult });
    } catch {
      this.fail(HOST_LEFT_MESSAGE, "protocol");
    }
  }

  onPublication(listener: (publication: MatchPublication) => void): () => void {
    this.publications.add(listener);
    return () => this.publications.delete(listener);
  }

  request<T extends ExecutorResult>(request: ExecutorRequest): Promise<T> {
    if (this.closed) return Promise.reject(new Error(this.lifecycle.message ?? HOST_LEFT_MESSAGE));
    if (this.pending.size >= 8) return Promise.reject(new Error("Match executor backlog exceeded"));
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.deadlines.enqueue(id, requestTimeoutMs(request.type) + HOST_REQUEST_SLACK_MS, request);
      const frame = encodeHostFrame({ id, request });
      if (this.link) this.link.send(frame);
      else this.outbox.push(frame);
    });
  }

  async close(): Promise<void> {
    this.fail("Match executor stopped", "closed");
  }

  private settle(message: Settled): void {
    const task = this.pending.get(message.id);
    if (!task) return;
    this.pending.delete(message.id);
    this.deadlines.settle(message.id);
    if (message.error) task.reject(new Error(message.error));
    else task.resolve(message.result);
  }

  private fail(message: string, cause: NonNullable<HostExecutor["lifecycle"]["cause"]>): void {
    if (this.closed) return;
    this.closed = true;
    this.lifecycle.state = "stopped";
    this.lifecycle.cause = cause;
    // A requested close keeps the match's own ending text.
    if (cause !== "closed") this.lifecycle.message = HOST_LEFT_MESSAGE;
    if (cause !== "closed" && cause !== "host-left")
      console.warn(JSON.stringify({ event: "host-executor-stopped", cause, message }));
    clearTimeout(this.attachTimer);
    this.sequencer.stop();
    this.deadlines.clear();
    this.outbox.length = 0;
    const error = new Error(cause === "closed" ? message : HOST_LEFT_MESSAGE);
    for (const task of this.pending.values()) task.reject(error);
    this.pending.clear();
    this.publications.clear();
    const link = this.link;
    this.link = undefined;
    link?.close();
  }
}
