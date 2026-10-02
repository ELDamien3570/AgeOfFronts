import type {
  LoadedMap,
  SnapshotPacket,
  WorkerRequest,
  WorkerResponse,
} from "../Protocol";
import type { MatchManifest, ServerMessage } from "../multiplayer/Protocol";
import type { EncodedState } from "../multiplayer/StateCodec";
import { mapIdentity } from "../multiplayer/application/MapIdentity";
import { OnlineLobbyConnection } from "./lobby/OnlineLobbyConnection";

const MAX_PENDING_STATES = 8;

/** Thin presentation client. The server alone advances the simulation. */
export class OnlineMatchSession {
  onmessage:
    | ((event: MessageEvent<WorkerResponse>) => void | Promise<void>)
    | null = null;
  oncommandsavailable: ((available: boolean) => void) | null = null;
  commandsAvailable = false;
  onerror: ((event: { message: string }) => void) | null = null;
  disconnectedPlayerIds: number[] = [];
  private decoder?: Worker;
  private connection: OnlineLobbyConnection;
  private decoding?: {
    resolve: (packet: SnapshotPacket) => void;
    reject: (error: Error) => void;
  };
  private incoming = Promise.resolve();
  private pendingStates = 0;
  private initialized = false;
  private stopped = false;
  private manifest?: MatchManifest;
  private lastTick = -1;
  private lastPublicationSequence = -1;
  private watching = false;
  private matchPaused = false;
  private pendingSync?: { id: string; publicationSequence: number };
  constructor(
    endpoint: string,
    private matchId: string,
    private load: (manifest: MatchManifest) => Promise<LoadedMap>,
    private identity: (playerId: number) => void,
    private status: (message: string) => void,
    private playerId?: number,
  ) {
    this.connection = new OnlineLobbyConnection(
      endpoint,
      () => {
        if (this.manifest || this.watching || this.stopped) return;
        this.watching = true;
        this.status("Joining match · loading your empire…");
        void this.request({
          type: "watch-match",
          matchId: this.matchId,
          ...(this.playerId === undefined ? {} : { playerId: this.playerId }),
        }).catch((error) => this.fail(error.message));
      },
      (message, connected) => {
        if (this.stopped || (connected && this.initialized)) return;
        if (!connected && this.initialized) {
          this.fail(
            "Connection lost. You have left this match. Return to the lobby to rejoin your reserved empire.",
          );
          return;
        }
        this.status(message);
      },
      (message) => {
        if (this.stopped) return;
        // Asset loading may still be awaiting network I/O. Terminal admission
        // messages must not wait behind that promise to release this session.
        if (this.pendingSync || this.lastTick < 0) {
          if (message.type === "error") {
            this.fail(message.message);
            return;
          }
          if (
            message.type === "match-ended" &&
            message.matchId === this.matchId
          ) {
            this.fail(`${message.message}. Return to the lobby to play again.`);
            return;
          }
        }
        const state = message.type === "match-state";
        if (state && ++this.pendingStates > MAX_PENDING_STATES) {
          this.fail(
            "This device cannot keep up with the match updates. Return to the lobby to play again.",
          );
          return;
        }
        this.incoming = this.incoming
          .then(() => (this.stopped ? undefined : this.receive(message)))
          .catch((error) => this.fail(error.message))
          .finally(() => {
            if (state) this.pendingStates--;
          });
      },
      { reconnect: false },
    );
  }
  connect(): void {
    if (!this.stopped) void this.connection.connect();
  }
  postMessage(message: WorkerRequest): void {
    if (this.stopped) return;
    if (message.type === "select-spawn")
      void this.request({
        type: "select-spawn",
        matchId: this.matchId,
        tile: message.tile,
      }).catch((error) => {
        if (!this.stopped)
          this.onmessage?.({
            data: { type: "rejected", message: error.message },
          } as MessageEvent<WorkerResponse>);
      });
    if (message.type === "command") {
      if (!this.commandsAvailable) {
        this.status(
          this.pendingSync
            ? "Synchronizing your empire… Commands unlock when synchronization completes."
            : "Waiting for the match to resume. Commands are temporarily unavailable.",
        );
        return;
      }
      void this.request({
        type: "match-command",
        matchId: this.matchId,
        command: message.command,
      }).catch((error) => {
        if (!this.stopped) this.status(error.message);
      });
    }
  }
  terminate(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.setCommandsAvailable(false);
    this.connection.stop();
    this.decoder?.terminate();
    this.decoding?.reject(new Error("Session stopped"));
    this.decoding = undefined;
  }
  private request(message: object): Promise<string | undefined> {
    return this.connection.request({
      ...message,
      requestId: crypto.randomUUID(),
    } as Parameters<OnlineLobbyConnection["request"]>[0]);
  }
  private decode(packet: EncodedState): Promise<SnapshotPacket> {
    return new Promise((resolve, reject) => {
      if (!this.decoder || this.decoding) {
        reject(new Error("State decoder is unavailable"));
        return;
      }
      this.decoding = { resolve, reject };
      this.decoder.postMessage(packet);
    });
  }
  private setCommandsAvailable(available: boolean): void {
    if (this.commandsAvailable === available) return;
    this.commandsAvailable = available;
    this.oncommandsavailable?.(available);
  }
  private async receive(message: ServerMessage): Promise<void> {
    if ("matchId" in message && message.matchId !== this.matchId) return;
    if (message.type === "match") {
      if (this.manifest || message.manifest.id !== this.matchId) return;
      this.manifest = message.manifest;
      if (
        message.manifest.runtimeId !== import.meta.env.VITE_SKIRMISH_RUNTIME_ID
      )
        throw new Error(
          "Game versions differ. Reload the homepage after deployment.",
        );
      this.status("Loading battlefield · your empire is reserved…");
      this.identity(message.manifest.playerId);
      const loaded = await this.load(message.manifest);
      if (this.stopped) return;
      const identity = await mapIdentity({
        width: loaded.map.width(),
        height: loaded.map.height(),
        terrain: loaded.terrain,
        elevation: loaded.elevation,
        forest: loaded.forest,
        resourceTerrain: loaded.resourceTerrain,
      });
      if (this.stopped) return;
      if (identity !== message.manifest.mapHash)
        throw new Error("Map versions differ. Reload after deployment.");
      this.decoder = new Worker(
        new URL("./multiplayerStateWorker.ts", import.meta.url),
        { type: "module" },
      );
      this.decoder.onmessage = (
        event: MessageEvent<{ packet?: SnapshotPacket; error?: string }>,
      ) => {
        const task = this.decoding;
        this.decoding = undefined;
        if (!task) return;
        if (event.data.error) task.reject(new Error(event.data.error));
        else if (event.data.packet) task.resolve(event.data.packet);
        else task.reject(new Error("Invalid decoded match state"));
      };
      this.decoder.onerror = (event) => this.fail(event.message);
      this.initialized = true;
      await this.request({
        type: "match-ready",
        matchId: this.matchId,
        runtimeId: message.manifest.runtimeId,
      });
    } else if (message.type === "match-spawn") {
      this.onmessage?.({
        data: { type: "spawn", state: message.state },
      } as MessageEvent<WorkerResponse>);
    } else if (message.type === "match-state") {
      if (!this.initialized) return;
      // A join barrier can publish a fresh baseline at the current simulation tick.
      // Publication identity, not tick advancement, orders the stream.
      if (message.publicationSequence !== undefined) {
        if (message.publicationSequence <= this.lastPublicationSequence) return;
      } else if (message.tick <= this.lastTick && !message.syncId) return;
      if (message.tick < this.lastTick)
        throw new Error(
          "Match updates arrived out of order. Return to the lobby to rejoin.",
        );
      if (message.syncId) {
        if (message.publicationSequence === undefined)
          throw new Error("Missing synchronization publication identity.");
        this.pendingSync = {
          id: message.syncId,
          publicationSequence: message.publicationSequence,
        };
        this.setCommandsAvailable(false);
        this.status(
          "Synchronizing your empire… Commands unlock when synchronization completes.",
        );
      }
      const packet = await this.decode(message.packet);
      if (this.stopped) return;
      if (
        packet.tick !== message.tick ||
        (!packet.reset && (this.lastTick < 0 || !!message.syncId))
      )
        throw new Error(
          "Invalid match update sequence. Return to the lobby to play again.",
        );
      this.lastTick = packet.tick;
      if (message.publicationSequence !== undefined)
        this.lastPublicationSequence = message.publicationSequence;
      this.matchPaused = message.paused;
      this.disconnectedPlayerIds = message.disconnectedPlayerIds;
      this.setCommandsAvailable(!message.paused && !this.pendingSync);
      if (message.syncId && !this.onmessage)
        throw new Error(
          "The match view is unavailable. Return to the lobby to rejoin.",
        );
      await this.onmessage?.({
        data: { type: "state", packet, paused: message.paused, speed: 1 },
      } as MessageEvent<WorkerResponse>);
      if (this.stopped) return;
      // Receipt is not application: acknowledge only after both decoding and
      // the presentation callback have applied the complete baseline.
      if (message.syncId) {
        await this.request({
          type: "match-sync-applied",
          matchId: this.matchId,
          syncId: message.syncId,
          publicationSequence: message.publicationSequence,
        });
      } else if (!this.pendingSync)
        this.status(
          message.paused
            ? "Match paused · waiting for players"
            : "Online match · server hosted",
        );
    } else if (message.type === "match-sync-complete") {
      if (message.syncId !== this.pendingSync?.id) return;
      this.pendingSync = undefined;
      // The completion event is the server's barrier-release authorization.
      this.matchPaused = false;
      this.setCommandsAvailable(true);
      this.status("Online match · server hosted");
    } else if (message.type === "match-status") {
      this.matchPaused = message.paused;
      this.setCommandsAvailable(
        this.lastTick >= 0 && !this.pendingSync && !this.matchPaused,
      );
      this.status(message.message);
    } else if (message.type === "match-ended") {
      this.status(`${message.message}. Return to the lobby to play again.`);
      this.terminate();
    } else if (message.type === "error") {
      if (this.pendingSync || this.lastTick < 0) this.fail(message.message);
      else this.status(message.message);
    }
  }
  private fail(message: string): void {
    if (this.stopped) return;
    this.terminate();
    this.onerror?.({ message });
    this.status(message);
  }
}
