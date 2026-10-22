import type { Building } from "../Protocol";
import { FIXED, TICKS_PER_SECOND } from "../Protocol";
import type { TradeActor } from "./Definitions";
import { TRADE_RULES } from "../content/Economy";
import { tradeDetailsChanged } from "./TradePublication";
import { chooseReadySeaPort, chooseSeaDiscovery, type SeaCandidate } from "./SeaTradePolicy";
import { SeaWorkQueue } from "./SeaTradeWork";
import { SeaTradePorts, validateSeaPortsMetadata, type SeaPortsCheckpoint } from "./SeaTradePorts";
import { SeaTradeRoutes, validateSeaRoutesEnvelope } from "./SeaTradeRoutes";
import type { LegCursor, SeaVoyage, SeaWait, LaneUse, SeaRoutesCheckpoint } from "./SeaTradeTypes";
import type { GameMap } from "../../core/game/GameMap";
import type { WaterPaths } from "../Pathfinding";
interface Dispatch { key: string; chosenActorId: number; receiverId: number; startTile: number; goalTile: number; requestedTick: number; laneId?: number; capacity?: boolean }
export interface SeaTradeCheckpoint {
  version: 1; routes: SeaRoutesCheckpoint; ports: SeaPortsCheckpoint;
  voyages: [number, SeaVoyage][]; dispatches: [string, Dispatch][]; mixedTurn: number; serviceTurn: number; demandRecoveryTurn: number; demandOrder: [string[], string[]]; salvageCursors: [number, number][];
}
interface VoyagePorts {
  map: GameMap; water: WaterPaths; tick(): number;
  building(id: number): Building | undefined;
  source(actor: TradeActor): Building | undefined;
  allowed(actor: TradeActor, receiver: Building, returning: boolean): boolean;
  intake(actor: TradeActor, receiver: Building): number;
  allied(a: number, b: number): boolean;
  commitLoad(actor: TradeActor, receiverId: number): boolean;
  ownedPorts(owner: number): readonly Building[];
}
const totals = () => ({ route: 0, intake: 0, handling: 0 });
const pendingKey = (id: number) => `actor:${id}:pending`;
const legKey = (id: number) => `actor:${id}:leg`;
const trailKey = (id: number, index: number) => `actor:${id}:trail:${index}`;
const dispatchKey = (actor: TradeActor) => `${actor.playerId}:${actor.originTile}`;
const publicWait: Record<SeaWait, TradeActor["waitingReason"]> = {
  cargo: "cargo", "shared-lane": "planning", admission: "capacity", search: "planning", packing: "planning",
  memory: "capacity", "market-intake": "capacity", "no-market": "unreachable", "no-owned-receiver": "no-receiver", handling: "handling",
};
/** Reverse only the visited prefix; the actor may still be between centers. */
export function seaReversePrefix(leg: LegCursor, length: number, startTile: number): LegCursor {
  if (!Number.isSafeInteger(length) || length < 1 || leg.next < 0 || leg.next > length) throw Error("Invalid sea prefix");
  return { laneId: leg.laneId, reverse: !leg.reverse, next: length - 1 - Math.max(0, leg.next - 1),
    end: length - 1, goalTile: startTile };
}

/** Economic subscribers and movement cursors; private to authoritative Trade. */
export class SeaTradeVoyages {
  readonly voyages = new Map<number, SeaVoyage>();
  private dispatches = new Map<string, Dispatch>();
  mixedTurn = 0;
  private serviceTurn = 0;
  private readonly demands = [new SeaWorkQueue<string>(), new SeaWorkQueue<string>()];
  private demandRecoveryTurn = 0;
  private readonly actorRefs = new Map<number, TradeActor>();
  onEvent?: (event: { type: "ready-eligible" | "departure" | "arrival" | "home" | "return";
    tick: number; actorId: number; shipmentId: number; kind?: "direct" | "retrace" | "legacy"; distanceTiles?: number }) => void;
  readonly diagnostics = { readyAttachChecks: 0, departures: 0, arrivals: 0, cycles: 0,
    directReturns: 0, retracedReturns: 0, legacyReturns: 0, salvageRequests: 0 };
  constructor(readonly routes: SeaTradeRoutes, readonly ports: SeaTradePorts, private readonly world: VoyagePorts) {}
  voyage(actor: TradeActor): SeaVoyage {
    this.actorRefs.set(actor.id, actor);
    let voyage = this.voyages.get(actor.id);
    if (!voyage) {
      voyage = { actorId: actor.id, shipmentId: actor.shipmentId, currentPortTile: actor.state === "prize" ? undefined : actor.originTile,
        trail: [], loadingWaits: totals(), tripWaits: totals(), preLoadWaitTicks: 0, legacyVoyage: false };
      this.voyages.set(actor.id, voyage);
    }
    return voyage;
  }
  private flush(voyage: SeaVoyage): void {
    const wait = voyage.wait; if (!wait) return;
    const elapsed = this.world.tick() - wait.since;
    if (elapsed < 0) throw Error("Future sea wait");
    const target = wait.loading ? voyage.loadingWaits : voyage.tripWaits;
    if (wait.cause === "handling") target.handling += elapsed;
    else if (wait.cause === "market-intake") target.intake += elapsed;
    else if (wait.cause !== "cargo") target.route += elapsed;
    voyage.wait = undefined;
  }
  setWait(actor: TradeActor, cause?: SeaWait): void {
    const voyage = this.voyage(actor), loading = actor.state === "loading";
    if (voyage.wait?.cause !== cause || voyage.wait?.loading !== loading) {
      this.flush(voyage);
      if (cause) voyage.wait = { cause, since: this.world.tick(), loading };
    }
    const reason = cause ? publicWait[cause] : undefined;
    const detail = cause === "market-intake" || cause === "no-market" ? cause : undefined;
    if (actor.waitingReason !== reason || actor.waitDetail !== detail) {
      tradeDetailsChanged(actor); actor.waitingReason = reason;
      if (detail) actor.waitDetail = detail; else delete actor.waitDetail;
    }
  }
  releaseActor(id: number): void {
    const voyage = this.voyages.get(id);
    this.routes.release(pendingKey(id)); this.routes.release(legKey(id));
    if (voyage) for (let i = 0; i < voyage.trail.length; i++) this.routes.release(trailKey(id, i));
    this.voyages.delete(id); this.actorRefs.delete(id); this.removeDemand(pendingKey(id));
    this.ports.releaseActor(id); this.salvageCursors.delete(id);
    // Source dispatch is owned by the source, so losing this courier cannot
    // cancel a useful shared request. The next idle courier can claim it.
  }
  private releaseTrail(actor: TradeActor, voyage: SeaVoyage): void {
    for (let i = 0; i < voyage.trail.length; i++) this.routes.release(trailKey(actor.id, i));
    voyage.trail = []; voyage.returnSpans = undefined; voyage.returnSpanIndex = undefined;
  }
  private clearPending(actor: TradeActor): void {
    this.routes.release(pendingKey(actor.id)); this.removeDemand(pendingKey(actor.id)); this.voyage(actor).pending = undefined;
  }
  private leg(actor: TradeActor, use: LaneUse, receiver: Building): void {
    const voyage = this.voyage(actor);
    this.routes.transfer(pendingKey(actor.id), legKey(actor.id), { type: "actor-leg", actorId: actor.id, shipmentId: actor.shipmentId }, actor.cargo > 0 || actor.state !== "loading" ? "continuation" : "departure");
    voyage.leg = { ...use, next: 0, end: this.routes.length(use.laneId) - 1,
      goalTile: this.routes.tile(use, this.routes.length(use.laneId) - 1) };
    voyage.pending = undefined; this.removeDemand(pendingKey(actor.id)); actor.path = []; actor.nextPathIndex = 0;
    actor.destination = receiver.id; this.routes.markUsed(use); this.setWait(actor);
  }
  private acquire(actor: TradeActor, receiver: Building, start: number, goal: number, kind: "departure" | "continuation" | "return" | "salvage") {
    const voyage = this.voyage(actor), old = voyage.pending;
    const requestTick = old?.receiverId === receiver.id && old.startTile === start && old.goalTile === goal && old.kind === kind ? old.requestTick : this.world.tick();
    voyage.pending = { kind, receiverId: receiver.id, startTile: start, goalTile: goal,
      owner: actor.playerId, shipmentId: actor.shipmentId, requestTick };
    const unchanged = old?.receiverId === receiver.id && old.startTile === start && old.goalTile === goal && old.kind === kind;
    if (unchanged && old.laneId !== undefined) voyage.pending.laneId = old.laneId;
    else { this.routes.release(pendingKey(actor.id)); this.removeDemand(pendingKey(actor.id)); }
    if (!this.routes.peek(start, goal)) {
      if (voyage.pending.laneId !== undefined) this.setWait(actor, this.routes.waitCause(voyage.pending.laneId) ?? "shared-lane");
      else { this.addDemand(pendingKey(actor.id)); this.setWait(actor, voyage.wait?.cause === "memory" ? "memory" : "admission"); }
      return { kind: "waiting" as const, laneId: voyage.pending.laneId, cause: "admission" as const };
    }
    const result = this.routes.acquire({ subscriberKey: pendingKey(actor.id), owner: actor.playerId, kind,
      start, goal, firstDemandTick: requestTick, holder: { type: "actor-demand", actorId: actor.id, shipmentId: actor.shipmentId } });
    if (result.kind === "waiting") { voyage.pending.laneId = result.laneId; this.setWait(actor, result.cause); }
    else if (result.kind === "capacity") { this.addDemand(pendingKey(actor.id)); this.setWait(actor, "memory"); }
    else if (result.kind === "ready") { voyage.pending.laneId = result.use.laneId; this.removeDemand(pendingKey(actor.id)); }
    return result;
  }
  private checksTick = -1;
  begin(actor: TradeActor, loading: boolean): void {
    if (this.checksTick !== this.world.tick()) { this.checksTick = this.world.tick(); this.diagnostics.readyAttachChecks = 0; }
    const voyage = this.voyage(actor), start = this.tile(actor), component = this.world.water.component[start];
    if (actor.state === "returning") { this.startReturn(actor); return; }
    if (actor.state === "prize") { this.salvage(actor); return; }
    if (!loading) {
      voyage.continuationStartedTick ??= this.world.tick();
      if (this.world.tick() - voyage.continuationStartedTick >= 5 * TICKS_PER_SECOND) { this.startReturn(actor); return; }
    }
    const view = this.ports.view(actor.id, actor.playerId, voyage.currentPortTile ?? actor.originTile, component);
    const pending = loading ? this.dispatches.get(dispatchKey(actor)) : voyage.pending;
    const pendingReceiver = pending && this.world.building(pending.receiverId);
    const candidates = this.ports.candidates(view, pendingReceiver && this.world.allowed(actor, pendingReceiver, false) ? pendingReceiver.id : undefined);
    const live: SeaCandidate[] = [], eligible: (SeaCandidate & { intakeAvailable: boolean })[] = [];
    let intakeBlocked = false;
    for (const candidate of candidates) {
      this.diagnostics.readyAttachChecks++;
      const receiver = this.world.building(candidate.receiverId);
      if (!receiver || !this.world.allowed(actor, receiver, false)) continue;
      const intakeAvailable = this.world.intake(actor, receiver) > 0;
      eligible.push({ ...candidate, intakeAvailable });
      if (!intakeAvailable) { intakeBlocked = true; continue; }
      live.push(candidate);
    }
    const reusable = eligible.flatMap(row => {
      const use = this.routes.peek(start, row.berth);
      return use ? [{ ...row, use, steps: this.routes.length(use.laneId) - 1, allied: this.world.allied(actor.playerId, row.owner) }] : [];
    });
    const ready = chooseReadySeaPort(reusable.filter(row => row.intakeAvailable), view.lastCommittedPortTile);
    // A full intake window does not make already-known geometry cold. Wait
    // for its refill instead of manufacturing a speculative replacement search.
    if (!ready && reusable.length) { this.setWait(actor, "market-intake"); return; }
    if (!ready && !loading) {
      // Allow the bounded catalog to publish its first descriptors; never
      // create a fresh geometry demand for an optional extra paid stop.
      if (!candidates.length && !view.passComplete) { this.setWait(actor, "shared-lane"); return; }
      this.startReturn(actor); return;
    }
    let candidate: SeaCandidate | undefined = ready;
    if (!candidate) {
      // Intake is economic state, not a geometry invalidation. Keep the
      // selected pair through saturation when no usable ready alternative exists.
      const existing = pending && candidates.find(row => row.receiverId === pending.receiverId && row.berth === pending.goalTile &&
        !!pendingReceiver && this.world.allowed(actor, pendingReceiver, false));
      candidate = existing ?? chooseSeaDiscovery(live.filter(row => view.nearest.some(n => n.receiverId === row.receiverId))
        .map(row => ({ ...row, allied: this.world.allied(actor.playerId, row.owner) })), view.lastCommittedPortTile)
        ?? chooseSeaDiscovery(live.map(row => ({ ...row, allied: this.world.allied(actor.playerId, row.owner) })), view.lastCommittedPortTile);
    }
    if (!candidate) {
      if (!loading || !pendingReceiver || !this.world.allowed(actor, pendingReceiver, false)) {
        this.clearPending(actor);
        if (loading) { this.routes.release(`source:${dispatchKey(actor)}`); this.removeDemand(`source:${dispatchKey(actor)}`); this.dispatches.delete(dispatchKey(actor)); }
      }
      if (!loading && (view.passComplete || intakeBlocked)) { this.startReturn(actor); return; }
      this.setWait(actor, intakeBlocked ? "market-intake" : view.passComplete ? "no-market" : "shared-lane"); return;
    }
    const receiver = this.world.building(candidate.receiverId)!;
    if (loading && !this.routes.peek(start, candidate.berth)) {
      const key = dispatchKey(actor), old = this.dispatches.get(key);
      if (!old || old.startTile === start || !this.world.building(old.receiverId)) {
        if (old && (old.goalTile !== candidate.berth || old.startTile !== start)) { this.routes.release(`source:${key}`); this.removeDemand(`source:${key}`); }
        const dispatch = old?.goalTile === candidate.berth && old.startTile === start ? old :
          { key, chosenActorId: actor.id, receiverId: receiver.id, startTile: start, goalTile: candidate.berth, requestedTick: this.world.tick() };
        dispatch.receiverId = receiver.id; dispatch.chosenActorId = actor.id;
        this.dispatches.set(key, dispatch);
        if (dispatch.laneId === undefined) { this.addDemand(`source:${key}`); this.setWait(actor, dispatch.capacity ? "memory" : "admission"); }
        else this.setWait(actor, this.routes.waitCause(dispatch.laneId) ?? "shared-lane");
      } else this.setWait(actor, "shared-lane");
      return;
    }
    const result = this.acquire(actor, receiver, start, candidate.berth, loading ? "departure" : "continuation");
    if (result.kind !== "ready") {
      if (!loading && (result.kind === "capacity" || voyage.wait?.cause === "memory" || this.world.tick() - voyage.pending!.requestTick >= 5 * TICKS_PER_SECOND)) this.startReturn(actor);
      return;
    }
    if (!this.world.allowed(actor, receiver, false)) { this.clearPending(actor); return; }
    if (this.world.intake(actor, receiver) <= 0) { this.setWait(actor, "market-intake"); return; }
    if (loading) {
      this.onEvent?.({ type: "ready-eligible", tick: this.world.tick(), actorId: actor.id, shipmentId: actor.shipmentId });
      this.flush(voyage);
      if (!this.world.commitLoad(actor, receiver.id)) { this.clearPending(actor); return; }
      voyage.shipmentId = actor.shipmentId; voyage.legacyVoyage = false;
      voyage.tripWaits = voyage.loadingWaits; voyage.loadingWaits = totals();
      voyage.preLoadWaitTicks = voyage.tripWaits.route + voyage.tripWaits.intake + voyage.tripWaits.handling;
      voyage.currentPortTile = actor.originTile;
      this.routes.release(`source:${dispatchKey(actor)}`); this.removeDemand(`source:${dispatchKey(actor)}`); this.dispatches.delete(dispatchKey(actor));
      this.diagnostics.departures++;
      this.onEvent?.({ type: "departure", tick: this.world.tick(), actorId: actor.id, shipmentId: actor.shipmentId });
    }
    this.leg(actor, result.use, receiver); actor.state = "outbound";
    view.lastCommittedPortTile = receiver.tile;
    if (loading) {
      this.routes.retain(`${actor.playerId}:${actor.originTile}:${component}`, result.use);
      this.ports.rememberSource(view, receiver.id);
    }
    tradeDetailsChanged(actor);
    if (loading) this.setWait(actor, "handling");
  }
  outwardArrival(actor: TradeActor, receiver: Building): void {
    const voyage = this.voyage(actor);
    if (!voyage.leg || voyage.trail.length >= TRADE_RULES.maximumStops) throw Error("Missing outward sea leg");
    const index = voyage.trail.length;
    this.routes.transfer(legKey(actor.id), trailKey(actor.id, index),
      { type: "actor-trail", actorId: actor.id, shipmentId: actor.shipmentId, trailIndex: index });
    voyage.trail.push({ laneId: voyage.leg.laneId, reverse: voyage.leg.reverse }); voyage.leg = undefined;
    voyage.currentPortTile = receiver.tile; voyage.continuationStartedTick = undefined; this.diagnostics.arrivals++;
    this.onEvent?.({ type: "arrival", tick: this.world.tick(), actorId: actor.id, shipmentId: actor.shipmentId });
  }
  startReturn(actor: TradeActor): void {
    const voyage = this.voyage(actor), source = this.world.source(actor);
    if (!source) { this.releaseActor(actor.id); actor.state = "prize"; actor.destination = null; this.salvage(actor); return; }
    if (voyage.returnSpans || actor.state === "returning" && voyage.leg) { actor.destination = source.id; return; }
    if (voyage.pending?.kind !== "return") this.clearPending(actor);
    const start = this.tile(actor), component = this.world.water.component[start], goal = this.ports.berth(source, component);
    const direct = goal === undefined ? undefined : this.routes.peek(start, goal);
    if (direct) {
      const result = this.acquire(actor, source, start, goal!, "return");
      if (result.kind !== "ready") throw Error("Ready sea return lost");
      this.routes.release(legKey(actor.id)); this.releaseTrail(actor, voyage);
      this.leg(actor, result.use, source); actor.state = "returning"; if (voyage.legacyVoyage) this.diagnostics.legacyReturns++; else this.diagnostics.directReturns++;
      this.onEvent?.({ type: "return", tick: this.world.tick(), actorId: actor.id, shipmentId: actor.shipmentId, kind: voyage.legacyVoyage ? "legacy" : "direct", distanceTiles: this.returnDistance(actor, [voyage.leg!]) }); return;
    }
    if (voyage.legacyVoyage) {
      this.routes.release(legKey(actor.id)); voyage.leg = undefined; this.releaseTrail(actor, voyage);
      if (goal === undefined) { this.setWait(actor, "no-owned-receiver"); return; }
      const result = this.acquire(actor, source, start, goal, "return");
      if (result.kind === "ready") { this.leg(actor, result.use, source); actor.state = "returning"; this.diagnostics.legacyReturns++;
        this.onEvent?.({ type: "return", tick: this.world.tick(), actorId: actor.id, shipmentId: actor.shipmentId, kind: "legacy", distanceTiles: this.returnDistance(actor, [voyage.leg!]) }); }
      return;
    }
    const spans: LegCursor[] = [];
    if (voyage.leg) {
      const leg = voyage.leg;
      spans.push(seaReversePrefix(leg, this.routes.length(leg.laneId), this.routes.tile(leg, 0)));
    }
    for (let i = voyage.trail.length - 1; i >= 0; i--) {
      const use = voyage.trail[i]; spans.push({ laneId: use.laneId, reverse: !use.reverse, next: 0,
        end: this.routes.length(use.laneId) - 1, goalTile: this.routes.tile(use, 0) });
    }
    if (!spans.length) {
      if (!voyage.legacyVoyage) throw Error("Sea voyage has no known return");
      if (goal === undefined) { this.setWait(actor, "no-owned-receiver"); return; }
      const result = this.acquire(actor, source, start, goal, "return");
      if (result.kind === "ready") { this.leg(actor, result.use, source); actor.state = "returning"; this.diagnostics.legacyReturns++;
        this.onEvent?.({ type: "return", tick: this.world.tick(), actorId: actor.id, shipmentId: actor.shipmentId, kind: "legacy", distanceTiles: this.returnDistance(actor, [voyage.leg!]) }); }
      return;
    }
    voyage.returnSpans = spans; voyage.returnSpanIndex = 0;
    actor.state = "returning"; actor.destination = source.id; actor.path = []; actor.nextPathIndex = 0;
    this.setWait(actor); tradeDetailsChanged(actor); this.diagnostics.retracedReturns++;
    this.onEvent?.({ type: "return", tick: this.world.tick(), actorId: actor.id, shipmentId: actor.shipmentId, kind: "retrace", distanceTiles: this.returnDistance(actor, spans) });
  }
  private returnDistance(actor: TradeActor, spans: readonly LegCursor[]): number {
    const tile = this.routes.tile(spans[0], spans[0].next);
    const first = Math.hypot(actor.x - (this.world.map.x(tile) + .5) * FIXED, actor.y - (this.world.map.y(tile) + .5) * FIXED) / FIXED;
    return first + spans.reduce((sum, span) => sum + Math.max(0, span.end - span.next), 0);
  }
  private salvageCursors = new Map<number, number>();
  private salvage(actor: TradeActor): void {
    const voyage = this.voyage(actor), start = this.tile(actor), component = this.world.water.component[start];
    const old = voyage.pending, prior = old && this.world.building(old.receiverId);
    let receiver = prior && this.world.allowed(actor, prior, true) ? prior : undefined;
    let goal = receiver ? this.ports.berth(receiver, component) : undefined;
    if (!receiver || goal === undefined || !this.routes.peek(start, goal)) {
      const rows = this.world.ownedPorts(actor.playerId), cursor = this.salvageCursors.get(actor.id) ?? 0;
      let fallback: { receiver: Building; goal: number } | undefined;
      for (let i = 0; i < Math.min(8, rows.length); i++) {
        const port = rows[(cursor + i) % rows.length], berth = this.ports.berth(port, component);
        if (berth === undefined || !this.world.allowed(actor, port, true)) continue;
        fallback ??= { receiver: port, goal: berth };
        if (this.routes.peek(start, berth)) { receiver = port; goal = berth; break; }
      }
      if ((!receiver || goal === undefined) && fallback) { receiver = fallback.receiver; goal = fallback.goal; }
      this.salvageCursors.set(actor.id, rows.length ? (cursor + 8) % rows.length : 0);
    }
    if (!receiver || goal === undefined) { this.clearPending(actor); this.setWait(actor, "no-owned-receiver"); return; }
    const result = this.acquire(actor, receiver, start, goal, "salvage");
    if (result.kind === "ready") { this.leg(actor, result.use, receiver); tradeDetailsChanged(actor); }
  }
  private tile(actor: TradeActor): number {
    return this.world.map.ref(Math.max(0, Math.min(this.world.map.width() - 1, Math.floor(actor.x / FIXED))),
      Math.max(0, Math.min(this.world.map.height() - 1, Math.floor(actor.y / FIXED))));
  }
  nextWaypoint(actor: TradeActor): number | undefined {
    const voyage = this.voyage(actor);
    if (voyage.returnSpans) {
      let index = voyage.returnSpanIndex ?? 0;
      for (let joins = 0; joins < 9 && index < voyage.returnSpans.length; joins++) {
        const span = voyage.returnSpans[index];
        if (span.next <= span.end) { voyage.returnSpanIndex = index; return this.routes.tile(span, span.next); }
        index++; voyage.returnSpanIndex = index;
        const next = voyage.returnSpans[index];
        if (next && next.next === 0) {
          const tile = this.routes.tile(next, 0);
          if (actor.x === (this.world.map.x(tile) + .5) * FIXED && actor.y === (this.world.map.y(tile) + .5) * FIXED) next.next++;
        }
      }
      if (index < voyage.returnSpans.length) throw Error("Too many sea return spans");
      return undefined;
    }
    const leg = voyage.leg;
    return leg && leg.next <= leg.end ? this.routes.tile(leg, leg.next) : undefined;
  }
  reachedWaypoint(actor: TradeActor): void {
    const voyage = this.voyage(actor), span = voyage.returnSpans?.[voyage.returnSpanIndex ?? 0] ?? voyage.leg;
    if (!span) throw Error("Missing sea movement cursor"); span.next++;
  }
  quote(actor: TradeActor): { cycleTicks: number; handlingTicks: number; routeWaitTicks: number; receivingWaitTicks: number; travelTicks: number } | undefined {
    const voyage = this.voyage(actor); if (voyage.legacyVoyage) return undefined;
    this.flush(voyage);
    const cycleTicks = Math.max(1, this.world.tick() - (actor.tripStartedTick ?? this.world.tick()) + (actor.tripSupplyTicks ?? 0) + voyage.preLoadWaitTicks);
    const handlingTicks = voyage.tripWaits.handling, routeWaitTicks = voyage.tripWaits.route, receivingWaitTicks = voyage.tripWaits.intake;
    const travelTicks = cycleTicks - (actor.tripSupplyTicks ?? 0) - handlingTicks - routeWaitTicks - receivingWaitTicks;
    if (travelTicks < 0) throw Error("Sea cycle wait accounting overflow");
    return { cycleTicks, handlingTicks, routeWaitTicks, receivingWaitTicks, travelTicks };
  }
  home(actor: TradeActor): void {
    const voyage = this.voyage(actor);
    this.routes.release(legKey(actor.id)); this.releaseTrail(actor, voyage); this.clearPending(actor);
    voyage.leg = undefined; voyage.continuationStartedTick = undefined; voyage.tripWaits = totals(); voyage.currentPortTile = actor.originTile;
    actor.path = []; actor.nextPathIndex = 0; this.diagnostics.cycles++;
    this.onEvent?.({ type: "home", tick: this.world.tick(), actorId: actor.id, shipmentId: actor.shipmentId });
  }
  private recoveryDemand(key: string): boolean {
    return key.startsWith("actor:") && this.voyages.get(Number(key.split(":")[1]))?.pending?.kind !== "departure";
  }
  private addDemand(key: string): void {
    const group = Number(this.recoveryDemand(key)); this.demands[1 - group].remove(key); this.demands[group].add(key);
  }
  private removeDemand(key: string): void { this.demands[0].remove(key); this.demands[1].remove(key); }
  private hasDemand(key: string): boolean { return this.demands[0].has(key) || this.demands[1].has(key); }
  private nextDemand(): string | undefined {
    const recovery = this.demands[1].size && (!this.demands[0].size || this.demandRecoveryTurn < 3);
    const key = this.demands[Number(!!recovery)].pop();
    if (key !== undefined) this.demandRecoveryTurn = recovery ? Math.min(3, this.demandRecoveryTurn + 1) : 0;
    return key;
  }
  private stepDemand(): number {
    const key = this.nextDemand(); if (key === undefined) return 0;
    if (key.startsWith("source:")) {
      const dispatch = this.dispatches.get(key.slice(7)); if (!dispatch) return 1;
      const actor = this.actorRefs.get(dispatch.chosenActorId), receiver = this.world.building(dispatch.receiverId);
      if (!actor || actor.state !== "loading" || dispatchKey(actor) !== dispatch.key || this.tile(actor) !== dispatch.startTile) {
        this.addDemand(key); return 1;
      }
      if (!receiver || !this.world.allowed(actor, receiver, false)) {
        this.routes.release(key); this.dispatches.delete(dispatch.key); return 1;
      }
      const result = this.routes.acquire({ subscriberKey: key, owner: actor.playerId, kind: "departure", start: dispatch.startTile,
        goal: dispatch.goalTile, firstDemandTick: dispatch.requestedTick, holder: { type: "source-demand", sourceKey: dispatch.key } });
      if (result.kind === "waiting") { dispatch.laneId = result.laneId; delete dispatch.capacity; }
      else if (result.kind === "ready") { dispatch.laneId = result.use.laneId; delete dispatch.capacity; }
      else if (result.kind === "capacity") { dispatch.capacity = true; this.addDemand(key); }
      else this.dispatches.delete(dispatch.key);
      return 1;
    }
    const id = Number(key.split(":")[1]), actor = this.actorRefs.get(id), voyage = this.voyages.get(id), pending = voyage?.pending;
    if (!actor || !pending || pending.laneId !== undefined) return 1;
    const receiver = this.world.building(pending.receiverId);
    if (!["departure", "continuation", "return", "salvage"].includes(pending.kind) || !Number.isSafeInteger(pending.receiverId) || pending.receiverId <= 0 ||
          pending.owner !== actor.playerId || pending.shipmentId !== actor.shipmentId || this.tile(actor) !== pending.startTile ||
      !receiver || !this.world.allowed(actor, receiver, pending.kind === "return" || pending.kind === "salvage")) {
      this.clearPending(actor); return 1;
    }
    const result = this.routes.acquire({ subscriberKey: key, owner: actor.playerId, kind: pending.kind,
      start: pending.startTile, goal: pending.goalTile, firstDemandTick: pending.requestTick,
      holder: { type: "actor-demand", actorId: id, shipmentId: actor.shipmentId } });
    if (result.kind === "waiting") { pending.laneId = result.laneId; this.setWait(actor, result.cause); }
    else if (result.kind === "ready") pending.laneId = result.use.laneId;
    else if (result.kind === "capacity") { this.addDemand(key); this.setWait(actor, "memory"); }
    else this.clearPending(actor);
    return 1;
  }
  stepManagement(budget: number): number {
    let used = 0;
    while (used < budget) {
      const demands = this.serviceTurn === 0; this.serviceTurn = 1 - this.serviceTurn;
      const work = demands ? this.stepDemand() || this.routes.stepManagement(1) : this.routes.stepManagement(1) || this.stepDemand();
      if (!work) break; used++;
    }
    return used;
  }
  probe(actor: TradeActor) {
    const voyage = this.voyages.get(actor.id), view = this.ports.actorView(actor.id), start = this.tile(actor);
    const dispatch = actor.state === "loading" ? this.dispatches.get(dispatchKey(actor)) : undefined;
    const pending = dispatch ?? voyage?.pending, receiver = pending && this.world.building(pending.receiverId);
    const rows = view ? this.ports.candidates(view, receiver && this.world.allowed(actor, receiver, false) ? receiver.id : undefined) : [];
    const ready = rows.some(row => {
      const receiver = this.world.building(row.receiverId);
      return !!receiver && this.world.allowed(actor, receiver, false) && this.world.intake(actor, receiver) > 0 && !!this.routes.peek(start, row.berth);
    });
    return { cause: voyage?.wait?.cause, since: voyage?.wait?.since,
      pending: voyage?.pending ?? (dispatch && { ...dispatch, kind: "departure", owner: actor.playerId }),
      leg: voyage?.leg && { ...voyage.leg }, trailLength: voyage?.trail.length ?? 0, ready,
      legacyVoyage: voyage?.legacyVoyage ?? false, returnSpans: voyage?.returnSpans?.length ?? 0 };
  }
  redirect(actor: TradeActor, other?: number): void {
    const voyage = this.voyages.get(actor.id), dispatch = this.dispatches.get(dispatchKey(actor));
    const target = voyage?.pending?.receiverId ?? dispatch?.receiverId;
    if (other !== undefined && (target === undefined || this.world.building(target)?.playerId !== other)) return;
    if (actor.state !== "loading") { this.startReturn(actor); return; }
    this.routes.release(`source:${dispatchKey(actor)}`); this.removeDemand(`source:${dispatchKey(actor)}`); this.dispatches.delete(dispatchKey(actor));
    this.releaseActor(actor.id); this.setWait(actor);
  }
  maintainSources(active: ReadonlySet<string>, idle: ReadonlySet<string>): void {
    for (const [key] of this.dispatches) {
      const [owner, tile] = key.split(":").map(Number);
      if (!active.has(`${owner}:1:${tile}`) || !idle.has(`${owner}:1:${tile}`)) { this.routes.release(`source:${key}`); this.removeDemand(`source:${key}`); this.dispatches.delete(key); }
    }
    this.routes.retainSources(active); this.ports.retainSources(active);
  }
  restore(saved: SeaTradeCheckpoint, actors: readonly TradeActor[]): void {
    if (saved.version !== 1 || !Number.isSafeInteger(saved.mixedTurn) || saved.mixedTurn < 0 || saved.mixedTurn > 1) throw Error("Invalid sea trade checkpoint");
    this.routes.restore(saved.routes); this.ports.restore(saved.ports);
    this.voyages.clear(); this.dispatches.clear(); this.actorRefs.clear(); this.demands[0].clear(); this.demands[1].clear(); this.salvageCursors.clear(); this.mixedTurn = saved.mixedTurn;
    if (!Number.isInteger(saved.serviceTurn) || saved.serviceTurn < 0 || saved.serviceTurn > 1 || !Array.isArray(saved.demandOrder) || saved.demandOrder.length !== 2 || !Number.isInteger(saved.demandRecoveryTurn) || saved.demandRecoveryTurn < 0 || saved.demandRecoveryTurn > 3) throw Error("Invalid sea demand order");
    this.serviceTurn = saved.serviceTurn; this.demandRecoveryTurn = saved.demandRecoveryTurn;
    const live = new Map(actors.filter(actor => actor.naval).map(actor => [actor.id, actor]));
    const subscriptions = new Map(saved.routes.subscriptions.map(sub => [sub.key, sub]));
    const used = new Set<string>();
    const pin = (key: string, laneId: number, actor: TradeActor, type: "actor-leg" | "actor-trail" | "actor-demand", index?: number) => {
      const sub = subscriptions.get(key), holder = sub?.holder;
      if (!sub || sub.laneId !== laneId || sub.owner !== actor.playerId || !holder || holder.type !== type ||
        holder.actorId !== actor.id || holder.shipmentId !== actor.shipmentId ||
        holder.type === "actor-trail" && holder.trailIndex !== index) throw Error("Invalid sea voyage reference");
      used.add(key);
    };
    const cursor = (span: LegCursor) => {
      const length = this.routes.length(span.laneId);
      if (typeof span.reverse !== "boolean" || !Number.isSafeInteger(span.next) || span.next < 0 ||
        !Number.isSafeInteger(span.end) || span.end < 0 || span.end >= length || span.next > span.end + 1 ||
        span.goalTile !== this.routes.tile(span, span.end)) throw Error("Invalid sea voyage cursor");
    };
    for (const [id, original] of saved.voyages) {
      const actor = live.get(id), voyage = structuredClone(original);
      if (!actor || id !== voyage.actorId || voyage.shipmentId !== actor.shipmentId || this.voyages.has(id) ||
        ![actor.x, actor.y].every(value => Number.isSafeInteger(value) && value >= 0) || actor.x >= this.world.map.width() * FIXED || actor.y >= this.world.map.height() * FIXED ||
        actor.path.length || actor.nextPathIndex !== 0 || typeof voyage.legacyVoyage !== "boolean" || voyage.trail.length > 8 || (voyage.returnSpans?.length ?? 0) > 9 ||
        ![voyage.loadingWaits.route, voyage.loadingWaits.intake, voyage.loadingWaits.handling, voyage.tripWaits.route, voyage.tripWaits.intake, voyage.tripWaits.handling, voyage.preLoadWaitTicks]
          .every(n => Number.isSafeInteger(n) && n >= 0)) throw Error("Invalid sea voyage");
      if (voyage.currentPortTile !== undefined && (!Number.isSafeInteger(voyage.currentPortTile) || voyage.currentPortTile < 0 ||
        voyage.currentPortTile >= this.world.map.width() * this.world.map.height())) throw Error("Invalid sea current port");
      if (!voyage.legacyVoyage && actor.state !== "loading" && actor.state !== "prize" && !voyage.leg && !voyage.trail.length)
        throw Error("Sea voyage has no known return geometry");
      if (voyage.wait && (!Object.prototype.hasOwnProperty.call(publicWait, voyage.wait.cause) || !Number.isSafeInteger(voyage.wait.since) ||
        voyage.wait.since < 0 || voyage.wait.since > this.world.tick() || typeof voyage.wait.loading !== "boolean")) throw Error("Invalid sea voyage wait");
      if (voyage.leg) {
        cursor(voyage.leg); pin(legKey(id), voyage.leg.laneId, actor, "actor-leg");
        const destination = actor.destination === null ? undefined : this.world.building(actor.destination);
        if (!voyage.returnSpans && destination && (destination.type !== "port" ||
          !this.ports.access(destination, this.world.water.component[voyage.leg.goalTile]).includes(voyage.leg.goalTile))) throw Error("Invalid sea destination geometry");
      }
      for (let i = 0; i < voyage.trail.length; i++) {
        const use = voyage.trail[i]; if (typeof use.reverse !== "boolean") throw Error("Invalid sea trail direction"); this.routes.tile(use, 0); pin(trailKey(id, i), use.laneId, actor, "actor-trail", i);
        if (i && this.routes.tile(voyage.trail[i - 1], this.routes.length(voyage.trail[i - 1].laneId) - 1) !== this.routes.tile(use, 0)) throw Error("Disconnected sea trail");
      }
      if (voyage.returnSpans) {
        if (!voyage.returnSpans.length || !Number.isSafeInteger(voyage.returnSpanIndex) || voyage.returnSpanIndex! < 0 || voyage.returnSpanIndex! > voyage.returnSpans.length) throw Error("Invalid sea return span index");
        for (const span of voyage.returnSpans) {
          cursor(span);
          if (span.laneId !== voyage.leg?.laneId && !voyage.trail.some(use => use.laneId === span.laneId)) throw Error("Unpinned sea return span");
        }
        for (let i = 1; i < voyage.returnSpans.length; i++) {
          const prior = voyage.returnSpans[i - 1], next = voyage.returnSpans[i];
          if (this.routes.tile(prior, prior.end) !== this.routes.tile(next, 0)) throw Error("Disconnected sea return");
        }
      }
      if (voyage.continuationStartedTick !== undefined && (!Number.isSafeInteger(voyage.continuationStartedTick) ||
        voyage.continuationStartedTick < 0 || voyage.continuationStartedTick > this.world.tick())) throw Error("Invalid sea continuation clock");
      const source = this.world.source(actor);
      if (source && !voyage.legacyVoyage && actor.state !== "prize") {
        const first = voyage.trail[0] ?? voyage.leg;
        if ((first && actor.state !== "returning") || voyage.trail.length) {
          const start = this.routes.tile(first!, 0), component = this.world.water.component[start];
          // The preferred berth may differ from the actual original access;
          // every physical footprint water edge is valid home access.
          if (!this.ports.access(source, component).includes(start)) throw Error("Sea voyage does not start at its source");
        }
        const spans = voyage.returnSpans;
        if (spans?.length && !this.ports.access(source, this.world.water.component[spans[spans.length - 1].goalTile])
          .includes(spans[spans.length - 1].goalTile)) throw Error("Sea return does not end at its source");
      }
      const moving = voyage.returnSpans?.[Math.min(voyage.returnSpanIndex ?? 0, voyage.returnSpans.length - 1)] ?? (!voyage.returnSpans ? voyage.leg : undefined);
      if (moving) {
        const at = Math.min(moving.next, moving.end), target = this.routes.tile(moving, at);
        const tx = (this.world.map.x(target) + .5) * FIXED, ty = (this.world.map.y(target) + .5) * FIXED;
        if (moving.next > moving.end) {
          if (actor.x !== tx || actor.y !== ty) throw Error("Sea arrival position disagrees with cursor");
        } else if (moving.next > 0) {
          const prior = this.routes.tile(moving, moving.next - 1), px = (this.world.map.x(prior) + .5) * FIXED, py = (this.world.map.y(prior) + .5) * FIXED;
          if (actor.x < Math.min(px, tx) || actor.x > Math.max(px, tx) || actor.y < Math.min(py, ty) || actor.y > Math.max(py, ty)) throw Error("Sea position disagrees with active segment");
        } else if (Math.abs(actor.x - tx) > FIXED / 2 || Math.abs(actor.y - ty) > FIXED / 2) throw Error("Sea departure position disagrees with cursor");
      }
      if (voyage.pending) {
        const pending = voyage.pending;
        if (!["departure", "continuation", "return", "salvage"].includes(pending.kind) || !Number.isSafeInteger(pending.receiverId) || pending.receiverId <= 0 ||
          pending.owner !== actor.playerId || pending.shipmentId !== actor.shipmentId ||
          !Number.isSafeInteger(pending.requestTick) || pending.requestTick < 0 || pending.requestTick > this.world.tick() ||
          !this.world.water.connected(pending.startTile, pending.goalTile)) throw Error("Invalid sea pending demand");
        if (pending.laneId !== undefined) {
          pin(pendingKey(id), pending.laneId, actor, "actor-demand");
          if (!this.routes.matchesPair(pending.laneId, pending.startTile, pending.goalTile)) throw Error("Invalid sea pending geometry");
        }
      }
      this.voyages.set(id, voyage); this.actorRefs.set(id, actor);
    }
    for (const [key, original] of saved.dispatches) {
      const row = structuredClone(original), pieces = key.split(":").map(Number);
      if (pieces.length !== 2 || pieces.some(value => !Number.isSafeInteger(value) || value < 0) || !pieces[0] || pieces[0] > 254 ||
        pieces[1] >= this.world.map.width() * this.world.map.height() || key !== `${pieces[0]}:${pieces[1]}` ||
        !Number.isSafeInteger(row.chosenActorId) || row.chosenActorId <= 0 || !Number.isSafeInteger(row.receiverId) || row.receiverId <= 0 || this.dispatches.has(key) || row.key !== key || (row.capacity !== undefined && typeof row.capacity !== "boolean") ||
        row.capacity && row.laneId !== undefined || !Number.isSafeInteger(row.requestedTick) ||
        row.requestedTick < 0 || row.requestedTick > this.world.tick() || !this.world.water.connected(row.startTile, row.goalTile)) throw Error("Invalid sea source dispatch");
      if (row.laneId !== undefined) {
        const sub = subscriptions.get(`source:${key}`);
        if (!sub || sub.laneId !== row.laneId || sub.owner !== pieces[0] || sub.holder.type !== "source-demand" || sub.holder.sourceKey !== key ||
          !this.routes.matchesPair(row.laneId, row.startTile, row.goalTile)) throw Error("Invalid sea source subscription");
        used.add(sub.key);
      }
      this.dispatches.set(key, row);
    }
    for (const group of [0, 1]) for (const key of saved.demandOrder[group]) {
      if (this.hasDemand(key)) throw Error("Duplicate sea demand work");
      const source = key.startsWith("source:") ? this.dispatches.get(key.slice(7)) : undefined;
      const pending = key.startsWith("actor:") ? this.voyages.get(Number(key.split(":")[1]))?.pending : undefined;
      if ((!source && !pending) || source?.laneId !== undefined || pending?.laneId !== undefined) throw Error("Invalid sea demand work");
      if (Number(this.recoveryDemand(key)) !== group) throw Error("Wrong sea demand work class");
      this.demands[group].add(key);
    }
    for (const [key, row] of this.dispatches) if (row.laneId === undefined && !this.hasDemand(`source:${key}`)) throw Error("Unscheduled sea source demand");
    for (const [id, voyage] of this.voyages) if (voyage.pending && voyage.pending.laneId === undefined && !this.hasDemand(pendingKey(id))) throw Error("Unscheduled sea actor demand");
    for (const sub of subscriptions.values()) if (!used.has(sub.key)) throw Error("Orphan sea subscription");
    for (const [id, position] of saved.salvageCursors) {
      if (!live.has(id) || this.salvageCursors.has(id) || !Number.isSafeInteger(position) || position < 0) throw Error("Invalid sea salvage cursor");
      this.salvageCursors.set(id, position);
    }
  }
  checkpoint(): SeaTradeCheckpoint {
    return structuredClone({ version: 1, routes: this.routes.checkpoint(), ports: this.ports.checkpoint(),
      voyages: [...this.voyages], dispatches: [...this.dispatches], mixedTurn: this.mixedTurn, serviceTurn: this.serviceTurn, demandRecoveryTurn: this.demandRecoveryTurn, demandOrder: [this.demands[0].values(), this.demands[1].values()] as [string[], string[]], salvageCursors: [...this.salvageCursors] });
  }
}

/** Pure metadata/payload bound checks before Simulation or Expansion clones. */
export function validateSeaTradeEnvelope(saved: SeaTradeCheckpoint | undefined, enabled: boolean,
  cells: number, actorCeiling: number, buildingCount: number): void {
  if (!enabled) { if (saved !== undefined) throw Error("Unexpected sea trade checkpoint"); return; }
  if (!saved || saved.version !== 1 || !Array.isArray(saved.voyages) || saved.voyages.length > actorCeiling ||
    !Array.isArray(saved.dispatches) || saved.dispatches.length > actorCeiling || !Array.isArray(saved.salvageCursors) ||
    saved.salvageCursors.length > actorCeiling || !Array.isArray(saved.demandOrder) || saved.demandOrder.length !== 2 || saved.demandOrder.some(rows => !Array.isArray(rows) || rows.length > actorCeiling) || !saved.ports || !saved.routes ||
    !Array.isArray(saved.ports.policies) || !Array.isArray(saved.ports.actors) || !Array.isArray(saved.ports.catalogs) ||
    !saved.ports.order || !Array.isArray(saved.ports.order.policies) || !Array.isArray(saved.ports.order.catalogs)) throw Error("Invalid sea trade envelope");
  validateSeaRoutesEnvelope(saved.routes, true, cells);
  if (saved.routes.subscriptions.length > (TRADE_RULES.maximumStops + 5) * actorCeiling ||
    (saved.ports.sourceHints?.length ?? 0) > actorCeiling * 32 || saved.routes.sourceRetention.length > actorCeiling * 32 || saved.ports.policies.length > actorCeiling ||
    saved.ports.actors.length > actorCeiling || saved.ports.catalogs.length > cells ||
    saved.ports.order.policies.length > actorCeiling || saved.ports.order.catalogs.length > cells)
    throw Error("Oversized sea trade metadata");
  if (saved.ports.sourceHints !== undefined && !Array.isArray(saved.ports.sourceHints)) throw Error("Invalid sea source hints envelope");
  for (const entry of saved.ports.sourceHints ?? []) if (!Array.isArray(entry) || entry.length !== 2 ||
    typeof entry[0] !== "string" || !Array.isArray(entry[1]) || entry[1].length > 2) throw Error("Invalid sea source hints envelope");
  let catalogCells = 0;
  for (const [, catalog] of saved.ports.catalogs) {
    if (!(catalog.receiverIds instanceof Int32Array)) throw Error("Invalid sea catalog envelope");
    catalogCells += catalog.receiverIds.length;
    if (catalog.build) {
      const build = catalog.build;
      if (!(build.a instanceof Int32Array) || !(build.b instanceof Int32Array) || !Array.isArray(build.inputIds) ||
        !Array.isArray(build.bootstrapInput) || build.bootstrapInput.length > 32 ||
        build.bootstrapOutput !== undefined && (!(build.bootstrapOutput instanceof Int32Array) || build.bootstrapOutput.length > 32)) throw Error("Invalid sea catalog build envelope");
      catalogCells += build.a.length + build.b.length + build.inputIds.length;
    }
    // A footprint has fewer than 32 distinct water access components. Four
    // arrays per basin cover coherent, input and both merge buffers.
    if (catalogCells > Math.max(1, buildingCount) * 128) throw Error("Oversized sea catalog payload");
  }
  for (const [, voyage] of saved.voyages) if (!Array.isArray(voyage.trail) || voyage.trail.length > 8 ||
    voyage.returnSpans && (!Array.isArray(voyage.returnSpans) || voyage.returnSpans.length > 9)) throw Error("Oversized sea voyage");
  for (const [, view] of saved.ports.policies) if (!Array.isArray(view.nearest) || view.nearest.length > 4 ||
    !Array.isArray(view.exploration) || view.exploration.length > 4) throw Error("Oversized sea candidate view");
  validateSeaPortsMetadata(saved.ports, cells);
}
