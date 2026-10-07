import type {
  LoadedMap,
  SnapshotPacket,
  Snapshot,
  WorkerRequest,
  WorkerResponse,
} from "../Protocol";
import type { MatchManifest, ServerMessage } from "../multiplayer/Protocol";
import type { EncodedState } from "../multiplayer/StateCodec";
import type { StateDecodeStats } from "../multiplayer/StateCodec";
import type { CommandOutcome } from "../CommandApplications";
import { mapIdentity } from "../multiplayer/application/MapIdentity";
import { OnlineLobbyConnection } from "./lobby/OnlineLobbyConnection";
import { RuntimeDiagnostics } from "../RuntimeDiagnostics";
import { SNAPSHOT_QUEUE_LIMITS } from "../multiplayer/StateLimits";

const MAX_PENDING_STATES = SNAPSHOT_QUEUE_LIMITS.states;
const MAX_PENDING_BYTES=SNAPSHOT_QUEUE_LIMITS.bytes;
interface DecodedState {canonicalOnly?:boolean;packet:SnapshotPacket;viewPacket?:SnapshotPacket;snapshot?:Snapshot;canonicalSequence?:number;decodeMs?:number;applyMs?:number;projectionMs?:number;decodeStats?:StateDecodeStats;}
interface Presentation {data:Extract<WorkerResponse,{type:"state"}>;sequence?:number;}

/** Thin presentation client. The server alone advances the simulation. */
export class OnlineMatchSession {
  onmessage:
    | ((event: MessageEvent<WorkerResponse>) => void | Promise<void>)
    | null = null;
  oncommandsavailable: ((available: boolean) => void) | null = null;
  oncommandoutcome: ((outcome: CommandOutcome) => void) | null = null;
  lastCommandOutcome?: CommandOutcome;
  private readonly commandOutcomes = new Map<string, CommandOutcome>();
  commandsAvailable = false;
  onerror: ((event: { message: string }) => void) | null = null;
  disconnectedPlayerIds: number[] = [];
  private decoder?: Worker;
  private expectedMap?: {width: number; height: number};
  private connection: OnlineLobbyConnection;
  private decoding?: {
    resolve: (packet: DecodedState) => void;
    reject: (error: Error) => void;
  };
  private incoming = Promise.resolve();
  private pendingStates = 0;
  private pendingBytes=0;
  private receiveGeneration=0;
  private recovering=false;
  private recoveryStarted?: number;
  private flowEpoch=0;
  private presenting?:Promise<void>;
  private latestPresentation?:Presentation;
  private pendingView?: { generation: number; paused: boolean };
  private presentationScheduled = false;
  readonly diagnostics={pendingStates:0,pendingBytes:0,oldestAgeMs:0,decodeMs:0,applyMs:0,presentationMs:0,coalesced:0,recoveries:0,wireBytes:0,decodedArrayBytes:0,metadataBytes:0,metadataTokens:0};
  private initialized = false;
  private stopped = false;
  private completing = false;
  private manifest?: MatchManifest;
  private lastTick = -1;
  private lastPublicationSequence = -1;
  private watching = false;
  private connectionLost=false;
  private awaitingReconnectBaseline=false;
  private matchPaused = false;
  private pendingSync?: { id: string; publicationSequence: number };
  constructor(
    endpoint: string,
    private matchId: string,
    private load: (manifest: MatchManifest) => Promise<LoadedMap>,
    private identity: (playerId: number) => void,
    private status: (message: string) => void,
    private playerId?: number,
    readonly timings = new RuntimeDiagnostics(),
  ) {
    this.connection = new OnlineLobbyConnection(
      endpoint,
      () => {
        if ((this.manifest&&!this.connectionLost) || this.watching || this.stopped) return;
        this.watching = true;
        this.status("Joining match · loading your empire…");
        void this.request({
          type: "watch-match",
          matchId: this.matchId,
          ...((this.manifest?.playerId??this.playerId) === undefined ? {} : { playerId: this.manifest?.playerId??this.playerId }),
        }).catch((error) => {if(!this.connectionLost)this.fail(error.message);});
      },
      (message, connected) => {
        if (this.stopped || (connected && this.initialized)) return;
        if (!connected && (this.initialized || this.manifest)) {
          if(!this.connectionLost){this.connectionLost=true;this.awaitingReconnectBaseline=true;this.receiveGeneration++;this.watching=false;this.pendingSync=undefined;
            this.recovering=false;this.latestPresentation=undefined;this.pendingView=undefined;this.flowEpoch=0;}
          this.setCommandsAvailable(false);
          this.status("Connection interrupted · reconnecting to your reserved empire…");
          return;
        }
        if(!connected)this.watching=false;
        this.status(message);
      },
      (message) => {
        if (this.stopped) return;
        if (message.type === "match-ended" && message.matchId === this.matchId && message.completed) {
          this.completing = true;
          this.setCommandsAvailable(false);
        }
        // Small command results do not depend on map decoding or presentation.
        // Consume them directly so a slow baseline cannot accumulate an
        // unbounded promise chain of receipt metadata.
        if (message.type === "match-command-outcome") {
          if (message.matchId === this.matchId && message.outcome.playerId === this.manifest?.playerId)
            this.recordCommandOutcome(message.outcome);
          return;
        }
        // Asset loading may still be awaiting network I/O. Terminal admission
        // messages must not wait behind that promise to release this session.
        if (this.pendingSync || this.lastTick < 0 || this.recovering) {
          if (message.type === "error") {
            this.fail(message.message);
            return;
          }
          if (
            message.type === "match-ended" &&
            message.matchId === this.matchId && !message.completed
          ) {
            this.fail(`${message.message}. Return to the lobby to play again.`);
            return;
          }
        }
        if(message.type==="match-ended" && message.matchId===this.matchId && !message.completed){
          this.status(`${message.message}. Return to the lobby to play again.`);this.terminate();return;
        }
        if(message.type==="error"){this.status(message.message);return;}
        const state = message.type === "match-state";
        if(state && this.recovering && !message.rebase)return;
        const bytes=state ? message.packet.binary?.byteLength ?? message.packet.payload.length*2 : 0,receivedAt=performance.now();
        if(state){
          if(this.pendingStates>=MAX_PENDING_STATES || this.pendingBytes+bytes>MAX_PENDING_BYTES){
            if(bytes>MAX_PENDING_BYTES){this.fail("Match baseline exceeds this client's bounded state budget.");return;}
            this.recover();return;
          }
          this.pendingStates++;this.pendingBytes+=bytes;
          this.diagnostics.pendingStates=this.pendingStates;this.diagnostics.pendingBytes=this.pendingBytes;
        }
        const generation=this.receiveGeneration;
        this.incoming = this.incoming
          .then(() => {
            this.diagnostics.oldestAgeMs=performance.now()-receivedAt;
            if (state) this.timings.record("queue", this.diagnostics.oldestAgeMs);
            return this.stopped || (state && generation!==this.receiveGeneration) ? undefined : this.receive(message);
          })
          .catch((error) => {if(generation===this.receiveGeneration&&!this.connectionLost)this.fail(error.message);})
          .finally(() => {
            if (state){this.pendingStates--;this.pendingBytes-=bytes;this.diagnostics.pendingStates=this.pendingStates;this.diagnostics.pendingBytes=this.pendingBytes;}
          });
      },
      { reconnectWindowMs:15_000,replayPending:false,matchId:this.matchId,onExhausted:()=>this.fail("Reconnection timed out. Return to the lobby to rejoin your reserved empire.") },
    );
  }
  connect(): void {
    if (!this.stopped) void this.connection.connect();
  }
  runtimeDiagnostics() {
    return { matchId: this.matchId, runtimeId: this.manifest?.runtimeId, tick: this.lastTick,
      publicationSequence: this.lastPublicationSequence, ...this.diagnostics,
      queuedPresentations: Number(!!this.latestPresentation), projectionPending: Number(!!this.pendingView),
      commandOutcomeEntries: this.commandOutcomes.size,
      timings: this.timings.snapshot(), retainedBytes: this.timings.retainedBytes };
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
      const requestId = crypto.randomUUID();
      void this.connection.request({
        type: "match-command",
        requestId,
        matchId: this.matchId,
        command: message.command,
      }).then(() => {
        // ACK means transport admission. A later domain result may already
        // have arrived; never overwrite it with an older accepted state.
        if (!this.stopped && !this.commandOutcomes.has(requestId))
          this.recordCommandOutcome({id: requestId, playerId: this.manifest?.playerId ?? message.command.playerId,
            tick: this.lastTick, status: "accepted"});
      }).catch((error) => {
        if (!this.stopped) this.recordCommandOutcome({id: requestId,
          playerId: this.manifest?.playerId ?? message.command.playerId,
          tick: this.lastTick, status: "rejected", reason: error.message});
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
    this.latestPresentation = undefined;
    this.pendingView = undefined;
    this.recoveryStarted = undefined;
    this.commandOutcomes.clear();
  }
  private recordCommandOutcome(outcome: CommandOutcome): void {
    this.commandOutcomes.delete(outcome.id);
    this.commandOutcomes.set(outcome.id, {...outcome});
    while (this.commandOutcomes.size > 2048)
      this.commandOutcomes.delete(this.commandOutcomes.keys().next().value!);
    this.lastCommandOutcome = {...outcome};
    this.oncommandoutcome?.({...outcome});
    if (outcome.status === "rejected" && outcome.reason)
      this.onmessage?.({ data: { type: "rejected", message: outcome.reason } } as MessageEvent<WorkerResponse>);
  }
  private request(message: object): Promise<string | undefined> {
    return this.connection.request({
      ...message,
      requestId: crypto.randomUUID(),
    } as Parameters<OnlineLobbyConnection["request"]>[0]);
  }
  private decode(packet: EncodedState, presentation = true): Promise<DecodedState> {
    return this.decoderRequest({ ...packet, expectedMap: this.expectedMap, presentation, packed: true });
  }
  private decoderRequest(message: unknown): Promise<DecodedState> {
    return new Promise((resolve, reject) => {
      if (!this.decoder || this.decoding) {
        reject(new Error("State decoder is unavailable"));
        return;
      }
      this.decoding = { resolve, reject };
      const binary = (message as { binary?: Uint8Array<ArrayBuffer> }).binary;
      if (binary) this.decoder.postMessage(message, [binary.buffer]);
      else this.decoder.postMessage(message);
    });
  }
  private recover():void {
    if(this.recovering || this.stopped)return;
    this.recoveryStarted=performance.now();
    this.recovering=true;this.receiveGeneration++;this.latestPresentation=undefined;this.pendingView=undefined;this.diagnostics.recoveries++;
    this.setCommandsAvailable(false);this.status("Catching up with the match · requesting a fresh state…");
    void this.request({type:"match-state-resync",matchId:this.matchId}).catch(error=>this.fail(error.message));
  }
  private present(update:Presentation):Promise<void> {
    const started=performance.now();
    const sequence = update.sequence;
    let data: Presentation["data"] | undefined = update.data;
    const task=Promise.resolve().then(()=>{
      const delivered = data; data = undefined;
      return this.stopped ? undefined : this.onmessage?.({data:delivered} as MessageEvent<WorkerResponse>);
    })
      .then(()=>{
        this.diagnostics.presentationMs=performance.now()-started;
        this.timings.record("presentation", this.diagnostics.presentationMs);
        if(!this.stopped && sequence!==undefined)this.decoder?.postMessage({type:"presented",sequence});
      });
    this.presenting=task;
    void task.catch(error=>this.fail(error.message)).finally(()=>{
      if(this.presenting!==task)return;this.presenting=undefined;
      const next=this.latestPresentation;this.latestPresentation=undefined;
      if(next && !this.stopped)this.present(next);
      else this.scheduleLatestPresentation();
    });
    return task;
  }
  private scheduleLatestPresentation(): void {
    if (this.presentationScheduled || this.presenting || !this.pendingView || this.recovering || this.stopped) return;
    this.presentationScheduled = true;
    // Shares the decode chain, so an explicit projection cannot race a network
    // decode or be mistaken for that decode's result.
    this.incoming = this.incoming.then(async () => {
      this.presentationScheduled = false;
      if (this.presenting || this.recovering || this.stopped) return;
      const context = this.pendingView; this.pendingView = undefined;
      if (!context) return;
      const decoded = await this.decoderRequest({ type: "presentation", packed: true });
      if (decoded.projectionMs !== undefined) this.timings.record("projection", decoded.projectionMs);
      if (this.stopped || context.generation !== this.receiveGeneration) return;
      if (!decoded.snapshot && !decoded.viewPacket) throw new Error("Missing canonical presentation");
      this.queuePresentation({ data: { type: "state", packet: decoded.viewPacket ?? decoded.packet, snapshot: decoded.snapshot,
        paused: context.paused, speed: 1 }, sequence: decoded.canonicalSequence });
    }).catch(error => this.fail(error.message));
  }
  private queuePresentation(update:Presentation):void {
    if(this.presenting){if(this.latestPresentation)this.diagnostics.coalesced++;this.latestPresentation=update;}
    else this.present(update);
  }
  private setCommandsAvailable(available: boolean): void {
    available=available&&!this.connectionLost&&!this.awaitingReconnectBaseline&&!this.completing;
    if (this.commandsAvailable === available) return;
    this.commandsAvailable = available;
    this.oncommandsavailable?.(available);
  }
  private async receive(message: ServerMessage): Promise<void> {
    const generation = this.receiveGeneration;
    if ("matchId" in message && message.matchId !== this.matchId) return;
    if (message.type === "match-command-outcome") {
      if (message.outcome.playerId === this.manifest?.playerId)
        this.recordCommandOutcome(message.outcome);
      return;
    }
    if (message.type === "match") {
      if(message.manifest.id!==this.matchId)return;
      if(this.manifest){
        if(!this.connectionLost)return;
        if(message.manifest.runtimeId!==this.manifest.runtimeId||message.manifest.mapHash!==this.manifest.mapHash||
          message.manifest.playerId!==this.manifest.playerId)throw new Error("Rejoined match identity changed. Reload from the lobby.");
        this.connectionLost=false;this.watching=false;
        const deadline=performance.now()+15_000;
        while(!this.stopped){
          try{await this.request({type:"match-ready",matchId:this.matchId,runtimeId:this.manifest.runtimeId,flowControl:true});break;}
          catch(error){if(this.connectionLost)return;
            if(performance.now()>=deadline||!/(cooling down|Another player is synchronizing)/.test((error as Error).message))throw error;
            await new Promise<void>(resolve=>setTimeout(resolve,500));}
        }
        return;
      }
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
      this.expectedMap = {width: loaded.map.width(), height: loaded.map.height()};
      this.decoder = new Worker(
        new URL("./multiplayerStateWorker.ts", import.meta.url),
        { type: "module" },
      );
      this.decoder.onmessage = (
        event: MessageEvent<DecodedState & {error?: string}>,
      ) => {
        const task = this.decoding;
        this.decoding = undefined;
        if (!task) return;
        if (event.data.error) task.reject(new Error(event.data.error));
        else if (event.data.packet) task.resolve(event.data);
        else task.reject(new Error("Invalid decoded match state"));
      };
      this.decoder.onerror = (event) => this.fail(event.message);
      this.initialized = true;
      if(this.connectionLost)return; // The queued rejoin manifest declares readiness on the new connection.
      await this.request({
        type: "match-ready",
        matchId: this.matchId,
        runtimeId: message.manifest.runtimeId,
        flowControl:true,
      });
    } else if (message.type === "match-spawn") {
      this.onmessage?.({
        data: { type: "spawn", state: message.state },
      } as MessageEvent<WorkerResponse>);
    } else if (message.type === "match-state") {
      if (!this.initialized) return;
      if(message.flowEpoch!==undefined && message.flowEpoch<this.flowEpoch)return;
      if(message.flowEpoch!==undefined && message.flowEpoch>this.flowEpoch && !message.rebase && this.flowEpoch>0)
        throw new Error("A new state epoch requires a replacement baseline");
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
      const decoded = await this.decode(message.packet, !!message.syncId || !!message.rebase || !this.presenting),packet=decoded.packet;
      if(this.stopped || generation!==this.receiveGeneration)return;
      if (this.stopped) return;
      if(this.recovering && !message.rebase)return;
      if (
        packet.tick !== message.tick ||
        (!packet.reset && (this.lastTick < 0 || !!message.syncId || !!message.rebase))
      )
        throw new Error(
          "Invalid match update sequence. Return to the lobby to play again.",
        );
      this.lastTick = packet.tick;
      if(message.flowEpoch!==undefined)this.flowEpoch=message.flowEpoch;
      this.diagnostics.decodeMs=decoded.decodeMs??0;this.diagnostics.applyMs=decoded.applyMs??0;
      if (decoded.decodeMs !== undefined) this.timings.record("decode", decoded.decodeMs);
      if (decoded.applyMs !== undefined) this.timings.record("apply", decoded.applyMs);
      if (decoded.projectionMs !== undefined) this.timings.record("projection", decoded.projectionMs);
      this.diagnostics.wireBytes=decoded.decodeStats?.wireBytes??0;
      this.diagnostics.decodedArrayBytes=decoded.decodeStats?.arrayBytes??0;
      this.diagnostics.metadataBytes=decoded.decodeStats?.metadataBytes??0;
      this.diagnostics.metadataTokens=decoded.decodeStats?.metadataTokens??0;
      if (message.publicationSequence !== undefined)
        this.lastPublicationSequence = message.publicationSequence;
      this.matchPaused = message.paused;
      this.disconnectedPlayerIds = message.disconnectedPlayerIds;
      this.setCommandsAvailable(!message.paused && !this.pendingSync && !this.recovering);
      if (message.syncId && !this.onmessage)
        throw new Error(
          "The match view is unavailable. Return to the lobby to rejoin.",
        );
      const hasView = !!(decoded.snapshot ?? decoded.viewPacket);
      const update:Presentation={data:{type:"state",packet:decoded.viewPacket ?? packet,snapshot:decoded.snapshot,paused:message.paused,speed:1},sequence:decoded.canonicalSequence};
      if (hasView) this.pendingView = undefined;
      if (decoded.canonicalOnly) {
        if (message.syncId || message.rebase) throw new Error("A synchronization baseline requires presentation");
        this.pendingView = { generation: this.receiveGeneration, paused: message.paused };
        this.diagnostics.coalesced++;
        this.scheduleLatestPresentation();
      } else if(message.syncId || message.rebase){
        await this.presenting;if(this.stopped || generation!==this.receiveGeneration)return;this.latestPresentation=undefined;
        await this.present(update);
        if(message.rebase){
          if (this.recoveryStarted !== undefined) this.timings.record("recovery", performance.now() - this.recoveryStarted);
          this.recoveryStarted = undefined;
          this.recovering=false;this.setCommandsAvailable(!message.paused && !this.pendingSync);
        }
      }else if(hasView)this.queuePresentation(update);
      else await this.onmessage?.({data:update.data} as MessageEvent<WorkerResponse>);
      if (this.stopped || generation!==this.receiveGeneration) return;
      // The receipt is credit for the server's publication window, not a gate
      // on this client: awaiting its acknowledgement serialized every state
      // behind a round trip, filled the window on distant links and forced
      // full-map resyncs. Ordering is carried by sequence and flow epoch.
      if(message.flowEpoch!==undefined && message.publicationSequence!==undefined)
        void this.request({type:"match-state-applied",matchId:this.matchId,publicationSequence:message.publicationSequence,flowEpoch:message.flowEpoch})
          .catch(() => { /* A lost receipt only delays credit; flow control recovers. */ });
      // Receipt is not application: acknowledge only after both decoding and
      // the presentation callback have applied the complete baseline.
      if (message.syncId) {
        await this.request({
          type: "match-sync-applied",
          matchId: this.matchId,
          syncId: message.syncId,
          publicationSequence: message.publicationSequence,
        });
      } else if (!this.pendingSync) {
        if(packet.reset){this.awaitingReconnectBaseline=false;this.setCommandsAvailable(!message.paused);}
        this.status(
          message.paused
            ? "Match paused · waiting for players"
            : "Online match · server hosted",
        );
      }
    } else if (message.type === "match-sync-complete") {
      if (message.syncId !== this.pendingSync?.id) return;
      this.pendingSync = undefined;this.awaitingReconnectBaseline=false;
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
      // Completion follows the final state on the wire. Drain decoding and
      // presentation before closing the worker, including a coalesced view.
      while (this.presenting) await this.presenting;
      const context = this.pendingView;
      this.pendingView = undefined;
      if (context && !this.stopped && context.generation === this.receiveGeneration) {
        const decoded = await this.decoderRequest({ type: "presentation", packed: true });
        if (!decoded.snapshot && !decoded.viewPacket) throw new Error("Missing final match presentation");
        await this.present({ data: { type: "state", packet: decoded.viewPacket ?? decoded.packet,
          snapshot: decoded.snapshot, paused: context.paused, speed: 1 }, sequence: decoded.canonicalSequence });
      }
      this.status(`${message.message}. Return to the lobby to play again.`);
      this.terminate();
    } else if (message.type === "error") {
      if (this.pendingSync || this.lastTick < 0) this.fail(message.message);
      else this.onmessage?.({ data: { type: "rejected", message: message.message } } as MessageEvent<WorkerResponse>);
    }
  }
  private fail(message: string): void {
    if (this.stopped) return;
    this.terminate();
    this.onerror?.({ message });
    this.status(message);
  }
}
