import { VESSELS } from "../content/Units";
import { FIXED } from "../Protocol";
import { tilePoint } from "../SquadGeometry";
import type { AiEconomicDirector } from "./AiEconomicDirector";
import { AGES } from "./Definitions";
import type { Expansion } from "./Expansion";
import { cargoHandlingPercent } from "./ResearchEffects";
import { tradeCycleQuote, type TradeCycleQuote } from "./TradeQuote";

interface Scan {
  playerId: number;
  generation: number;
  cursor: number;
  source?: number;
  market?: number;
  sourceWater?: number;
  marketWater?: number;
  port?: number;
  naval: boolean;
  phase: "source" | "market" | "supply" | "route" | "cost";
  path?: number[];
  pathCursor: number;
  travelTicks: number;
  risk: number;
  key?: string;
  best?: {
    source: number;
    market: number;
    sea?: number;
    quote: TradeCycleQuote;
    validity: string;
    tick: number;
  };
  nextThink: number;
}
/** Quotes one source/market leg at a time. Exact paths and route cost processing
 * consume shared allowances; investment decisions never run waterPaths.find. */
export class AiTradeOpportunities {
  private readonly scans = new Map<string, Scan>();
  private cursor = 0;
  constructor(
    private readonly expansion: Expansion,
    private readonly economy: AiEconomicDirector,
  ) {}
  checkpoint() {
    return structuredClone({ scans: [...this.scans], cursor: this.cursor });
  }
  restore(saved?: ReturnType<AiTradeOpportunities["checkpoint"]>): void {
    this.scans.clear();
    this.cursor = saved?.cursor ?? 0;
    for (const [key, s] of structuredClone(saved?.scans ?? []))
      this.scans.set(key, s);
  }
  release(playerId: number): void {
    for (const [key, s] of this.scans)
      if (s.playerId === playerId) {
        if (s.key) this.economy.routes.release(s.key);
        this.scans.delete(key);
      }
  }
  private validity(source: number, market: number, playerId: number): string {
    const { world, progression, supply, diplomacy } = this.expansion,
      s = world.building(source),
      m = world.building(market);
    return JSON.stringify([
      world.domainRoutes?.revision(),
      progression.states[playerId].completed,
      s?.playerId,
      s?.remainingTicks,
      s?.age,
      m?.playerId,
      m?.remainingTicks,
      supply.goods.get(source) ?? 0,
      m && diplomacy.allied(playerId, m.playerId),
      s && this.expansion.trade.loadingPortFor(s)?.id,
    ]);
  }
  best(playerId: number, naval: boolean) {
    const s = this.scans.get(`${playerId}:${naval}`),
      best = s?.best,
      { world } = this.expansion;
    if (
      !s ||
      s.generation !== world.aiGeneration(playerId) ||
      !best ||
      world.tick - best.tick > 600 ||
      best.validity !== this.validity(best.source, best.market, playerId)
    )
      return undefined;
    const source = world.building(best.source),
      market = world.building(best.market);
    if (
      !source ||
      !market ||
      source.playerId !== playerId ||
      source.remainingTicks ||
      market.remainingTicks ||
      (source.health ?? 1) <= 0 ||
      (market.health ?? 1) <= 0 ||
      (naval && market.playerId === playerId) ||
      (this.expansion.supply.goods.get(source.id) ?? 0) < 10
    )
      return undefined;
    return best;
  }
  step(budget = 8): number {
    const { world, progression, supply, diplomacy } = this.expansion;
    const players = world.players.filter((p) => this.economy.enabled(p));
    if (!players.length || !world.options?.deferredPlanning) return 0;
    const slot = this.cursor++ % (players.length * 2),
      player = players[Math.floor(slot / 2)],
      naval = !!(slot % 2);
    const key = `${player.id}:${naval}`;
    let s = this.scans.get(key);
    if (!s || s.generation !== world.aiGeneration(player.id)) {
      s = {
        playerId: player.id,
        generation: world.aiGeneration(player.id),
        naval,
        cursor: 0,
        phase: "source",
        pathCursor: 0,
        travelTicks: 0,
        risk: 0,
        nextThink: world.tick,
      };
      this.scans.set(key, s);
    }
    if (s.nextThink > world.tick) return 0;
    let used = 0;
    while (used < budget) {
      used++;
      if (s.phase === "source") {
        const b = world.buildings[s.cursor++];
        if (!b) {
          s.cursor = 0;
          s.nextThink = world.tick + 100;
          break;
        }
        if (
          b.type !== "factory" ||
          b.playerId !== player.id ||
          b.remainingTicks ||
          (b.health ?? 1) <= 0 ||
          (supply.goods.get(b.id) ?? 0) < 10
        )
          continue;
        s.source = b.id;
        s.cursor = 0;
        s.phase = "market";
      } else if (s.phase === "market") {
        const market = world.buildings[s.cursor++],
          source = world.building(s.source!);
        if (!source || source.playerId !== player.id) {
          s.phase = "source";
          s.cursor = 0;
          continue;
        }
        if (!market) {
          s.phase = "source";
          s.cursor = world.buildings.findIndex((b) => b.id === source.id) + 1;
          continue;
        }
        if (
          market.remainingTicks ||
          (market.health ?? 1) <= 0 ||
          (naval
            ? market.type !== "port" || market.playerId === player.id
            : !["city", "port"].includes(market.type))
        )
          continue;
        const port = naval
          ? this.expansion.trade.loadingPortFor(source)
          : undefined;
        if (naval && !port) continue;
        const start = naval
          ? world.map
              .neighbors(port!.tile)
              .find((t) => world.waterPaths.walkable(t))
          : source.tile;
        const end = naval
          ? world.map
              .neighbors(market.tile)
              .find((t) => world.waterPaths.connected(start!, t))
          : market.tile;
        if (
          start === undefined ||
          end === undefined ||
          (!naval && !world.paths.connected(start, end))
        )
          continue;
        s.market = market.id;
        s.sourceWater = start;
        s.marketWater = end;
        s.port = port?.id;
        s.key = `trade-opportunity:${key}`;
        s.phase = naval ? "supply" : "route";
      } else if (s.phase === "supply") {
        const source = world.building(s.source!),
          port = world.building(s.port!);
        if (!source || !port || port.playerId !== player.id) {
          s.phase = "market";
          continue;
        }
        const route = this.economy.routes.request(
          s.key!,
          player.id,
          source.tile,
          port.tile,
        );
        if (route.pending) break;
        if (!route.path) {
          this.economy.routes.release(s.key!);
          s.phase = "market";
          continue;
        }
        this.economy.routes.release(s.key!);
        s.phase = "route";
      } else if (s.phase === "route") {
        const route = this.economy.routes.request(
          s.key!,
          player.id,
          s.sourceWater!,
          s.marketWater!,
          naval,
        );
        if (route.pending) break;
        if (!route.path) {
          this.economy.routes.release(s.key!);
          s.phase = "market";
          continue;
        }
        s.path = [...route.path];
        s.pathCursor = 0;
        s.travelTicks = 0;
        s.risk = 0;
        s.phase = "cost";
      } else {
        const path = s.path!,
          tile = path[s.pathCursor];
        if (tile !== undefined) {
          const previous = s.pathCursor ? path[s.pathCursor - 1] : tile;
          s.travelTicks += s.pathCursor
            ? Math.ceil(
                (Math.sqrt(world.map.euclideanDistSquared(previous, tile)) *
                  FIXED) /
                  (naval ? 55 : 50),
              )
            : 1;
          if (s.pathCursor % Math.max(1, Math.ceil(path.length / 32)) === 0)
            s.risk += this.expansion.trade.observedRouteRisk(
              player.id,
              naval,
              tilePoint(world.map, tile),
            );
          s.pathCursor++;
          continue;
        }
        const source = world.building(s.source!),
          market = world.building(s.market!);
        if (
          source &&
          market &&
          source.playerId === player.id &&
          !source.remainingTicks &&
          !market.remainingTicks &&
          (supply.goods.get(source.id) ?? 0) >= 10
        ) {
          const research = progression.states[player.id].completed;
          const merchant = [...VESSELS]
            .reverse()
            .find(
              (v) => v.kind === "trade" && research.includes(v.technologyId),
            );
          const capacity = Math.floor(
            ((naval
              ? (merchant?.capacity ?? 0)
              : [20, 30, 40, 50, 60, 80, 120][
                  AGES.indexOf(progression.states[player.id].age)
                ]) *
              cargoHandlingPercent(research)) /
              100,
          );
          const port = naval
            ? this.expansion.trade.loadingPortFor(source)
            : source;
          if (capacity && port) {
            const quote = tradeCycleQuote({
              naval,
              stock: supply.goods.get(source.id) ?? 0,
              capacity,
              valuePerGood: 50 * (AGES.indexOf(source.age ?? "StoneAge") + 1),
              supplyTicks: 0,
              legs: [
                {
                  marketId: market.id,
                  distance: Math.sqrt(
                    world.map.euclideanDistSquared(port.tile, market.tile),
                  ),
                  foreign: market.playerId !== player.id,
                  allied: diplomacy.allied(player.id, market.playerId),
                  travelTicks: s.travelTicks,
                },
              ],
              returnTicks: s.travelTicks,
              observedRisk: Math.min(900, s.risk * 20),
            });
            if (
              !this.best(player.id, naval) ||
              quote.riskAdjustedGoldPer1000Ticks >
                s.best!.quote.riskAdjustedGoldPer1000Ticks
            )
              s.best = {
                source: source.id,
                market: market.id,
                sea: naval
                  ? world.waterPaths.component[s.sourceWater!]
                  : undefined,
                quote,
                validity: this.validity(source.id, market.id, player.id),
                tick: world.tick,
              };
          }
        }
        this.economy.routes.release(s.key!);
        s.phase = "market";
      }
    }
    return used;
  }
}
