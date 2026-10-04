import { FormationOccupancy } from "./FormationOccupancy";
import type { GameMap } from "../core/game/GameMap";
import {
  FormationPlanning,
  type FormationPlanningState,
} from "./FormationPlanning";
import type { LandPaths } from "./Pathfinding";
import { FIXED, type Order, type Squad } from "./Protocol";
import type { ExactRouteOutcome } from "./RoutePlanner";
import { limitedRouteRetry, ROUTE_CAPACITY_REASON } from "./RouteRetryPolicy";
import type { WorldPoint } from "./SpatialGrid";
import { distanceSquared, pointTile, tilePoint } from "./SquadGeometry";
import { StructureAttackPreparation, STRUCTURE_PREPARATION_LIMITS, type StructureAttackPreparationState } from "./domain/StructureAttackPreparation";

interface Member {
  id: number;
  destination?: WorldPoint;
  start?: number;
  path?: number[];
  cursor: number;
  connector?: number;
  requested: boolean;
  limitedAttempts?: number;
  retryAt?: number;
  queued: Order[];
  shared?: { stage: "entry" | "exit"; entry?: number[]; spine: number[] };
  independent?: boolean;
  structureTarget?: Squad["structureTarget"];
}
interface Admission {
  corridorId?: number;
  id: number;
  playerId: number;
  generation: number;
  tile: number;
  revision: string;
  members: Member[];
  formation: FormationPlanningState;
  phase: "preparation" | "formation" | "queued" | "routes" | "connectors";
  preparation?: StructureAttackPreparationState;
  preparationRestarts?: number;
  member: number;
  placementRetries?: number;
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
  prepareStructure?(state: StructureAttackPreparationState, budget: number): number;
  activateStructure?(playerId: number, squads: readonly Squad[], points: Map<number, WorldPoint>, target: NonNullable<Squad["structureTarget"]>): void;
  handoffStructure?(id: number, playerId: number, action: () => void): void;
  squads(): readonly Squad[];
  hostile?(a: number, b: number): boolean;
  priority?(playerId: number): boolean;
  squad(id: number): Squad | undefined;
  generation(playerId: number): number;
  revision(playerId: number): string;
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
    structureTarget?: Squad["structureTarget"],
  ): boolean;
  commit(
    squad: Squad,
    point: WorldPoint,
    path: number[],
    nextIndex: number,
    append: readonly Order[],
    structureTarget?: Squad["structureTarget"],
  ): void;
}

/** Transactional land admission: current orders run until every replacement
 * has a live, short connector. No member is activated after a partial success.
 * Pending input and search continuations are checkpointed domain state.
 */
export class MovementAdmission {
  private readonly pending = new Map<number, Admission>();
  private readonly pendingBySquad = new Map<number, number>();
  private readonly intents = new Map<number, QueuedIntent>();
  private readonly intentsBySquad = new Map<number, Set<number>>();
  private readonly intentsByAdmission = new Map<number, Set<number>>();
  readonly events: MovementAdmissionEvent[] = [];
  onEvent?: (event: MovementAdmissionEvent) => void;
  private nextId = 1;
  private readonly occupancy: FormationOccupancy;
  private readonly corridors = new Map<number, { path: number[]; kind: Squad["kind"]; revision: string }>();
  hasPending(squadId: number): boolean { return this.pendingBySquad.has(squadId); }
  get pendingCount(): number {
    return this.pending.size;
  }
  get preparationCount(): number { return [...this.pending.values()].filter(a => a.phase === "preparation").length; }
  readonly preparationDiagnostics = { work: 0, completed: 0, rejected: 0, restarts: 0, coalesced: 0, superseded: 0, discardedWork: 0 };
  startStructure(playerId: number, squads: readonly Squad[], tile: number, tick: number,
    state: StructureAttackPreparationState): string | null {
    // A think-cycle restatement by an autonomous controller retains the exact
    // objective's progress. Human replacements and queued intents always keep
    // their separate command identity and normal cancellation semantics.
    if (!this.ports.priority?.(playerId) && squads.length) {
      const current = this.pending.get(this.pendingBySquad.get(squads[0].id) ?? -1), previous = current?.preparation;
      if (current?.phase === "preparation" && previous && current.playerId === playerId &&
        current.generation === this.ports.generation(playerId) && current.revision === this.ports.revision(playerId) &&
        previous.target.buildingId === state.target.buildingId && previous.target.barrierId === state.target.barrierId &&
        previous.members.length === state.members.length && state.members.every(member =>
          !this.intentsBySquad.get(member.id)?.size && previous.members.some(old => old.id === member.id && old.kind === member.kind && old.range === member.range))) {
        this.preparationDiagnostics.coalesced++;
        return null;
      }
    }
    if (this.preparationCount >= STRUCTURE_PREPARATION_LIMITS.jobs)
      return "Structure preparation is full; retry after pending orders finish";
    this.cancel(squads.map(s => s.id), tick);
    const id = this.create(playerId, squads, tile, tick, undefined, state.target), admission = this.pending.get(id)!;
    admission.phase = "preparation"; admission.preparation = state;
    return null;
  }
  constructor(
    private readonly map: GameMap,
    private readonly paths: LandPaths,
    private readonly ports: MovementAdmissionPorts,
  ) { this.occupancy = new FormationOccupancy(map); }
  checkpoint() {
    return structuredClone({
      pending: [...this.pending],
      intents: [...this.intents],
      nextId: this.nextId,
      events: this.events,
      corridors: [...this.corridors],
    });
  }
  restore(saved: ReturnType<MovementAdmission["checkpoint"]>): void {
    this.pending.clear();
    this.corridors.clear();
    for (const [id, corridor] of structuredClone(saved.corridors ?? [])) this.corridors.set(id, corridor);
    this.pendingBySquad.clear();
    for (const [id, admission] of structuredClone(saved.pending)) {
      FormationPlanning.normalizeCheckpoint(admission.formation);
      this.pending.set(id, admission);
      for (const member of admission.members)
        this.pendingBySquad.set(member.id, id);
    }
    this.intents.clear();
    this.intentsBySquad.clear();
    this.intentsByAdmission.clear();
    for (const [, intent] of structuredClone(saved.intents ?? [])) {
      if (intent.formation) FormationPlanning.normalizeCheckpoint(intent.formation);
      this.addIntent(intent);
    }
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
    this.onEvent?.({ ...this.events[this.events.length - 1] });
  }
  private finish(
    admission: Admission,
    tick: number,
    status: MovementAdmissionEvent["status"],
    reason?: string,
  ): void {
    if (admission.phase === "preparation" && status === "superseded") {
      this.preparationDiagnostics.superseded++;
      this.preparationDiagnostics.discardedWork += admission.preparation?.consumed ?? 0;
    }
    this.pending.delete(admission.id);
    if (admission.corridorId !== undefined && ![...this.pending.values()].some(a => a.corridorId === admission.corridorId)) this.corridors.delete(admission.corridorId);
    for (const member of admission.members) {
      if (this.pendingBySquad.get(member.id) === admission.id)
        this.pendingBySquad.delete(member.id);
      this.ports.cancel(admission.id, member.id);
    }
    this.event(admission, tick, status, reason);
  }
  cancel(ids: readonly number[], tick: number): void {
    const selected = new Set(ids);
    for (const [id, intent] of this.intents)
      if (intent.members.some((m) => selected.has(m.id))) {
        this.removeIntent(id);
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
  append(ids: readonly number[], order: Order, tick = 0): boolean {
    const selected = [...new Set(ids)],
      members = selected.map((id) => ({
        id,
        admissionId: this.pendingBySquad.get(id),
      }));
    if (!members.some((m) => m.admissionId !== undefined)) return false;
    if (selected.length > 30) {
      for (let start = 0; start < selected.length; start += 30) {
        const chunk = members.slice(start, start + 30), squad = this.ports.squad(chunk[0].id)!;
        const intent: QueuedIntent = { id: this.nextId++, playerId: squad.playerId,
          generation: this.ports.generation(squad.playerId), order: { ...order }, members: chunk,
          revision: this.ports.revision(squad.playerId) };
        this.addIntent(intent); this.event(intent, tick, "deferred");
      }
      return true;
    }
    const squad = this.ports.squad(selected[0])!;
    const intent: QueuedIntent = {
      id: this.nextId++,
      playerId: squad.playerId,
      generation: this.ports.generation(squad.playerId),
      order: { ...order },
      members,
      revision: this.ports.revision(squad.playerId),
    };
    this.addIntent(intent);
    this.event(intent, tick, "deferred");
    return true;
  }
  queued(ids: readonly number[]): number {
    let maximum = 0;
    for (const id of new Set(ids)) {
      const member = this.pending
        .get(this.pendingBySquad.get(id) ?? -1)
        ?.members.find((m) => m.id === id);
      const pending = this.intentsBySquad.get(id)?.size ?? 0;
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
    repeatIntent = false,
    structureTarget?: Squad["structureTarget"],
  ): number {
    // A periodic AI controller restating its unchanged intention must not
    // throw away a long-running search. Deliberate manual replacements retain
    // normal cancellation semantics, including clearing pending Shift legs.
    if (
      repeatIntent &&
      !preferred &&
      squads.length &&
      squads.every((s) => !this.intentsBySquad.get(s.id)?.size)
    ) {
      const selected = new Set(squads.map(s => s.id)), cohorts = new Set<number>();
      const unchanged = squads.every(s => {
        const current = this.pending.get(this.pendingBySquad.get(s.id) ?? -1);
        if (!current || current.playerId !== playerId || current.tile !== tile ||
          current.generation !== this.ports.generation(playerId) ||
          current.members.some(m => !selected.has(m.id) || m.queued.length)) return false;
        cohorts.add(current.id); return true;
      });
      if (unchanged) return cohorts.values().next().value!;
    }
    this.cancel(
      squads.map((s) => s.id),
      tick,
    );
    // Small human cohorts can commit promptly while the rest of a large
    // selection prepares. AI keeps larger batches for corridor reuse.
    const cohortSize=this.ports.priority?.(playerId)?10:30;
    if (squads.length > cohortSize) {
      const ordered = [...squads].sort((a, b) => a.x - b.x || a.y - b.y || a.id - b.id),
        columns = Math.ceil(Math.sqrt(ordered.length)), rows = Math.ceil(ordered.length / columns),
        center = tilePoint(this.map, tile), points = preferred ?? new Map<number, WorldPoint>();
      if (!preferred) for (let i = 0; i < ordered.length; i++) points.set(ordered[i].id, {
        x: Math.round(center.x + ((i % columns) - (columns - 1) / 2) * 1.25 * FIXED),
        y: Math.round(center.y + (Math.floor(i / columns) - (rows - 1) / 2) * 1.25 * FIXED),
      });
      let first = 0;
      const corridorId = this.nextId;
      let start=0;
      if(this.ports.priority?.(playerId)){
        // Publish one real lead route promptly. Other cohorts reuse its spine;
        // a single awkward follower cannot delay the selection's first motion.
        let lead=0;
        for(let i=1;i<ordered.length;i++)if(distanceSquared(ordered[i],center)<distanceSquared(ordered[lead],center))lead=i;
        ordered.unshift(ordered.splice(lead,1)[0]);
        if(!preferred)points.set(ordered[0].id,center);
        first=this.create(playerId,ordered.slice(0,1),tile,tick,points,structureTarget,corridorId);start=1;
      }
      for (; start < ordered.length; start += cohortSize) {
        const id = this.create(playerId, ordered.slice(start, start + cohortSize), tile, tick, points, structureTarget, corridorId);
        first ||= id;
      }
      return first;
    }
    return this.create(playerId, squads, tile, tick, preferred, structureTarget);
  }
  /** Re-admit an occupied destination while retaining later player intentions. */
  recoverDestination(squad: Squad, tile: number, tick: number): void {
    if (this.hasPending(squad.id)) return;
    const id = this.create(squad.playerId, [squad], tile, tick, undefined, squad.structureTarget ?? undefined);
    this.pending.get(id)!.members[0].queued = squad.queuedOrders.map(order=>({...order}));
    for (const intentId of this.intentsBySquad.get(squad.id) ?? []) {
      const intent = this.intents.get(intentId)!;
      for (const member of intent.members) if (member.id === squad.id && member.admissionId === undefined) {
        member.admissionId = id;
        this.addIntentReference(this.intentsByAdmission, id, intent.id);
      }
    }
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
    for (const intentId of this.intentsBySquad.get(squad.id) ?? []) {
      const intent = this.intents.get(intentId)!;
      for (const member of intent.members)
        if (member.id === squad.id && member.admissionId === undefined) {
          member.admissionId = id;
          this.addIntentReference(this.intentsByAdmission, id, intent.id);
        }
    }
    return id;
  }
  private create(
    playerId: number,
    squads: readonly Squad[],
    tile: number,
    tick: number,
    preferred?: Map<number, WorldPoint>,
    structureTarget?: Squad["structureTarget"],
    corridorId?: number,
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
      corridorId,
      playerId,
      generation: this.ports.generation(playerId),
      tile,
      revision: this.ports.revision(playerId),
      members: squads.map((s) => ({
        id: s.id,
        cursor: 0,
        requested: false,
        queued: [],
        ...(structureTarget ? { structureTarget: { ...structureTarget } } : {}),
      })),
      formation: formation.state,
      phase: "formation",
      member: 0,
    };
    this.pending.set(id, admission);
    for (const member of admission.members)
      this.pendingBySquad.set(member.id, id);
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
      this.pendingBySquad.get(squadId) === id
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
      member.limitedAttempts = 0;
      member.retryAt = undefined;
      if (member.shared?.stage === "entry") {
        member.shared.entry = path; member.shared.stage = "exit"; return;
      }
      member.path = member.shared ? [...member.shared.entry!, ...member.shared.spine.slice(1), ...path.slice(1)] : path;
      if (!member.shared && admission.corridorId === admission.id && member === admission.members[0])
        this.corridors.set(admission.id, { path, kind: this.ports.squad(member.id)!.kind, revision: admission.revision });
      member.shared = undefined;
      member.cursor = 0;
      member.connector = undefined;
    } else if (outcome === "unreachable" && member.shared) {
      // A shared corridor is an optimization, never proof that an individual
      // route is impossible. Try that member's ordinary exact route once.
      member.shared = undefined; member.independent = true;
    } else if (outcome === "unreachable")
      this.finish(
        admission,
        tick,
        "rejected",
        "A formation destination cannot be reached by land",
      );
    else if (outcome === "limited") {
      const retry = limitedRouteRetry(member.limitedAttempts ?? 0, tick);
      member.limitedAttempts = retry.attempts;
      if (retry.exhausted)
        this.finish(admission, tick, "rejected", ROUTE_CAPACITY_REASON);
      else member.retryAt = retry.retryAt;
    }
    // Resource exhaustion is an explicit planning rejection, never disconnection.
  }
  private addIntentReference(
    index: Map<number, Set<number>>,
    key: number,
    id: number,
  ): void {
    let ids = index.get(key);
    if (!ids) index.set(key, (ids = new Set()));
    ids.add(id);
  }
  private addIntent(intent: QueuedIntent): void {
    this.intents.set(intent.id, intent);
    for (const member of intent.members) {
      this.addIntentReference(this.intentsBySquad, member.id, intent.id);
      if (member.admissionId !== undefined)
        this.addIntentReference(
          this.intentsByAdmission,
          member.admissionId,
          intent.id,
        );
    }
  }
  private removeIntent(id: number): void {
    const intent = this.intents.get(id);
    if (!intent) return;
    this.intents.delete(id);
    for (const member of intent.members) {
      for (const [index, key] of [
        [this.intentsBySquad, member.id],
        [this.intentsByAdmission, member.admissionId],
      ] as const) {
        if (key === undefined) continue;
        const ids = index.get(key);
        ids?.delete(id);
        if (!ids?.size) index.delete(key);
      }
    }
  }
  private waitingIntent(admissionId: number): boolean {
    return !!this.intentsByAdmission.get(admissionId)?.size;
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
        this.removeIntent(id);
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
      const revision = this.ports.revision(intent.playerId);
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
          this.ports.hostile,
        );
      } else used++;
      if (intent.formation?.phase === "failed") {
        this.removeIntent(id);
        this.event(
          intent,
          tick,
          "rejected",
          "There is no room for a queued formation",
        );
        continue;
      }
      if (order.type === "move" && intent.formation?.phase !== "done") continue;
      this.removeIntent(id);
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
      this.event(intent, tick, "executed");
    }
    return used;
  }
  step(tick: number, budget = 128): number {
    if (!Number.isInteger(budget) || budget < 0)
      throw new Error("Invalid admission work budget");
    if (this.pending.size) this.occupancy.rebuild(this.ports.squads());
    let used = this.stepIntents(tick, Math.min(32, budget));
    // Reserve two thirds of the allowance for interactive commands. Unused work
    // returns to the ordinary round-robin, which continues serving the AI.
    used += this.stepAdmissions(tick, Math.floor((budget-used)*2/3), true);
    return used + this.stepAdmissions(tick, budget-used, false);
  }
  /** A fixed extra allowance for human input. Background work keeps its
   * ordinary allowance; no wall clock affects authoritative scheduling. */
  stepInteractive(tick:number,budget:number):number {
    if(!Number.isInteger(budget)||budget<0)throw new Error("Invalid interactive admission allowance");
    if(![...this.pending.values()].some(p=>this.ports.priority?.(p.playerId)))return 0;
    this.occupancy.rebuild(this.ports.squads());
    return this.stepAdmissions(tick,budget,true);
  }
  private stepAdmissions(tick: number, budget: number, priority: boolean): number {
    const validated = new Set<number>();
    let used = 0, idle = 0;
    while (this.pending.size && used < budget) {
      const entry = priority
        ? [...this.pending].find(([, admission]) => this.ports.priority?.(admission.playerId))
        : this.pending.entries().next().value;
      if (!entry) break;
      const [id, admission] = entry;
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
      if (admission.phase === "preparation") {
        const state = admission.preparation!;
        if (admission.revision !== this.ports.revision(admission.playerId)) {
          if ((admission.preparationRestarts ?? 0) >= 3) {
            this.preparationDiagnostics.rejected++;
            this.finish(admission, tick, "rejected", "Structure preparation dependencies kept changing"); used++; continue;
          }
          admission.preparationRestarts = (admission.preparationRestarts ?? 0) + 1;
          this.preparationDiagnostics.restarts++;
          const members = state.members.map(member => ({ ...member, origin: { x: this.ports.squad(member.id)!.x, y: this.ports.squad(member.id)!.y } }));
          admission.preparation = StructureAttackPreparation.create(admission.playerId, members, state.target);
          admission.preparation.consumed = state.consumed + 1;
          this.preparationDiagnostics.work++;
          admission.revision = this.ports.revision(admission.playerId);
          used++; continue;
        }
        const work = this.ports.prepareStructure!(state, Math.min(STRUCTURE_PREPARATION_LIMITS.quantum, budget - used));
        used += work; this.preparationDiagnostics.work += work; idle = 0;
        if (state.stage === "failed") {
          this.preparationDiagnostics.rejected++;
          this.finish(admission, tick, "rejected", state.reason);
        } else if (state.stage === "done") {
          const squads = admission.members.map(m => this.ports.squad(m.id)!);
          // The original allocator hands off to the same route/cohort policy.
          // Retire only this preparation, then attach every replacement plan to
          // its external receipt before publishing the preparation completion.
          this.pending.delete(id);
          for (const member of admission.members) this.pendingBySquad.delete(member.id);
          const activate = () => this.ports.activateStructure!(admission.playerId, squads, state.points, state.target);
          if (this.ports.handoffStructure) this.ports.handoffStructure(id, admission.playerId, activate);
          else activate();
          this.preparationDiagnostics.completed++;
          this.event(admission, tick, "executed");
        }
        continue;
      }
      if (admission.revision !== this.ports.revision(admission.playerId)) {
        if (admission.corridorId !== undefined) this.corridors.delete(admission.corridorId);
        const squads = admission.members.map((m) => this.ports.squad(m.id)!);
        const preferred = admission.formation.preferred;
        for (const member of admission.members) {
          this.ports.cancel(id, member.id);
          member.requested = false;
          member.path = undefined;
          member.shared = undefined;
          member.independent = undefined;
        }
        admission.formation = new FormationPlanning(
          this.map,
          this.paths,
          admission.tile,
          squads.map((squad) => ({ squad, origin: squad })),
          () => this.ports.squads(),
          Infinity,
          preferred,
        ).state;
        admission.revision = this.ports.revision(admission.playerId);
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
          undefined,
          this.occupancy,
        );
        used += formation.step(
          Math.min(16, budget - used),
          this.ports.blocked(admission.playerId),
          this.ports.hostile,
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
        // Nearby members share the first member's long corridor. Entry and
        // exit connectors retain exact obstacle checks under the same queue.
        const leader = admission.members[0], corridor = admission.corridorId === undefined ? undefined : this.corridors.get(admission.corridorId),
          original = admission.corridorId === undefined ? undefined : this.pending.get(admission.corridorId);
        if (original && original !== admission && !corridor &&
          this.ports.squad(leader.id)!.kind === this.ports.squad(original.members[0].id)!.kind) {
          if (++idle >= this.pending.size) break; continue;
        }
        if (!leader.path && leader.requested) { if (++idle >= this.pending.size) break; continue; }
        const member = admission.members.find(
          (m) => !m.path && !m.requested && (m.retryAt ?? 0) <= tick,
        );
        if (member) {
          const squad = this.ports.squad(member.id)!;
          if (member.shared?.stage !== "exit") member.start = pointTile(this.map, squad);
          const sharedCorridor = corridor?.revision === admission.revision && corridor.kind === squad.kind ? corridor.path : undefined,
            spine = sharedCorridor ?? leader.path;
          if ((member !== leader || sharedCorridor) && spine && spine !== member.path && spine.length >= 32 &&
            squad.kind === this.ports.squad(leader.id)!.kind && !member.independent && !member.shared &&
            this.map.euclideanDistSquared(member.start!, spine[0]) <= 32 ** 2 &&
            this.map.euclideanDistSquared(pointTile(this.map, member.destination!), spine[spine.length - 1]) <= 32 ** 2)
            member.shared = { stage: "entry", spine };
          const start = member.shared?.stage === "exit" ? member.shared.spine[member.shared.spine.length - 1] : member.start!,
            goal = member.shared?.stage === "entry" ? member.shared.spine[0] : pointTile(this.map, member.destination!);
          member.requested = this.ports.request(
            id,
            admission.playerId,
            member.id,
            start,
            goal,
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
                  m.structureTarget,
                ),
            )
          ) {
            if ((admission.placementRetries ?? 0) < 3) {
              admission.placementRetries = (admission.placementRetries ?? 0) + 1;
              const preferred = admission.formation.preferred;
              admission.formation = new FormationPlanning(this.map, this.paths, admission.tile,
                admission.members.map(m => { const squad = this.ports.squad(m.id)!; return { squad, origin: squad }; }),
                () => this.ports.squads(), Infinity, preferred).state;
              for (const m of admission.members) { m.path = undefined; m.start = undefined; m.shared = undefined; m.independent = undefined; m.cursor = 0; }
              admission.phase = "formation"; admission.member = 0;
            } else this.finish(admission, tick, "rejected", "Formation destination remains occupied");
            continue;
          }
          for (const m of admission.members) {
            this.ports.commit(
              this.ports.squad(m.id)!,
              m.destination!,
              m.path!,
              m.connector!,
              m.queued,
              m.structureTarget,
            );
            this.occupancy.refresh(this.ports.squad(m.id)!);
          }
          this.finish(admission, tick, "executed");
        }
      }
    }
    return used;
  }
}
