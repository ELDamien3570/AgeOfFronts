import { SPAWN_SECONDS } from "../../domain/SpawnSelection";
import type { Command } from "../../Protocol";
import { TICKS_PER_SECOND } from "../../Protocol";
import { commandSchema } from "../CommandSchema";
import type { MatchReservation } from "../domain/RoomCoordinator";
import type { MatchManifest, ServerMessage } from "../Protocol";
import type { EncodedState } from "../StateCodec";
import {
  MAX_ADVANCE_TICKS,
  type MatchAdvance,
  type MatchCommand,
  type MatchExecutor,
  type PreparedMatch,
  type SpawnReply,
} from "./MatchExecutor";

export const MAX_RECENT_COMMANDS = 2048;
export const MAX_QUEUED_COMMANDS = 100;
const TICK_MS = 1000 / TICKS_PER_SECOND;
const SNAPSHOT_MS = 200;

/** The coordinator admits commands; one reserved worker owns the live world. */
export class LiveMatch {
  private loaded = new Set<string>();
  private loading = new Set<string>();
  private mapHash = "";
  private commands: MatchCommand[] = [];
  private seen = new Set<string>();
  private busy = false;
  private stopped = false;
  private running = false;
  private tick = 0;
  private nextTickAt = 0;
  private nextSnapshotAt = 0;
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
    if (this.stopped) return;
    this.mapHash = prepared.mapHash;
    Object.assign(this.options, prepared.options);
    this.initialized = true;
    this.initializedAt = this.now();
    for (const member of this.reservation.members)
      if (this.connected(member.guestId)) this.announce(member.guestId);
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
    // Watching can race asynchronous map preparation; initialize announces later.
    if (!this.initialized) return;
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
  async qualify(guest: string, runtimeId: string): Promise<void> {
    if (!this.connected(guest) || runtimeId !== this.runtimeId)
      throw new Error("Game versions differ. Reload after deployment.");
    if (this.loaded.has(guest) || this.loading.has(guest)) return;
    this.loading.add(guest);
    try {
      if (this.running) {
        const packet = await this.executor.request<EncodedState>({
          type: "baseline",
        });
        if (this.stopped || !this.connected(guest)) return;
        // Do not deliver dependent deltas to this subscriber before its baseline.
        this.loaded.add(guest);
        this.send(guest, this.state(packet));
      } else {
        this.loaded.add(guest);
        if (this.spawnDeadline !== undefined && this.now() < this.spawnDeadline)
          await this.publishSpawn(guest);
      }
    } finally {
      this.loading.delete(guest);
    }
  }
  async selectSpawn(guest: string, tile: number): Promise<void> {
    if (
      !this.connected(guest) ||
      !this.loaded.has(guest) ||
      this.spawnDeadline === undefined ||
      this.now() >= this.spawnDeadline ||
      this.running
    )
      throw new Error("Spawn selection is not open");
    const reply = await this.executor.request<SpawnReply>({
      type: "select-spawn",
      playerId: this.playerId(guest),
      tile,
    });
    if (reply.rejection) throw new Error(reply.rejection);
    if (!this.running && !this.stopped)
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
    >({
      type: "spawn-state",
      remainingMs: this.spawnDeadline! - this.now(),
    });
    if (this.stopped) return;
    const message = {
      type: "match-spawn" as const,
      matchId: this.reservation.id,
      state,
    };
    if (guest) this.send(guest, message);
    else this.broadcast(message);
  }
  command(guest: string, id: string, input: Record<string, unknown>): void {
    if (this.stopped) throw new Error("This match has ended");
    if (!this.running)
      throw new Error("Choose your spawn before issuing orders");
    if (!this.connected(guest) || !this.loaded.has(guest))
      throw new Error("You are not active in this match");
    if (this.seen.has(id)) return;
    if (this.commands.length >= MAX_QUEUED_COMMANDS)
      throw new Error("Command queue is full");
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
    if (this.seen.size > MAX_RECENT_COMMANDS)
      this.seen.delete(this.seen.values().next().value!);
    this.commands.push({ id, command });
  }
  async disconnect(guest: string): Promise<void> {
    const id = this.playerId(guest);
    if (!id || this.disconnected.has(id)) return;
    this.disconnected.add(id);
    this.departed?.(guest);
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
    if (!this.running) {
      if (this.spawnDeadline === undefined) {
        if (!this.loaded.size) return;
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
        const initial = await this.executor.request<MatchAdvance>({
          type: "start",
        });
        if (this.stopped) return;
        this.running = true;
        this.tick = initial.tick;
        this.nextTickAt = this.now() + TICK_MS;
        this.nextSnapshotAt = this.now() + SNAPSHOT_MS;
        this.broadcast(this.state(initial.packet!));
      } finally {
        this.busy = false;
      }
      return;
    }
    if (now < this.nextTickAt) return;
    const due = Math.floor((now - this.nextTickAt) / TICK_MS) + 1;
    const ticks = Math.min(MAX_ADVANCE_TICKS, due);
    this.nextTickAt =
      due > MAX_ADVANCE_TICKS
        ? now + TICK_MS
        : this.nextTickAt + ticks * TICK_MS;
    const publish = now >= this.nextSnapshotAt;
    if (publish)
      this.nextSnapshotAt +=
        (Math.floor((now - this.nextSnapshotAt) / SNAPSHOT_MS) + 1) *
        SNAPSHOT_MS;
    const commands = this.commands
      .splice(0)
      .filter((item) => !this.disconnected.has(item.command.playerId));
    this.busy = true;
    try {
      const result = await this.executor.request<MatchAdvance>({
        type: "advance",
        ticks,
        commands,
        disconnectedPlayerIds: [...this.disconnected],
        publish,
      });
      if (this.stopped) return;
      this.tick = result.tick;
      if (result.packet) this.broadcast(this.state(result.packet));
      for (const rejection of result.rejectedCommands) {
        const guest = this.reservation.members[rejection.playerId - 1]?.guestId;
        if (guest && this.connected(guest))
          this.send(guest, { type: "error", message: rejection.message });
      }
      if (result.winner !== null) await this.end("Match complete");
    } finally {
      this.busy = false;
    }
  }
  async end(message: string): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
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
  ): Extract<ServerMessage, { type: "match-state" }> {
    return {
      type: "match-state",
      matchId: this.reservation.id,
      packet,
      tick: this.tick,
      paused: false,
      disconnectedPlayerIds: [...this.disconnected],
      executor: "server",
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
