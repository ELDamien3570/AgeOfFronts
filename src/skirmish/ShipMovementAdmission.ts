import type { GameMap } from "../core/game/GameMap";
import type { MovementAdmissionEvent } from "./MovementAdmission";
import type { WaterPaths } from "./Pathfinding";
import { MAX_QUEUED_ORDERS, type Player, type Ship } from "./Protocol";
import type { ExactRouteOutcome } from "./RoutePlanner";
import { limitedRouteRetry, ROUTE_CAPACITY_REASON } from "./RouteRetryPolicy";

interface Member {
  id: number;
  path?: number[];
  start?: number;
  requested: boolean;
  limitedAttempts?: number;
  retryAt?: number;
  cursor: number;
  connector?: number;
  append: number[];
}
interface Admission {
  id: number;
  playerId: number;
  generation: number;
  goal: number;
  members: Member[];
  selected: Set<number>;
  member: number;
  execution?: boolean;
  paused?: boolean;
  recovery?: { state: Ship["repairState"]; port: Ship["repairPortId"] };
}
export interface ShipMovementAdmissionPorts {
  ship(id: number): Ship | undefined;
  tileOf(ship: Ship): number;
  generation(playerId: number): number;
  available(ship: Ship): boolean;
  request(
    id: number,
    playerId: number,
    shipId: number,
    start: number,
    goal: number,
  ): boolean;
  cancel(id: number, shipId: number): void;
  commit(
    ship: Ship,
    goal: number,
    path: number[],
    connector: number,
    append: number[],
    recovery?: boolean,
  ): void;
  queue(ship: Ship, goal: number): void;
  paused?(ship: Ship, paused: boolean): void;
}

/** Water routes use the same exact scheduler as land. Replacement activation
 * is transactional; a short cardinal connector preserves continuing voyages.
 * Paths and Shift waypoints are owned until commit, never reconstructed twice. */
export class ShipMovementAdmission {
  private readonly pending = new Map<number, Admission>();
  private readonly replacementByShip = new Map<number, number>();
  private readonly executionByShip = new Map<number, number>();
  private nextId = 1;
  private pauseCommitted = true;
  readonly events: MovementAdmissionEvent[] = [];
  onEvent?: (event: MovementAdmissionEvent) => void;
  get pendingCount(): number {
    return this.pending.size;
  }
  constructor(
    private readonly map: GameMap,
    private readonly paths: WaterPaths,
    private readonly ports: ShipMovementAdmissionPorts,
  ) {}
  checkpoint() {
    return structuredClone({
      pending: [...this.pending],
      nextId: this.nextId,
      events: this.events,
      pauseCommitted: this.pauseCommitted,
    });
  }
  restore(
    saved: Omit<
      ReturnType<ShipMovementAdmission["checkpoint"]>,
      "pauseCommitted"
    > & { pauseCommitted?: boolean },
  ): void {
    this.pauseCommitted = saved.pauseCommitted ?? false;
    this.pending.clear();
    this.replacementByShip.clear();
    this.executionByShip.clear();
    for (const [, admission] of structuredClone(saved.pending))
      this.index(admission);
    this.nextId = saved.nextId;
    this.events.splice(0, this.events.length, ...structuredClone(saved.events));
  }
  private event(
    admission: Admission,
    tick: number,
    status: MovementAdmissionEvent["status"],
    reason?: string,
  ): void {
    this.events.push({
      id: admission.id,
      playerId: admission.playerId,
      tick,
      status,
      reason,
    });
    if (this.events.length > 128) this.events.shift();
    this.onEvent?.({ ...this.events[this.events.length - 1] });
  }
  private finish(
    admission: Admission,
    tick: number,
    status: MovementAdmissionEvent["status"],
    reason?: string,
  ): void {
    this.pending.delete(admission.id);
    const index = admission.execution
      ? this.executionByShip
      : this.replacementByShip;
    for (const member of admission.members) {
      if (index.get(member.id) === admission.id) index.delete(member.id);
      this.ports.cancel(admission.id, member.id);
      if (admission.paused) {
        const ship = this.ports.ship(member.id);
        if (ship) this.ports.paused?.(ship, false);
      }
    }
    if (!admission.execution) this.event(admission, tick, status, reason);
  }
  cancel(ids: readonly number[], tick: number): void {
    this.cancelSelection(ids, tick, true);
  }
  private cancelSelection(
    ids: readonly number[],
    tick: number,
    executions: boolean,
  ): void {
    const selected = new Set(ids);
    for (const admission of this.pending.values())
      if (
        (executions || !admission.execution) &&
        admission.members.some((m) => selected.has(m.id))
      )
        this.finish(
          admission,
          tick,
          "superseded",
          "Replaced by a newer command",
        );
  }
  executing(shipId: number): boolean {
    return this.executionByShip.has(shipId);
  }
  replacement(shipId: number): number | undefined {
    return this.replacementByShip.get(shipId);
  }
  private index(admission: Admission): void {
    this.pending.set(admission.id, admission);
    const index = admission.execution
      ? this.executionByShip
      : this.replacementByShip;
    for (const member of admission.members) index.set(member.id, admission.id);
  }
  /** Activation of an already committed waypoint is executable old intent.
   * It can coexist with a replacement being planned, and survives takeover. */
  resume(ship: Ship, goal: number, recovery = false): void {
    if (this.executing(ship.id))
      throw new Error("Ship already awaits waypoint activation");
    const id = this.nextId++,
      admission: Admission = {
        id,
        playerId: ship.playerId,
        generation: this.ports.generation(ship.playerId),
        goal,
        execution: true,
        ...(recovery
          ? { recovery: { state: ship.repairState, port: ship.repairPortId } }
          : {}),
        selected: new Set([ship.id]),
        member: 0,
        members: [
          {
            id: ship.id,
            requested: false,
            cursor: 0,
            append: [...ship.waypoints],
          },
        ],
      };
    this.index(admission);
  }
  /** Recovery is executable domain intent, subordinate to the ship's existing
   * repair owner. A newer human replacement may continue planning alongside it. */
  recover(ship: Ship, goal: number, tick: number): void {
    const previous = this.pending.get(this.executionByShip.get(ship.id) ?? -1);
    if (
      this.pauseCommitted &&
      previous?.recovery &&
      previous.goal === goal &&
      previous.recovery.state === ship.repairState &&
      previous.recovery.port === ship.repairPortId
    )
      return;
    if (previous) this.finish(previous, tick, "superseded");
    this.resume(ship, goal, true);
  }
  command(
    player: Player,
    ships: readonly Ship[],
    goal: number,
    append: boolean,
    tick: number,
  ): string | null {
    if (ships.some((ship) => !this.ports.available(ship)))
      return "Wait for these ships to finish recovery or boarding";
    const members = ships.map((ship) => {
      const admission = this.pending.get(
          this.replacementByShip.get(ship.id) ??
            this.executionByShip.get(ship.id) ??
            -1,
        ),
        member = admission?.members.find((m) => m.id === ship.id),
        last =
          member?.append[member.append.length - 1] ??
          admission?.goal ??
          ship.waypoints[ship.waypoints.length - 1] ??
          ship.destination ??
          this.ports.tileOf(ship);
      return {
        ship,
        admission,
        member,
        origin: append ? last : this.ports.tileOf(ship),
      };
    });
    // All validation precedes either queue changes or replacement cancellation.
    if (members.some((m) => !this.paths.connected(m.origin, goal)))
      return "That water cannot be reached by this ship";
    if (
      append &&
      members.some(
        (m) =>
          (m.member?.append.length ?? m.ship.waypoints.length) >=
          MAX_QUEUED_ORDERS,
      )
    )
      return "A ship can queue 32 waypoints";
    if(!append && members.length && members.every(m=>m.admission && !m.admission.execution && m.admission.goal===goal && m.admission.generation===this.ports.generation(player.id) && m.admission.id===members[0].admission?.id && m.admission.selected.size===ships.length)){this.event(members[0].admission!,tick,"deferred");return null;}
    const initial: Ship[] = [];
    if (append) {
      for (const m of members) {
        if (m.member) {
          m.member.append.push(goal);
          if (m.admission?.execution) this.ports.queue(m.ship, goal);
        } else if (m.ship.destination !== null) this.ports.queue(m.ship, goal);
        else initial.push(m.ship);
      }
    } else {
      this.cancelSelection(
        ships.map((s) => s.id),
        tick,
        false,
      );
      initial.push(...ships);
    }
    if (initial.length) {
      const id = this.nextId++,
        admission: Admission = {
          id,
          playerId: player.id,
          generation: this.ports.generation(player.id),
          goal,
          member: 0,
          selected: new Set(initial.map((s) => s.id)),
          members: initial.map((s) => ({
            id: s.id,
            requested: false,
            cursor: 0,
            append: [],
          })),
        };
      this.index(admission);
      this.event(admission, tick, "deferred");
    }
    return null;
  }
  valid(id: number, shipId: number): boolean {
    const admission = this.pending.get(id),
      ship = this.ports.ship(shipId);
    return (
      !!admission &&
      !!ship &&
      ship.health > 0 &&
      ship.playerId === admission.playerId &&
      !ship.refit &&
      (admission.recovery
        ? ship.repairState === admission.recovery.state &&
          ship.repairPortId === admission.recovery.port
        : this.ports.available(ship)) &&
      admission.selected.has(shipId) &&
      (admission.execution
        ? ship.destination === admission.goal
        : admission.generation === this.ports.generation(admission.playerId))
    );
  }
  completed(
    id: number,
    shipId: number,
    outcome: ExactRouteOutcome,
    path: number[],
    tick: number,
  ): void {
    const admission = this.pending.get(id),
      member = admission?.members.find((m) => m.id === shipId);
    if (!admission || !member || admission.paused) return;
    member.requested = false;
    if (outcome === "complete") {
      member.limitedAttempts = 0;
      member.retryAt = undefined;
      member.path = path;
      member.cursor = 0;
      member.connector = undefined;
    } else if (outcome === "unreachable")
      this.finish(admission, tick, "rejected", "Water route is disconnected");
    else if (outcome === "limited") {
      const retry = limitedRouteRetry(
        member.limitedAttempts ?? 0,
        tick,
        !admission.execution || this.pauseCommitted,
      );
      member.limitedAttempts = retry.attempts;
      if (retry.exhausted && !admission.execution)
        this.finish(admission, tick, "rejected", ROUTE_CAPACITY_REASON);
      else if (retry.exhausted) {
        admission.paused = true;
        for (const m of admission.members) {
          this.ports.cancel(admission.id, m.id);
          m.requested = false;
          const ship = this.ports.ship(m.id);
          if (ship) this.ports.paused?.(ship, true);
        }
        this.event(admission, tick, "deferred", ROUTE_CAPACITY_REASON);
      } else member.retryAt = retry.retryAt;
    }
  }
  step(tick: number, budget = 64): number {
    if (!Number.isInteger(budget) || budget < 0)
      throw new Error("Invalid sailing admission budget");
    const validated = new Set<number>();
    let used = 0,
      idle = 0;
    while (this.pending.size && used < budget) {
      const [id, admission] = this.pending.entries().next().value!;
      this.pending.delete(id);
      this.pending.set(id, admission);
      if (
        !validated.has(id) &&
        admission.members.some((m) => !this.valid(id, m.id))
      ) {
        this.finish(admission, tick, "superseded", "Control or ships changed");
        used++;
        continue;
      }
      validated.add(id);
      if (admission.paused) {
        used++;
        if (++idle >= this.pending.size) break;
        continue;
      }
      const unplanned = admission.members.find(
        (m) => !m.path && !m.requested && (m.retryAt ?? 0) <= tick,
      );
      if (unplanned) {
        unplanned.start = this.ports.tileOf(this.ports.ship(unplanned.id)!);
        unplanned.requested = this.ports.request(
          id,
          admission.playerId,
          unplanned.id,
          unplanned.start,
          admission.goal,
        );
        used++;
        idle = 0;
        continue;
      }
      if (admission.members.some((m) => !m.path)) {
        if (++idle >= this.pending.size) break;
        continue;
      }
      idle = 0;
      const member = admission.members[admission.member],
        ship = this.ports.ship(member.id)!;
      const at = member.cursor++,
        candidate = member.path![at];
      used++;
      if (candidate === undefined) {
        member.path = undefined;
        member.cursor = 0;
        admission.member = 0;
        continue;
      }
      // Same or cardinally adjacent water cells are a legal straight connector
      // from any point inside the current cell; they cannot cross a land corner.
      if (this.map.manhattanDist(this.ports.tileOf(ship), candidate) > 1)
        continue;
      member.connector = at;
      if (++admission.member < admission.members.length) continue;
      const stale = admission.members.find(
        (m) =>
          this.map.manhattanDist(
            this.ports.tileOf(this.ports.ship(m.id)!),
            m.path![m.connector!],
          ) > 1,
      );
      if (stale) {
        admission.member = admission.members.indexOf(stale);
        stale.cursor = 0;
        continue;
      }
      if (!admission.execution)
        for (const other of this.pending.values())
          if (
            other.execution &&
            other.members.some((m) => admission.selected.has(m.id))
          )
            this.finish(other, tick, "superseded");
      for (const m of admission.members)
        this.ports.commit(
          this.ports.ship(m.id)!,
          admission.goal,
          m.path!,
          m.connector!,
          m.append,
          !!admission.recovery,
        );
      this.finish(admission, tick, "executed");
    }
    return used;
  }
}
