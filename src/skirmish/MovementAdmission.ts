import { translatedSlots } from "./FormationLine";
import type { GameMap } from "../core/game/GameMap";
import {
  FormationPlanning,
  type FormationPlanningState,
} from "./FormationPlanning";
import type { LandPaths } from "./Pathfinding";
import { FIXED, type Order, type Squad } from "./Protocol";
import type { ExactRouteOutcome } from "./RoutePlanner";
import { limitedRouteRetry, planningDeadline, ROUTE_CAPACITY_REASON } from "./RouteRetryPolicy";
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
  /** Consecutive planner refusals (P20); reset by an accepted request. */
  refusals?: number;
  retryAt?: number;
  queued: Order[];
  shared?: { stage: "entry" | "exit"; entry?: number[]; spine: number[] };
  independent?: boolean;
  /** D2: the bounded synchronous search failed; use planner jobs. */
  plannerOnly?: boolean;
  structureTarget?: Squad["structureTarget"];
  preview?: number[];
  previewTried?: boolean;
  join?: number;
}
interface Admission {
  deadline?:number;
  corridorId?: number;
  /** Independent human intentions share layout and route families, never cancellation. */
  groupId?: number;
  interrupted?: string;
  layout?: boolean;
  placementFailure?: string;
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
  /** Route passes that began beside a member yet found no clear connector. */
  connectorMisses?: number;
  routeCheck?: { revision: string; member: number; stage: 0 | 1; cursor: number; dropped: boolean };
}
interface QueuedIntent {
  placementFailure?: string;
  independent?: boolean;
  interrupted?: string;
  deadline?:number;
  id: number;
  playerId: number;
  generation: number;
  order: Order;
  members: { id: number; admissionId?: number; origin?: WorldPoint }[];
  revision: string;
  formation?: FormationPlanningState;
  travelLayout?: {
    members: { id: number; admissionId?: number; origin?: WorldPoint }[];
    origins: Map<number, WorldPoint>; index: number; sumX: number; sumY: number;
  };
}
export interface MovementAdmissionEvent {
  id: number;
  playerId: number;
  tick: number;
  status: "deferred" | "executed" | "rejected" | "superseded" | "progress";
  independent?: boolean;
  reason?: string;
  tile?: number;
}
export interface MovementAdmissionPorts {
  responsive?: boolean;
  preview?(squad: Squad, destination: WorldPoint, path: number[]): void;
  abortPreview?(squad: Squad, queued: readonly Order[]): void;
  deadlineTicks?(playerId:number):number|undefined;
  /** Experimental persistent group offsets for ordinary queued movement. */
  preserveQueuedLayout?: boolean;
  /** The route graph for a faction's squads (amphibious with transports). */
  paths?(playerId: number): LandPaths;
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
  /** D2: a bounded synchronous exact search for a member's short entry or
   * exit connector onto a cohort spine, on the member's own route graph and
   * obstacle mask. `path` starts at `start` (null when no route was found
   * within `limit` expansions); `work` is the expansions spent. */
  connector?(playerId: number, squadId: number, start: number, goal: number, limit: number): { path: number[] | null; work: number };
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

const CONNECTOR_REPLANS = 3;
/** Work an interactive admission pass may spend on human Shift intents. */
const INTERACTIVE_INTENT_BUDGET = 32;
/** D2 (R2-P3, notes 16 rec 2): one planner job per cohort. A member that
 * shares a cohort spine plans its short entry and exit connectors here, by a
 * bounded synchronous search, instead of filing two planner jobs; a member
 * whose whole move is within `directTiles` plans it the same way. A search
 * that hits `expansionLimit` falls back to planner jobs as before. The
 * per-tick budget bounds the synchronous work; when it is spent, members wait
 * for the next tick rather than queue planner jobs. Admission work is charged
 * one unit per `expansionsPerUnit` expansions. Not a balance value. */
export const COHORT_CONNECTORS = { expansionLimit: 1024, tickBudget: 4096, expansionsPerUnit: 64, directTiles: 32 } as const;
/** Owner decision D3 (P20): back-off after the route planner refuses an
 * admission's request because it is full: 2, 4, 8, then 16 ticks. */
export const ADMISSION_REFUSAL_BACKOFF = { firstTicks: 2, maximumTicks: 16 } as const;

/** Version 1 retains transactional cohorts. Version 2 allocates shared layout
 * then hands off to independently owned human intentions with reusable route
 * families and certified approach segments. All continuations are checkpointed.
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
  private handoffDeadline?: number;
  private creatingGroup?: number;
  /** Synchronous connector expansions spent in `connectorTick` (derived
   * per-tick scratch: it restarts every tick, so it is not checkpointed). */
  private connectorTick = -1;
  private connectorWork = 0;
  /** D2 diagnostics: connectors planned synchronously, and fallbacks. */
  readonly connectorDiagnostics = { synchronous: 0, fallbacks: 0, deferred: 0, work: 0 };
  private policyVersion = 1;
  get responsive(): boolean { return this.policyVersion >= 2; }
  private readonly families = new Map<number, {groupId:number; kind:Squad["kind"]; start:number; goal:number}>();
  private readonly corridors = new Map<number, { path: number[]; kind: Squad["kind"]; revision: string }>();
  /** An order onto land keeps its formation ashore; squads become afloat
   * only on the way or when ordered onto water itself. */
  private destination(formation: FormationPlanningState): void {
    if (this.map.isLand(formation.center)) formation.landSlots = true;
  }
  private pathsOf(playerId: number): LandPaths {
    return this.ports.paths?.(playerId) ?? this.paths;
  }
  previewEndpoint(squadId:number): WorldPoint | undefined {
    const a=this.pending.get(this.pendingBySquad.get(squadId)??-1),m=a?.members.find(m=>m.id===squadId);
    return m?.preview ? tilePoint(this.map,m.preview[m.preview.length-1]) : undefined;
  }
  onMemberProgress?: (squadId:number,tick:number,stage:"layout"|"prefix"|"route"|"commit"|"rejected")=>void;
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
  ) { this.policyVersion = ports.responsive ? 3 : 1; }
  checkpoint() {
    return structuredClone({
      pending: [...this.pending],
      intents: [...this.intents],
      nextId: this.nextId,
      events: this.events,
      corridors: [...this.corridors],
      ...(this.responsive ? {policyVersion: this.policyVersion, families: [...this.families]} : {}),
    });
  }
  restore(saved: ReturnType<MovementAdmission["checkpoint"]>): void {
    if (![1,2,3].includes(saved.policyVersion ?? 1)) throw Error("Unknown movement policy");
    this.policyVersion = saved.policyVersion ?? 1;
    this.families.clear();
    const size=this.map.width()*this.map.height();
    for (const [id,family] of structuredClone(saved.families??[])) {
      if(!Number.isSafeInteger(id)||id<1||this.families.has(id)||!Number.isSafeInteger(family.groupId)||family.groupId<1||
        !["infantry","archer","cavalry"].includes(family.kind)||![family.start,family.goal].every(t=>Number.isSafeInteger(t)&&t>=0&&t<size))
        throw Error("Invalid movement route family");
      this.families.set(id,family);
    }
    this.pending.clear();
    this.corridors.clear();
    for (const [id, corridor] of structuredClone(saved.corridors ?? [])) this.corridors.set(id, corridor);
    this.pendingBySquad.clear();
    for (const [id, admission] of structuredClone(saved.pending)) {
      FormationPlanning.normalizeCheckpoint(admission.formation);
      if(admission.groupId!==undefined && (!this.responsive || !Number.isSafeInteger(admission.groupId)||admission.groupId<1))throw Error("Invalid independent movement owner");
      for(const member of admission.members)if(member.preview!==undefined &&
        (admission.groupId===undefined || !Array.isArray(member.preview)||member.preview.length<2||member.preview.length>5||
          member.preview.some(t=>!Number.isSafeInteger(t)||t<0||t>=size)))throw Error("Invalid movement prefix");
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
    admission: Pick<Admission, "id" | "playerId"> & {tile?:number;groupId?:number},
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
      ...(admission.tile===undefined?{}:{tile:admission.tile}),
      ...(admission.groupId !== undefined || "independent" in admission && admission.independent ? {independent:true} : {}),
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
    if (admission.groupId !== undefined) {
      const remaining = [...this.pending.values()].filter(a => a.groupId === admission.groupId);
      if (!remaining.length) {
        for (const [id, family] of this.families) if (family.groupId === admission.groupId) {
          this.families.delete(id); this.corridors.delete(id);
        }
      } else if (this.families.has(admission.id) && !this.corridors.has(admission.id)) {
        const next = remaining.find(a => a.corridorId === admission.id);
        if (next) {
          const family = this.families.get(admission.id)!;
          this.families.delete(admission.id); this.families.set(next.id, family);
          family.start = pointTile(this.map, this.ports.squad(next.members[0].id)!);
          family.goal = pointTile(this.map, next.members[0].destination!);
          for (const a of remaining) if (a.corridorId === admission.id) a.corridorId = next.id;
        }
      }
    }
    if (admission.groupId === undefined && admission.corridorId !== undefined && ![...this.pending.values()].some(a => a.corridorId === admission.corridorId)) this.corridors.delete(admission.corridorId);
    for (const member of admission.members) {
      if (this.pendingBySquad.get(member.id) === admission.id)
        this.pendingBySquad.delete(member.id);
      this.ports.cancel(admission.id, member.id);
      const squad = this.ports.squad(member.id);
      if (status === "rejected") {
        this.onMemberProgress?.(member.id,tick,"rejected");
        if(member.preview && squad)this.ports.abortPreview?.(squad,member.queued);
      }
    }
    this.event(admission, tick, status === "executed" && admission.interrupted ? "superseded" : status, admission.interrupted ?? reason);
  }
  cancel(ids: readonly number[], tick: number, reason = "Replaced by a newer command"): void {
    const selected = new Set(ids);
    for (const [id, intent] of this.intents)
      if (intent.members.some((m) => selected.has(m.id))) {
        if (this.responsive && this.ports.priority?.(intent.playerId) && intent.members.some(m => !selected.has(m.id))) {
          const kept=intent.members.filter(m=>!selected.has(m.id));
          for(const m of intent.members)if(selected.has(m.id)){
            const refs=this.intentsBySquad.get(m.id);refs?.delete(id);if(!refs?.size)this.intentsBySquad.delete(m.id);
            if(m.admissionId!==undefined && !kept.some(k=>k.admissionId===m.admissionId)){
              const plans=this.intentsByAdmission.get(m.admissionId);plans?.delete(id);if(!plans?.size)this.intentsByAdmission.delete(m.admissionId);
            }
          }
          intent.members=kept;intent.interrupted??=reason;
          continue;
        }
        this.removeIntent(id);
        this.event(intent, tick, "superseded", reason);
      }
    for (const admission of this.pending.values())
      if (admission.members.some((m) => selected.has(m.id))) {
        if (admission.groupId !== undefined && admission.members.some(m => !selected.has(m.id))) {
          for (const m of admission.members) if (selected.has(m.id)) { this.pendingBySquad.delete(m.id); this.ports.cancel(admission.id,m.id); }
          admission.interrupted ??= reason;
          admission.members = admission.members.filter(m => !selected.has(m.id));
          const squads = admission.members.map(m => this.ports.squad(m.id)!);
          admission.formation = new FormationPlanning(this.map,this.pathsOf(admission.playerId),admission.tile,
            squads.map(squad=>({squad,origin:squad})),()=>this.ports.squads(),Infinity,admission.formation.preferred).state;
          this.destination(admission.formation); admission.phase = "formation";
        } else this.finish(admission, tick, "superseded", reason);
      }
  }
  private deadline(playerId:number,tick:number):{deadline?:number} {
    const value=planningDeadline(tick,this.ports.deadlineTicks?.(playerId));
    return value===undefined?{}:{deadline:value};
  }
  append(ids: readonly number[], order: Order, tick = 0): boolean {
    const selected = [...new Set(ids)],
      members = selected.map((id) => ({
        id,
        admissionId: this.pendingBySquad.get(id),
      }));
    if (!members.some((m) => m.admissionId !== undefined)) return false;
    if (selected.length > 30) {
      const travelLayout = this.ports.preserveQueuedLayout && order.type === "move"
        ? { members, origins: new Map<number, WorldPoint>(), index: 0, sumX: 0, sumY: 0 }
        : undefined;
      for (let start = 0; start < selected.length; start += 30) {
        const chunk = members.slice(start, start + 30), squad = this.ports.squad(chunk[0].id)!;
        const intent: QueuedIntent = { id: this.nextId++, playerId: squad.playerId,
          ...(this.responsive && this.ports.priority?.(squad.playerId)?{independent:true}:{}),
          ...this.deadline(squad.playerId,tick),
          generation: this.ports.generation(squad.playerId), order: { ...order }, members: chunk, travelLayout,
          revision: this.ports.revision(squad.playerId) };
        this.addIntent(intent); this.event(intent, tick, "deferred");
      }
      return true;
    }
    const squad = this.ports.squad(selected[0])!;
    const intent: QueuedIntent = {
      ...(this.responsive && this.ports.priority?.(squad.playerId)?{independent:true}:{}),
      ...this.deadline(squad.playerId,tick),
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
    const groupId = this.responsive && this.ports.priority?.(playerId) && !structureTarget ? this.nextId : undefined;
    const create = (members: readonly Squad[], points?: Map<number,WorldPoint>, corridorId?: number) => {
      this.creatingGroup = groupId;
      let id: number;
      try { id = this.create(playerId,members,tile,tick,points,structureTarget,corridorId); }
      finally { this.creatingGroup = undefined; }
      return id;
    };
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
        first=create(ordered.slice(0,1),points,corridorId);start=1;
      }
      for (; start < ordered.length; start += cohortSize) {
        const id = create(ordered.slice(start, start + cohortSize), points, corridorId);
        first ||= id;
      }
      return first;
    }
    return create(squads,preferred);
  }
  private assignFamily(admission: Admission): void {
    const member = admission.members[0], squad = this.ports.squad(member.id)!;
    const start = pointTile(this.map,squad), goal = pointTile(this.map,member.destination!);
    let familyId: number | undefined;
    for (const [id,family] of this.families) if (family.groupId === admission.groupId && family.kind === squad.kind &&
      this.map.euclideanDistSquared(start,family.start) <= 32**2 && this.map.euclideanDistSquared(goal,family.goal) <= 32**2) { familyId=id; break; }
    if (familyId === undefined) {
      familyId=admission.id; this.families.set(familyId,{groupId:admission.groupId!,kind:squad.kind,start,goal});
    }
    admission.corridorId=familyId;
  }
  private spawnMember(admission:Admission,member:Member,tick:number):void {
        const squad=this.ports.squad(member.id)!;
        this.creatingGroup=admission.groupId;
        let id:number;
        try { id=this.create(admission.playerId,[squad],admission.tile,tick,new Map([[member.id,member.destination!]])); }
        finally { this.creatingGroup=undefined; }
        const child=this.pending.get(id)!;
        child.members[0]=member; child.deadline=admission.deadline;
        child.formation.pending=child.formation.setup!.members;
        child.formation.setup=undefined;child.formation.selected.add(member.id);
        child.formation.consumed=new Set([member.id]);child.formation.index=1;
        child.formation.phase="done"; child.formation.result.set(member.id,member.destination!);
        child.phase="queued"; this.assignFamily(child);
        // Existing Shift intents now refer to this member's new planning owner.
        for (const intentId of this.intentsBySquad.get(member.id) ?? []) {
          const intent=this.intents.get(intentId)!;
          for (const m of intent.members) if(m.id===member.id && m.admissionId===admission.id) m.admissionId=id;
          this.addIntentReference(this.intentsByAdmission,id,intentId);
        }
  }
  private handoffMembers(admission:Admission,members:readonly Member[],tick:number):void {
    const activate=()=>{
      for(const member of members)this.spawnMember(admission,member,tick);
      const refs=this.intentsByAdmission.get(admission.id);
      if(refs)for(const intentId of refs)if(!this.intents.get(intentId)?.members.some(m=>m.admissionId===admission.id))refs.delete(intentId);
      if(!refs?.size)this.intentsByAdmission.delete(admission.id);
    };
    if(this.ports.handoffStructure)this.ports.handoffStructure(admission.id,admission.playerId,activate);else activate();
  }
  private splitLayout(admission: Admission,tick:number): void {
    if(admission.members.length===1){this.assignFamily(admission);admission.phase="queued";return;}
    this.pending.delete(admission.id);
    for(const m of admission.members)this.pendingBySquad.delete(m.id);
    this.handoffMembers(admission,admission.members,tick);
    this.event(admission,tick,admission.interrupted?"superseded":"executed",admission.interrupted);
  }
  /** Version 3 publishes each certified slot while its shared allocator keeps
   * working. An impossible slot cannot hold or cancel already placed members. */
  private publishLayout(admission:Admission,tick:number):void {
    const ready=admission.members.filter(m=>admission.formation.result.has(m.id));
    if(ready.length){
      for(const m of ready){m.destination=admission.formation.result.get(m.id)!;this.onMemberProgress?.(m.id,tick,"layout");this.pendingBySquad.delete(m.id);}
      admission.members=admission.members.filter(m=>!admission.formation.result.has(m.id));
      this.handoffMembers(admission,ready,tick);
    }
    if(admission.formation.phase==="failed"){
      const failed=admission.members.find(m=>m.id===admission.formation.member?.id);
      if(!failed){this.finish(admission,tick,"rejected","There is no room for this formation at that destination");return;}
      admission.placementFailure="A selected unit has no legal formation slot at that destination";
      admission.members=admission.members.filter(m=>m!==failed);
      this.pendingBySquad.delete(failed.id);this.ports.cancel(admission.id,failed.id);
      this.onMemberProgress?.(failed.id,tick,"rejected");
      this.cancel([failed.id],tick,admission.placementFailure);
      const state=admission.formation;state.selected.delete(failed.id);
      state.phase=state.result.size<state.selected.size?"slot":"done";
    }
    if(!admission.members.length)this.finish(admission,tick,admission.placementFailure?"rejected":"executed",admission.placementFailure);
  }
  /** Future Shift preparation may outlive the current member's route. Retain
   * its planned origin and move its queue reference onto the live squad. */
  private detachIntents(admission:Admission,member:Member):void {
    if(this.policyVersion<3 || admission.groupId===undefined)return;
    for(const intentId of this.intentsByAdmission.get(admission.id)??[]){
      const intent=this.intents.get(intentId);if(!intent)continue;
      for(const m of intent.members)if(m.id===member.id && m.admissionId===admission.id){m.origin=member.destination;m.admissionId=undefined;}
    }
    this.intentsByAdmission.delete(admission.id);
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
        this.pathsOf(playerId),
        tile,
        squads.map((squad) => ({ squad, origin: squad })),
        () => this.ports.squads(),
        Infinity,
        preferred,
      );
    this.destination(formation.state);
    const deadlineTicks = this.ports.deadlineTicks?.(playerId);
    if (deadlineTicks !== undefined && (!Number.isSafeInteger(deadlineTicks) || deadlineTicks < 1))
      throw Error("Invalid admission deadline");
    const admission: Admission = {
      ...(deadlineTicks === undefined ? {} : { deadline: this.handoffDeadline ?? tick + deadlineTicks }),
      id,
      corridorId,
      ...(this.creatingGroup === undefined ? {} : {groupId:this.creatingGroup,
        ...(this.policyVersion>=3 && squads.length>1 ? {layout:true} : {})}),
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
    this.priorityOrder?.ids.push(id);
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
      this.onMemberProgress?.(squadId,tick,"route");
      member.cursor = 0;
      member.join = undefined;
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
  /** Keeps every finished route that remains clear under the current revision
   * and re-requests the rest. Returns the work spent. */
  private retainRoutes(admission: Admission, budget: number): number {
    const blocked = this.ports.blocked(admission.playerId),
      revision = this.ports.revision(admission.playerId);
    if (admission.routeCheck?.revision !== revision) admission.routeCheck =
      { revision, member: 0, stage: 0, cursor: 0, dropped: false };
    const check = admission.routeCheck;
    let work = 0;
    while (work < budget) {
      const member = admission.members[check.member],
        corridor = admission.corridorId === undefined ? undefined : this.corridors.get(admission.corridorId),
        path = member ? check.stage === 0 ? member.shared?.spine : member.path
          : corridor?.revision === admission.revision ? corridor.path : undefined;
      // Include the preceding cell so a diagonal at a quantum boundary keeps
      // both corner checks. Path arrays are immutable after publication.
      const end = path ? Math.min(path.length, check.cursor + 63) : 0;
      const clear = !path || this.pathsOf(admission.playerId).routeClear(
        path.slice(Math.max(0, check.cursor - 1), end), blocked);
      work++;
      check.cursor = end;
      if (!clear) {
        if (!member) this.corridors.delete(admission.corridorId!);
        else if (check.stage === 0) {
          if (member.requested) this.ports.cancel(admission.id, member.id);
          member.requested = false;
          member.shared = undefined;
        } else {
          member.path = undefined; member.cursor = 0; check.dropped = true;
        }
      } else if (path && end < path.length) continue;
      check.cursor = 0;
      if (!member) {
        if (clear && corridor?.revision === admission.revision) corridor.revision = revision;
        if (check.dropped && admission.phase === "connectors") {
          admission.phase = "routes"; admission.member = 0;
        }
        admission.revision = revision;
        admission.routeCheck = undefined;
        break;
      }
      if (check.stage === 0) check.stage = 1;
      else { check.stage = 0; check.member++; }
    }
    return work;
  }
  /** D2: plans a spine member's entry and exit connectors synchronously.
   * `done` when the member now has its full path or waits for next tick's
   * connector budget; otherwise the bounded search failed and the member
   * files planner jobs as before. `units` is the admission work spent. */
  private synchronousConnectors(admission: Admission, member: Member, tick: number): { units: number; done: boolean } {
    if (this.connectorTick !== tick) { this.connectorTick = tick; this.connectorWork = 0; }
    if (this.connectorWork >= COHORT_CONNECTORS.tickBudget) {
      this.connectorDiagnostics.deferred++;
      member.retryAt = tick + 1;
      return { units: 1, done: true };
    }
    const limit = COHORT_CONNECTORS.expansionLimit, goal = pointTile(this.map, member.destination!);
    const spine = member.shared?.spine;
    const entry = this.ports.connector!(admission.playerId, member.id, member.start!, spine ? spine[0] : goal, limit);
    let work = entry.work;
    const exit = !spine ? { path: [goal], work: 0 } : entry.path && this.ports.connector!(admission.playerId, member.id, spine[spine.length - 1], goal, limit);
    work += exit?.work ?? 0;
    this.connectorWork += work;
    this.connectorDiagnostics.work += work;
    const units = 1 + Math.floor(work / COHORT_CONNECTORS.expansionsPerUnit);
    // The search work is charged; the planner request that follows adds its own unit.
    if (!entry.path || !exit?.path) { this.connectorDiagnostics.fallbacks++; return { units: units - 1, done: false }; }
    this.connectorDiagnostics.synchronous++;
    this.onMemberProgress?.(member.id,tick,"route");
    member.path = spine ? [...entry.path, ...spine.slice(1), ...exit.path.slice(1)] : entry.path;
    // A corridor lead publishes its route for the other cohorts, as completed() does.
    if (!spine && admission.corridorId === admission.id && member === admission.members[0])
      this.corridors.set(admission.id, { path: entry.path, kind: this.ports.squad(member.id)!.kind, revision: admission.revision });
    member.shared = undefined;
    member.cursor = 0;
    member.connector = undefined;
    member.limitedAttempts = 0;
    member.retryAt = undefined;
    member.refusals = undefined;
    return { units, done: true };
  }
  /** A locally certified approach is a partial execution, never proof that the
   * destination is reachable. It stops within two tiles while discovery runs. */
  private preview(admission:Admission,member:Member,tick:number):number {
    if(admission.groupId===undefined || member.previewTried || !this.ports.preview || !this.ports.connector)return 0;
    if(this.connectorTick!==tick){this.connectorTick=tick;this.connectorWork=0;}
    if(this.connectorWork>=COHORT_CONNECTORS.tickBudget)return 0;
    member.previewTried=true;
    const squad=this.ports.squad(member.id)!,destination=member.destination!,start=pointTile(this.map,squad),goal=pointTile(this.map,destination);
    if(this.map.euclideanDistSquared(start,goal)<=COHORT_CONNECTORS.directTiles**2)return 0;
    const dx=destination.x-squad.x,dy=destination.y-squad.y,length=Math.hypot(dx,dy);
    const end=pointTile(this.map,{x:Math.round(squad.x+dx/length*1.5*FIXED),y:Math.round(squad.y+dy/length*1.5*FIXED)});
    const result=this.ports.connector(admission.playerId,member.id,start,end,Math.min(128,COHORT_CONNECTORS.tickBudget-this.connectorWork));
    this.connectorWork+=result.work;this.connectorDiagnostics.work+=result.work;
    if(result.path && result.path.length>1 && result.path.length<=5 && result.path.every(tile=>this.map.euclideanDistSquared(start,tile)<=3**2) &&
      this.ports.clear(squad,tilePoint(this.map,end))){
      member.preview=result.path;this.ports.preview(squad,destination,result.path);
      this.onMemberProgress?.(member.id,tick,"prefix");this.event(admission,tick,"progress");
    }
    return 1+Math.floor(result.work/COHORT_CONNECTORS.expansionsPerUnit);
  }
  private waitingIntent(admissionId: number): boolean {
    return !!this.intentsByAdmission.get(admissionId)?.size;
  }
  private queueIntentMember(intent:QueuedIntent,m:QueuedIntent["members"][number]):void {
    const point=intent.formation?.result.get(m.id),order=intent.order;
    const next:Order=order.type==="move"&&point?{type:"move",tile:pointTile(this.map,point),...point}:{...order};
    if(m.admissionId!==undefined)this.pending.get(m.admissionId)!.members.find(member=>member.id===m.id)!.queued.push(next);
    else this.ports.queue(this.ports.squad(m.id)!,next);
    if(this.policyVersion>=3 && next.type==="move")for(const laterId of this.intentsBySquad.get(m.id)??[]){
      const later=this.intents.get(laterId)?.members.find(member=>member.id===m.id);
      if(later)later.origin=next.x===undefined?tilePoint(this.map,next.tile):{x:next.x,y:next.y!};
    }
  }
  private releaseIntentMember(intent:QueuedIntent,m:QueuedIntent["members"][number]):void {
    intent.members=intent.members.filter(member=>member!==m);
    const own=this.intentsBySquad.get(m.id);own?.delete(intent.id);if(!own?.size)this.intentsBySquad.delete(m.id);
    if(m.admissionId!==undefined && !intent.members.some(member=>member.admissionId===m.admissionId)){
      const refs=this.intentsByAdmission.get(m.admissionId);refs?.delete(intent.id);if(!refs?.size)this.intentsByAdmission.delete(m.admissionId);
    }
  }
  private stepIntents(tick: number, budget: number, priorityOnly = false): number {
    let used = 0;
    // A single FIFO preserves the order of Shift commands across overlapping
    // replacement cohorts. One formation owns all slots of each Shift selection.
    while (this.intents.size && used < budget) {
      const entry = priorityOnly && this.responsive
        ? [...this.intents].find(([,intent])=>this.ports.priority?.(intent.playerId))
        : this.intents.entries().next().value;
      if(!entry)break;
      const [id,intent]=entry;
      // The interactive pass serves the FIFO only while a human's intent is
      // at its head; order across players is unchanged.
      if (priorityOnly && !this.ports.priority?.(intent.playerId)) break;
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
      const layout = intent.travelLayout;
      if (layout && layout.index < layout.members.length) {
        // All placement cohorts share one translated layout. Capture its source
        // destinations incrementally so a large Shift selection stays budgeted.
        while (layout.index < layout.members.length && used < budget) {
          const m = layout.members[layout.index], squad = this.ports.squad(m.id);
          const pending = m.admissionId === undefined ? undefined : this.pending.get(m.admissionId);
          const member = pending?.members.find(candidate => candidate.id === m.id);
          if (pending && !member?.destination) { used++; break; }
          if (squad) {
            const orders = member?.queued ?? squad.queuedOrders;
            const last = orders[orders.length - 1] ?? (pending ? undefined : squad.order);
            const origin = last?.type === "move" ? last.x === undefined ? tilePoint(this.map,last.tile) : { x:last.x,y:last.y! }
              : member?.destination ?? m.origin ?? squad;
            layout.origins.set(m.id,{x:origin.x,y:origin.y});
            layout.sumX += origin.x; layout.sumY += origin.y;
          }
          layout.index++; used++;
        }
        if (layout.index < layout.members.length) break;
      }
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
              : (pending?.destination ?? m.origin ?? squad);
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
          this.pathsOf(intent.playerId),
          order.tile,
          members,
          () => this.ports.squads(),
          Infinity,
          layout ? new Map(members.map(m => {
            const origin = layout.origins.get(m.squad.id) ?? m.origin;
            const target = tilePoint(this.map,order.tile), count = Math.max(1,layout.origins.size);
            return [m.squad.id,{ x:Math.round(target.x+origin.x-layout.sumX/count), y:Math.round(target.y+origin.y-layout.sumY/count) }];
          })) : this.ports.preserveQueuedLayout ? translatedSlots(
            members.map(m => ({ id: m.squad.id, origin: m.origin })), tilePoint(this.map, order.tile),
          ) : undefined,
          undefined,
          additional,
        ).state;
        this.destination(intent.formation);
      }
      if (order.type === "move") {
        const formation = new FormationPlanning(
          this.map,
          this.pathsOf(intent.playerId),
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
      if(this.policyVersion>=3 && intent.independent && order.type==="move"){
        const state=intent.formation!;
        for(const m of [...intent.members])if(state.result.has(m.id)){
          this.queueIntentMember(intent,m);this.releaseIntentMember(intent,m);
        }
        if(state.phase==="failed"){
          const failed=intent.members.find(m=>m.id===state.member?.id);
          if(!failed)throw Error("Queued placement lost its failed member");
          intent.placementFailure="A selected unit has no legal queued formation slot";
          this.releaseIntentMember(intent,failed);state.selected.delete(failed.id);
          state.phase=state.result.size<state.selected.size?"slot":"done";
        }
        if(!intent.members.length){this.removeIntent(id);this.event(intent,tick,intent.placementFailure?"rejected":intent.interrupted?"superseded":"executed",intent.placementFailure??intent.interrupted);}
        continue;
      }
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
      for(const m of intent.members)this.queueIntentMember(intent,m);
      this.event(intent,tick,intent.interrupted?"superseded":"executed",intent.interrupted);
    }
    return used;
  }
  step(tick: number, budget = 128): number {
    if (!Number.isInteger(budget) || budget < 0)
      throw new Error("Invalid admission work budget");
    // An autonomous attempt includes preparation, queueing and every connector
    // retry. Finishing it leaves the squad's active order untouched.
    for (const intent of this.intents.values()) {
      const limit=this.ports.deadlineTicks?.(intent.playerId);
      if(limit===undefined)continue;
      intent.deadline??=planningDeadline(tick,limit);
      if(tick>=intent.deadline!) { this.removeIntent(intent.id);this.event(intent,tick,"rejected",ROUTE_CAPACITY_REASON); }
    }
    for(const admission of this.pending.values()) {
      const limit=this.ports.deadlineTicks?.(admission.playerId);
      if(limit===undefined)continue;
      admission.deadline??=planningDeadline(tick,limit); // Upgrade an older restored continuation.
      if(tick>=admission.deadline!)this.finish(admission,tick,"rejected",ROUTE_CAPACITY_REASON);
    }
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
    let waiting = false;
    for (const p of this.pending.values()) if (this.ports.priority?.(p.playerId)) { waiting = true; break; }
    if(!waiting)return 0;
    // A human move with Shift legs commits only after its queued intents are
    // attached; serving them only from the background step left such moves
    // waiting most of their admission time (Next #1). The interactive pass
    // now also advances human intents at the head of the FIFO.
    const used = this.stepIntents(tick, Math.min(INTERACTIVE_INTENT_BUDGET, budget), true);
    return used + this.stepAdmissions(tick,budget-used,true);
  }
  /** Diagnostics hook: observes each admission a step visits, before rotation. */
  onVisit?: (id: number, priority: boolean) => void;
  /** Priority-pass visiting order (R2-P6): the priority admissions' ids in
   * pending-map order. A visit rotates its entry to the map's end, and every
   * admission created during the call is appended there too, so the queue's
   * first live priority id is exactly the map's first priority entry. Stale
   * ids (finished admissions) are skipped lazily. O(P) per call, not O(P^2). */
  private priorityOrder?: { ids: number[]; head: number };
  private nextPriority(): [number, Admission] | undefined {
    const order = this.priorityOrder!;
    while (order.head < order.ids.length) {
      const id = order.ids[order.head++], admission = this.pending.get(id);
      if (admission && this.ports.priority?.(admission.playerId)) { order.ids.push(id); return [id, admission]; }
    }
    return undefined;
  }
  private stepAdmissions(tick: number, budget: number, priority: boolean): number {
    const previousOrder = this.priorityOrder;
    if (priority) {
      const ids: number[] = [];
      for (const [id, admission] of this.pending) if (this.ports.priority?.(admission.playerId)) ids.push(id);
      this.priorityOrder = { ids, head: 0 };
    } else this.priorityOrder = undefined;
    try { return this.stepAdmissionsWith(tick, budget, priority); }
    finally { this.priorityOrder = previousOrder; }
  }
  private stepAdmissionsWith(tick: number, budget: number, priority: boolean): number {
    const validated = new Set<number>();
    let used = 0, idle = 0;
    while (this.pending.size && used < budget) {
      const entry = priority
        ? this.nextPriority()
        : this.pending.entries().next().value;
      if (!entry) break;
      const [id, admission] = entry;
      this.onVisit?.(id, priority);
      this.pending.delete(id);
      this.pending.set(id, admission);
      // Full validation runs once per call; every visit still confirms each
      // member squad exists, so the member lookups below cannot dereference a
      // squad removed since validation.
      if (
        (!validated.has(id) &&
          admission.members.some((m) => !this.valid(id, m.id))) ||
        admission.members.some((m) => !this.ports.squad(m.id))
      ) {
        if(admission.groupId !== undefined && admission.members.length>1) this.cancel(admission.members.filter(m=>!this.valid(id,m.id)).map(m=>m.id),tick,"Control or selected units changed");
        else this.finish(admission,tick,"superseded","Control or selected units changed");
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
          const activate = () => {
            const previous = this.handoffDeadline;
            this.handoffDeadline = admission.deadline;
            try { this.ports.activateStructure!(admission.playerId, squads, state.points, state.target); }
            finally { this.handoffDeadline = previous; }
          };
          if (this.ports.handoffStructure) this.ports.handoffStructure(id, admission.playerId, activate);
          else activate();
          this.preparationDiagnostics.completed++;
          this.event(admission, tick, "executed");
        }
        continue;
      }
      if (admission.revision !== this.ports.revision(admission.playerId) &&
        admission.phase !== "formation") {
        // Permission/wall changes retire only affected paths. In-flight exact
        // searches observe the live mask and revalidate their own result.
        used += this.retainRoutes(admission, budget - used);
        if (admission.revision !== this.ports.revision(admission.playerId)) { idle = 0; continue; }
        if (used >= budget) continue;
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
          member.plannerOnly = undefined;
        }
        admission.formation = new FormationPlanning(
          this.map,
          this.pathsOf(admission.playerId),
          admission.tile,
          squads.map((squad) => ({ squad, origin: squad })),
          () => this.ports.squads(),
          Infinity,
          preferred,
        ).state;
        this.destination(admission.formation);
        admission.revision = this.ports.revision(admission.playerId);
        admission.phase = "formation";
        admission.member = 0;
      }
      if (admission.phase === "formation") {
        const formation = new FormationPlanning(
          this.map,
          this.pathsOf(admission.playerId),
          admission.tile,
          [],
          () => this.ports.squads(),
          Infinity,
          undefined,
          admission.formation,
          undefined,
        );
        used += formation.step(
          Math.min(16, budget - used),
          this.ports.blocked(admission.playerId),
          this.ports.hostile,
        );
        if(admission.layout){this.publishLayout(admission,tick);idle=0;continue;}
        if (formation.state.phase === "failed")
          this.finish(
            admission,
            tick,
            "rejected",
            "There is no room for this formation at that destination",
          );
        else if (formation.state.phase === "done") {
          for (const member of admission.members) {
            member.destination = formation.state.result.get(member.id)!;
            this.onMemberProgress?.(member.id,tick,"layout");
          }
          if(admission.groupId !== undefined) this.splitLayout(admission,tick);
          else admission.phase = "queued";
        }
        idle = 0;
      } else if (admission.phase === "queued") {
        used++;
        // Pending Shift intents gate only the commit (connectors phase): the
        // members' routes are planned meanwhile, so a move with queued legs
        // no longer waits for them before routing starts.
        if (!(this.policyVersion>=3 && admission.groupId!==undefined) && this.waitingIntent(admission.id) && admission.members.every((m) => !!m.path)) {
          if (++idle >= this.pending.size) break;
        } else {
          admission.phase = "routes";
          admission.member = 0;
          idle = 0;
        }
      } else if (admission.phase === "routes") {
        if(admission.groupId!==undefined){
          const m=admission.members[0];
          used=Math.min(budget,used+this.preview(admission,m,tick));
          if(used>=budget)continue;
        }
        if(admission.groupId!==undefined && admission.corridorId!==undefined &&
          !this.corridors.has(admission.corridorId) && !this.pending.has(admission.corridorId)){
          const old=admission.corridorId,family=this.families.get(old);
          if(family){
            this.families.delete(old);this.families.set(admission.id,family);
            family.start=pointTile(this.map,this.ports.squad(admission.members[0].id)!);
            family.goal=pointTile(this.map,admission.members[0].destination!);
            for(const other of this.pending.values())if(other.groupId===admission.groupId && other.corridorId===old)other.corridorId=admission.id;
          }
        }
        // Nearby members share the first member's long corridor. Entry and
        // exit connectors retain exact obstacle checks under the same queue.
        const leader = admission.members[0], corridor = admission.corridorId === undefined ? undefined : this.corridors.get(admission.corridorId),
          original = admission.corridorId === undefined ? undefined : this.pending.get(admission.corridorId);
        // A follower waits for the corridor lead's spine only while that lead
        // squad still exists; otherwise it plans its own route below.
        const originalLead = original && original !== admission ? this.ports.squad(original.members[0].id) : undefined,
          follower = this.ports.squad(leader.id);
        if (originalLead && follower && !corridor && follower.kind === originalLead.kind &&
          (admission.groupId === undefined || this.map.euclideanDistSquared(pointTile(this.map,follower),pointTile(this.map,originalLead)) <= 32**2 &&
            this.map.euclideanDistSquared(pointTile(this.map,leader.destination!),pointTile(this.map,original!.members[0].destination!)) <= 32**2 &&
            this.map.euclideanDistSquared(pointTile(this.map,follower),pointTile(this.map,leader.destination!)) > COHORT_CONNECTORS.directTiles**2)) {
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
          if (this.ports.connector && !member.independent && !member.plannerOnly && (member.shared?.stage === "entry" || !member.shared &&
            this.map.euclideanDistSquared(member.start!, pointTile(this.map, member.destination!)) <= COHORT_CONNECTORS.directTiles ** 2)) {
            const synchronous = this.synchronousConnectors(admission, member, tick);
            // Charged within this call's allowance: callers rely on step()
            // never returning more than its budget. The connector tick budget
            // bounds the search work itself.
            used = Math.min(budget, used + synchronous.units);
            if (synchronous.done) { idle = 0; continue; }
            member.plannerOnly = true;
            if (used >= budget) continue;
          }
          const start = member.shared?.stage === "exit" ? member.shared.spine[member.shared.spine.length - 1] : member.start!,
            goal = member.shared?.stage === "entry" ? member.shared.spine[0] : pointTile(this.map, member.destination!);
          member.requested = this.ports.request(
            id,
            admission.playerId,
            member.id,
            start,
            goal,
          );
          // P20: a refused request (planner full) waits 2, 4, 8, then 16
          // ticks before asking again, so a saturated planner no longer burns
          // the whole admission budget re-asking for the same member. Refusals
          // never count toward limited-route exhaustion.
          if (member.requested) member.refusals = undefined;
          else {
            member.refusals = (member.refusals ?? 0) + 1;
            member.retryAt = tick + Math.min(ADMISSION_REFUSAL_BACKOFF.maximumTicks,
              ADMISSION_REFUSAL_BACKOFF.firstTicks * 2 ** (member.refusals - 1));
          }
          used++;
          idle = 0;
        } else if (admission.members.every((m) => !!m.path)) {
          admission.phase = "connectors";
          admission.member = 0;
          used++;
          idle = 0;
        } else if (++idle >= this.pending.size) break;
      } else {
        if (!(this.policyVersion>=3 && admission.groupId!==undefined) && this.waitingIntent(admission.id)) {
          admission.phase = "queued";
          used++;
          continue;
        }
        const member = admission.members[admission.member],
          squad = this.ports.squad(member.id)!;
        let at = member.cursor++;
        let tile: number | undefined = member.path![at];
        used++;
        idle = 0;
        if(member.preview){
          const point=tile===undefined?undefined:tilePoint(this.map,tile);
          const nearby=point!==undefined && distanceSquared(squad,point)<=(3*FIXED)**2;
          if(nearby && this.ports.clear(squad,point!)){
            const previous=member.join===undefined?undefined:tilePoint(this.map,member.path![member.join]);
            if(!previous || distanceSquared(squad,point!)<=distanceSquared(squad,previous))member.join=at;
          }
          // A prefix can have carried the squad past the original route start.
          // Join the nearest certified point in the first local neighbourhood,
          // rather than ordering it backwards to the first point within 3 tiles.
          // Each point is charged; at most sixteen are inspected per handoff.
          if(tile!==undefined && at<15 && (nearby || member.join===undefined))continue;
          if(member.join!==undefined){at=member.join;tile=member.path![at];member.join=undefined;}
          else if(at>=15)tile=undefined;
        }
        if (tile === undefined) {
          // A unit wedged against terrain has no clear connector even to a
          // route that starts beside it. Bound that replanning instead of
          // spending the shared route allowance every tick. Units that merely
          // drifted while their old order ran keep replanning normally.
          const origin = tilePoint(this.map, member.path![0]);
          if (distanceSquared(squad, origin) <= (3 * FIXED) ** 2 &&
            (admission.connectorMisses = (admission.connectorMisses ?? 0) + 1) > CONNECTOR_REPLANS) {
            this.finish(admission, tick, "rejected", "A selected unit is wedged against impassable ground");
            continue;
          }
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
            stale.cursor = 0;stale.join=undefined;
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
              admission.formation = new FormationPlanning(this.map, this.pathsOf(admission.playerId), admission.tile,
                admission.members.map(m => { const squad = this.ports.squad(m.id)!; return { squad, origin: squad }; }),
                () => this.ports.squads(), Infinity, preferred).state;
              this.destination(admission.formation);
              for (const m of admission.members) { m.path = undefined; m.start = undefined; m.shared = undefined; m.independent = undefined; m.plannerOnly = undefined; m.cursor = 0; }
              admission.phase = "formation"; admission.member = 0;
            } else this.finish(admission, tick, "rejected", "Formation destination remains occupied");
            continue;
          }
          for (const m of admission.members) {
            this.detachIntents(admission,m);
            this.onMemberProgress?.(m.id,tick,"commit");
            this.ports.commit(
              this.ports.squad(m.id)!,
              m.destination!,
              m.path!,
              m.connector!,
              m.queued,
              m.structureTarget,
            );
          }
          this.finish(admission, tick, "executed");
        }
      }
    }
    return used;
  }
}
