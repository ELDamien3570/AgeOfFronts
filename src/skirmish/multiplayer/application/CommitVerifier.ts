import type { SnapshotPacket } from "../../Protocol";
import type { Skirmish } from "../../Simulation";
import { SnapshotEncoder } from "../../SnapshotCodec";
import {
  EconomyLedger,
  type EconomyEvent,
  type SpendAuthorization,
} from "../domain/EconomyLedger";
import { decodeState, encodeState, type EncodedState } from "../StateCodec";
import { applyDelta, type StateDelta } from "../StateDelta";
import {
  chainStateId,
  COMMIT_TICKS,
  HostedRuntime,
  type HostBatch,
  type RuntimeCommit,
} from "./HostedRuntime";

export interface VerifiedCommit {
  /** Id of the committed state; the authority and new hosts use it. */
  stateId: string;
  tick: number;
  winner: number | null;
  ledger: ReturnType<EconomyLedger["snapshot"]>;
  rejectedCommands: RuntimeCommit["rejectedCommands"];
}

/** Command costs are evaluated with the shared domain. Host world income remains trusted. */
export class CommitVerifier {
  private committed: ReturnType<Skirmish["checkpoint"]>;
  private ledger: EconomyLedger;
  private encoder = new SnapshotEncoder();
  // Ids follow the hash chain of accepted deltas, never a re-encoding.
  private committedId = "";
  // Joins and reconnects ask for the same baseline until the next commit; a
  // full-map baseline costs about a second to encode on the largest maps.
  private baselineCache?: { id: string; state: EncodedState };
  // Full checkpoints are only needed to hand the match to a new host.
  private checkpointCache?: { id: string; state: EncodedState };
  // Id of the state the runtime currently holds, or "" once it has diverged.
  private runtimeId = "";
  private prepared?: {
    id: string;
    state: ReturnType<Skirmish["checkpoint"]>;
  };
  constructor(readonly runtime: HostedRuntime) {
    this.committed = runtime.match.checkpoint();
    this.ledger = new EconomyLedger(
      runtime.match.players.map((player) => ({
        playerId: player.id,
        gold: player.gold,
        reserves: player.reserves,
      })),
    );
  }
  async initial(): Promise<VerifiedCommit> {
    if (!this.committedId) {
      const checkpoint = await encodeState(this.committed);
      this.committedId = checkpoint.hash;
      this.checkpointCache = { id: checkpoint.hash, state: checkpoint };
    }
    if (this.runtimeId !== this.committedId) {
      this.runtime.restore(this.committed, this.committedId);
      this.runtimeId = this.committedId;
    }
    return {
      stateId: this.committedId,
      tick: this.committed.tick,
      winner: this.committed.winner,
      ledger: this.ledger.snapshot(),
      rejectedCommands: [],
    };
  }
  async restore(
    checkpoint: EncodedState,
    ledger: ReturnType<EconomyLedger["snapshot"]>,
  ): Promise<void> {
    const decoded =
      await decodeState<ReturnType<Skirmish["checkpoint"]>>(checkpoint);
    this.runtime.restore(decoded, checkpoint.hash);
    this.committed = decoded;
    this.committedId = checkpoint.hash;
    this.runtimeId = checkpoint.hash;
    this.checkpointCache = { id: checkpoint.hash, state: checkpoint };
    this.prepared = undefined;
    this.ledger = new EconomyLedger([], ledger);
    this.encoder = new SnapshotEncoder();
  }
  async verify(
    batch: HostBatch,
    proposal: RuntimeCommit,
  ): Promise<VerifiedCommit> {
    if (
      proposal.previousTick !== this.committed.tick ||
      batch.previousTick !== this.committed.tick
    )
      throw new Error("Stale commit boundary");
    if (!this.committedId) await this.initial();
    if (proposal.baseId !== this.committedId)
      throw new Error("Commit does not extend the committed state");
    const stateId = await chainStateId(this.committedId, proposal.delta.hash);
    if (proposal.stateId !== stateId) throw new Error("Invalid commit id");
    const next = applyDelta(
      this.committed,
      await decodeState<StateDelta>(proposal.delta),
    );
    if (
      typeof next !== "object" ||
      next === null ||
      !Array.isArray(next.players) ||
      !(next.owners instanceof Uint8Array) ||
      !(next.claims instanceof Uint8Array)
    )
      throw new Error("Invalid committed state");
    if (
      next.tick !== proposal.tick ||
      next.tick <= this.committed.tick ||
      next.tick > this.committed.tick + COMMIT_TICKS ||
      (next.tick !== this.committed.tick + COMMIT_TICKS && next.winner === null)
    )
      throw new Error("Invalid committed tick");
    if (
      next.players.length !== this.committed.players.length ||
      next.players.some(
        (player, index) =>
          player.id !== index + 1 ||
          player.name !== this.committed.players[index].name ||
          player.ai !==
            (this.committed.players[index].ai ||
              batch.disconnectedPlayerIds.includes(player.id)),
      )
    )
      throw new Error("Invalid faction roster");
    if (
      next.owners.some((owner) => owner > next.players.length) ||
      next.claims.some((owner) => owner > next.players.length)
    )
      throw new Error("Invalid territory owner");
    const events: EconomyEvent[] = [],
      quotes: SpendAuthorization[] = [],
      rejected: RuntimeCommit["rejectedCommands"] = [];
    if (this.runtimeId !== this.committedId)
      this.runtime.restore(this.committed, this.committedId);
    this.runtimeId = "";
    const humanIds = new Set(
      this.runtime.match.players
        .filter(
          (player) =>
            !player.ai && !batch.disconnectedPlayerIds.includes(player.id),
        )
        .map((player) => player.id),
    );
    for (const id of batch.disconnectedPlayerIds) {
      const player = this.runtime.match.player(id);
      if (player) player.ai = true;
    }
    for (const item of batch.commands) {
      const player = this.runtime.match.player(item.command.playerId);
      if (!player || !humanIds.has(player.id))
        throw new Error("A disconnected player cannot issue commands");
      const before = { gold: player.gold, reserves: player.reserves };
      const error = this.runtime.match.applyCommand(item.command);
      if (error) {
        rejected.push({ id: item.id, message: error });
        continue;
      }
      const gold = player.gold - before.gold,
        reserves = player.reserves - before.reserves;
      this.accountChange(
        `command-${item.sequence}`,
        player.id,
        gold,
        reserves,
        events,
        quotes,
      );
    }
    if (JSON.stringify(rejected) !== JSON.stringify(proposal.rejectedCommands))
      throw new Error("Host command results disagree with domain validation");
    if (
      proposal.worldEconomy.length !== next.players.length ||
      new Set(proposal.worldEconomy.map((change) => change.playerId)).size !==
        next.players.length
    )
      throw new Error("Invalid world accounting set");
    for (const change of proposal.worldEconomy) {
      if (
        !next.players.some((player) => player.id === change.playerId) ||
        !Number.isSafeInteger(change.gold) ||
        !Number.isSafeInteger(change.reserves)
      )
        throw new Error("Invalid world accounting amount");
      if (humanIds.has(change.playerId) && change.gold < 0)
        throw new Error("Unpaid human gold spending");
      this.accountChange(
        `world-${next.tick}-${change.playerId}`,
        change.playerId,
        change.gold,
        change.reserves,
        events,
        quotes,
      );
    }
    const ledger = this.ledger.prepare(
      events,
      quotes,
      next.players.map((player) => ({
        playerId: player.id,
        gold: player.gold,
        reserves: player.reserves,
      })),
    );
    // Restore into a constructor-wired world before accepting it; malformed host state fails here.
    this.runtime.restore(next, stateId);
    this.runtimeId = stateId;
    this.prepared = { id: stateId, state: next };
    const result = {
      stateId,
      tick: next.tick,
      winner: next.winner,
      ledger,
      rejectedCommands: rejected,
    };
    return result;
  }
  /** Atomically advances the in-memory world/ledger before publishing its presentation. */
  async accept(result: VerifiedCommit): Promise<EncodedState> {
    if (!this.prepared || this.prepared.id !== result.stateId)
      throw new Error("Commit was not verified");
    this.committed = this.prepared.state;
    this.committedId = result.stateId;
    if (this.runtimeId !== this.committedId)
      this.runtime.restore(this.committed, this.committedId);
    this.runtimeId = this.committedId;
    this.prepared = undefined;
    this.ledger.commit(result.ledger);
    return this.encodeSnapshot();
  }
  /** A new subscriber receives a full presentation baseline, never an unpublished delta. */
  async baseline(): Promise<EncodedState> {
    const cached = this.baselineCache;
    if (cached && cached.id === this.committedId) return cached.state;
    if (this.runtimeId !== this.committedId)
      this.runtime.restore(this.committed, this.committedId);
    this.runtimeId = this.committedId;
    const id = this.committedId;
    const state = await encodeState(
      new SnapshotEncoder().encode(
        this.runtime.match.snapshot(),
      ) satisfies SnapshotPacket,
    );
    // A commit may have been accepted while encoding; only keep a still-current one.
    if (id === this.committedId) this.baselineCache = { id, state };
    return state;
  }
  /** The committed state in full, for a host taking over the match. */
  async checkpoint(): Promise<EncodedState> {
    if (!this.committedId) await this.initial();
    const cached = this.checkpointCache;
    if (cached && cached.id === this.committedId) return cached.state;
    const id = this.committedId;
    const state = await encodeState(this.committed);
    if (id === this.committedId) this.checkpointCache = { id, state };
    return state;
  }
  async fallback(batch: HostBatch): Promise<RuntimeCommit> {
    if (!this.committedId) await this.initial();
    if (this.runtimeId !== this.committedId)
      this.runtime.restore(this.committed, this.committedId);
    this.runtimeId = "";
    return this.runtime.run(batch);
  }
  private async encodeSnapshot(): Promise<EncodedState> {
    return encodeState(
      this.encoder.encode(
        this.runtime.match.snapshot(),
      ) satisfies SnapshotPacket,
    );
  }
  private accountChange(
    id: string,
    playerId: number,
    gold: number,
    reserves: number,
    events: EconomyEvent[],
    quotes: SpendAuthorization[],
  ): void {
    if (gold < 0 || reserves < 0) {
      const authorizationId = `debit-${id}`;
      quotes.push({
        id: authorizationId,
        playerId,
        gold: Math.max(0, -gold),
        reserves: Math.max(0, -reserves),
      });
      events.push({ type: "spend", id: authorizationId, authorizationId });
    }
    if (gold > 0 || reserves > 0)
      events.push({
        type: "world-income",
        id: `credit-${id}`,
        playerId,
        source: id.startsWith("command") ? "refund" : "host-world",
        gold: Math.max(0, gold),
        reserves: Math.max(0, reserves),
      });
  }
}
