import { tradeActorCap } from "../FactionRules";
import { buildingCost } from "../content/Buildings";
import {
  PORT_CARGO_REPLENISH_SECONDS,
  FACTORY_CARGO_REPLENISH_SECONDS,
  TRADE_RULES,
  tradeSourceActorCap,
  marketDropLimit,
} from "../content/Economy";
import { portWaterTiles } from "../PortWaterAccess";
import {
  FIXED,
  TICKS_PER_SECOND,
  type Building,
  type Player,
} from "../Protocol";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import { AGES } from "./Definitions";
import type { Expansion } from "./Expansion";
import { tradeCargoCapacity, tradeCargoEffects } from "./TradeCargo";
import { tradePayout } from "./TradeQuote";
import { MARKET_INTAKE_WINDOW_SECONDS, TradeReceiving } from "./TradeReceiving";

export interface AiTradeCapacity {
  portTarget: number;
  factoryTarget: number;
  portUtility: number;
  factoryUtility: number;
  usefulSeas: ReadonlySet<number>;
  portGoodsPerSecond: number;
  seaDemandPerSecond: number;
  landDemandPerSecond: number;
  /** Funded sources, including foundations, with an accessible lawful receiver. */
  hasProductivePort: boolean;
  hasProductiveFactory: boolean;
}
interface Market {
  source: Building;
  stack: number;
  percent: number;
  seas: Set<number>;
}
interface Geometry {
  revision: string;
  bySea: Map<number, Market[]>;
  byLand: Map<number, Market[]>;
  exporters: Map<number, Set<number>>;
}
const geometryCache = new WeakMap<Expansion, Geometry>();
const coastCache = new WeakMap<
  Expansion,
  Map<number, { revision: string; anchors: Map<number, number> }>
>();

/** Derived geometry only: permissions, liquid funds, cargo and fleet occupancy
 * remain live inputs. Rebuild counters never enter canonical checkpoint state. */
function marketGeometry(expansion: Expansion): Geometry {
  const { world } = expansion,
    facts = world.buildingFacts();
  const revision = `${facts.producerRevision}:${world.waterPaths.revision}:${world.paths.revision}`;
  const previous = geometryCache.get(expansion);
  if (previous?.revision === revision) return previous;
  const grouped = new Map<string, Market>();
  for (const owner of world.players)
    for (const type of ["city", "port"] as const)
      for (const b of facts.completed(owner.id, type)) {
        const key = `${owner.id}:${b.tile}`,
          old = grouped.get(key);
        const seas =
          type === "port"
            ? new Set(
                portWaterTiles(world.map, b.tile)
                  .filter((t) => world.waterPaths.walkable(t))
                  .map((t) => world.waterPaths.component[t]),
              )
            : new Set<number>();
        const percent = 100 + AGES.indexOf(b.age ?? "StoneAge") * 5;
        if (old) {
          old.stack++;
          old.percent = Math.max(old.percent, percent);
          for (const sea of seas) old.seas.add(sea);
        } else grouped.set(key, { source: b, stack: 1, percent, seas });
      }
  const bySea = new Map<number, Market[]>(),
    byLand = new Map<number, Market[]>(),
    exporters = new Map<number, Set<number>>();
  for (const market of grouped.values()) {
    const land = world.paths.component[market.source.tile],
      landRows = byLand.get(land) ?? [];
    landRows.push(market);
    byLand.set(land, landRows);
    for (const sea of market.seas) {
      const rows = bySea.get(sea) ?? [];
      rows.push(market);
      bySea.set(sea, rows);
      const owners = exporters.get(sea) ?? new Set<number>();
      owners.add(market.source.playerId);
      exporters.set(sea, owners);
    }
  }
  const result = { revision, bySea, byLand, exporters };
  geometryCache.set(expansion, result);
  return result;
}
function coastAnchors(
  expansion: Expansion,
  player: Player,
  coasts: readonly number[],
  ownershipRevision: string | number,
): Map<number, number> {
  const { world } = expansion,
    revision = `${ownershipRevision}:${player.base}:${world.waterPaths.revision}:${world.buildingFacts().geometryRevision}`;
  let owners = coastCache.get(expansion);
  if (!owners) {
    owners = new Map();
    coastCache.set(expansion, owners);
  }
  const previous = owners.get(player.id);
  if (previous?.revision === revision) return previous.anchors;
  const anchors = new Map<number, number>();
  for (const coast of coasts)
    for (const water of world.map.neighbors(coast)) {
      if (!world.waterPaths.walkable(water)) continue;
      const sea = world.waterPaths.component[water],
        old = anchors.get(sea);
      if (
        old === undefined ||
        world.map.euclideanDistSquared(player.base, coast) <
          world.map.euclideanDistSquared(player.base, old)
      )
        anchors.set(sea, coast);
    }
  owners.set(player.id, { revision, anchors });
  return anchors;
}
/** One physical market intake budget is shared fairly among permitted source
 * owners. The actor ceiling and fixed source identity constrain useful sites;
 * no completed-voyage prerequisite or fixed port-count quota is imposed. */
export function aiTradeCapacity(
  expansion: Expansion,
  player: Player,
  snapshot: AiEconomicSnapshot,
  coasts: readonly number[],
  ownershipRevision: string | number = coasts.join(","),
): AiTradeCapacity {
  const { world, trade } = expansion,
    geometry = marketGeometry(expansion),
    anchors = coastAnchors(expansion, player, coasts, ownershipRevision);
  const effects = tradeCargoEffects(snapshot.research),
    seaCargo = tradeCargoCapacity(effects, true),
    landCargo = tradeCargoCapacity(effects, false);
  const ports = snapshot.buildings.filter(
      (b) => b.type === "port" && (b.health ?? 1) > 0,
    ),
    factories = snapshot.buildings.filter(
      (b) => b.type === "factory" && (b.health ?? 1) > 0,
    );
  const actors = trade.actors.filter((a) => a.playerId === player.id),
    seaActors = actors.filter((a) => a.naval).length;
  const actorCap = tradeActorCap(player, snapshot.age);
  const free = Math.max(0, actorCap - actors.length);
  const reclaimable = Math.min(
    actors.filter((a) => !a.naval && a.state === "loading" && a.cargo === 0)
      .length,
    Math.max(0, actors.length - seaActors - TRADE_RULES.reservedLandActors),
  );
  const seaQuota =
    actorCap -
    (trade.controls[player.id]?.landPaused
      ? 0
      : TRADE_RULES.reservedLandActors);
  let freeSea = Math.min(free + reclaimable, Math.max(0, seaQuota - seaActors));
  const alive = new Set(
    world.players.filter((p) => !p.eliminated).map((p) => p.id),
  );
  const seenMarkets = new Set<number>();
  const theaters = [...anchors]
    .sort((a, b) => a[0] - b[0])
    .map(([sea, anchor]) => {
      const sources = ports.filter((b) =>
        portWaterTiles(world.map, b.tile).some(
          (w) => world.waterPaths.component[w] === sea,
        ),
      );
      const ownerSet = new Set([
        ...(geometry.exporters.get(sea) ?? []),
        player.id,
      ]);
      const rows = (geometry.bySea.get(sea) ?? [])
        .filter((m) => {
          if (
            seenMarkets.has(m.source.id) ||
            m.source.playerId === player.id ||
            !alive.has(m.source.playerId) ||
            !trade.permitted(player.id, m.source.playerId, true)
          )
            return false;
          seenMarkets.add(m.source.id);
          return true;
        })
        .map((m) => {
          const contenders = [...ownerSet].filter(
            (id) =>
              id !== m.source.playerId &&
              alive.has(id) &&
              trade.permitted(id, m.source.playerId, true),
          ).length;
          const rate =
            TradeReceiving.intakeBudget(m) /
            MARKET_INTAKE_WINDOW_SECONDS /
            Math.max(1, contenders);
          const distance = Math.sqrt(
            Math.min(
              ...(sources.length
                ? sources.map((b) =>
                    world.map.euclideanDistSquared(b.tile, m.source.tile),
                  )
                : [world.map.euclideanDistSquared(anchor, m.source.tile)]),
            ),
          );
          const drop = Math.round(
            (marketDropLimit(
              m.stack,
              true,
              true,
              expansion.diplomacy.allied(player.id, m.source.playerId),
            ) *
              m.percent) /
              100,
          );
          return { market: m, rate, distance, drop };
        })
        .sort(
          (a, b) =>
            a.distance - b.distance || a.market.source.id - b.market.source.id,
        );
      const stops = rows.slice(0, TRADE_RULES.maximumStops),
        load = Math.min(
          seaCargo,
          stops.reduce((n, r) => n + r.drop, 0),
        );
      // The furthest selected stop gives a conservative straight-line circuit;
      // observed travel+handling increases this estimate without supply waits.
      let cycle =
        (2 * Math.max(0, ...stops.map((r) => r.distance))) /
          ((effects.seaSpeed * TICKS_PER_SECOND) / FIXED) +
        2 +
        stops.length;
      const sourceTiles = new Set(sources.map((b) => b.tile));
      let currentActors = 0;
      for (const actor of actors) {
        if (!actor.naval || !sourceTiles.has(actor.originTile)) continue;
        currentActors++;
        const quote = trade.cycleQuotes.get(actor.id);
        if (quote?.delivered)
          cycle = Math.max(
            cycle,
            (quote.travelTicks + quote.handlingTicks) / TICKS_PER_SECOND,
          );
      }
      const payout = stops.length
        ? tradePayout({
            naval: true,
            quantity: load,
            valuePerGood: TRADE_RULES.valuePerGood,
            distance: stops[0].distance,
            mapWidth: world.map.width(),
            foreign: true,
            allied: expansion.diplomacy.allied(
              player.id,
              stops[0].market.source.playerId,
            ),
          }) / Math.max(1, load)
        : 0;
      return {
        sea,
        sources,
        sourceTiles,
        currentActors,
        rate: rows.reduce((n, r) => n + r.rate, 0),
        load,
        cycle,
        payout,
        newSlots: 0,
      };
    })
    .filter((t) => t.rate > 0 && t.load > 0)
    .sort((a, b) => b.rate * b.payout - a.rate * a.payout || a.sea - b.sea);
  const baseSourceSlots = tradeSourceActorCap(snapshot.age);
  const sourceSlots = (buildings: readonly Building[]) => {
    const stacks = new Map<number, number>();
    for (const building of buildings) stacks.set(building.tile, (stacks.get(building.tile) ?? 0) + 1);
    return [...stacks.values()].reduce((sum, stack) => sum + tradeSourceActorCap(snapshot.age, stack), 0);
  };
  const portRate = seaCargo / PORT_CARGO_REPLENISH_SECONDS;
  const potential = (t: (typeof theaters)[number], extra = 0) =>
    Math.min(
      t.rate,
      (t.sources.length + t.newSlots + extra) * portRate,
      ((t.currentActors + t.newSlots + extra) * t.load) / Math.max(1, t.cycle),
    );
  // Each free slot is assigned once. A new distinct source needs a courier
  // even when its sailing time is much shorter than its replenishment time.
  while (freeSea > 0) {
    const best = theaters
      .filter(
        (t) =>
          t.sourceTiles.size + t.newSlots < seaQuota &&
          potential(t, 1) > potential(t),
      )
      .sort(
        (a, b) =>
          (potential(b, 1) - potential(b)) * b.payout -
            (potential(a, 1) - potential(a)) * a.payout || a.sea - b.sea,
      )[0];
    if (!best) break;
    best.newSlots++;
    freeSea--;
  }
  const portCost = buildingCost("port", snapshot.age, ports.length).gold ?? 0;
  let portTarget = ports.length,
    seaDemand = 0,
    portPayback = Infinity;
  const usefulSeas = new Set<number>();
  for (const t of theaters) {
    const demand = Math.min(
      t.rate,
      ((t.currentActors + t.newSlots) * t.load) / Math.max(1, t.cycle),
    );
    seaDemand += demand;
    const existingRate = Math.min(t.sources.length * portRate, sourceSlots(t.sources) * t.load / Math.max(1, t.cycle));
    const missing = Math.max(0, demand - existingRate),
      payback =
        portCost / Math.max(0.001, Math.min(portRate, baseSourceSlots * t.load / Math.max(1, t.cycle), missing) * t.payout);
    const target = Math.min(
      t.sources.length + Math.max(0,
        Math.ceil(demand / Math.max(0.001, portRate)) - t.sources.length,
        Math.ceil((Math.ceil(demand * t.cycle / Math.max(1, t.load)) - sourceSlots(t.sources)) / baseSourceSlots)),
      t.sourceTiles.size + t.newSlots,
      seaQuota,
    );
    if (
      target > t.sources.length &&
      payback <= 600 &&
      portCost <= (snapshot.liquid.gold ?? 0) + snapshot.goldIncome * 300
    ) {
      portTarget += target - t.sources.length;
      usefulSeas.add(t.sea);
      portPayback = Math.min(portPayback, payback);
    }
  }
  if (!ports.length && coasts.length && !portTarget) portTarget = 1;
  // Domestic stops have per-visit limits rather than a shared intake rate.
  // Distances are computed once, outside sorting, using actual source sites.
  const factoryTiles = new Set(factories.map((b) => b.tile));
  const landRows = (
    geometry.byLand.get(world.paths.component[player.base]) ?? []
  )
    .filter(
      (m) =>
        alive.has(m.source.playerId) &&
        trade.permitted(player.id, m.source.playerId, false) &&
        (!factoryTiles.has(m.source.tile) || m.source.playerId !== player.id),
    )
    .map((m) => ({
      market: m,
      distance: Math.sqrt(
        Math.min(
          ...(factories.length
            ? factories.map((b) =>
                world.map.euclideanDistSquared(b.tile, m.source.tile),
              )
            : [world.map.euclideanDistSquared(player.base, m.source.tile)]),
        ),
      ),
    }))
    .sort(
      (a, b) =>
        a.distance - b.distance || a.market.source.id - b.market.source.id,
    )
    .slice(0, TRADE_RULES.maximumStops);
  const landLoad = Math.min(
    landCargo,
    landRows.reduce(
      (n, { market: m }) =>
        n +
        Math.round(
          (marketDropLimit(
            m.stack,
            false,
            m.source.playerId !== player.id,
            expansion.diplomacy.allied(player.id, m.source.playerId),
          ) *
            m.percent) /
            100,
        ),
      0,
    ),
  );
  let landCycle =
    (2 * Math.max(0, ...landRows.map((r) => r.distance))) / (1000 / FIXED) +
    2 +
    landRows.length;
  for (const actor of actors) {
    if (actor.naval) continue;
    const q = trade.cycleQuotes.get(actor.id);
    if (q?.delivered)
      landCycle = Math.max(
        landCycle,
        (q.travelTicks + q.handlingTicks) / TICKS_PER_SECOND,
      );
  }
  const landSlots = Math.min(
    theaters.length
      ? TRADE_RULES.reservedLandActors
      : actorCap - seaActors,
    actors.length - seaActors + free,
    factoryTiles.size + free,
  );
  const landDemand = (landSlots * landLoad) / Math.max(1, landCycle),
    factoryRate = landCargo / FACTORY_CARGO_REPLENISH_SECONDS,
    factoryCost =
      buildingCost("factory", snapshot.age, factories.length).gold ?? 0;
  const factoryPayback =
    factoryCost /
    Math.max(
      0.001,
      Math.min(
        factoryRate,
        baseSourceSlots * landLoad / Math.max(1, landCycle),
        Math.max(0, landDemand - Math.min(factories.length * factoryRate, sourceSlots(factories) * landLoad / Math.max(1, landCycle))),
      ) * TRADE_RULES.valuePerGood,
    );
  const unused = factories.some(
    (b) =>
      !b.remainingTicks &&
      (expansion.supply.goods.get(b.id) ?? 0) >= landCargo &&
      !actors.some((a) => !a.naval && a.originTile === b.tile),
  );
  const factoryTarget =
    !unused &&
    landLoad > 0 &&
    factoryPayback <= 600 &&
    factoryCost <= (snapshot.liquid.gold ?? 0) + snapshot.goldIncome * 300
      ? Math.max(
          factories.length,
          Math.min(factories.length + Math.max(0,
            Math.ceil(landDemand / factoryRate) - factories.length,
            Math.ceil((landSlots - sourceSlots(factories)) / baseSourceSlots)), landSlots),
        )
      : factories.length;
  return {
    portTarget,
    factoryTarget,
    hasProductivePort: theaters.some(t => t.sources.length > 0),
    hasProductiveFactory: factories.some(factory =>
      (geometry.byLand.get(world.paths.component[factory.tile]) ?? []).some(m =>
        (m.source.tile !== factory.tile || m.source.playerId !== player.id) &&
        alive.has(m.source.playerId) && trade.permitted(player.id,m.source.playerId,false))),
    usefulSeas,
    portUtility: Math.round(
      6000 + Math.min(3000, 600000 / Math.max(1, portPayback)),
    ),
    factoryUtility: Math.round(
      6000 + Math.min(3000, 600000 / Math.max(1, factoryPayback)),
    ),
    portGoodsPerSecond: portRate,
    seaDemandPerSecond: seaDemand,
    landDemandPerSecond: landDemand,
  };
}
