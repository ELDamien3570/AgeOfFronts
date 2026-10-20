import { decodeHostFrame, encodeHostFrame } from "../multiplayer/HostWire";

const GUEST_TOKEN_KEY = "ageoffronts.guest-token.v1";

/**
 * The owner's side of a hosted custom match. A worker runs the match's
 * simulation (hostMatchWorker.ts); this page relays the coordinator's
 * requests to it over the /host socket and uploads its results and
 * snapshots. The owner also plays through an ordinary OnlineMatchSession, so
 * the host's own view takes the same path as everyone else's.
 */
export class MatchHostConnection {
  private socket?: WebSocket;
  private worker?: Worker;
  private stopped = false;
  private readonly leaveWarning = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    // Older browsers show the prompt only when returnValue is set.
    event.returnValue = "";
  };

  constructor(
    private readonly endpoint: string,
    private readonly matchId: string,
    private readonly runtimeId: string,
    private readonly failed: (message: string) => void,
  ) {}

  start(): void {
    if (this.stopped || this.socket) return;
    let token: string | null = null;
    try { token = localStorage.getItem(GUEST_TOKEN_KEY); } catch { /* storage blocked */ }
    if (!token) {
      this.fail("This browser has no guest identity to host the match. Return to the lobby.");
      return;
    }
    const worker = (this.worker = new Worker(new URL("./hostMatchWorker.ts", import.meta.url), { type: "module" }));
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(encodeHostFrame(event.data));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.fail("The match simulation stopped in this browser. The match has ended.");
    };
    const url = new URL("host", this.endpoint.endsWith("/") ? this.endpoint : `${this.endpoint}/`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = (this.socket = new WebSocket(url));
    socket.binaryType = "arraybuffer";
    socket.onopen = () =>
      socket.send(JSON.stringify({ type: "host-authenticate", token, matchId: this.matchId, runtimeId: this.runtimeId }));
    socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      if (typeof event.data === "string") return;
      try {
        worker.postMessage(decodeHostFrame(event.data));
      } catch {
        this.fail("The match server sent an invalid hosting request.");
      }
    };
    socket.onclose = (event) => {
      if (this.stopped) return;
      // 1000 is the coordinator closing a finished match.
      if (event.code === 1000) this.stop();
      else this.fail(event.reason ? `Hosting stopped: ${event.reason}` : "The hosting connection was lost. The match has ended.");
    };
    window.addEventListener("beforeunload", this.leaveWarning);
  }

  /** The match ended: release the simulation and stop guarding the page. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    window.removeEventListener("beforeunload", this.leaveWarning);
    this.socket?.close();
    this.worker?.terminate();
  }

  private fail(message: string): void {
    if (this.stopped) return;
    this.stop();
    this.failed(message);
  }
}
