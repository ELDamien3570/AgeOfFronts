import type { Command } from "../../Protocol";
import { SPAWN_SECONDS } from "../../domain/SpawnSelection";
import { commandSchema } from "../CommandSchema";
import { MatchAuthority, type HostCandidate } from "../domain/MatchAuthority";
import type { MatchReservation } from "../domain/RoomCoordinator";
import type { MatchManifest, ServerMessage } from "../Protocol";
import type { EncodedState } from "../StateCodec";
import type { VerifiedCommit } from "./CommitVerifier";
import type { HostBatch, OrderedCommand, RuntimeCommit } from "./HostedRuntime";
import type { MatchExecutor, PreparedMatch, SpawnReply } from "./MatchExecutor";

/** One serialized match lifecycle. The room aggregate owns admission; this owns execution. */
export class LiveMatch {
  readonly ready = new Map<string, HostCandidate>();
  private loaded = new Set<string>();
  private authority!: MatchAuthority;
  private commit!: VerifiedCommit;
  private mapHash = "";
  private batch?: HostBatch;
  private commands: OrderedCommand[] = [];
  private seen = new Set<string>();
  private sequence = 0;
  private busy = false;
  private stopped = false;
  private nextAt = 0;
  private pendingSince = 0;
  private disconnected = new Set<number>();
  private initializedAt = 0;
  private initialized = false;
  private spawnDeadline?: number;
  private nextSpawnAt = 0;
  readonly options;
  constructor(
    readonly reservation: MatchReservation,
    readonly executor: MatchExecutor,
    private runtimeId: string,
    private send: (guest: string, message: ServerMessage) => void,
    private release: () => void,
    private now = Date.now,
    private departed?: (guest: string) => void,
  ) {
    const settings = reservation.settings;
    this.options = {
      seed: Math.floor(Math.random() * 0x7fffffff),
      humanNames: reservation.members.map((member) => member.profile.name),
      // Lobby counts are absolute: humans plus these AI opponents and tribes.
      aiCount: settings.aiCount,
      tribes: settings.tribeCount > 0,
      tribeCount: settings.tribeCount,
      ruleset: "ages-v1" as const,
      victoryMode: settings.victory,
      technologySpeed: settings.technologySpeed,
      resourceDensity: settings.resourceDensity,
      resourceOutput: settings.resourceOutput,
      alliances: settings.alliances,
    };
  }
  async initialize(): Promise<void> {
    const prepared = await this.executor.request<PreparedMatch>({
      type: "prepare",
      settings: this.reservation.settings,
      options: this.options,
    });
    this.mapHash = prepared.mapHash;
    Object.assign(this.options, prepared.options);
    this.initialized = true;
    for (const member of this.reservation.members)
      this.announce(member.guestId);
    this.pendingSince = this.now();
    this.initializedAt = this.now();
  }
  playerId(guest: string): number {
    return (
      this.reservation.members.findIndex((member) => member.guestId === guest) +
      1
    );
  }
  connected(guest: string): boolean {
    return (
      this.playerId(guest) > 0 && !this.disconnected.has(this.playerId(guest))
    );
  }
  announce(guest: string): void {
    if (!this.connected(guest))
      throw new Error("Player reconnect is not available for this match");
    const manifest: MatchManifest = {
      id: this.reservation.id,
      settings: this.reservation.settings,
      options: this.options,
      runtimeId: this.runtimeId,
      mapHash: this.mapHash,
      playerId: this.playerId(guest),
    };
    this.send(guest, { type: "match", manifest });
  }
  async qualify(
    guest: string,
    runtimeId: string,
    tickP95Ms: number,
  ): Promise<void> {
    if (!this.connected(guest) || runtimeId !== this.runtimeId)
      throw new Error("Game versions differ. Reload after deployment.");
    this.ready.set(guest, {
      guestId: guest,
      eligible: true,
      tickP95Ms,
      roundTripMs: 0,
    });
    this.loaded.add(guest);
    if (this.authority) await this.baseline(guest);
    else if (this.spawnDeadline !== undefined) await this.publishSpawn(guest);
  }
  async selectSpawn(guest: string, tile: number): Promise<void> {
    if (
      !this.connected(guest) ||
      !this.loaded.has(guest) ||
      this.spawnDeadline === undefined ||
      this.now() >= this.spawnDeadline ||
      this.authority
    )
      throw new Error("Spawn selection is not open");
    const reply = await this.executor.request<SpawnReply>({
      type: "select-spawn",
      playerId: this.playerId(guest),
      tile,
    });
    if (reply.rejection) throw new Error(reply.rejection);
    if (!this.authority)
      this.broadcast({
        type: "match-spawn",
        matchId: this.reservation.id,
        state: {
          ...reply.state,
          remainingMs: Math.max(0, this.spawnDeadline - this.now()),
        },
      });
  }
  private async publishSpawn(guest?: string): Promise<void> {
    const state = await this.executor.request<
      import("../../Protocol").SpawnState
    >({ type: "spawn-state", remainingMs: this.spawnDeadline! - this.now() });
    const message = {
      type: "match-spawn" as const,
      matchId: this.reservation.id,
      state,
    };
    if (guest) this.send(guest, message);
    else this.broadcast(message);
  }
  async baseline(guest: string): Promise<void> {
    const packet = await this.executor.request<EncodedState>({
      type: "baseline",
    });
    this.send(
      guest,
      this.state(packet, this.authority.snapshot().phase !== "running"),
    );
  }
  hostReady(guest: string, epoch: number, tick: number, hash: string): void {
    if (!this.authority) throw new Error("The match has not started");
    this.authority.ready(guest, epoch, tick, hash, this.now());
    this.nextAt = this.now();
  }
  command(guest: string, id: string, input: Record<string, unknown>): void {
    if (!this.authority)
      throw new Error("Choose your spawn before issuing orders");
    if (!this.connected(guest) || !this.loaded.has(guest))
      throw new Error("You are not active in this match");
    if (this.seen.has(id)) return;
    if (this.commands.length >= 100) throw new Error("Command queue is full");
    if (
      typeof input.type !== "string" ||
      JSON.stringify(input).length > 100_000
    )
      throw new Error("Invalid command");
    const command = commandSchema.parse({
      ...input,
      playerId: this.playerId(guest),
    }) as Command;
    this.seen.add(id);
    this.commands.push({ id, sequence: ++this.sequence, command });
  }
  async accept(
    guest: string,
    epoch: number,
    proposal: RuntimeCommit,
  ): Promise<void> {
    if (this.busy || !this.batch) throw new Error("No host batch is pending");
    const current = this.authority.snapshot();
    if (
      current.executor !== guest ||
      current.epoch !== epoch ||
      current.phase !== "running"
    )
      throw new Error("Stale host");
    this.busy = true;
    try {
      const verified = await this.executor.request<VerifiedCommit>({
        type: "verify",
        batch: this.batch,
        proposal,
      });
      const after = this.authority.snapshot();
      if (this.stopped || after.epoch !== epoch || after.executor !== guest)
        return;
      const packet = await this.executor.request<EncodedState>({
        type: "accept",
        commit: verified,
      });
      const acceptedAuthority = this.authority.snapshot();
      if (
        acceptedAuthority.epoch === epoch &&
        acceptedAuthority.executor === guest &&
        this.now() < acceptedAuthority.leaseExpiresAt
      ) {
        this.authority.commit(
          guest,
          epoch,
          this.commit.tick,
          verified.tick,
          verified.stateId,
          this.now(),
        );
      } else {
        // A disconnect during acceptance cannot undo an already accepted world.
        // Fence the successor at this committed cursor before selecting another host.
        this.authority = new MatchAuthority(
          verified.tick,
          verified.stateId,
          {
            ...acceptedAuthority,
            committedTick: verified.tick,
            checkpointHash: verified.stateId,
          },
        );
      }
      this.commit = verified;
      this.batch = undefined;
      this.broadcast(
        this.state(packet, this.authority.snapshot().phase !== "running"),
      );
      for (const rejection of verified.rejectedCommands)
        this.broadcast({ type: "error", message: rejection.message });
      if (verified.winner !== null) await this.end("Match complete");
    } catch (error) {
      this.ready.delete(guest);
      this.authority.disconnect(guest);
      this.broadcast({
        type: "error",
        message: `Host recovery: ${(error as Error).message}`,
      });
    } finally {
      this.busy = false;
    }
  }
  async disconnect(guest: string): Promise<void> {
    const id = this.playerId(guest);
    if (!id || this.disconnected.has(id)) return;
    this.disconnected.add(id);
    this.departed?.(guest);
    this.ready.delete(guest);
    this.authority?.disconnect(guest);
    if (this.disconnected.size === this.reservation.members.length)
      await this.end("All players left");
  }
  async advance(): Promise<void> {
    if (this.stopped || this.busy || !this.initialized) return;
    const now = this.now();
    if (now - this.initializedAt >= 60_000) {
      for (const member of this.reservation.members)
        if (!this.loaded.has(member.guestId))
          await this.disconnect(member.guestId);
      if (this.stopped) return;
    }
    if (!this.authority) {
      if (this.spawnDeadline === undefined) {
        if (!this.loaded.size) {
          if (now - this.initializedAt >= 60_000)
            await this.end("No players loaded the match");
          return;
        }
        if (
          this.reservation.members.some(
            (member) =>
              this.connected(member.guestId) &&
              !this.loaded.has(member.guestId),
          ) &&
          now - this.initializedAt < 10_000
        )
          return;
        this.spawnDeadline = now + SPAWN_SECONDS * 1000;
      }
      this.busy = true;
      try {
        if (now < this.spawnDeadline) {
          if (now >= this.nextSpawnAt) {
            this.nextSpawnAt = now + 250;
            await this.publishSpawn();
          }
          return;
        }
        this.commit = await this.executor.request<VerifiedCommit>({
          type: "start",
        });
        if (this.stopped) return;
        this.authority = new MatchAuthority(
          this.commit.tick,
          this.commit.stateId,
        );
      } finally {
        this.busy = false;
      }
    }
    this.authority.expire(now);
    let state = this.authority.snapshot();
    if (state.phase === "paused") {
      const connected = this.reservation.members.filter((member) =>
        this.connected(member.guestId),
      );
      if (
        connected.some((member) => !this.loaded.has(member.guestId)) &&
        now - this.pendingSince < 10_000
      )
        return;
      if (this.loaded.size === 0 && now - this.pendingSince < 60_000) return;
      if (this.loaded.size === 0) {
        await this.end("No players loaded the match");
        return;
      }
      this.busy = true;
      try {
        if (this.batch) this.commands.unshift(...this.batch.commands);
        this.batch = undefined;
        state = this.authority.elect([...this.ready.values()], now, true);
        this.broadcast(
          this.state(
            await this.executor.request<EncodedState>({ type: "baseline" }),
            true,
          ),
        );
        if (state.executor === "server")
          this.authority.ready(
            "server",
            state.epoch,
            this.commit.tick,
            this.commit.stateId,
            now,
          );
        else if (state.executor)
          this.send(state.executor, {
            type: "host-restore",
            matchId: this.reservation.id,
            epoch: state.epoch,
            checkpoint: await this.executor.request<EncodedState>({
              type: "checkpoint",
            }),
            stateId: this.commit.stateId,
          });
      } finally {
        this.busy = false;
      }
      return;
    }
    if (state.phase !== "running") return;
    if (this.batch) {
      if (now - this.pendingSince > 3000) {
        this.ready.delete(state.executor!);
        this.authority.disconnect(state.executor!);
      }
      return;
    }
    if (now < this.nextAt) return;
    this.batch = {
      previousTick: this.commit.tick,
      commands: this.commands
        .splice(0)
        .filter((item) => !this.disconnected.has(item.command.playerId)),
      disconnectedPlayerIds: [...this.disconnected],
    };
    this.pendingSince = now;
    this.nextAt = now + 200;
    if (state.executor === "server") {
      this.busy = true;
      try {
        const proposal = await this.executor.request<RuntimeCommit>({
          type: "fallback",
          batch: this.batch,
        });
        this.busy = false;
        await this.accept("server", state.epoch, proposal);
      } finally {
        this.busy = false;
      }
    } else
      this.send(state.executor!, {
        type: "host-batch",
        matchId: this.reservation.id,
        epoch: state.epoch,
        batch: this.batch,
      });
  }
  async end(message: string): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.authority?.end();
    this.broadcast({
      type: "match-ended",
      matchId: this.reservation.id,
      message,
    });
    await this.executor.close();
    this.release();
  }
  private state(
    packet: EncodedState,
    paused: boolean,
  ): Extract<ServerMessage, { type: "match-state" }> {
    return {
      type: "match-state",
      matchId: this.reservation.id,
      packet,
      tick: this.commit.tick,
      paused,
      disconnectedPlayerIds: [...this.disconnected],
      executor: this.authority.snapshot().executor,
    };
  }
  isLoaded(guest: string): boolean {
    return this.loaded.has(guest);
  }
  private broadcast(message: ServerMessage): void {
    for (const member of this.reservation.members)
      if (this.connected(member.guestId) && this.loaded.has(member.guestId))
        this.send(member.guestId, message);
  }
}
