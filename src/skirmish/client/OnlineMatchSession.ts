import type {
  LoadedMap,
  SnapshotPacket,
  WorkerRequest,
  WorkerResponse,
} from "../Protocol";
import type { MatchManifest, ServerMessage } from "../multiplayer/Protocol";
import { decodeState } from "../multiplayer/StateCodec";
import type { RuntimeCommit } from "../multiplayer/application/HostedRuntime";
import { mapIdentity } from "../multiplayer/application/MapIdentity";
import { OnlineLobbyConnection } from "./lobby/OnlineLobbyConnection";

/** Presentation/session adapter. Only the selected browser worker executes world ticks. */
export class OnlineMatchSession {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  disconnectedPlayerIds: number[] = [];
  private host?: Worker;
  private connection: OnlineLobbyConnection;
  private nextId = 1;
  private tasks = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  private incoming = Promise.resolve();
  private initialized = false;
  private manifest?: MatchManifest;
  private guestId = "";
  constructor(
    endpoint: string,
    private matchId: string,
    private load: (manifest: MatchManifest) => Promise<LoadedMap>,
    private identity: (playerId: number) => void,
    private status: (message: string) => void,
  ) {
    this.connection = new OnlineLobbyConnection(
      endpoint,
      (message) => {
        this.guestId = message.guestId;
        if (!this.manifest)
          void this.request({
            type: "watch-match",
            matchId: this.matchId,
          }).catch((error) => this.fail(error.message));
      },
      (message, connected) => {
        if (connected && this.initialized) return;
        this.status(message);
        if (!connected && this.initialized)
          this.status(
            "Connection lost. This match cannot be rejoined; return to the lobby.",
          );
      },
      (message) => {
        this.incoming = this.incoming
          .then(() => this.receive(message))
          .catch((error) => this.fail(error.message));
      },
    );
  }
  connect(): void {
    void this.connection.connect();
  }
  postMessage(message: WorkerRequest): void {
    if (message.type === "command")
      void this.request({
        type: "match-command",
        matchId: this.matchId,
        command: message.command,
      }).catch((error) => this.status(error.message));
  }
  terminate(): void {
    this.connection.stop();
    this.host?.terminate();
    for (const task of this.tasks.values())
      task.reject(new Error("Session stopped"));
    this.tasks.clear();
  }
  private request(message: any): Promise<string | undefined> {
    return this.connection.request({
      ...message,
      requestId: crypto.randomUUID(),
    });
  }
  private hostRequest<T>(type: string, details: object): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.tasks.set(id, { resolve, reject });
      this.host!.postMessage({ id, type, ...details });
    });
  }
  private async receive(message: ServerMessage): Promise<void> {
    if (message.type === "match") {
      if (this.manifest) return;
      this.manifest = message.manifest;
      if (
        message.manifest.runtimeId !== import.meta.env.VITE_SKIRMISH_RUNTIME_ID
      )
        throw new Error(
          "Game versions differ. Reload the homepage after deployment.",
        );
      this.identity(message.manifest.playerId);
      const loaded = await this.load(message.manifest);
      const runtimeMap = {
        width: loaded.map.width(),
        height: loaded.map.height(),
        terrain: loaded.terrain,
        elevation: loaded.elevation,
        forest: loaded.forest,
        resourceTerrain: loaded.resourceTerrain,
      };
      if ((await mapIdentity(runtimeMap)) !== message.manifest.mapHash)
        throw new Error("Map versions differ. Reload after deployment.");
      this.host = new Worker(
        new URL("./multiplayerHostWorker.ts", import.meta.url),
        { type: "module" },
      );
      this.host.onmessage = (event) => {
        const task = this.tasks.get(event.data.id);
        if (!task) return;
        this.tasks.delete(event.data.id);
        if (event.data.error) task.reject(new Error(event.data.error));
        else task.resolve(event.data.result);
      };
      this.host.onerror = (event) => this.fail(event.message);
      const tickP95Ms = await this.hostRequest<number>("initialize", {
        map: runtimeMap,
        options: message.manifest.options,
      });
      this.initialized = true;
      await this.request({
        type: "match-ready",
        matchId: this.matchId,
        runtimeId: message.manifest.runtimeId,
        tickP95Ms,
      });
    } else if (message.type === "host-restore") {
      const tick = await this.hostRequest<number>("restore", {
        checkpoint: message.checkpoint,
      });
      await this.request({
        type: "host-ready",
        matchId: this.matchId,
        epoch: message.epoch,
        tick,
        hash: message.checkpoint.hash,
      });
    } else if (message.type === "host-batch") {
      const proposal = await this.hostRequest<RuntimeCommit>("batch", {
        batch: message.batch,
      });
      await this.request({
        type: "host-commit",
        matchId: this.matchId,
        epoch: message.epoch,
        proposal,
      });
    } else if (message.type === "match-state") {
      this.disconnectedPlayerIds = message.disconnectedPlayerIds;
      const packet = await decodeState<SnapshotPacket>(message.packet);
      this.onmessage?.({
        data: { type: "state", packet, paused: message.paused, speed: 1 },
      } as MessageEvent<WorkerResponse>);
      this.status(
        message.paused
          ? "Match paused · selecting a host…"
          : message.executor === "server"
            ? "Online match · server fallback"
            : message.executor === this.guestId
              ? "Online match · you are hosting"
              : "Online match · client hosted",
      );
    } else if (message.type === "match-ended")
      this.status(`${message.message}. Return to the lobby to play again.`);
    else if (message.type === "error") this.status(message.message);
  }
  private fail(message: string): void {
    this.onerror?.({ message });
    this.status(message);
  }
}
