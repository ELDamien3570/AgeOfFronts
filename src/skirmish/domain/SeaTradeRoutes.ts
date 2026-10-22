import type { GameMap } from "../../core/game/GameMap";
import type { WaterPaths } from "../Pathfinding";
import type { ExactRouteOutcome, ExactRouteRequest } from "../RoutePlanner";
import { domainRouteKey, type DomainRouteTask } from "./DomainRoutePorts";
import { SEA_TRADE_LIMITS, type AcquireResult, type LaneDemand, type LaneRecord,
  type LaneUse, type SeaLaneTask, type SeaRoutePorts, type SeaRoutesCheckpoint,
  type Subscription, type Holder } from "./SeaTradeTypes";
import { SeaWorkHeap, SeaWorkQueue } from "./SeaTradeWork";

type Limits = { records: number; packedCells: number; stagingCells: number;
  recoveryCells: number; recoveryRecords: number };
const laneKey = (revision: number, start: number, goal: number) =>
  `water:${revision}:${Math.min(start, goal)}:${Math.max(start, goal)}`;
const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** Simulation-local water geometry. No cargo, market or political authority. */
export class SeaTradeRoutes {
  private lanes = new Map<number, LaneRecord>();
  private keys = new Map<string, number>();
  private subscriptions = new Map<string, Subscription>();
  private members = new Map<number, Map<string, Subscription>>();
  private paidCounts = new Map<number, number>();
  private owners = new Map<number, Map<number, number>>();
  private retention = new Map<string, number[]>();
  private retainedBy = new Map<number, Set<string>>();
  private nextLaneId = 1;
  private nextSubscriptionId = 1;
  private packed = 0;
  private staged = 0;
  private recoveryTurn = 0;
  private lastRecoveryOwner = 0;
  private lastDepartureOwner = 0;
  private maintenanceTurn = 0;
  private maintenanceQueue = 0;
  private recordPressure = false;
  private readonly packing = new SeaWorkQueue<number>();
  private readonly memory = new SeaWorkQueue<number>();
  private readonly retiring = new SeaWorkQueue<number>();
  private readonly cleanup = new SeaWorkQueue<number>();
  private readonly requested = new SeaWorkQueue<number>();
  private readonly delayed = new SeaWorkHeap<number>((a, b) => {
    const x = this.lanes.get(a)!, y = this.lanes.get(b)!;
    return x.nextAttemptTick < y.nextAttemptTick || x.nextAttemptTick === y.nextAttemptTick && this.older(a, b);
  });
  private readonly victims = new SeaWorkHeap<number>((a, b) => {
    const x = this.lanes.get(a)!, y = this.lanes.get(b)!;
    const xr = this.retainedBy.has(a), yr = this.retainedBy.has(b);
    return xr !== yr ? !xr : x.lastUseTick < y.lastUseTick || x.lastUseTick === y.lastUseTick && a < b;
  });
  private readonly ready = [new Map<number, SeaWorkHeap<number>>(), new Map<number, SeaWorkHeap<number>>()];
  private readonly queuedOwner = new Map<number, { group: number; owner: number }>();
  onEvent?: (event: { type: "acquire" | "accepted" | "refused" | "ready" | "released"; tick: number; laneId: number;
    start: number; goal: number; firstDemandTick: number; selectedDemandTick?: number; subscriber?: string; holder?: Holder["type"]; kind?: Subscription["kind"]; ready?: boolean }) => void;
  readonly diagnostics = {
    acquisitions: 0, readyHits: 0, reversedHits: 0, requests: 0, accepted: 0,
    refused: 0, completed: 0, limited: 0, stale: 0, cancelled: 0,
    componentRejections: 0, stagingRefusals: 0, copyCancellations: 0, copied: 0, evicted: 0, allocationMs: 0,
    packedHighWater: 0, stagingHighWater: 0, recordHighWater: 0,
  };
  constructor(private readonly map: GameMap, private readonly water: WaterPaths,
    private readonly ports: () => SeaRoutePorts,
    private readonly tick: () => number,
    private readonly subscriptionCap: () => number,
    private readonly limits: Limits = SEA_TRADE_LIMITS) {}

  private older(a: number, b: number): boolean {
    const x = this.lanes.get(a)!, y = this.lanes.get(b)!;
    return x.firstDemandTick < y.firstDemandTick || x.firstDemandTick === y.firstDemandTick && a < b;
  }
  private task(lane: LaneRecord): SeaLaneTask {
    return { kind: "domain", owner: "sea-trade", playerId: lane.sponsorId,
      admissionId: lane.id, memberId: lane.key.hi, stage: "lane",
      generation: lane.key.revision, epoch: lane.epoch };
  }
  private paid(id: number): boolean {
    return (this.paidCounts.get(id) ?? 0) > 0;
  }
  committed(task: DomainRouteTask): boolean { return this.validRoute(task) && this.paid(task.admissionId); }
  private unschedule(id: number): void {
    this.delayed.remove(id);
    const old = this.queuedOwner.get(id);
    if (old) {
      const heap = this.ready[old.group].get(old.owner)!;
      heap.remove(id); if (!heap.size) this.ready[old.group].delete(old.owner);
      this.queuedOwner.delete(id);
    }
  }
  private schedule(lane: LaneRecord): void {
    this.unschedule(lane.id);
    if (lane.state !== "queued" || !lane.references) return;
    if (lane.nextAttemptTick > this.tick()) { this.delayed.update(lane.id); return; }
    const group = Number(this.paid(lane.id));
    // Bounded by the roster, independent of fleet/lane count.
    const owners = this.owners.get(lane.id)!;
    let chosen: number | undefined, wrapped: number | undefined;
    const after = lane.sponsorId;
    for (const owner of owners.keys()) {
      if (wrapped === undefined || owner < wrapped) wrapped = owner;
      if (owner > after && (chosen === undefined || owner < chosen)) chosen = owner;
    }
    const owner = chosen ?? wrapped!;
    let heap = this.ready[group].get(owner);
    if (!heap) { heap = new SeaWorkHeap((a, b) => this.older(a, b)); this.ready[group].set(owner, heap); }
    heap.update(lane.id); this.queuedOwner.set(lane.id, { group, owner });
  }
  acquire(demand: LaneDemand, tick = this.tick()): AcquireResult {
    if (![demand.start, demand.goal, demand.firstDemandTick, demand.owner].every(integer) ||
      demand.firstDemandTick > tick || demand.owner === 0) throw Error("Invalid sea lane demand");
    const key = laneKey(this.water.revision, demand.start, demand.goal);
    const old = this.subscriptions.get(demand.subscriberKey);
    if (old && (this.keys.get(key) !== old.laneId || old.owner !== demand.owner || old.kind !== demand.kind ||
      JSON.stringify(old.holder) !== JSON.stringify(demand.holder))) this.release(demand.subscriberKey);
    if (!this.water.connected(demand.start, demand.goal)) {
      this.diagnostics.componentRejections++; return { kind: "unreachable" };
    }
    let lane = this.lanes.get(this.keys.get(key) ?? -1);
    if (!this.subscriptions.has(demand.subscriberKey)) {
      if (this.subscriptions.size >= this.subscriptionCap()) return { kind: "capacity" };
      if (!lane) {
        const cap = this.limits.records - (demand.kind === "departure" ? this.limits.recoveryRecords : 0);
        if (this.lanes.size >= cap) { this.recordPressure = true; return { kind: "capacity" }; }
        lane = { id: this.nextLaneId++, key: { revision: this.water.revision,
          lo: Math.min(demand.start, demand.goal), hi: Math.max(demand.start, demand.goal) },
          epoch: 0, firstDemandTick: demand.firstDemandTick, nextAttemptTick: tick,
          attempts: 0, sponsorId: demand.owner, lastUseTick: tick, references: 0, state: "queued" };
        this.lanes.set(lane.id, lane); this.keys.set(key, lane.id);
        this.members.set(lane.id, new Map()); this.owners.set(lane.id, new Map());
        this.diagnostics.recordHighWater = Math.max(this.diagnostics.recordHighWater, this.lanes.size);
      }
      const sub: Subscription = { id: this.nextSubscriptionId++, key: demand.subscriberKey,
        laneId: lane.id, owner: demand.owner, kind: demand.kind, holder: demand.holder };
      this.subscriptions.set(sub.key, sub); this.members.get(lane.id)!.set(sub.key, sub);
      const owners = this.owners.get(lane.id)!; owners.set(sub.owner, (owners.get(sub.owner) ?? 0) + 1);
      if (sub.kind !== "departure") this.paidCounts.set(lane.id, (this.paidCounts.get(lane.id) ?? 0) + 1);
      lane.references++; this.victims.remove(lane.id); this.cleanup.remove(lane.id);
      this.diagnostics.acquisitions++;
      this.onEvent?.({ type: "acquire", tick, laneId: lane.id, start: demand.start, goal: demand.goal,
        firstDemandTick: lane.firstDemandTick, selectedDemandTick: demand.firstDemandTick, subscriber: sub.key, holder: sub.holder.type, kind: sub.kind, ready: lane.state === "ready" });
      if (lane.state === "ready") { this.diagnostics.readyHits++; if (demand.start === lane.key.hi && lane.key.lo !== lane.key.hi) this.diagnostics.reversedHits++; }
      this.schedule(lane);
    }
    if (!lane) throw Error("Missing sea subscription lane");
    if (lane.state === "ready") return { kind: "ready", use: { laneId: lane.id, reverse: demand.start !== lane.key.lo } };
    return { kind: "waiting", laneId: lane.id, cause: lane.state === "queued" ? "admission" :
      lane.state === "requested" || lane.state === "retiring" ? "search" : lane.state === "staging" ? "memory" : "packing" };
  }
  matchesPair(laneId: number, start: number, goal: number): boolean {
    const lane = this.lanes.get(laneId);
    return !!lane && lane.key.lo === Math.min(start, goal) && lane.key.hi === Math.max(start, goal);
  }
  peek(start: number, goal: number): LaneUse | undefined {
    const lane = this.lanes.get(this.keys.get(laneKey(this.water.revision, start, goal)) ?? -1);
    return lane?.state === "ready" ? { laneId: lane.id, reverse: start !== lane.key.lo } : undefined;
  }
  waitCause(id: number): "admission" | "search" | "packing" | "memory" | undefined {
    const lane = this.lanes.get(id); if (!lane) throw Error("Missing referenced sea lane");
    return lane.state === "ready" ? undefined : lane.state === "queued" ? "admission" :
      lane.state === "requested" || lane.state === "retiring" ? "search" : lane.state === "staging" ? "memory" : "packing";
  }
  markUsed(use: LaneUse, tick = this.tick()): void {
    const lane = this.lanes.get(use.laneId); if (lane?.state !== "ready") throw Error("Using unfinished sea lane");
    lane.lastUseTick = tick; if (!lane.references) this.victims.update(lane.id);
  }
  transfer(from: string, to: string, holder: Holder, kind?: Subscription["kind"]): void {
    const sub = this.subscriptions.get(from);
    if (!sub || from !== to && this.subscriptions.has(to)) throw Error("Invalid sea lane reference transfer");
    this.subscriptions.delete(from); this.members.get(sub.laneId)!.delete(from);
    if (kind && kind !== sub.kind) {
      const change = Number(kind !== "departure") - Number(sub.kind !== "departure");
      this.paidCounts.set(sub.laneId, (this.paidCounts.get(sub.laneId) ?? 0) + change);
      sub.kind = kind;
    }
    sub.key = to; sub.holder = holder;
    this.subscriptions.set(to, sub); this.members.get(sub.laneId)!.set(to, sub);
    this.schedule(this.lanes.get(sub.laneId)!);
  }
  release(key: string): void {
    const sub = this.subscriptions.get(key); if (!sub) return;
    const released = this.lanes.get(sub.laneId)!;
    this.onEvent?.({ type: "released", tick: this.tick(), laneId: released.id, start: released.key.lo, goal: released.key.hi,
      firstDemandTick: released.firstDemandTick, subscriber: key, holder: sub.holder.type, kind: sub.kind });
    this.subscriptions.delete(key); this.members.get(sub.laneId)!.delete(key);
    const owners = this.owners.get(sub.laneId)!, count = owners.get(sub.owner)! - 1;
    if (count) owners.set(sub.owner, count); else owners.delete(sub.owner);
    const lane = this.lanes.get(sub.laneId)!;
    if (sub.kind !== "departure") this.paidCounts.set(lane.id, this.paidCounts.get(lane.id)! - 1);
    if (--lane.references < 0) throw Error("Sea lane reference underflow");
    if (!lane.references) {
      this.unschedule(lane.id);
      if (lane.state === "ready") this.victims.update(lane.id);
      else this.cleanup.add(lane.id);
    } else this.schedule(lane);
  }
  retain(source: string, use: LaneUse): void {
    const rows = this.retention.get(source) ?? [];
    const old = rows.indexOf(use.laneId); if (old >= 0) rows.splice(old, 1);
    rows.push(use.laneId);
    if (rows.length > 2) this.unretain(source, rows.shift()!);
    this.retention.set(source, rows);
    let sources = this.retainedBy.get(use.laneId);
    if (!sources) { sources = new Set(); this.retainedBy.set(use.laneId, sources); }
    sources.add(source);
    if (this.victims.has(use.laneId)) this.victims.update(use.laneId);
  }
  private unretain(source: string, id: number): void {
    const sources = this.retainedBy.get(id); sources?.delete(source);
    if (!sources?.size) this.retainedBy.delete(id);
    if (this.victims.has(id)) this.victims.update(id);
  }
  retainSources(active: ReadonlySet<string>): void {
    for (const source of this.retention.keys()) {
      const [owner, tile] = source.split(":");
      if (!active.has(`${owner}:1:${tile}`)) this.releaseSource(source);
    }
  }
  releaseSource(source: string): void {
    for (const id of this.retention.get(source) ?? []) this.unretain(source, id);
    this.retention.delete(source);
  }
  tile(use: LaneUse, logicalIndex: number): number {
    const lane = this.lanes.get(use.laneId);
    if (lane?.state !== "ready" || !integer(logicalIndex) || logicalIndex >= lane.tiles.length) throw Error("Invalid sea lane cursor");
    return lane.tiles[use.reverse ? lane.tiles.length - 1 - logicalIndex : logicalIndex];
  }
  length(id: number): number {
    const lane = this.lanes.get(id); if (lane?.state !== "ready") throw Error("Unfinished sea lane"); return lane.tiles.length;
  }
  validRoute(task: DomainRouteTask): boolean {
    const lane = this.lanes.get(task.admissionId);
    return task.owner === "sea-trade" && task.stage === "lane" && !!lane &&
      lane.state === "requested" && lane.references > 0 && lane.epoch === task.epoch &&
      lane.sponsorId === task.playerId && lane.key.hi === task.memberId &&
      lane.key.revision === task.generation && lane.key.revision === this.water.revision;
  }
  completedRoute(task: DomainRouteTask, outcome: ExactRouteOutcome, input: number[]): void {
    const lane = this.lanes.get(task.admissionId);
    if (!lane || lane.epoch !== task.epoch || task.owner !== "sea-trade" ||
      task.stage !== "lane" || task.memberId !== lane.key.hi || task.generation !== lane.key.revision ||
      task.playerId !== lane.sponsorId || lane.state !== "requested" && lane.state !== "retiring") {
      this.diagnostics.stale++; return;
    }
    this.requested.remove(lane.id); this.retiring.remove(lane.id);
    if (lane.state === "retiring" || !lane.references) {
      if (lane.references) this.retry(lane); else this.remove(lane);
      return;
    }
    if (outcome === "unreachable") throw Error(`Connected water route reported unreachable: ${domainRouteKey(task)}`);
    if (outcome !== "complete") { if (outcome === "limited") this.diagnostics.limited++; this.retry(lane); return; }
    if (!input.length || input.length > this.map.width() * this.map.height() ||
      input[0] !== lane.key.lo || input[input.length - 1] !== lane.key.hi)
      throw Error("Invalid sea route completion envelope");
    if (this.staged + input.length > this.limits.stagingCells) { this.diagnostics.stagingRefusals++; this.retry(lane); return; }
    const next: LaneRecord = { ...this.base(lane), state: "staging", input };
    this.lanes.set(lane.id, next); this.staged += input.length;
    this.diagnostics.stagingHighWater = Math.max(this.diagnostics.stagingHighWater, this.staged);
    this.memory.add(lane.id); this.diagnostics.completed++;
  }
  private base(lane: LaneRecord) {
    return { id: lane.id, key: lane.key, epoch: lane.epoch, firstDemandTick: lane.firstDemandTick,
      nextAttemptTick: lane.nextAttemptTick, attempts: lane.attempts, sponsorId: lane.sponsorId,
      lastUseTick: lane.lastUseTick, references: lane.references };
  }
  private retry(lane: LaneRecord): void {
    const next: LaneRecord = { ...this.base(lane), state: "queued",
      nextAttemptTick: this.tick() + 2 ** Math.min(3, lane.attempts), attempts: lane.attempts + 1 };
    this.lanes.set(lane.id, next); this.schedule(next);
  }
  private remove(lane: LaneRecord): void {
    if (lane.references) throw Error("Evicting referenced sea lane");
    this.unschedule(lane.id); this.cleanup.remove(lane.id); this.requested.remove(lane.id);
    this.packing.remove(lane.id); this.memory.remove(lane.id); this.retiring.remove(lane.id); this.victims.remove(lane.id);
    if (lane.state === "ready") this.packed -= lane.tiles.length;
    if (lane.state === "packing") { this.packed -= lane.packing.output.length; this.staged -= lane.packing.input.length; }
    if (lane.state === "staging") this.staged -= lane.input.length;
    for (const source of this.retainedBy.get(lane.id) ?? []) {
      const rows = this.retention.get(source)!; rows.splice(rows.indexOf(lane.id), 1);
      if (!rows.length) this.retention.delete(source);
    }
    this.retainedBy.delete(lane.id); this.members.delete(lane.id); this.owners.delete(lane.id); this.paidCounts.delete(lane.id);
    this.keys.delete(laneKey(lane.key.revision, lane.key.lo, lane.key.hi)); this.lanes.delete(lane.id);
  }
  private evict(): boolean {
    const id = this.victims.pop(); if (id === undefined) return false;
    this.remove(this.lanes.get(id)!); this.diagnostics.evicted++; return true;
  }
  private maintenance(): boolean {
    let kind = -1;
    for (let checked = 0; checked < 5; checked++) {
      const next = this.maintenanceQueue; this.maintenanceQueue = (next + 1) % 5;
      if ([this.cleanup.size, this.retiring.size, this.memory.size, this.requested.size, Number(this.recordPressure)][next]) { kind = next; break; }
    }
    if (kind < 0) return false;
    if (kind === 4) { this.recordPressure = false; this.evict(); return true; }
    const id = kind === 0 ? this.cleanup.pop() : undefined;
    if (id !== undefined) {
      const lane = this.lanes.get(id)!;
      if (lane.references) return true;
      if (lane.state === "requested") {
        const next: LaneRecord = { ...this.base(lane), state: "retiring", requestedKey: lane.requestedKey };
        this.lanes.set(id, next); this.requested.remove(id); this.retiring.add(id);
        this.ports().cancel(this.task(next)); this.diagnostics.cancelled++;
      } else if (lane.state !== "retiring") this.remove(lane);
      return true;
    }
    const retired = kind === 1 ? this.retiring.pop() : undefined;
    if (retired !== undefined) {
      const lane = this.lanes.get(retired)!;
      if (lane.state !== "retiring") throw Error("Invalid retiring sea lane");
      if (this.ports().has(lane.requestedKey)) this.retiring.add(retired);
      else if (lane.references) this.retry(lane); else this.remove(lane);
      return true;
    }
    const memory = kind === 2 ? this.memory.pop() : undefined;
    if (memory !== undefined) {
      const lane = this.lanes.get(memory)!;
      if (lane.state !== "staging") throw Error("Invalid staged sea lane");
      if (!lane.references) { this.remove(lane); return true; }
      const cap = this.limits.packedCells - (this.paid(lane.id) ? 0 : this.limits.recoveryCells);
      if (this.packed + lane.input.length > cap) { this.evict(); this.memory.add(memory); return true; }
      const started = performance.now(), output = new Int32Array(lane.input.length);
      this.diagnostics.allocationMs += performance.now() - started;
      this.packed += output.length; this.diagnostics.packedHighWater = Math.max(this.diagnostics.packedHighWater, this.packed);
      this.lanes.set(memory, { ...this.base(lane), state: "packing", packing: { input: lane.input, output, offset: 0 } });
      this.packing.add(memory); return true;
    }
    const active = kind === 3 ? this.requested.pop() : undefined;
    if (active !== undefined) {
      const lane = this.lanes.get(active)!;
      if (lane.state !== "requested" || !this.ports().has(lane.requestedKey)) throw Error(`Lost sea route request: ${active}`);
      this.requested.add(active); return true;
    }
    return false;
  }
  private submit(): boolean {
    const due = this.delayed.first();
    if (due !== undefined && this.lanes.get(due)!.nextAttemptTick <= this.tick()) {
      this.delayed.remove(due); this.schedule(this.lanes.get(due)!); return true;
    }
    const group = this.ready[1].size && (!this.ready[0].size || this.recoveryTurn < 3) ? 1 : 0;
    const byOwner = this.ready[group];
    if (!byOwner.size) return false;
    const after = group ? this.lastRecoveryOwner : this.lastDepartureOwner;
    let owner: number | undefined, wrapped: number | undefined;
    for (const id of byOwner.keys()) {
      if (wrapped === undefined || id < wrapped) wrapped = id;
      if (id > after && (owner === undefined || id < owner)) owner = id;
    }
    owner ??= wrapped!;
    const id = byOwner.get(owner)!.first()!, lane = this.lanes.get(id)!;
    this.unschedule(id);
    if (group) this.lastRecoveryOwner = owner; else this.lastDepartureOwner = owner;
    this.recoveryTurn = group ? Math.min(3, this.recoveryTurn + 1) : 0;
    lane.sponsorId = owner; lane.epoch++;
    const task = this.task(lane); this.diagnostics.requests++;
    if (!this.ports().request(task, lane.key.lo, lane.key.hi, true)) {
      this.diagnostics.refused++;
      this.onEvent?.({ type: "refused", tick: this.tick(), laneId: lane.id, start: lane.key.lo, goal: lane.key.hi, firstDemandTick: lane.firstDemandTick });
      this.retry(lane); return true;
    }
    this.diagnostics.accepted++;
    this.onEvent?.({ type: "accepted", tick: this.tick(), laneId: lane.id, start: lane.key.lo, goal: lane.key.hi, firstDemandTick: lane.firstDemandTick });
    this.lanes.set(id, { ...this.base(lane), attempts: 0, state: "requested", requestedKey: domainRouteKey(task) });
    this.requested.add(id); return true;
  }
  stepManagement(budget: number): number {
    let used = 0;
    while (used < budget) {
      const maintenance = this.maintenanceTurn === 0; this.maintenanceTurn = 1 - this.maintenanceTurn;
      const worked = maintenance ? this.maintenance() || this.submit() : this.submit() || this.maintenance();
      if (!worked) break; used++;
    }
    return used;
  }
  private validateTile(lane: LaneRecord, input: ArrayLike<number>, index: number): void {
    const tile = input[index];
    if (!integer(tile) || tile >= this.map.width() * this.map.height() || !this.water.walkable(tile) ||
      index === 0 && tile !== lane.key.lo || index === input.length - 1 && tile !== lane.key.hi ||
      index > 0 && this.map.manhattanDist(input[index - 1], tile) !== 1) throw Error("Invalid sea lane geometry");
  }
  stepCopies(budget: number): number {
    let used = 0, copied = 0;
    while (used < budget && this.packing.size) {
      const id = this.packing.pop()!, lane = this.lanes.get(id)!;
      if (lane.state !== "packing") throw Error("Invalid sea packing work");
      if (!lane.references) { this.remove(lane); this.diagnostics.copyCancellations++; used++; continue; }
      const packing = lane.packing;
      this.validateTile(lane, packing.input, packing.offset);
      packing.output[packing.offset] = packing.input[packing.offset]; packing.offset++; used++; copied++;
      if (packing.offset === packing.input.length) {
        this.staged -= packing.input.length;
        this.lanes.set(id, { ...this.base(lane), state: "ready", tiles: packing.output });
        if (!lane.references) this.victims.update(id);
        this.onEvent?.({ type: "ready", tick: this.tick(), laneId: lane.id, start: lane.key.lo, goal: lane.key.hi, firstDemandTick: lane.firstDemandTick });
      } else this.packing.add(id);
    }
    this.diagnostics.copied += copied; return used;
  }
  checkpoint(): SeaRoutesCheckpoint {
    return structuredClone({ version: 1, waterRevision: this.water.revision,
      nextLaneId: this.nextLaneId, nextSubscriptionId: this.nextSubscriptionId,
      lanes: [...this.lanes.values()], subscriptions: [...this.subscriptions.values()].sort((a, b) => a.id - b.id),
      sourceRetention: [...this.retention],
      order: { packing: this.packing.values(), memory: this.memory.values(), retiring: this.retiring.values(), requested: this.requested.values(), cleanup: this.cleanup.values() },
      cursors: { recoveryTurn: this.recoveryTurn, lastRecoveryOwner: this.lastRecoveryOwner,
        lastDepartureOwner: this.lastDepartureOwner, maintenanceTurn: this.maintenanceTurn, maintenanceQueue: this.maintenanceQueue, recordPressure: this.recordPressure } });
  }
  restore(saved: SeaRoutesCheckpoint): void {
    validateSeaRoutesEnvelope(saved, true, this.map.width() * this.map.height(), this.limits);
    if (saved.waterRevision !== this.water.revision || saved.subscriptions.length > this.subscriptionCap()) throw Error("Invalid sea route revision or subscription count");
    this.lanes.clear(); this.keys.clear(); this.subscriptions.clear(); this.members.clear(); this.owners.clear(); this.paidCounts.clear();
    this.retention.clear(); this.retainedBy.clear(); this.delayed.clear(); this.victims.clear(); this.queuedOwner.clear();
    this.ready[0].clear(); this.ready[1].clear();
    for (const queue of [this.packing, this.memory, this.retiring, this.requested, this.cleanup]) queue.clear();
    this.packed = this.staged = 0;
    const s = structuredClone(saved);
    this.nextLaneId = s.nextLaneId; this.nextSubscriptionId = s.nextSubscriptionId;
    const cursors = s.cursors;
    if (![cursors.recoveryTurn, cursors.lastRecoveryOwner, cursors.lastDepartureOwner, cursors.maintenanceTurn, cursors.maintenanceQueue].every(integer) || typeof cursors.recordPressure !== "boolean" || cursors.recoveryTurn > 3 ||
      cursors.lastRecoveryOwner > 254 || cursors.lastDepartureOwner > 254 || cursors.maintenanceTurn > 1 || cursors.maintenanceQueue > 4) throw Error("Invalid sea service cursor");
    this.recoveryTurn = cursors.recoveryTurn; this.lastRecoveryOwner = cursors.lastRecoveryOwner;
    this.lastDepartureOwner = cursors.lastDepartureOwner; this.maintenanceTurn = cursors.maintenanceTurn; this.maintenanceQueue = cursors.maintenanceQueue; this.recordPressure = cursors.recordPressure;
    for (const lane of s.lanes) {
      if (![lane.id, lane.epoch, lane.firstDemandTick, lane.nextAttemptTick, lane.attempts, lane.sponsorId,
        lane.lastUseTick, lane.references, lane.key.revision, lane.key.lo, lane.key.hi].every(integer) ||
        lane.id === 0 || lane.id >= s.nextLaneId || lane.sponsorId === 0 || lane.sponsorId > 254 ||
        lane.firstDemandTick > this.tick() || lane.lastUseTick > this.tick() || lane.key.revision !== s.waterRevision ||
        lane.key.lo > lane.key.hi || !this.water.connected(lane.key.lo, lane.key.hi) || this.lanes.has(lane.id))
        throw Error("Invalid sea lane identity");
      const key = laneKey(lane.key.revision, lane.key.lo, lane.key.hi);
      if (this.keys.has(key)) throw Error("Duplicate sea lane geometry");
      if (lane.state === "ready") {
        for (let i = 0; i < lane.tiles.length; i++) this.validateTile(lane, lane.tiles, i);
        this.packed += lane.tiles.length;
      } else if (lane.state === "packing") {
        const p = lane.packing;
        if (!integer(p.offset) || p.offset >= p.output.length) throw Error("Invalid sea packing cursor");
        for (let i = 0; i < p.input.length; i++) {
          this.validateTile(lane, p.input, i);
          if (i < p.offset && p.output[i] !== p.input[i]) throw Error("Invalid copied sea prefix");
          if (i >= p.offset && p.output[i] !== 0) throw Error("Invalid uncopied sea suffix");
        }
        this.packed += p.output.length; this.staged += p.input.length;
      } else if (lane.state === "staging") {
        for (let i = 0; i < lane.input.length; i++) this.validateTile(lane, lane.input, i);
        this.staged += lane.input.length;
      } else if (lane.state === "requested" || lane.state === "retiring") {
        if (!lane.epoch || lane.requestedKey !== domainRouteKey(this.task(lane))) throw Error("Invalid sea requested key");
      } else if (lane.state !== "queued") throw Error("Unknown sea lane state");
      this.lanes.set(lane.id, lane); this.keys.set(key, lane.id);
      this.members.set(lane.id, new Map()); this.owners.set(lane.id, new Map());
    }
    const ids = new Set<number>();
    for (const sub of s.subscriptions) {
      const lane = this.lanes.get(sub.laneId);
      const holder = sub.holder;
      if (!lane || !integer(sub.id) || !sub.id || sub.id >= s.nextSubscriptionId || ids.has(sub.id) ||
        !integer(sub.owner) || !sub.owner || sub.owner > 254 || typeof sub.key !== "string" || !sub.key || this.subscriptions.has(sub.key) ||
        !["departure", "continuation", "return", "salvage"].includes(sub.kind) || !holder ||
        (holder.type === "source-demand" ? typeof holder.sourceKey !== "string" :
          !["actor-demand", "actor-leg", "actor-trail"].includes(holder.type) ||
          !integer(holder.actorId) || !integer(holder.shipmentId) || holder.type === "actor-trail" && (!integer(holder.trailIndex) || holder.trailIndex >= 8)))
        throw Error("Invalid sea subscription");
      ids.add(sub.id); this.subscriptions.set(sub.key, sub); this.members.get(lane.id)!.set(sub.key, sub);
      const owners = this.owners.get(lane.id)!; owners.set(sub.owner, (owners.get(sub.owner) ?? 0) + 1);
      if (sub.kind !== "departure") this.paidCounts.set(lane.id, (this.paidCounts.get(lane.id) ?? 0) + 1);
    }
    for (const [source, rows] of s.sourceRetention) {
      if (typeof source !== "string" || this.retention.has(source) || rows.length > 2 || new Set(rows).size !== rows.length) throw Error("Invalid sea source retention");
      for (const id of rows) {
        if (this.lanes.get(id)?.state !== "ready") throw Error("Invalid retained sea lane");
        let sources = this.retainedBy.get(id); if (!sources) { sources = new Set(); this.retainedBy.set(id, sources); }
        sources.add(source);
      }
      this.retention.set(source, rows);
    }
    const restoreQueue = (queue: SeaWorkQueue<number>, rows: number[], states: string[]) => {
      for (const id of rows) {
        const lane = this.lanes.get(id);
        if (!lane || queue.has(id) || !states.includes(lane.state)) throw Error("Invalid sea work queue");
        queue.add(id);
      }
    };
    restoreQueue(this.packing, s.order.packing, ["packing"]); restoreQueue(this.memory, s.order.memory, ["staging"]);
    restoreQueue(this.retiring, s.order.retiring, ["retiring"]); restoreQueue(this.requested, s.order.requested, ["requested"]);
    restoreQueue(this.cleanup, s.order.cleanup, ["queued", "requested", "staging", "packing"]);
    for (const lane of this.lanes.values()) {
      if (lane.references !== this.members.get(lane.id)!.size || this.cleanup.has(lane.id) && lane.references ||
        (lane.state === "packing") !== this.packing.has(lane.id) || (lane.state === "staging") !== this.memory.has(lane.id) ||
        (lane.state === "requested") !== this.requested.has(lane.id) || (lane.state === "retiring") !== this.retiring.has(lane.id))
        throw Error("Invalid sea lane reference or work membership");
      if (!lane.references && lane.state === "ready") this.victims.update(lane.id);
      else if (!lane.references && lane.state !== "retiring" && !this.cleanup.has(lane.id)) throw Error("Unscheduled abandoned sea lane");
      this.schedule(lane);
    }
  }
  get usage() { return { records: this.lanes.size, packedCells: this.packed, stagingCells: this.staged,
    subscriptions: this.subscriptions.size, victims: this.victims.size, queued: this.queuedOwner.size + this.delayed.size }; }
  validatePlannerLinks(requests: readonly ExactRouteRequest<unknown>[]): void {
    const active = new Map<string, ExactRouteRequest<DomainRouteTask>>();
    for (const request of requests) {
      const task = request.context as DomainRouteTask;
      if (task?.kind !== "domain" || task.owner !== "sea-trade") continue;
      const lane = this.lanes.get(task.admissionId);
      if (!lane || lane.state !== "requested" && lane.state !== "retiring" ||
        lane.requestedKey !== request.key || domainRouteKey(this.task(lane)) !== request.key ||
        task.generation !== lane.key.revision || task.playerId !== lane.sponsorId ||
        request.start !== lane.key.lo || request.goal !== lane.key.hi || !request.water ||
        request.amphibious || request.prepare || request.alternatives?.length)
        throw Error("Orphan sea planner request");
      active.set(request.key, request as ExactRouteRequest<DomainRouteTask>);
    }
    for (const lane of this.lanes.values()) if (lane.state === "requested" && !active.has(lane.requestedKey)) throw Error("Missing sea planner request");
  }
}

/** Size-only preflight before any whole-checkpoint clone. Semantic checks follow. */
export function validateSeaRoutesEnvelope(saved: SeaRoutesCheckpoint | undefined, enabled: boolean,
  cells: number, limits: Limits = SEA_TRADE_LIMITS): void {
  if (!enabled) { if (saved !== undefined) throw Error("Unexpected sea route state"); return; }
  if (!saved || saved.version !== 1 || !integer(saved.waterRevision) ||
    !integer(saved.nextLaneId) || !saved.nextLaneId || !integer(saved.nextSubscriptionId) || !saved.nextSubscriptionId ||
    !Array.isArray(saved.lanes) || saved.lanes.length > limits.records || !Array.isArray(saved.subscriptions) ||
    !Array.isArray(saved.sourceRetention) || saved.sourceRetention.length > limits.records * 2 || !saved.order || !saved.cursors)
    throw Error("Invalid sea route envelope");
  for (const rows of Object.values(saved.order)) if (!Array.isArray(rows) || rows.length > limits.records) throw Error("Oversized sea work queue");
  for (const entry of saved.sourceRetention) if (!Array.isArray(entry) || entry.length !== 2 ||
    typeof entry[0] !== "string" || !Array.isArray(entry[1]) || entry[1].length > 2) throw Error("Invalid sea retention envelope");
  let packed = 0, staged = 0;
  for (const lane of saved.lanes) {
    if (!lane || !lane.key) throw Error("Invalid sea lane envelope");
    const output = lane.state === "ready" ? lane.tiles : lane.state === "packing" ? lane.packing?.output : undefined;
    const input = lane.state === "staging" ? lane.input : lane.state === "packing" ? lane.packing?.input : undefined;
    if (output !== undefined) {
      if (!(output instanceof Int32Array) || !output.length || output.length > cells) throw Error("Invalid packed sea route size");
      packed += output.length;
    } else if (lane.state === "ready" || lane.state === "packing") throw Error("Missing sea route output");
    if (input !== undefined) {
      if (!Array.isArray(input) || !input.length || input.length > cells || output && output.length !== input.length) throw Error("Invalid staged sea route size");
      staged += input.length;
    } else if (lane.state === "staging" || lane.state === "packing") throw Error("Missing sea route input");
    if (packed > limits.packedCells || staged > limits.stagingCells) throw Error("Sea route payload exceeds limits");
  }
}
