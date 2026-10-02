import type { GameMap } from "../core/game/GameMap";
import {
  FormationPlanning,
  type FormationPlanningState,
} from "./FormationPlanning";
import type { LandPaths } from "./Pathfinding";
import { FIXED, type Order, type Squad } from "./Protocol";
import type { ExactRouteOutcome } from "./RoutePlanner";
import type { WorldPoint } from "./SpatialGrid";
import { distanceSquared, pointTile, tilePoint } from "./SquadGeometry";

interface Member {
  id: number;
  destination?: WorldPoint;
  start?: number;
  path?: number[];
  cursor: number;
  connector?: number;
  requested: boolean;
  queued: Order[];
}
interface Admission {
  id: number;
  playerId: number;
  generation: number;
  tile: number;
  revision: string;
  members: Member[];
  formation: FormationPlanningState;
  phase: "formation" | "queued" | "routes" | "connectors";
  member: number;
}
interface QueuedIntent {
  id: number;
  playerId: number;
  generation: number;
  order: Order;
  members: { id: number; admissionId?: number }[];
  revision: string;
  formation?: FormationPlanningState;
}
export interface MovementAdmissionEvent {
  id: number;
  playerId: number;
  tick: number;
  status: "deferred" | "executed" | "rejected" | "superseded";
  reason?: string;
}
export interface MovementAdmissionPorts {
  squads(): readonly Squad[];
  squad(id: number): Squad | undefined;
  generation(playerId: number): number;
  revision(): string;
  blocked(playerId: number): ((tile: number) => boolean) | undefined;
  request(
    id: number,
    playerId: number,
    squadId: number,
    start: number,
    goal: number,
  ): boolean;
  cancel(id: number, squadId: number): void;
  queue(squad: Squad, order: Order): void;
  clear(squad: Squad, end: WorldPoint): boolean;
  destinationValid(
    squad: Squad,
    point: WorldPoint,
    selected: ReadonlySet<number>,
  ): boolean;
  commit(
    squad: Squad,
    point: WorldPoint,
    path: number[],
    nextIndex: number,
    append: readonly Order[],
  ): void;
}

/** Transactional land admission: current orders run until every replacement
 * has a live, short connector. No member is activated after a partial success.
 * Pending input and search continuations are checkpointed domain state.
 */
export class MovementAdmission {
  private readonly pending = new Map<number, Admission>();
  private readonly intents = new Map<number, QueuedIntent>();
  readonly events: MovementAdmissionEvent[] = [];
  private nextId = 1;
  get pendingCount(): number {
    return this.pending.size;
  }
  constructor(
    private readonly map: GameMap,
    private readonly paths: LandPaths,
    private readonly ports: MovementAdmissionPorts,
  ) {}
  checkpoint() {
    return structuredClone({
      pending: [...this.pending],
      intents: [...this.intents],
      nextId: this.nextId,
      events: this.events,
    });
  }
  restore(saved: ReturnType<MovementAdmission["checkpoint"]>): void {
    this.pending.clear();
    for (const [id, admission] of structuredClone(saved.pending))
      this.pending.set(id, admission);
    this.intents.clear();
    for (const [id, intent] of structuredClone(saved.intents))
      this.intents.set(id, intent);
    this.nextId = saved.nextId;
    this.events.splice(0, this.events.length, ...structuredClone(saved.events));
  }
  private event(
    admission: Pick<Admission, "id" | "playerId">,
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
  }
  private finish(
    admission: Admission,
    tick: number,
    status: MovementAdmissionEvent["status"],
    reason?: string,
  ): void {
    this.pending.delete(admission.id);
    for (const member of admission.members)
      this.ports.cancel(admission.id, member.id);
    this.event(admission, tick, status, reason);
  }
  cancel(ids: readonly number[], tick: number): void {
    const selected = new Set(ids);
    for (const [id, intent] of this.intents)
      if (intent.members.some((m) => selected.has(m.id))) {
        this.intents.delete(id);
        this.event(intent, tick, "superseded", "Replaced by a newer command");
      }
    for (const admission of this.pending.values())
      if (admission.members.some((m) => selected.has(m.id)))
        this.finish(
          admission,
          tick,
          "superseded",
          "Replaced by a newer command",
        );
  }
  append(ids: readonly number[], order: Order): boolean {
    const selected = [...new Set(ids)],
      members = selected.map((id) => ({
        id,
        admissionId: [...this.pending.values()].find((a) =>
          a.formation.selected.has(id),
        )?.id,
      }));
    if (!members.some((m) => m.admissionId !== undefined)) return false;
    const squad = this.ports.squad(selected[0])!;
    const intent: QueuedIntent = {
      id: this.nextId++,
      playerId: squad.playerId,
      generation: this.ports.generation(squad.playerId),
      order: { ...order },
      members,
      revision: this.ports.revision(),
    };
    this.intents.set(intent.id, intent);
    return true;
  }
  queued(ids: readonly number[]): number {
    let maximum = 0;
    for (const id of new Set(ids)) {
      const member = [...this.pending.values()]
        .flatMap((a) => a.members)
        .find((m) => m.id === id);
      const pending = [...this.intents.values()].filter((i) =>
        i.members.some((m) => m.id === id),
      ).length;
      maximum = Math.max(
        maximum,
        (member?.queued.length ??
          this.ports.squad(id)?.queuedOrders.length ??
          0) + pending,
      );
    }
    return maximum;
  }
  start(
    playerId: number,
    squads: readonly Squad[],
    tile: number,
    tick: number,
    preferred?: Map<number, WorldPoint>,
  ): number {
    this.cancel(
      squads.map((s) => s.id),
      tick,
    );
    return this.create(playerId, squads, tile, tick, preferred);
  }
  /** An idle member of a mixed Shift command needs its first route admitted,
   * while later Shift intents stay attached to the newly created cohort. */
  startQueued(
    squad: Squad,
    order: Extract<Order, { type: "move" }>,
    tick: number,
  ): number {
    const point =
      order.x === undefined
        ? tilePoint(this.map, order.tile)
        : { x: order.x, y: order.y! };
    const id = this.create(
      squad.playerId,
      [squad],
      order.tile,
      tick,
      new Map([[squad.id, point]]),
    );
    for (const intent of this.intents.values())
      for (const member of intent.members)
        if (member.id === squad.id && member.admissionId === undefined)
          member.admissionId = id;
    return id;
  }
  private create(
    playerId: number,
    squads: readonly Squad[],
    tile: number,
    tick: number,
    preferred?: Map<number, WorldPoint>,
  ): number {
    const id = this.nextId++,
      formation = new FormationPlanning(
        this.map,
        this.paths,
        tile,
        squads.map((squad) => ({ squad, origin: squad })),
        () => this.ports.squads(),
        Infinity,
        preferred,
      );
    const admission: Admission = {
      id,
      playerId,
      generation: this.ports.generation(playerId),
      tile,
      revision: this.ports.revision(),
      members: squads.map((s) => ({
        id: s.id,
        cursor: 0,
        requested: false,
        queued: [],
      })),
      formation: formation.state,
      phase: "formation",
      member: 0,
    };
    this.pending.set(id, admission);
    this.event(admission, tick, "deferred");
    return id;
  }
  valid(id: number, squadId: number): boolean {
    const admission = this.pending.get(id),
      squad = this.ports.squad(squadId);
    return (
      !!admission &&
      !!squad &&
      squad.playerId === admission.playerId &&
      squad.troops > 0 &&
      squad.embarkedOn === null &&
      !squad.refit &&
      admission.generation === this.ports.generation(admission.playerId) &&
      admission.formation.selected.has(squadId)
    );
  }
  completed(
    id: number,
    squadId: number,
    outcome: ExactRouteOutcome,
    path: number[],
    tick: number,
  ): void {
    const admission = this.pending.get(id),
      member = admission?.members.find((m) => m.id === squadId);
    if (!admission || !member) return;
    member.requested = false;
    if (outcome === "complete") {
      member.path = path;
      member.cursor = 0;
      member.connector = undefined;
    } else if (outcome === "unreachable")
      this.finish(
        admission,
        tick,
        "rejected",
        "A formation destination cannot be reached by land",
      );
    // Budget exhaustion or invalidated geometry remain deferred, never physical failure.
  }
  private waitingIntent(admissionId: number): boolean {
    return [...this.intents.values()].some((i) =>
      i.members.some((m) => m.admissionId === admissionId),
    );
  }
  private stepIntents(tick: number, budget: number): number {
    let used = 0;
    // A single FIFO preserves the order of Shift commands across overlapping
    // replacement cohorts. One formation owns all slots of each Shift selection.
    while (this.intents.size && used < budget) {
      const [id, intent] = this.intents.entries().next().value!;
      if (
        intent.generation !== this.ports.generation(intent.playerId) ||
        intent.members.some((m) => {
          const squad = this.ports.squad(m.id);
          return (
            !squad ||
            squad.playerId !== intent.playerId ||
            squad.troops <= 0 ||
            squad.embarkedOn !== null ||
            !!squad.refit ||
            (m.admissionId !== undefined && !this.pending.has(m.admissionId))
          );
        })
      ) {
        this.intents.delete(id);
        this.event(intent, tick, "superseded", "Queued selection changed");
        used++;
        continue;
      }
      if (
        intent.members.some(
          (m) =>
            m.admissionId !== undefined &&
            this.pending.get(m.admissionId)!.phase === "formation",
        )
      ) {
        used++;
        break;
      }
      const revision = this.ports.revision();
      if (intent.revision !== revision) {
        intent.formation = undefined;
        intent.revision = revision;
      }
      const order = intent.order;
      if (order.type === "move" && !intent.formation) {
        const members = intent.members.map((m) => {
          const squad = this.ports.squad(m.id)!,
            pending =
              m.admissionId === undefined
                ? undefined
                : this.pending
                    .get(m.admissionId)!
                    .members.find((member) => member.id === m.id)!;
          const orders = pending?.queued ?? squad.queuedOrders,
            last =
              orders[orders.length - 1] ?? (pending ? undefined : squad.order);
          const origin =
            last?.type === "move"
              ? last.x === undefined
                ? tilePoint(this.map, last.tile)
                : { x: last.x, y: last.y! }
              : (pending?.destination ?? squad);
          return { squad, origin };
        });
        // Include pending future slots in the occupancy snapshot seen by later
        // Shift selections, without modifying any unit's executable orders.
        const additional = new Map<number, Order[]>();
        for (const admission of this.pending.values())
          for (const m of admission.members)
            additional.set(m.id, [
              ...(m.destination
                ? [
                    {
                      type: "move" as const,
                      tile: pointTile(this.map, m.destination),
                      ...m.destination,
                    },
                  ]
                : []),
              ...m.queued.map((queued) => ({ ...queued })),
            ]);
        intent.formation = new FormationPlanning(
          this.map,
          this.paths,
          order.tile,
          members,
          () => this.ports.squads(),
          Infinity,
          undefined,
          undefined,
          additional,
        ).state;
      }
      if (order.type === "move") {
        const formation = new FormationPlanning(
          this.map,
          this.paths,
          order.tile,
          [],
          () => this.ports.squads(),
          Infinity,
          undefined,
          intent.formation,
        );
        used += formation.step(
          Math.min(16, budget - used),
          this.ports.blocked(intent.playerId),
        );
      } else used++;
      if (intent.formation?.phase === "failed") {
        this.intents.delete(id);
        this.event(
          intent,
          tick,
          "rejected",
          "There is no room for a queued formation",
        );
        continue;
      }
      if (order.type === "move" && intent.formation?.phase !== "done") continue;
      this.intents.delete(id);
      for (const m of intent.members) {
        const point = intent.formation?.result.get(m.id),
          next: Order =
            order.type === "move" && point
              ? { type: "move", tile: pointTile(this.map, point), ...point }
              : { ...order };
        if (m.admissionId !== undefined)
          this.pending
            .get(m.admissionId)!
            .members.find((member) => member.id === m.id)!
            .queued.push(next);
        else this.ports.queue(this.ports.squad(m.id)!, next);
      }
    }
    return used;
  }
  step(tick: number, budget = 128): number {
    if (!Number.isInteger(budget) || budget < 0)
      throw new Error("Invalid admission work budget");
    const validated = new Set<number>(),
      revision = this.ports.revision();
    let used = this.stepIntents(tick, Math.min(32, budget)),
      idle = 0;
    while (this.pending.size && used < budget) {
      const [id, admission] = this.pending.entries().next().value!;
      this.pending.delete(id);
      this.pending.set(id, admission);
      if (
        !validated.has(id) &&
        admission.members.some((m) => !this.valid(id, m.id))
      ) {
        this.finish(
          admission,
          tick,
          "superseded",
          "Control or selected units changed",
        );
        used++;
        continue;
      }
      validated.add(id);
      if (admission.revision !== revision) {
        const squads = admission.members.map((m) => this.ports.squad(m.id)!);
        for (const member of admission.members) {
          this.ports.cancel(id, member.id);
          member.requested = false;
          member.path = undefined;
        }
        admission.formation = new FormationPlanning(
          this.map,
          this.paths,
          admission.tile,
          squads.map((squad) => ({ squad, origin: squad })),
          () => this.ports.squads(),
        ).state;
        admission.revision = revision;
        admission.phase = "formation";
        admission.member = 0;
      }
      if (admission.phase === "formation") {
        const formation = new FormationPlanning(
          this.map,
          this.paths,
          admission.tile,
          [],
          () => this.ports.squads(),
          Infinity,
          undefined,
          admission.formation,
        );
        used += formation.step(
          Math.min(16, budget - used),
          this.ports.blocked(admission.playerId),
        );
        if (formation.state.phase === "failed")
          this.finish(
            admission,
            tick,
            "rejected",
            "There is no room for this formation at that destination",
          );
        else if (formation.state.phase === "done") {
          for (const member of admission.members)
            member.destination = formation.state.result.get(member.id)!;
          admission.phase = "queued";
        }
        idle = 0;
      } else if (admission.phase === "queued") {
        used++;
        if (this.waitingIntent(admission.id)) {
          if (++idle >= this.pending.size) break;
        } else {
          admission.phase = "routes";
          admission.member = 0;
          idle = 0;
        }
      } else if (admission.phase === "routes") {
        const member = admission.members.find((m) => !m.path && !m.requested);
        if (member) {
          const squad = this.ports.squad(member.id)!;
          member.start = pointTile(this.map, squad);
          member.requested = this.ports.request(
            id,
            admission.playerId,
            member.id,
            member.start,
            pointTile(this.map, member.destination!),
          );
          used++;
          idle = 0;
        } else if (admission.members.every((m) => !!m.path)) {
          admission.phase = "connectors";
          admission.member = 0;
          used++;
          idle = 0;
        } else if (++idle >= this.pending.size) break;
      } else {
        if (this.waitingIntent(admission.id)) {
          admission.phase = "queued";
          used++;
          continue;
        }
        const member = admission.members[admission.member],
          squad = this.ports.squad(member.id)!;
        const at = member.cursor++,
          tile = member.path![at];
        used++;
        idle = 0;
        if (tile === undefined) {
          member.path = undefined;
          member.cursor = 0;
          admission.phase = "routes";
          admission.member = 0;
          continue;
        }
        const point = tilePoint(this.map, tile);
        if (
          distanceSquared(squad, point) <= (3 * FIXED) ** 2 &&
          this.ports.clear(squad, point)
        ) {
          member.connector = at;
          if (++admission.member < admission.members.length) continue;
          const selected = new Set(admission.members.map((m) => m.id));
          // The final read/commit is atomic within this fixed tick. Each corridor
          // is at most three tiles, independent of total route/map length.
          const stale = admission.members.find((m) => {
            const live = this.ports.squad(m.id)!,
              end = tilePoint(this.map, m.path![m.connector!]);
            return (
              distanceSquared(live, end) > (3 * FIXED) ** 2 ||
              !this.ports.clear(live, end)
            );
          });
          if (stale) {
            admission.member = admission.members.indexOf(stale);
            stale.cursor = 0;
            continue;
          }
          if (
            admission.members.some(
              (m) =>
                !this.ports.destinationValid(
                  this.ports.squad(m.id)!,
                  m.destination!,
                  selected,
                ),
            )
          ) {
            this.finish(
              admission,
              tick,
              "rejected",
              "Formation destination became occupied",
            );
            continue;
          }
          for (const m of admission.members)
            this.ports.commit(
              this.ports.squad(m.id)!,
              m.destination!,
              m.path!,
              m.connector!,
              m.queued,
            );
          this.finish(admission, tick, "executed");
        }
      }
    }
    return used;
  }
}
