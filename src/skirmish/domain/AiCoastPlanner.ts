import { buildingGroundBounds, buildingFootprint } from "../BuildingFootprint";
import { buildingCost, buildingTechnology } from "../content/Buildings";
import { shoreTransportCapacity } from "../content/ShoreTransport";
import { FIXED, type Player } from "../Protocol";
import { tilePoint } from "../SquadGeometry";
import { affordableAiCost } from "./AiBudgetLedger";
import type { AiEconomicDirector } from "./AiEconomicDirector";
import type { Expansion } from "./Expansion";

interface Candidate {
  tile: number;
  water: number;
  sea: number;
  score: number;
}
interface CoastGoal {
  id: string;
  playerId: number;
  generation: number;
  phase:
    | "scan"
    | "markets"
    | "quote"
    | "move"
    | "capture"
    | "fund"
    | "complete"
    | "abort";
  cursor: number;
  marketCursor?: number | null;
  pending?: Candidate;
  shortlist: Candidate[];
  index: number;
  tile?: number;
  sea?: number;
  siteCursor?: number;
  members: number[];
  created: number;
  deadline: number;
  nextThink: number;
  reason: string;
}
/** Coast topology is indexed once. Candidates, market evidence and exact routes
 * are resumed under one allowance. Only occupation may grant ownership. */
export class AiCoastPlanner {
  readonly goals = new Map<number, CoastGoal>();
  private readonly edges: readonly { landTile: number; waterTile: number }[];
  private cursor = 0;
  private serial = 0;
  private readonly history: {
    id: string;
    tick: number;
    reason: string;
    phase: string;
  }[] = [];
  constructor(
    private readonly expansion: Expansion,
    private readonly economy: AiEconomicDirector,
  ) {
    const map=expansion.world.map, shape=buildingFootprint("port"), edges=new Map<string,{landTile:number;waterTile:number}>();
    for(const connection of expansion.world.coast.connections())for(const edge of connection.edges) {
      const x=map.x(edge.landTile),y=map.y(edge.landTile);
      for(let dy=0;dy<shape.height;dy++)for(let dx=0;dx<shape.width;dx++) {
        if(!map.isValidCoord(x-dx,y-dy) || !map.isValidCoord(x-dx+shape.width-1,y-dy+shape.height-1))continue;
        const tile=map.ref(x-dx,y-dy),bounds=buildingGroundBounds(map,tile,"port");
        let valid=true;
        for(let yy=bounds.top;yy<bounds.bottom;yy++)for(let xx=bounds.left;xx<bounds.right;xx++)
          if(!map.isLand(map.ref(xx,yy)) || map.isImpassable(map.ref(xx,yy)))valid=false;
        if(valid)edges.set(tile+":"+edge.waterTile,{landTile:tile,waterTile:edge.waterTile});
      }
    }
    this.edges=[...edges.values()];
  }
  checkpoint() {
    return structuredClone({
      goals: [...this.goals],
      cursor: this.cursor,
      serial: this.serial,
      history: this.history,
    });
  }
  restore(saved?: ReturnType<AiCoastPlanner["checkpoint"]>): void {
    this.goals.clear();
    this.cursor = saved?.cursor ?? 0;
    this.serial = saved?.serial ?? 0;
    this.history.length = 0;
    for (const [id, g] of structuredClone(saved?.goals ?? []))
      this.goals.set(id, g);
    this.history.push(...structuredClone(saved?.history ?? []));
  }
  release(playerId: number): void {
    const g = this.goals.get(playerId);
    if (g) {
      this.economy.routes.release(g.id);
      this.economy.assets.release(g.id);
      this.economy.ledger.release(g.id);
    }
    this.goals.delete(playerId);
  }
  private finish(
    g: CoastGoal,
    phase: "complete" | "abort",
    reason: string,
  ): void {
    g.phase = phase;
    g.reason = reason;
    g.nextThink = this.expansion.world.tick + 800;
    this.economy.routes.release(g.id);
    this.economy.ledger.release(g.id);
    const { world } = this.expansion;
    const members = g.members.filter(
      (id) =>
        this.economy.assets.owns(`squad:${id}`, g.id) &&
        world.squad(id)?.playerId === g.playerId &&
        world.squad(id)!.embarkedOn === null,
    );
    if (members.length)
      world.applyCommand({
        type: "order",
        playerId: g.playerId,
        squadIds: members,
        order: {
          type: "move",
          tile: world.players.find((p) => p.id === g.playerId)!.base,
        },
      });
    this.economy.assets.release(g.id);
    this.history.push({ id: g.id, tick: world.tick, reason, phase });
    if (this.history.length > 128) this.history.shift();
  }
  private legal(player: Player, tile: number): boolean {
    const {world,operations}=this.expansion, bounds=buildingGroundBounds(world.map,tile,"port");
    for(let y=bounds.top;y<bounds.bottom;y++)for(let x=bounds.left;x<bounds.right;x++){
      if(!world.map.isValidCoord(x,y))return false;
      const cell=world.map.ref(x,y),owner=world.owners[cell];
      if(owner!==0 && owner!==player.id && (!world.hostile(player.id,owner) ||
        (operations.enabled(player) && !operations.canEnter(player.id,owner,cell))))return false;
    }
    return true;
  }
  private owned(player: Player,tile:number): boolean {
    const {world}=this.expansion,bounds=buildingGroundBounds(world.map,tile,"port");
    for(let y=bounds.top;y<bounds.bottom;y++)for(let x=bounds.left;x<bounds.right;x++)
      if(!world.map.isValidCoord(x,y) || world.owners[world.map.ref(x,y)]!==player.id)return false;
    return true;
  }
  step(budget = 8): number {
    const { world, progression, operations } = this.expansion;
    if (
      budget <= 0 ||
      !world.options?.deferredPlanning ||
      !world.players.length
    )
      return 0;
    const player = world.players[this.cursor++ % world.players.length];
    if (!this.economy.enabled(player)) return 0;
    let g = this.goals.get(player.id);
    if (g && g.generation !== world.aiGeneration(player.id)) {
      this.release(player.id);
      g = undefined;
    }
    if (g && ["complete", "abort"].includes(g.phase)) {
      if (world.tick < g.nextThink) return 0;
      this.release(player.id);
      g = undefined;
    }
    if (!g) {
      // Ownership of an already useful coast is handled by ordinary placement.
      if (
        this.economy.placements.coasts(player.id).length &&
        world
          .buildingFacts()
          .byOwner(player.id)
          .some((b) => b.type === "port")
      )
        return 0;
      g = {
        id: `coast:${player.id}:${++this.serial}`,
        playerId: player.id,
        generation: world.aiGeneration(player.id),
        phase: "scan",
        cursor: 0,
        shortlist: [],
        index: 0,
        members: [],
        created: world.tick,
        deadline: world.tick + 6000,
        nextThink: world.tick,
        reason: "Looking for a reachable coast with actual market value",
      };
      this.goals.set(player.id, g);
    }
    if (g.nextThink > world.tick) return 0;
    if (world.tick >= g.deadline) {
      this.finish(g, "abort", "Coastal acquisition deadline reached");
      return 1;
    }
    const state = progression.states[player.id];
    let used = 0;
    while (used < budget) {
      used++;
      if (g.phase === "scan") {
        const edge = this.edges[g.cursor++];
        if (!edge) {
          g.phase = "quote";
          g.index = 0;
          continue;
        }
        const sea = world.waterPaths.component[edge.waterTile];
        if (
          !this.legal(player, edge.landTile) ||
          this.expansion.fortifications.blocked(edge.landTile, player.id) ||
          this.expansion.supply.resourceSites.rejection("port", edge.landTile)
        )
          continue;
        const land = world.paths.connected(player.base, edge.landTile);
        const shore =
          shoreTransportCapacity(state.completed) > 0 &&
          world.coast.candidates(world.paths.component[player.base], sea)
            .length > 0;
        if (!land && !shore) continue;
        g.pending = {
          tile: edge.landTile,
          water: edge.waterTile,
          sea,
          score:
            10000 -
            Math.min(
              9000,
              world.map.manhattanDist(player.base, edge.landTile) * 40,
            ) -
            (land ? 0 : 1500),
        };
        g.marketCursor = undefined;
        if (!world.buildingFacts().byOwner(player.id).some(b => b.type === "port" && (b.health ?? 1) > 0)) {
          // First access to the sea has strategic value before any foreign
          // port exists. The normal quote, occupation and payment gates apply.
          g.shortlist.push(g.pending);
          g.shortlist.sort((a, b) => b.score - a.score || a.tile - b.tile);
          g.shortlist.length = Math.min(8, g.shortlist.length);
          g.phase = "scan";
          continue;
        }
        g.phase = "markets";
      } else if (g.phase === "markets") {
        const read = this.economy.navalFacts.readSea(
          "buildings",
          g.pending!.sea,
          g.marketCursor,
        );
        if (read.invalid) {
          g.phase = "scan";
          continue;
        }
        g.marketCursor = read.next;
        const b = read.value;
        if (
          b &&
          b.type === "port" &&
          b.playerId !== player.id &&
          !b.remainingTicks &&
          (b.health ?? 1) > 0
        ) {
          if (
            !g.shortlist.some(
              (c) => c.tile === g.pending!.tile && c.sea === g.pending!.sea,
            )
          )
            g.shortlist.push(g.pending!);
          g.shortlist.sort((a, b) => b.score - a.score || a.tile - b.tile);
          g.shortlist.length = Math.min(8, g.shortlist.length);
          g.phase = "scan";
        } else if (read.next === null) g.phase = "scan";
      } else if (g.phase === "quote") {
        const candidate = g.shortlist[g.index];
        if (!candidate) {
          this.finish(
            g,
            "abort",
            "No funded, reachable coastal market opportunity",
          );
          break;
        }
        if (!this.legal(player, candidate.tile)) {
          g.index++;
          continue;
        }
        const land = world.paths.connected(player.base, candidate.tile);
        if (land) {
          const route = this.economy.routes.request(
            g.id,
            player.id,
            player.base,
            candidate.tile,
          );
          if (route.pending) break;
          if (!route.path) {
            g.index++;
            continue;
          }
        }
        const available = world
          .squadFacts()
          .byOwner(player.id)
          .filter(
            (s) =>
              s.troops >= 700 &&
              !s.fighting &&
              !s.refit &&
              !s.structureTarget &&
              !s.charge &&
              s.embarkedOn === null &&
              s.order.type === "hold" &&
              !this.expansion.armies.armyOf(s.id) &&
              !this.economy.assets.held(`squad:${s.id}`) &&
              world.paths.connected(player.base, world.tileOf(s)),
          );
        // Keep two squads at home. Foreign objectives require a supported larger party.
        const foreign =
          world.owners[candidate.tile] !== 0 &&
          world.owners[candidate.tile] !== player.id;
        const count = Math.min(foreign ? 4 : 2, available.length - 2);
        if (count < (foreign ? 4 : 2)) {
          g.nextThink = world.tick + 100;
          g.reason =
            "Waiting for an acquisition force while retaining mobile reserves";
          break;
        }
        g.members = available.slice(0, count).map((s) => s.id);
        g.tile = candidate.tile;
        g.sea = candidate.sea;
        if (
          !this.economy.assets.acquire(
            g.members.map((id) => ({
              asset: `squad:${id}` as const,
              playerId: player.id,
              generation: g!.generation,
              controller: g!.id,
              priority: "operation" as const,
              createdTick: world.tick,
              expiresTick: g!.deadline,
            })),
          )
        ) {
          g.members = [];
          g.nextThink = world.tick + 100;
          break;
        }
        const rejection = world.applyCommand({
          type: "order",
          playerId: player.id,
          squadIds: g.members,
          order: { type: "move", tile: g.tile },
        });
        if (rejection) {
          this.economy.assets.release(g.id);
          g.members = [];
          g.index++;
          g.reason = rejection;
          continue;
        }
        g.phase = "move";
        g.reason = land
          ? "Moving the paid standing force to its certified coast"
          : "Using researched physical shore transport for coastal acquisition";
        this.economy.routes.release(g.id);
        break;
      } else if (g.phase === "move" || g.phase === "capture") {
        if (
          !this.legal(player, g.tile!) ||
          g.members.some(
            (id) =>
              !world.squad(id) ||
              world.squad(id)!.playerId !== player.id ||
              !this.economy.assets.owns(`squad:${id}`, g!.id),
          )
        ) {
          this.finish(g, "abort", "Coast access or acquisition force changed");
          break;
        }
        if (this.owned(player,g.tile!)) {
          g.phase = "fund";
          g.reason =
            "Ownership acquired through occupation; funding the real port";
          continue;
        }
        const members = g.members.map((id) => world.squad(id)!);
        if (
          members.every(
            (s) =>
              s.embarkedOn === null &&
              world.map.euclideanDistSquared(world.tileOf(s), g!.tile!) <=
                3 ** 2,
          )
        ) {
          g.phase = "capture";
          g.reason = "Waiting for authoritative coastal occupation";
        }
        g.nextThink = world.tick + 40;
        break;
      } else if (g.phase === "fund") {
        if (!this.owned(player,g.tile!)) {
          this.finish(
            g,
            "abort",
            "Coast ownership lost before unpaid construction",
          );
          break;
        }
        const existing = world
          .buildingsAt(g.tile!)
          .find((b) => b.type === "port" && b.playerId === player.id);
        if (existing) {
          const source = world
            .buildingFacts()
            .byOwner(player.id)
            .find(
              (b) =>
                b.type === "factory" &&
                (b.health ?? 1) > 0 &&
                world.map.euclideanDistSquared(b.tile, g!.tile!) <= 20 ** 2 &&
                world.paths.connected(b.tile, g!.tile!),
            );
          if (source) {
            this.finish(
              g,
              "complete",
              "Coastal acquisition delivered a port and reachable goods producer",
            );
            break;
          }
          const technology = buildingTechnology("factory", state.age);
          if (!technology || !state.completed.includes(technology)) {
            g.reason =
              "Waiting for researched goods production at the acquired coast";
            g.nextThink = world.tick + 100;
            break;
          }
          const tiles = world.ownedLandNearest(player.id, g.tile!, 8),
            site = tiles[(g.siteCursor ?? 0) % Math.max(1, tiles.length)];
          g.siteCursor = (g.siteCursor ?? 0) + 1;
          if (
            site === undefined ||
            world.buildingSite(player.id, "factory", site, state.age)
          )
            continue;
          const cost = buildingCost(
            "factory",
            state.age,
            world
              .buildingFacts()
              .byOwner(player.id)
              .filter((b) => b.type === "factory").length,
          );
          const stock = {
            gold: player.gold,
            reserves: player.reserves,
            items: this.expansion.supply.inventories[player.id],
          };
          if (
            !affordableAiCost(
              this.economy.ledger.spendable(player.id, stock, g.id, "growth"),
              cost,
            )
          ) {
            g.reason =
              "Saving for the coast's real goods-production dependency";
            g.nextThink = world.tick + 100;
            break;
          }
          if (
            !this.economy.ledger.tryReserve(
              {
                id: g.id,
                playerId: player.id,
                generation: g.generation,
                claimant: g.id,
                priority: "growth",
                amounts: cost,
                createdTick: g.created,
                progressTick: world.tick,
                expiresTick: g.deadline,
              },
              stock,
            )
          )
            break;
          const result = world.applyCommand({
            type: "build",
            playerId: player.id,
            buildingType: "factory",
            tile: site,
          });
          this.economy.ledger.release(g.id);
          if (result) {
            g.reason = result;
            g.nextThink = world.tick + 100;
            break;
          }
          this.finish(
            g,
            "complete",
            "Acquired coast has paid port and goods-production dependencies",
          );
          break;
        }
        const technology = buildingTechnology("port", state.age);
        if (!technology || !state.completed.includes(technology)) {
          g.reason = "Waiting for normal port research";
          g.nextThink = world.tick + 100;
          break;
        }
        const rejection = world.buildingSite(
          player.id,
          "port",
          g.tile!,
          state.age,
        );
        if (rejection) {
          this.finish(g, "abort", rejection);
          break;
        }
        const cost = buildingCost(
          "port",
          state.age,
          world
            .buildingFacts()
            .byOwner(player.id)
            .filter((b) => b.type === "port").length,
        );
        const stock = {
          gold: player.gold,
          reserves: player.reserves,
          items: this.expansion.supply.inventories[player.id],
        };
        const available = this.economy.ledger.spendable(
          player.id,
          stock,
          g.id,
          "growth",
        );
        if (!affordableAiCost(available, cost)) {
          g.reason = "Saving liquid funds for coastal infrastructure";
          g.nextThink = world.tick + 100;
          break;
        }
        if (
          !this.economy.ledger.tryReserve(
            {
              id: g.id,
              playerId: player.id,
              generation: g.generation,
              claimant: g.id,
              priority: "growth",
              amounts: cost,
              createdTick: g.created,
              progressTick: world.tick,
              expiresTick: g.deadline,
            },
            stock,
          )
        ) {
          break;
        }
        const result = world.applyCommand({
          type: "build",
          playerId: player.id,
          buildingType: "port",
          tile: g.tile!,
        });
        this.economy.ledger.release(g.id);
        if (result) this.finish(g, "abort", result);
        else {
          g.reason =
            "Port construction paid; completing the real goods dependency";
          g.nextThink = world.tick + 100;
        }
        break;
      } else break;
    }
    // Local invasion observations can interrupt even while the objective is saving.
    if (operations.enabled(player) && g.tile !== undefined) {
      const point = tilePoint(world.map, g.tile);
      const threat = world
        .nearbyArmyEnemies(point, 8 * FIXED, player.id)
        .find((s) => world.hostile(player.id, s.playerId));
      if (threat) operations.threatened(player.id, threat.playerId, g.tile);
    }
    return used;
  }
}
