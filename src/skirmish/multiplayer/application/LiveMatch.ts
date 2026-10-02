import { SPAWN_SECONDS } from "../../domain/SpawnSelection";
import type { EmpireProfile } from "../../lobby/EmpireProfile";
import type { Command } from "../../Protocol";
import { TICKS_PER_SECOND } from "../../Protocol";
import { commandSchema } from "../CommandSchema";
import type { MatchReservation } from "../domain/RoomCoordinator";
import type {
  LiveMatchSummary,
  MatchManifest,
  ServerMessage,
} from "../Protocol";
import type { EncodedState } from "../StateCodec";
import {
  MAX_ADVANCE_TICKS,
  type JoinBarrier,
  type MatchAdvance,
  type MatchCommand,
  type MatchExecutor,
  type PreparedMatch,
  type RuntimeSeat,
  type SeatStatus,
  type SpawnReply,
} from "./MatchExecutor";

export const MAX_RECENT_COMMANDS = 2048;
export const MAX_QUEUED_COMMANDS = 100;
export const EMPTY_MATCH_GRACE_MS = 120_000;
const TICK_MS = 1000 / TICKS_PER_SECOND;
const SNAPSHOT_MS = 200;
interface Seat {
  playerId: number;
  guestId: string;
  profile: EmpireProfile;
  connected: boolean;
}
interface Admission {
  guest: string;
  playerId: number;
  profile: EmpireProfile;
  expiresAt: number;
}
interface Sync {
  admission: Admission;
  id: string;
  sequence?: number;
  expiresAt: number;
  startedAt: number;
  restoring?: Promise<void>;
}
export interface LiveMatchOptions {
  graceMs?: number;
  loadTimeoutMs?: number;
  syncTimeoutMs?: number;
  cooldownMs?: number;
  pauseBudgetMs?: number;
}

/** One authoritative world, stable faction IDs, and at most one bounded admission barrier. */
export class LiveMatch {
  private loaded = new Set<string>();
  private seats = new Map<number, Seat>();
  private runtimeSeats: RuntimeSeat[] = [];
  private admissions = new Map<string, Admission>();
  private loadingDeadlines = new Map<string, number>();
  private mapHash = "";
  private commands: MatchCommand[] = [];
  private seen = new Set<string>();
  private advancing?: Promise<void>;
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
  private publicationSequence = 0;
  private syncCounter = 0;
  private sync?: Sync;
  private syncTimer?: ReturnType<typeof setTimeout>;
  private nextSyncAt = 0;
  private pauses: { at: number; ms: number }[] = [];
  private emptyDeadline?: number;
  readonly options;
  constructor(
    readonly reservation: MatchReservation,
    readonly executor: MatchExecutor,
    private runtimeId: string,
    private send: (guest: string, message: ServerMessage) => void,
    private release: () => void,
    private now = Date.now,
    private departed?: (guest: string) => void,
    private admitted?: (
      guest: string,
      playerId: number,
      profile: EmpireProfile,
    ) => void,
    private config: LiveMatchOptions = {},
  ) {
    const settings = reservation.settings;
    reservation.members.forEach((member, index) =>
      this.seats.set(index + 1, {
        playerId: index + 1,
        guestId: member.guestId,
        profile: member.profile,
        connected: member.connected,
      }),
    );
    this.options = {
      seed: Math.floor(Math.random() * 0x7fffffff),
      humanNames: reservation.members.map((member) => member.profile.name),
      aiCount: settings.aiCount,
      tribes: settings.tribeCount > 0,
      tribeCount: settings.tribeCount,
      ruleset: "ages-v1" as const,
      victoryMode: settings.victory,
      technologySpeed: settings.technologySpeed,
      startingAge: settings.startingAge,
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
    for (const seat of this.seats.values())
      if (seat.connected) {
        this.loadingDeadlines.set(seat.guestId, this.now() + this.loadTimeout);
        this.announce(seat.guestId);
      }
    for (const admission of this.admissions.values())
      if (!this.connected(admission.guest)) this.announce(admission.guest);
  }
  private get loadTimeout(): number {
    return this.config.loadTimeoutMs ?? 60_000;
  }
  private seat(guest: string): Seat | undefined {
    return [...this.seats.values()].find((seat) => seat.guestId === guest);
  }
  playerId(guest: string): number {
    return this.seat(guest)?.playerId ?? 0;
  }
  owns(guest: string): boolean {
    return this.playerId(guest) > 0;
  }
  connected(guest: string): boolean {
    return this.seat(guest)?.connected === true;
  }
  isLoaded(guest: string): boolean {
    return this.loaded.has(guest);
  }
  isAdmitting(guest: string): boolean {
    return this.admissions.has(guest);
  }
  watch(
    guest: string,
    profile: EmpireProfile,
    requestedPlayerId?: number,
  ): void {
    if (this.stopped) throw new Error("This match has ended");
    const owned = this.seat(guest);
    if (
      owned &&
      requestedPlayerId !== undefined &&
      requestedPlayerId !== owned.playerId
    )
      throw new Error("You already own a faction in this match");
    if (!this.running && owned?.connected) {
      this.announce(guest);
      return;
    }
    if (!this.running) {
      if (!owned) throw new Error("This match is still starting");
      if (this.emptyDeadline !== undefined && this.now() >= this.emptyDeadline)
        throw new Error("This match has expired");
      if (!this.admissions.has(guest))
        this.admissions.set(guest, {
          guest,
          playerId: owned.playerId,
          profile,
          expiresAt: this.now() + this.loadTimeout,
        });
      this.announce(guest);
      return;
    }
    if (owned?.connected && this.loaded.has(guest))
      throw new Error("This match is already open");
    const playerId = owned?.playerId ?? requestedPlayerId;
    if (!playerId) throw new Error("Choose an available AI empire");
    this.assertAvailable(guest, playerId);
    const previous = this.admissions.get(guest);
    if (!previous && this.admissions.size >= 16)
      throw new Error(
        "Too many players are loading. Please try again shortly.",
      );
    if (previous && previous.playerId !== playerId)
      throw new Error("A faction join is already loading");
    const admission = previous ?? {
      guest,
      playerId,
      profile,
      expiresAt: this.now() + this.loadTimeout,
    };
    this.admissions.set(guest, admission);
    this.announce(guest);
  }
  private assertAvailable(guest: string, playerId: number): void {
    const owner = this.seats.get(playerId);
    const own = this.seat(guest);
    if (own && own.playerId !== playerId)
      throw new Error("You already own a faction in this match");
    if (owner && owner.guestId !== guest)
      throw new Error("This empire is reserved for its original player");
    const runtime = this.runtimeSeats.find(
      (seat) => seat.playerId === playerId,
    );
    if (!runtime || runtime.kind !== "regular" || runtime.eliminated)
      throw new Error("This faction is no longer available");
    if (
      !owner &&
      (!this.reservation.settings.publicAiTakeover ||
        (!runtime.ai && this.sync?.admission.guest !== guest))
    )
      throw new Error("Public AI takeover is not allowed in this match");
    if (!owner && this.seats.size >= this.reservation.settings.slots)
      throw new Error("All human seats are claimed, including away players");
    if (
      this.sync &&
      this.sync.admission.guest !== guest &&
      this.sync.admission.playerId === playerId
    )
      throw new Error("Another player is claiming this empire");
    if (this.emptyDeadline !== undefined && this.now() >= this.emptyDeadline)
      throw new Error("This match has expired");
  }
  announce(guest: string): void {
    const admission = this.admissions.get(guest);
    if (!this.connected(guest) && !admission)
      throw new Error("Use Rejoin your empire to reconnect");
    if (!this.initialized) return;
    const manifest: MatchManifest = {
      id: this.reservation.id,
      settings: this.reservation.settings,
      options: this.options,
      runtimeId: this.runtimeId,
      mapHash: this.mapHash,
      playerId: admission?.playerId ?? this.playerId(guest),
    };
    this.send(guest, { type: "match", manifest });
  }
  async qualify(guest: string, runtimeId: string): Promise<void> {
    if (this.stopped || runtimeId !== this.runtimeId)
      throw new Error("Game versions differ. Reload after deployment.");
    if (this.loaded.has(guest) && this.connected(guest)) return;
    // Starting destroys the spawn-selection state in the worker. Decide the
    // initial-loading path only after that in-flight transition has finished.
    if (!this.running && this.advancing) await this.advancing;
    if (this.stopped) throw new Error("This match has ended");
    if (!this.running) {
      if (!this.connected(guest)) {
        const admission = this.admissions.get(guest),
          seat = this.seat(guest);
        if (
          !admission ||
          !seat ||
          this.now() >= admission.expiresAt ||
          (this.emptyDeadline !== undefined && this.now() >= this.emptyDeadline)
        )
          throw new Error(
            "Loading timed out. Return to the lobby and try again.",
          );
        this.admitted?.(guest, seat.playerId, seat.profile);
        seat.connected = true;
        this.disconnected.delete(seat.playerId);
        this.admissions.delete(guest);
        this.emptyDeadline = undefined;
        // No world exists yet: resume spawn selection with a fresh short window.
        if (this.spawnDeadline !== undefined)
          this.spawnDeadline = Math.max(
            this.spawnDeadline,
            this.now() + SPAWN_SECONDS * 1000,
          );
      }
      this.loaded.add(guest);
      this.loadingDeadlines.delete(guest);
      if (this.spawnDeadline !== undefined && this.now() < this.spawnDeadline)
        await this.publishSpawn(guest);
      return;
    }
    let admission = this.admissions.get(guest);
    if (!admission && this.connected(guest)) {
      const seat = this.seat(guest)!;
      admission = {
        guest,
        playerId: seat.playerId,
        profile: seat.profile,
        expiresAt:
          this.loadingDeadlines.get(guest) ?? this.now() + this.loadTimeout,
      };
      this.admissions.set(guest, admission);
    }
    if (!admission || this.now() >= admission.expiresAt)
      throw new Error("Loading timed out. Return to the lobby and try again.");
    if (this.sync) {
      if (this.sync.admission === admission) return;
      throw new Error(
        "Another player is synchronizing. Please try again shortly.",
      );
    }
    this.assertAvailable(guest, admission.playerId);
    this.pauses = this.pauses.filter((p) => this.now() - p.at < 60_000);
    if (
      this.now() < this.nextSyncAt ||
      this.pauses.reduce((sum, p) => sum + p.ms, 0) >=
        (this.config.pauseBudgetMs ?? 15_000)
    )
      throw new Error(
        "Join synchronization is cooling down. Please try again shortly.",
      );
    const sync: Sync = {
      admission,
      id: `sync-${++this.syncCounter}`,
      startedAt: this.now(),
      expiresAt: this.now() + (this.config.syncTimeoutMs ?? 5_000),
    };
    this.sync = sync; // Admission lock is acquired before waiting for an in-flight advance.
    this.status("Synchronizing a joining player…", true);
    this.syncTimer = setTimeout(() => {
      void this.cancelSync(
        sync,
        "Synchronization timed out. Please rejoin from the lobby.",
      );
    }, this.config.syncTimeoutMs ?? 5_000);
    try {
      await this.advancing;
      if (this.sync !== sync || this.stopped || sync.restoring) return;
      this.assertAvailable(guest, admission.playerId);
      const result = await this.executor.request<JoinBarrier>({
        type: "join-barrier",
        playerId: admission.playerId,
      });
      if (this.sync !== sync || this.stopped || sync.restoring) return;
      this.tick = result.tick;
      this.runtimeSeats = result.seats;
      if (result.winner !== null) {
        await this.end("Match complete");
        return;
      }
      sync.sequence = ++this.publicationSequence;
      this.broadcast(this.state(result.packet, true));
      this.send(guest, {
        ...this.state(result.baseline, true),
        syncId: sync.id,
      });
    } catch (error) {
      await this.cancelSync(sync, (error as Error).message);
      throw error;
    }
  }
  acknowledge(guest: string, syncId: string, sequence: number): void {
    const sync = this.sync;
    if (
      !sync ||
      sync.restoring ||
      sync.admission.guest !== guest ||
      sync.id !== syncId ||
      sync.sequence !== sequence ||
      this.now() >= sync.expiresAt
    )
      throw new Error("This synchronization attempt has expired");
    const { admission } = sync;
    this.assertAvailable(guest, admission.playerId);
    this.admitted?.(guest, admission.playerId, admission.profile);
    this.seats.set(admission.playerId, {
      playerId: admission.playerId,
      guestId: guest,
      profile: admission.profile,
      connected: true,
    });
    this.disconnected.delete(admission.playerId);
    this.loaded.add(guest);
    this.loadingDeadlines.delete(guest);
    this.admissions.delete(guest);
    this.emptyDeadline = undefined;
    this.send(guest, {
      type: "match-sync-complete",
      matchId: this.reservation.id,
      syncId,
    });
    this.finishSync(sync);
  }
  private async cancelSync(sync: Sync, message: string): Promise<void> {
    if (this.sync !== sync || this.stopped) return;
    if (sync.restoring) return sync.restoring;
    sync.restoring = (async () => {
      // If an executor is wedged, retire it rather than hold everyone paused.
      const watchdog = setTimeout(() => {
        void this.end("Match executor timed out during synchronization");
      }, 1_000);
      try {
        await this.advancing;
        const result = await this.executor.request<SeatStatus>({
          type: "set-controller",
          playerId: sync.admission.playerId,
          ai: true,
        });
        this.runtimeSeats = result.seats;
      } catch {
        await this.end("Match executor unavailable during synchronization");
      } finally {
        clearTimeout(watchdog);
        this.admissions.delete(sync.admission.guest);
        this.send(sync.admission.guest, { type: "error", message });
        this.finishSync(sync);
      }
    })();
    return sync.restoring;
  }
  private finishSync(sync: Sync): void {
    if (this.sync !== sync) return;
    clearTimeout(this.syncTimer);
    this.sync = undefined;
    this.pauses.push({
      at: this.now(),
      ms: Math.max(0, this.now() - sync.startedAt),
    });
    this.nextSyncAt = this.now() + (this.config.cooldownMs ?? 2_000);
    this.nextTickAt = this.now() + TICK_MS;
    this.nextSnapshotAt = this.now() + SNAPSHOT_MS;
    if (!this.stopped)
      this.status(
        this.emptyDeadline === undefined
          ? "Online match · server hosted"
          : "Waiting for a player to return",
        this.emptyDeadline !== undefined,
      );
  }
  private status(message: string, paused: boolean): void {
    this.broadcast({
      type: "match-status",
      matchId: this.reservation.id,
      message,
      paused,
    });
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
    >({ type: "spawn-state", remainingMs: this.spawnDeadline! - this.now() });
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
    if (this.sync)
      throw new Error("Match is briefly paused for synchronization");
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
    const admission = this.admissions.get(guest);
    if (admission) this.admissions.delete(guest);
    const seat = this.seat(guest);
    if (seat?.connected) {
      seat.connected = false;
      this.disconnected.add(seat.playerId);
      this.commands = this.commands.filter(
        (item) => item.command.playerId !== seat.playerId,
      );
      this.loaded.delete(guest);
      this.loadingDeadlines.delete(guest);
      this.departed?.(guest);
    }
    if (
      ![...this.seats.values()].some((s) => s.connected) &&
      this.emptyDeadline === undefined
    )
      this.emptyDeadline =
        this.now() + (this.config.graceMs ?? EMPTY_MATCH_GRACE_MS);
    if (this.sync?.admission.guest === guest)
      await this.cancelSync(
        this.sync,
        "Join canceled because the connection closed",
      );
  }
  async advance(): Promise<void> {
    if (this.stopped) return;
    if (this.emptyDeadline !== undefined && this.now() >= this.emptyDeadline) {
      await this.end("No players returned before the reconnect grace expired");
      return;
    }
    if (this.sync && this.now() >= this.sync.expiresAt) {
      await this.cancelSync(
        this.sync,
        "Synchronization timed out. Please rejoin from the lobby.",
      );
      return;
    }
    for (const [guest, attempt] of this.admissions)
      if (this.now() >= attempt.expiresAt && this.sync?.admission !== attempt) {
        this.admissions.delete(guest);
        this.send(guest, {
          type: "error",
          message: "Loading timed out. Return to the lobby and try again.",
        });
      }
    for (const [guest, deadline] of this.loadingDeadlines)
      if (this.now() >= deadline && !this.loaded.has(guest)) {
        this.send(guest, {
          type: "error",
          message: "Loading timed out. Return to the lobby and try again.",
        });
        await this.disconnect(guest);
      }
    if (
      this.advancing ||
      this.sync ||
      this.emptyDeadline !== undefined ||
      !this.initialized
    )
      return;
    this.advancing = this.advanceWorld();
    try {
      await this.advancing;
    } finally {
      this.advancing = undefined;
    }
  }
  private async advanceWorld(): Promise<void> {
    const now = this.now();
    if (!this.running) {
      if (this.spawnDeadline === undefined) {
        if (!this.loaded.size) return;
        if (
          [...this.seats.values()].some(
            (s) => s.connected && !this.loaded.has(s.guestId),
          ) &&
          now - this.initializedAt < 10_000
        )
          return;
        this.spawnDeadline = now + SPAWN_SECONDS * 1000;
      }
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
      this.runtimeSeats = initial.seats ?? [];
      this.nextTickAt = this.now() + TICK_MS;
      this.nextSnapshotAt = this.now() + SNAPSHOT_MS;
      this.publicationSequence++;
      this.broadcast(this.state(initial.packet!));
      return;
    }
    if (now < this.nextTickAt) return;
    const due = Math.floor((now - this.nextTickAt) / TICK_MS) + 1,
      ticks = Math.min(MAX_ADVANCE_TICKS, due);
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
    const result = await this.executor.request<MatchAdvance>({
      type: "advance",
      ticks,
      commands,
      disconnectedPlayerIds: [...this.disconnected],
      publish,
    });
    if (this.stopped) return;
    this.tick = result.tick;
    if (result.seats) this.runtimeSeats = result.seats;
    if (result.packet) {
      this.publicationSequence++;
      this.broadcast(this.state(result.packet));
    }
    for (const rejection of result.rejectedCommands) {
      const guest = this.seats.get(rejection.playerId)?.guestId;
      if (guest && this.connected(guest))
        this.send(guest, { type: "error", message: rejection.message });
    }
    if (result.winner !== null) await this.end("Match complete");
  }
  summary(guest: string): LiveMatchSummary | undefined {
    const owner = this.seat(guest);
    if (
      this.stopped ||
      !this.initialized ||
      (!this.running && (!owner || owner.connected))
    )
      return;
    const liveOwner =
      owner &&
      (!this.running ||
        this.runtimeSeats.some(
          (s) => s.playerId === owner.playerId && !s.eliminated,
        ));
    const freeAiSeats =
      this.reservation.settings.publicAiTakeover &&
      this.seats.size < this.reservation.settings.slots &&
      !owner
        ? this.runtimeSeats
            .filter(
              (s) =>
                s.ai &&
                s.kind === "regular" &&
                !s.eliminated &&
                !this.seats.has(s.playerId) &&
                this.sync?.admission.playerId !== s.playerId,
            )
            .map((s) => ({ playerId: s.playerId, name: s.name }))
        : [];
    return {
      id: this.reservation.id,
      title:
        this.reservation.title ?? `${this.reservation.settings.mapId} match`,
      mapId: this.reservation.settings.mapId,
      elapsedSeconds: Math.floor(this.tick / TICKS_PER_SECOND),
      connectedHumans: [...this.seats.values()].filter(
        (s) => s.connected && this.loaded.has(s.guestId),
      ).length,
      humanSeats: this.reservation.settings.slots,
      claimedHumanSeats: this.seats.size,
      freeAiSeats,
      rejoinPlayerId:
        liveOwner && !owner!.connected ? owner!.playerId : undefined,
      publicTakeover: Boolean(this.reservation.settings.publicAiTakeover),
      status: this.sync
        ? "syncing"
        : this.emptyDeadline !== undefined
          ? "paused"
          : "running",
      graceRemainingMs:
        this.emptyDeadline === undefined
          ? undefined
          : Math.max(0, this.emptyDeadline - this.now()),
    };
  }
  async end(message: string): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.syncTimer);
    this.broadcast({
      type: "match-ended",
      matchId: this.reservation.id,
      message,
    });
    for (const guest of this.admissions.keys())
      this.send(guest, {
        type: "match-ended",
        matchId: this.reservation.id,
        message,
      });
    try {
      await this.executor.close();
    } finally {
      this.release();
    }
  }
  private state(
    packet: EncodedState,
    paused = this.sync !== undefined || this.emptyDeadline !== undefined,
  ): Extract<ServerMessage, { type: "match-state" }> {
    return {
      type: "match-state",
      matchId: this.reservation.id,
      packet,
      tick: this.tick,
      publicationSequence: this.publicationSequence,
      paused,
      disconnectedPlayerIds: [...this.disconnected],
      executor: "server",
    };
  }
  private broadcast(message: ServerMessage): void {
    for (const seat of this.seats.values())
      if (seat.connected && this.loaded.has(seat.guestId))
        this.send(seat.guestId, message);
  }
}
