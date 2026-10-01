import type { ClientMessage, ServerMessage } from "../../multiplayer/Protocol";
type LobbyRequest = Exclude<ClientMessage, { type: "authenticate" }>;

/** Browser transport port. Remembered credentials are private and independent of empire cosmetics. */
export class OnlineLobbyConnection {
  private socket?: WebSocket;
  private reconnectTimer?: number;
  private stopped = false;
  private failures = 0;
  private pending = new Map<
    string,
    {
      message: LobbyRequest;
      resolve: (roomId?: string) => void;
      reject: (error: Error) => void;
    }
  >();
  constructor(
    private readonly endpoint: string,
    private readonly onState: (
      message: Extract<ServerMessage, { type: "directory" }>,
    ) => void,
    private readonly onStatus: (status: string, connected: boolean) => void,
    private readonly onMatch?: (message: ServerMessage) => void,
  ) {}

  async connect(): Promise<void> {
    if (this.stopped) return;
    this.onStatus("Connecting to lobby server…", false);
    try {
      let token = localStorage.getItem("ageoffronts.guest-token.v1");
      if (!token) {
        const response = await fetch(new URL("guest", this.baseUrl()), {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error("Guest session service unavailable.");
        const guest = (await response.json()) as { token: string };
        if (!/^[A-Za-z0-9_-]{43}$/u.test(guest.token))
          throw new Error("Invalid guest session response.");
        localStorage.setItem("ageoffronts.guest-token.v1", guest.token);
        token = guest.token;
      }
      const url = new URL("socket", this.baseUrl());
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = (this.socket = new WebSocket(url));
      let authenticated = false;
      const authenticationTimer = window.setTimeout(
        () => socket.close(),
        10_000,
      );
      socket.onopen = () =>
        socket.send(JSON.stringify({ type: "authenticate", token }));
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;
          if (message.type === "directory") {
            clearTimeout(authenticationTimer);
            this.failures = 0;
            this.onStatus("Connected to shared lobbies", true);
            this.onState(message);
            if (!authenticated)
              for (const item of this.pending.values())
                socket.send(JSON.stringify(item.message));
            authenticated = true;
          } else if (message.type === "ack" || message.type === "error") {
            const pending = message.requestId
              ? this.pending.get(message.requestId)
              : undefined;
            if (pending && message.requestId) {
              this.pending.delete(message.requestId);
              if (message.type === "ack") pending.resolve(message.roomId);
              else pending.reject(new Error(message.message));
            } else if (message.type === "error") this.onMatch?.(message);
          } else this.onMatch?.(message);
        } catch {
          this.onStatus("Invalid response from lobby server.", false);
          socket.close();
        }
      };
      socket.onclose = (event) => {
        clearTimeout(authenticationTimer);
        if (this.stopped) return;
        if (event.code === 1008 && event.reason === "Invalid guest session") {
          localStorage.removeItem("ageoffronts.guest-token.v1");
          this.retry();
          return;
        }
        if (event.code === 4001 || event.code === 1008) {
          this.onStatus(
            event.code === 4001
              ? "This guest is active in another tab. Close that tab and reload to return."
              : "Guest session rejected. Clear the saved guest session to create a new identity.",
            false,
          );
          this.stop();
          return;
        }
        this.retry();
      };
      socket.onerror = () => socket.close();
    } catch (error) {
      this.onStatus((error as Error).message, false);
      this.retry();
    }
  }

  request(message: LobbyRequest): Promise<string | undefined> {
    if (this.stopped || this.socket?.readyState !== WebSocket.OPEN)
      return Promise.reject(
        new Error("The lobby server is disconnected. Wait for reconnection."),
      );
    return new Promise((resolve, reject) => {
      this.pending.set(message.requestId, { message, resolve, reject });
      this.socket!.send(JSON.stringify(message));
    });
  }
  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
    for (const pending of this.pending.values())
      pending.reject(new Error("Lobby connection closed."));
    this.pending.clear();
  }
  private baseUrl(): URL {
    return new URL(
      this.endpoint.endsWith("/") ? this.endpoint : `${this.endpoint}/`,
    );
  }
  private retry(): void {
    this.onStatus("Lobby server disconnected. Reconnecting…", false);
    this.reconnectTimer = window.setTimeout(
      () => void this.connect(),
      Math.min(10_000, 500 * 2 ** Math.min(this.failures++, 5)),
    );
  }
}
