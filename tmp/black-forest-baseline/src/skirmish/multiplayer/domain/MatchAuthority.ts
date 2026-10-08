export interface HostCandidate {
  guestId: string;
  eligible: boolean;
  tickP95Ms: number;
  roundTripMs: number;
}
export interface AuthorityState {
  epoch: number;
  phase: "paused" | "restoring" | "running" | "ended";
  executor: string | "server" | null;
  leaseExpiresAt: number;
  committedTick: number;
  checkpointHash: string;
}

/** Exclusive simulation lease. The coordinator, never a peer, selects the executor. */
export class MatchAuthority {
  private state: AuthorityState;
  constructor(
    committedTick: number,
    checkpointHash: string,
    restored?: AuthorityState,
  ) {
    if (
      !Number.isInteger(committedTick) ||
      committedTick < 0 ||
      !checkpointHash
    )
      throw new Error("A recoverable checkpoint is required.");
    this.state = restored
      ? {
          ...restored,
          epoch: restored.epoch + 1,
          phase: "paused",
          executor: null,
          leaseExpiresAt: 0,
        }
      : {
          epoch: 0,
          phase: "paused",
          executor: null,
          leaseExpiresAt: 0,
          committedTick,
          checkpointHash,
        };
  }
  snapshot(): AuthorityState {
    return { ...this.state };
  }
  elect(
    candidates: readonly HostCandidate[],
    now: number,
    fallbackReserved: boolean,
  ): AuthorityState {
    if (this.state.phase === "ended") throw new Error("This match has ended.");
    if (
      (this.state.phase === "running" || this.state.phase === "restoring") &&
      now < this.state.leaseExpiresAt
    )
      throw new Error("The current executor still holds its lease.");
    const valid = candidates
      .filter(
        (candidate) =>
          candidate.eligible &&
          Number.isFinite(candidate.tickP95Ms) &&
          candidate.tickP95Ms >= 0 &&
          candidate.tickP95Ms <= 25 &&
          Number.isFinite(candidate.roundTripMs) &&
          candidate.roundTripMs >= 0 &&
          candidate.roundTripMs <= 250,
      )
      .sort(
        (a, b) =>
          a.tickP95Ms - b.tickP95Ms ||
          a.roundTripMs - b.roundTripMs ||
          a.guestId.localeCompare(b.guestId),
      );
    const executor = valid[0]?.guestId ?? (fallbackReserved ? "server" : null);
    this.state = {
      ...this.state,
      epoch: this.state.epoch + 1,
      phase: executor ? "restoring" : "paused",
      executor,
      leaseExpiresAt: executor ? now + 10_000 : 0,
    };
    return this.snapshot();
  }
  ready(
    executor: string,
    epoch: number,
    tick: number,
    checkpointHash: string,
    now: number,
  ): void {
    this.assertLease(executor, epoch, now);
    if (
      this.state.phase !== "restoring" ||
      tick !== this.state.committedTick ||
      checkpointHash !== this.state.checkpointHash
    )
      throw new Error("The executor did not restore the committed checkpoint.");
    this.state.phase = "running";
    this.state.leaseExpiresAt = now + 5000;
  }
  renew(executor: string, epoch: number, now: number): void {
    this.assertLease(executor, epoch, now);
    if (this.state.phase !== "running")
      throw new Error("The executor has not restored the match.");
    this.state.leaseExpiresAt = now + 5000;
  }
  commit(
    executor: string,
    epoch: number,
    previousTick: number,
    tick: number,
    checkpointHash: string,
    now: number,
  ): void {
    this.assertLease(executor, epoch, now);
    if (
      this.state.phase !== "running" ||
      previousTick !== this.state.committedTick ||
      !Number.isInteger(tick) ||
      tick <= previousTick ||
      !checkpointHash
    )
      throw new Error("Invalid commit boundary.");
    this.state.committedTick = tick;
    this.state.checkpointHash = checkpointHash;
    this.state.leaseExpiresAt = now + 5000;
  }
  disconnect(executor: string): void {
    if (this.state.executor !== executor || this.state.phase === "ended")
      return;
    this.state = {
      ...this.state,
      epoch: this.state.epoch + 1,
      phase: "paused",
      executor: null,
      leaseExpiresAt: 0,
    };
  }
  expire(now: number): boolean {
    if (
      !this.state.executor ||
      this.state.phase === "ended" ||
      now < this.state.leaseExpiresAt
    )
      return false;
    this.disconnect(this.state.executor);
    return true;
  }
  end(): void {
    this.state = {
      ...this.state,
      epoch: this.state.epoch + 1,
      phase: "ended",
      executor: null,
      leaseExpiresAt: 0,
    };
  }
  private assertLease(executor: string, epoch: number, now: number): void {
    if (
      this.state.executor !== executor ||
      this.state.epoch !== epoch ||
      now >= this.state.leaseExpiresAt ||
      this.state.phase === "ended"
    )
      throw new Error("Stale or expired executor lease.");
  }
}
