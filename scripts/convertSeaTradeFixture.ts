import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deserialize, serialize } from "node:v8";
import { loadServerMap } from "../src/skirmish/multiplayer/infrastructure/ServerMap";
import { createSkirmishMap } from "../src/skirmish/Elevation";
import { Skirmish } from "../src/skirmish/Simulation";
import type { LaneRecord, SeaVoyage, Subscription } from "../src/skirmish/domain/SeaTradeTypes";
import { validateSeaRoutesEnvelope } from "../src/skirmish/domain/SeaTradeRoutes";

/** Offline only. Retains all money, stock, cargo, positions and planner arena state. */
export async function convertSeaTradeFixture(input: string, output: string, sourceSha: string) {
  if (resolve(input) === resolve(output) || existsSync(output) || existsSync(`${output}.json`)) throw Error("Conversion output already exists");
  if (!/^[a-f0-9]{8,40}$/i.test(sourceSha)) throw Error("Provide the exact source SHA");
  const bytes = readFileSync(input), fixture = deserialize(bytes);
  if (fixture.options?.seaTradeRouting !== undefined || fixture.checkpoint?.options?.seaTradeRouting !== undefined) throw Error("Fixture is already converted");
  if (!fixture.settings || !Number.isSafeInteger(fixture.seed)) throw Error("Unknown fixture map reconstruction");
  const loaded = await loadServerMap(fixture.settings, undefined, fixture.seed), m = loaded.map;
  const map = () => createSkirmishMap(m.width, m.height, m.terrain.slice(), structuredClone(m.elevation), structuredClone(m.forest), structuredClone(m.resourceTerrain));
  const old = new Skirmish(map(), fixture.options); old.restore(fixture.checkpoint);
  if (!old.expansion || !old.options.deferredPlanning) throw Error("Fixture needs ages/deferred planning");
  const original = old.checkpoint();
  const catalogRows = old.expansion.trade.seaFixtureCatalogs();
  if (!isDeepStrictEqual(original, old.checkpoint())) throw Error("Conversion catalog read changed the source world");
  let cancelled = 0;
  for (const [, admission] of original.expansion!.trade.admissions) if (admission.naval) {
    old.domainRoutes!.cancel({ kind: "domain", owner: "trade", playerId: admission.playerId,
      admissionId: admission.id, memberId: admission.candidates[admission.index], stage: "market",
      generation: admission.generation, epoch: admission.epoch });
    cancelled++;
  }
  const state = old.checkpoint(), options = { ...fixture.options, seaTradeRouting: "lanes-v1" as const };
  const candidate = new Skirmish(map(), options);
  const sea = candidate.expansion!.trade.checkpoint().seaTrade!;
  sea.ports.catalogs = catalogRows.map(([component, ids]) => [component, { component, version: 1, receiverIds: Int32Array.from(ids.sort((a, b) => a - b)) }]);
  sea.ports.order.catalogs = sea.ports.catalogs.map(([component]) => component);
  const interned = new Map<string, LaneRecord>(); let convertedLegs = 0, legacyVoyages = 0;
  const intern = (path: readonly number[], owner: number, required: boolean): LaneRecord => {
    const lo = Math.min(path[0], path[path.length - 1]), hi = Math.max(path[0], path[path.length - 1]);
    const canonical = path[0] !== lo ? path.slice().reverse() : path;
    const key = `water:${old.waterPaths.revision}:${lo}:${hi}`;
    const existing = interned.get(key);
    if (existing) {
      const retained = existing.state === "ready" ? existing.tiles : undefined;
      if (required && (!retained || retained.length !== canonical.length || canonical.some((tile, i) => tile !== retained[i])))
        throw Error(`Conflicting imported geometry for ${key}; refusing to alter an active path`);
      return existing;
    }
    const lane: LaneRecord = { id: sea.routes.nextLaneId++, key: { revision: old.waterPaths.revision, lo, hi }, epoch: 0,
      firstDemandTick: state.tick, nextAttemptTick: state.tick, attempts: 0, sponsorId: owner,
      lastUseTick: state.tick, references: 0, state: "ready", tiles: Int32Array.from(canonical) };
    interned.set(key, lane); sea.routes.lanes.push(lane); return lane;
  };
  const trade = state.expansion!.trade;
  for (const actor of trade.actors) {
    if (!actor.naval) continue;
    const voyage: SeaVoyage = { actorId: actor.id, shipmentId: actor.shipmentId,
      currentPortTile: actor.state === "loading" ? actor.originTile : undefined,
      trail: [], loadingWaits: { route: 0, intake: 0, handling: 0 }, tripWaits: { route: 0, intake: 0, handling: 0 },
      preLoadWaitTicks: 0, legacyVoyage: actor.state !== "loading" };
    if (voyage.legacyVoyage) legacyVoyages++;
    if (actor.state !== "loading" && actor.destination !== null && actor.path.length && actor.nextPathIndex <= actor.path.length) {
      // Consumed prefixes carry no future movement authority for imported
      // legacy shipments. Keep the last reached waypoint and exact remaining
      // sequence; this also avoids merging historically different A/B routes.
      const consumed = Math.max(0, actor.nextPathIndex - 1);
      const path = actor.path.slice(consumed), next = actor.nextPathIndex - consumed;
      const reverse = path[0] > path[path.length - 1];
      const lane = intern(path, actor.playerId, true);
      lane.references++;
      const sub: Subscription = { id: sea.routes.nextSubscriptionId++, key: `actor:${actor.id}:leg`, laneId: lane.id,
        owner: actor.playerId, kind: actor.state === "prize" ? "salvage" : "return",
        holder: { type: "actor-leg", actorId: actor.id, shipmentId: actor.shipmentId } };
      sea.routes.subscriptions.push(sub);
      voyage.leg = { laneId: lane.id, reverse, next, end: path.length - 1, goalTile: path[path.length - 1] };
      convertedLegs++;
    }
    actor.path = []; actor.nextPathIndex = 0;
    // A cancelled actor-owned admission may have left a destination with no
    // active movement payload. Re-enter planning without changing position.
    if (!voyage.leg && actor.state !== "loading") actor.destination = null;
    sea.voyages.push([actor.id, voyage]);
  }
  // Reuse geometry the old world already calculated, including consumed
  // actor payloads. Do not turn a mature network artificially cold by throwing
  // away that work merely because its old 128-entry cache could not hold it.
  const activeLaneCount = sea.routes.lanes.length;
  for (const actor of original.expansion!.trade.actors) if (actor.naval && actor.path.length) intern(actor.path, actor.playerId, false);
  for (const [key, path] of original.expansion!.trade.corridors) if (key.startsWith("water:") && path.length) intern(path, 1, false);
  const historicalLaneCount = sea.routes.lanes.length - activeLaneCount;
  trade.corridors = trade.corridors.filter(([key]) => !key.startsWith("water:"));
  trade.routeFailures = trade.routeFailures.filter(([key]) => key.split(":")[1] !== "1");
  trade.admissions = trade.admissions.filter(([, admission]) => !admission.naval);
  const seaIds = new Set(trade.actors.filter(actor => actor.naval).map(actor => actor.id));
  trade.retries = trade.retries.filter(([id]) => !seaIds.has(id));
  trade.seaTrade = sea; trade.seaMarketDirty = false; state.options = options;
  state.planning.scheduling.version = 8;
  sea.routes.waterRevision = old.waterPaths.revision;
  validateSeaRoutesEnvelope(sea.routes, true, m.width * m.height);
  candidate.restore(state);
  const after = candidate.checkpoint();
  const protectedActor = (actor: object) => Object.fromEntries(Object.entries(actor).filter(([key]) => !["path", "nextPathIndex", "destination"].includes(key)));
  const stableActorFields = ["id", "playerId", "factoryId", "originPortId", "x", "y", "cargo", "loaded", "delivered", "lost", "returned", "shipmentId", "valuePerGood", "waitTicks"] as const;
  const actorRows = new Map(after.expansion!.trade.actors.map(actor => [actor.id, actor]));
  for (const actor of original.expansion!.trade.actors) {
    const restored = actorRows.get(actor.id);
    if (!restored || !isDeepStrictEqual(protectedActor(actor), protectedActor(restored)) || stableActorFields.some(key => !Object.is(actor[key], restored[key]))) throw Error(`Conversion changed actor ${actor.id}`);
  }
  if (actorRows.size !== original.expansion!.trade.actors.length) throw Error("Conversion changed actor roster");
  if (JSON.stringify(original.players.map(player => player.gold)) !== JSON.stringify(after.players.map(player => player.gold))) throw Error("Conversion changed paid gold");
  for (const key of ["deliveredGold", "capturedValue", "lostValue", "nextShipment"] as const)
    if (JSON.stringify(trade[key]) !== JSON.stringify(after.expansion!.trade[key])) throw Error(`Conversion changed ${key}`);
  if (!isDeepStrictEqual(original.expansion!.trade.receiving, after.expansion!.trade.receiving)) throw Error("Conversion changed receiving intake");
  if (JSON.stringify(original.expansion!.supply) !== JSON.stringify(after.expansion!.supply)) throw Error("Conversion changed supply");
  const manifest = { sourceSha, input: resolve(input), checkpointSha256: createHash("sha256").update(bytes).digest("hex"),
    seed: fixture.seed, settings: fixture.settings, oldOptions: fixture.options, newOptions: options,
    plannerScheduling: { old: original.planning.scheduling.version, new: 8 },
    historicalLaneCount, tick: state.tick, cancelledNavalAdmissions: cancelled, convertedLegs, legacyVoyages,
    behavior: "Imported shipments retain direct-return planning until the next new load; new shipments use ready direct lanes or retrace.",
    packedCells: sea.routes.lanes.reduce((n, lane) => n + (lane.state === "ready" ? lane.tiles.length : 0), 0) };
  writeFileSync(output, serialize({ ...fixture, options, checkpoint: after }), { flag: "wx" });
  writeFileSync(`${output}.json`, JSON.stringify(manifest, null, 2), { flag: "wx" });
  return manifest;
}
if (process.argv[1]?.endsWith("convertSeaTradeFixture.ts")) {
  const args = process.argv.slice(2), value = (key: string) => args[args.indexOf(key) + 1];
  for (const key of ["--input", "--output", "--source-sha", "--policy"]) if (!args.includes(key) || !value(key)) throw Error(`Missing ${key}`);
  if (value("--policy") !== "lanes-v1") throw Error("Unknown conversion policy");
  console.log(JSON.stringify(await convertSeaTradeFixture(value("--input"), value("--output"), value("--source-sha"))));
}
