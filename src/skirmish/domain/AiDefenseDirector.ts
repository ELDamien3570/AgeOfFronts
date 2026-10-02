import { AiDefenseOutline, type DefenseOutlineState } from "./AiDefenseOutline";
import type { Player } from "../Protocol";
import { FIXED } from "../Protocol";
import { personalityOf } from "../content/AiPersonalities";
import { buildingTechnology } from "../content/Buildings";
import { affordableAiCost } from "./AiBudgetLedger";
import {
  quoteAiDefense,
  rectangularDefensePerimeter,
  type AiDefenseQuote,
  type AiDefenseSite,
} from "./AiDefenseQuote";
import type { AiEconomicDirector } from "./AiEconomicDirector";
import type { Age, Cost, Inventory } from "./Definitions";
import type { Expansion } from "./Expansion";
import { boxSweepEntry } from "./ProjectileCollision";

interface DefenseProject {
  id: string;
  playerId: number;
  generation: number;
  age: Age;
  cityId: string;
  cityRevision: number;
  sites: AiDefenseSite[];
  perimeter: Set<number>;
  quote: AiDefenseQuote;
  phase:
    | "proposed"
    | "reserved"
    | "building"
    | "linking"
    | "defended"
    | "paused"
    | "abandoned";
  next: number;
  paid: number[];
  defenders: number[];
  quietSince: number;
  lastProgress: number;
  nextDecision: number;
  reason?: string;
  funded: Cost;
  repair?: { kind: "building" | "wall"; id: number };
  health: Map<string, { tick: number; health: number }>;
}
interface WallAllowance {
  amount: number;
  tick: number;
}
/** Persistent city project owner. Paid structures remain normal world entities;
 * abandonment releases only unpaid stock and movement leases. Modern fronts
 * use a separate proposal policy rather than pretending these are gun belts.
 */
export class AiDefenseDirector {
  readonly projects = new Map<number, DefenseProject>();
  private readonly allowances = new Map<number, WallAllowance>();
  private cursor = 0;
  private readonly cityCursors = new Map<number, number>();
  private nextBuild = 0;
  private readonly proposalRetry = new Map<number, number>();
  private readonly outlines = new Map<number, { cityId: string; revision: number; retryAt: number; state: DefenseOutlineState }>();
  readonly diagnostics = {
    proposed: 0,
    commands: 0,
    rejected: 0,
    abandoned: 0,
    outlineWork: 0,
  };
  constructor(
    private readonly expansion: Expansion,
    private readonly economy: AiEconomicDirector,
  ) {}
  checkpoint() {
    return structuredClone({
      projects: [...this.projects],
      allowances: [...this.allowances],
      cityCursors: [...this.cityCursors],
      cursor: this.cursor,
      nextBuild: this.nextBuild,
      outlines: [...this.outlines],
      proposalRetry: [...this.proposalRetry],
    });
  }
  restore(saved: ReturnType<AiDefenseDirector["checkpoint"]>): void {
    this.proposalRetry.clear();
    for (const [id, tick] of saved.proposalRetry ?? []) this.proposalRetry.set(id, tick);
    this.outlines.clear();
    for (const [id, outline] of structuredClone(saved.outlines ?? [])) this.outlines.set(id, outline);
    this.projects.clear();
    for (const [id, project] of structuredClone(saved.projects))
      this.projects.set(id, project);
    this.allowances.clear();
    for (const [id, allowance] of saved.allowances)
      this.allowances.set(id, allowance);
    this.cursor = saved.cursor;
    this.nextBuild = saved.nextBuild;
    this.cityCursors.clear();
    for (const [id, cursor] of saved.cityCursors)
      this.cityCursors.set(id, cursor);
  }
  release(playerId: number): void {
    const project = this.projects.get(playerId);
    if (project) {
      this.economy.ledger.release(project.id);
      this.economy.assets.release(project.id);
    }
    this.projects.delete(playerId);
    this.allowances.delete(playerId);
    this.cityCursors.delete(playerId);
    this.outlines.delete(playerId);
    this.proposalRetry.delete(playerId);
  }
  production(playerId: number): Inventory {
    const project = this.projects.get(playerId);
    if (!project || ["defended", "abandoned"].includes(project.phase))
      return {};
    const items: Inventory = {};
    for (const step of project.quote.steps.slice(
      project.next,
      project.next + (project.next ? 1 : 2),
    ))
      for (const [id, n] of Object.entries(step.cost.items ?? {}))
        items[id] = (items[id] ?? 0) + n;
    return items;
  }
  private abandon(project: DefenseProject, reason: string): void {
    project.phase = "abandoned";
    project.reason = reason;
    project.nextDecision = this.expansion.world.tick + 400;
    this.economy.ledger.release(project.id);
    this.economy.assets.release(project.id);
    this.diagnostics.abandoned++;
  }
  private liquid(player: Player): Cost {
    return {
      gold: player.gold,
      reserves: player.reserves,
      items: this.expansion.supply.inventories[player.id],
    };
  }
  private allowance(player: Player): WallAllowance {
    const { world } = this.expansion,
      profile = personalityOf(player),
      previous = this.allowances.get(player.id) ?? {
        amount: 0,
        tick: world.tick,
      },
      fraction =
        profile.id === "warden"
          ? 25
          : ["builder", "merchant"].includes(profile.id)
            ? 20
            : 10,
      income =
        20 +
        Math.floor(
          player.land / (40 * (world.options?.territoryIncomeScale ?? 1)),
        );
    // Missed decisions do not create a catch-up construction burst.
    previous.amount = Math.min(
      120000,
      previous.amount +
        Math.floor(
          (income * Math.min(120, world.tick - previous.tick) * fraction) /
            2000,
        ),
    );
    previous.tick = world.tick;
    this.allowances.set(player.id, previous);
    return previous;
  }
  private proposal(player: Player): DefenseProject | undefined {
    const { world, progression, fortifications, diplomacy, supply } =
        this.expansion,
      state = progression.states[player.id],
      technology = buildingTechnology("tower", state.age);
    if (!technology || !state.completed.includes(technology)) return;
    const own = world.buildings.filter((b) => b.playerId === player.id),
      towers = own.filter((b) => b.type === "tower").length;
    if (
      towers >= 32 ||
      fortifications.barriers
        .filter((b) => b.playerId === player.id)
        .reduce((n, b) => n + b.tiles.length, 0) >= 384
    )
      return;
    const cities = [...this.economy.cities.records.values()]
      .filter(
        (c) =>
          c.playerId === player.id &&
          c.kind !== "outpost" &&
          c.sites.length >= 2 &&
          this.economy.cities.valid(c) &&
          world.tick - c.stableSince >= 100,
      )
      .sort(
        (a, b) =>
          b.buildings.length - a.buildings.length ||
          a.anchorTile - b.anchorTile,
      );
    const pending = this.outlines.get(player.id), cursor = this.cityCursors.get(player.id) ?? 0,
      city = pending ? cities.find(c => c.id === pending.cityId) : cities[cursor % Math.max(1, cities.length)];
    if (!pending) this.cityCursors.set(player.id, cursor + 1);
    if (!city) { this.outlines.delete(player.id); return; }
    if (pending && pending.revision !== city.revision) { this.outlines.delete(player.id); return; }
    if (pending && pending.retryAt > world.tick) return;
    if (pending?.state.phase === "failed") { this.outlines.delete(player.id); return; }
    let tiles = rectangularDefensePerimeter(world.map, {
      left: city.bounds.left - 4,
      top: city.bounds.top - 4,
      right: city.bounds.right + 4,
      bottom: city.bounds.bottom + 4,
    });
    let perimeter = new Set<number>();
    const usable = (tile: number) => world.owners[tile] === player.id && world.paths.walkable(tile) &&
      !world.buildingsAt(tile).length && !fortifications.intactWallAt(tile) &&
      !supply.resourceSites.rejection("tower", tile);
    let rectangleValid = !!tiles && tiles.length + towers <= 32;
    if (tiles) for (let i = 0; i < tiles.length; i++) {
      let x = world.map.x(tiles[i]), y = world.map.y(tiles[i]);
      const to = tiles[(i + 1) % tiles.length];
      while (true) {
        const tile = world.map.ref(x, y);
        if (!usable(tile)) rectangleValid = false;
        perimeter.add(tile);
        if (x === world.map.x(to) && y === world.map.y(to)) break;
        x += Math.sign(world.map.x(to) - x); y += Math.sign(world.map.y(to) - y);
      }
    }
    if (!rectangleValid || pending) {
      const facts = world.buildingFacts(), outline = new AiDefenseOutline(world.map, city.bounds, tile => usable(tile) &&
        ![...facts.nearby(tile, 3)].some(b => world.map.euclideanDistSquared(tile, b.tile) < 9), pending?.state);
      this.diagnostics.outlineWork = outline.step(32);
      this.outlines.set(player.id, { cityId: city.id, revision: city.revision,
        retryAt: outline.state.phase === "failed" ? world.tick + 400 : 0, state: outline.state });
      const result = outline.result();
      if (!result) {
        if (outline.state.phase === "complete") this.outlines.delete(player.id);
        return;
      }
      tiles = result.towers; perimeter = result.perimeter;
      this.outlines.delete(player.id);
      if (tiles.length + towers > 32 || [...perimeter].some(t => !usable(t))) return;
    }
    if (!tiles) return;
    if (
      perimeter.size +
        fortifications.barriers
          .filter((b) => b.playerId === player.id)
          .reduce((n, b) => n + b.tiles.length, 0) >
      384
    )
      return;
    const sites: AiDefenseSite[] = tiles.map((tile) => ({
        type: "tower",
        tile,
      })),
      quote = quoteAiDefense({
        map: world.map,
        owners: world.owners,
        player,
        age: state.age,
        buildings: world.buildings,
        buildingFacts: world.buildingFacts(),
        fortifications,
        diplomacy,
        resources: supply.resourceSites,
        sites,
        allowedWall: (t) => usable(t),
      });
    if (typeof quote === "string") return;
    // Automatic production links can add a legal shortcut at a concave corner.
    // Retain its actual paid footprint, but still require every intended edge.
    const firstId = world.buildingFacts().highestId + 1;
    const edges = new Set(quote.steps.flatMap((step, index) => step.links.map(link =>
      [link.a, firstId + index].sort((a,b) => a-b).join(":"))));
    if (sites.some((_, index) => !edges.has([firstId + index, firstId + (index + 1) % sites.length].sort((a,b) => a-b).join(":")))) return;
    for (const step of quote.steps) for (const link of step.links) for (const tile of link.tiles) perimeter.add(tile);
    if (perimeter.size + fortifications.barriers.filter(b => b.playerId === player.id).reduce((n,b) => n + b.tiles.length, 0) > 384) return;
    this.diagnostics.proposed++;
    return {
      id: `defense:${player.id}:${city.anchorTile}`,
      playerId: player.id,
      generation: world.aiGeneration(player.id),
      age: state.age,
      cityId: city.id,
      cityRevision: city.revision,
      sites,
      perimeter,
      quote,
      phase: "proposed",
      next: 0,
      paid: [],
      defenders: [],
      quietSince: world.tick,
      lastProgress: world.tick,
      nextDecision: world.tick,
      funded: {},
      health: new Map(),
    };
  }
  private staff(project: DefenseProject, player: Player): boolean {
    const { world } = this.expansion,
      assets = this.economy.assets,
      suitable = world.squads
        .filter(
          (s) =>
            s.playerId === player.id &&
            s.troops >= 700 &&
            s.embarkedOn === null &&
            !s.refit &&
            (!s.fighting || assets.owns(`squad:${s.id}`, project.id)) &&
            !s.charge &&
            !s.structureTarget &&
            s.order.type !== "board" &&
            !this.expansion.armies.armyOf(s.id) &&
            (!assets.held(`squad:${s.id}`) ||
              assets.owns(`squad:${s.id}`, project.id)) &&
            ["frontline", "ranged"].includes(this.expansion.unit(s).role) &&
            world.paths.connected(world.tileOf(s), project.sites[0].tile),
        )
        .sort((a, b) => a.id - b.id),
      total = world.squads.filter(
        (s) =>
          s.playerId === player.id &&
          s.embarkedOn === null &&
          !s.refit &&
          s.troops >= 700,
      ).length;
    if (
      suitable.length < 2 ||
      total < personalityOf(player).minimumRaidSquads + 2
    )
      return false;
    const chosen =
      project.defenders.length === 2 &&
      project.defenders.every((id) => suitable.some((s) => s.id === id))
        ? project.defenders
        : suitable.slice(0, 2).map((s) => s.id);
    if (
      !assets.acquire(
        chosen.map((id) => ({
          asset: `squad:${id}` as const,
          controller: project.id,
          playerId: player.id,
          generation: project.generation,
          priority: "defense" as const,
          createdTick: world.tick,
          expiresTick: world.tick + 200,
        })),
      )
    )
      return false;
    for (const [asset, lease] of assets.leases)
      if (
        lease.controller === project.id &&
        !chosen.some((id) => asset === `squad:${id}`)
      )
        assets.leases.delete(asset);
    project.defenders = chosen;
    const city = this.economy.cities.records.get(project.cityId)!,
      point = {
        x: (world.map.x(city.anchorTile) + 0.5) * FIXED,
        y: (world.map.y(city.anchorTile) + 0.5) * FIXED,
      },
      defenders = chosen.map((id) => world.squad(id)!);
    if (
      defenders.some(
        (s) => (s.x - point.x) ** 2 + (s.y - point.y) ** 2 > (4 * FIXED) ** 2,
      )
    ) {
      if (
        !defenders.every(
          (s) =>
            s.order.type === "move" &&
            world.map.euclideanDistSquared(s.order.tile, city.anchorTile) <= 16,
        )
      )
        world.applyCommand({
          type: "order",
          playerId: player.id,
          squadIds: chosen,
          order: { type: "move", tile: city.anchorTile },
        });
      return false;
    }
    if (defenders.some((s) => s.order.type !== "hold" && !s.fighting))
      world.applyCommand({
        type: "order",
        playerId: player.id,
        squadIds: defenders.filter((s) => !s.fighting).map((s) => s.id),
        order: { type: "hold" },
      });
    return true;
  }
  private occupied(project: DefenseProject, from: number, to: number): boolean {
    const { world } = this.expansion,
      tiles = new Set(project.sites.slice(from, to).map((s) => s.tile));
    for (const step of project.quote.steps.slice(from, to))
      for (const link of step.links)
        for (const tile of link.tiles) tiles.add(tile);
    const footprint = [...tiles];
    return world.squads.some(
      (s) =>
        s.embarkedOn === null &&
        footprint.some(
          (tile) =>
            boxSweepEntry(
              s,
              s,
              { x: world.map.x(tile) * FIXED, y: world.map.y(tile) * FIXED },
              FIXED,
              FIXED / 2,
            ) !== null,
        ),
    );
  }
  private repair(
    project: DefenseProject,
    player: Player,
    allowance: WallAllowance,
  ): void {
    const { world, fortifications } = this.expansion;
    if (
      project.repair &&
      fortifications.repairing(project.repair.kind, project.repair.id)
    )
      return;
    project.repair = undefined;
    const candidates: ["building" | "wall", number, number, number, number][] =
      [];
    const walls = fortifications.barriers.filter(
      (b) =>
        b.playerId === player.id &&
        project.paid.includes(b.a) &&
        project.paid.includes(b.b) &&
        b.health > 0 &&
        !b.remainingTicks,
    );
    for (const b of world.buildings.filter(
      (b) =>
        project.paid.includes(b.id) && !b.remainingTicks && (b.health ?? 1) > 0,
    )) {
      const health = b.health ?? b.maxHealth ?? 1200,
        missing = (b.maxHealth ?? 1200) - health;
      candidates.push([
        "building",
        b.id,
        health,
        missing,
        walls.filter((w) => w.a === b.id || w.b === b.id).length * 500,
      ]);
    }
    for (const wall of walls)
      candidates.push([
        "wall",
        wall.id,
        wall.health,
        wall.maxHealth - wall.health,
        wall.tiles.length * 10,
      ]);
    const viable = candidates
      .filter(([kind, id, health, missing]) => {
        const key = `${kind}:${id}`,
          previous = project.health.get(key);
        project.health.set(key, { tick: world.tick, health });
        return (
          missing > 0 &&
          (!previous ||
            previous.health <= health ||
            (previous.health - health) * 20 <=
              50 * Math.max(1, world.tick - previous.tick))
        );
      })
      .sort((a, b) => b[4] - a[4] || b[3] - a[3] || a[1] - b[1]);
    const target = viable[0];
    if (!target) return;
    const [kind, id, , missing] = target,
      cost = { gold: Math.ceil(missing / 5) },
      claimant = `${project.id}:repair`,
      liquid = this.liquid(player);
    if (
      cost.gold > allowance.amount ||
      !affordableAiCost(
        this.economy.ledger.spendable(player.id, liquid, claimant),
        cost,
      )
    )
      return;
    if (
      !this.economy.ledger.tryReserve(
        {
          id: claimant,
          claimant,
          playerId: player.id,
          generation: project.generation,
          priority: "growth",
          amounts: cost,
          createdTick: world.tick,
          progressTick: world.tick,
          expiresTick: world.tick + 200,
        },
        liquid,
      )
    )
      return;
    const rejected = world.applyCommand({
      type: "repair",
      playerId: player.id,
      ...(kind === "building" ? { buildingId: id } : { barrierId: id }),
    });
    this.economy.ledger.release(claimant);
    this.diagnostics.commands++;
    if (rejected) this.diagnostics.rejected++;
    else {
      project.repair = { kind, id };
      allowance.amount -= cost.gold;
    }
  }
  step(): void {
    const { world } = this.expansion;
    this.diagnostics.outlineWork = 0;
    if (world.tick % 3) return;
    for (let i = 0; i < world.players.length; i++) {
      const player = world.players[this.cursor % world.players.length];
      this.cursor = (this.cursor + 1) % world.players.length;
      if (!this.economy.enabled(player)) continue;
      const allowance = this.allowance(player);
      let project = this.projects.get(player.id);
      if (project && world.tick < project.nextDecision) continue;
      if (project?.phase === "abandoned") {
        const city = this.economy.cities.records.get(project.cityId);
        if (city && city.revision === project.cityRevision) continue;
        this.projects.delete(player.id);
        project = undefined;
      }
      if (!project) {
        if ((this.proposalRetry.get(player.id) ?? 0) > world.tick) continue;
        project = this.proposal(player);
        if (project) this.projects.set(player.id, project);
        else if (!this.outlines.has(player.id)) this.proposalRetry.set(player.id, world.tick + 120);
      }
      if (project) this.advance(project, player, allowance);
      break;
    }
  }
  private advance(
    project: DefenseProject,
    player: Player,
    allowance: WallAllowance,
  ): void {
    const { world, progression } = this.expansion,
      city = this.economy.cities.records.get(project.cityId);
    project.nextDecision = world.tick + 20;
    if (
      project.generation !== world.aiGeneration(player.id) ||
      progression.states[player.id].age !== project.age ||
      !city ||
      city.revision !== project.cityRevision ||
      !this.economy.cities.valid(city) ||
      project.paid.some(
        (id) =>
          !world.buildings.some(
            (b) =>
              b.id === id && b.playerId === player.id && (b.health ?? 1) > 0,
          ),
      )
    ) {
      this.abandon(project, "Hub, tier, ownership or a paid endpoint changed");
      return;
    }
    if (world.tick - project.lastProgress > 2400) {
      this.abandon(project, "Funding or construction made no progress");
      return;
    }
    if (!this.staff(project, player)) {
      project.phase = "paused";
      project.reason = "Waiting for available defenders and a mobile reserve";
      this.economy.ledger.release(project.id);
      return;
    }
    const latest = world.buildings.find(
      (b) => b.id === project.paid[project.paid.length - 1],
    );
    if (latest?.remainingTicks) {
      project.phase = "building";
      project.lastProgress = world.tick;
      return;
    }
    if (project.next >= project.sites.length) {
      const walls = this.expansion.fortifications.barriers.filter(
        (b) => b.playerId === player.id && b.health > 0 && !b.remainingTicks,
      );
      if (
        project.paid.some(
          (id) =>
            new Set(
              walls
                .filter((b) => b.a === id || b.b === id)
                .map((b) => (b.a === id ? b.b : b.a))
                .filter((id) => project.paid.includes(id)),
            ).size < 2,
        )
      ) {
        this.abandon(
          project,
          "The intended enclosure is not an intact closed circuit",
        );
        return;
      }
      project.phase = "defended";
      project.lastProgress = world.tick;
      this.economy.ledger.release(project.id);
      this.repair(project, player, allowance);
      return;
    }
    const end = Math.min(
      project.sites.length,
      project.next + (project.next ? 1 : 2),
    );
    if (this.occupied(project, project.next, end)) {
      project.quietSince = world.tick;
      project.phase = "paused";
      project.reason = "Waiting for troops to clear the planned footprint";
      return;
    }
    if (world.tick - project.quietSince < 100) return;
    const sites = project.sites.slice(project.next, end),
      quote = quoteAiDefense({
        map: world.map,
        owners: world.owners,
        player,
        age: project.age,
        buildings: world.buildings,
        buildingFacts: world.buildingFacts(),
        fortifications: this.expansion.fortifications,
        diplomacy: this.expansion.diplomacy,
        resources: this.expansion.supply.resourceSites,
        sites,
        allowedWall: (tile) => project.perimeter.has(tile),
      });
    if (typeof quote === "string") {
      this.abandon(project, quote);
      return;
    }
    for (const enemy of world.squads)
      if (
        enemy.embarkedOn === null &&
        world.hostile(player.id, enemy.playerId)
      ) {
        const current = world.map.euclideanDistSquared(
            world.tileOf(enemy),
            city.anchorTile,
          ),
          approaching =
            enemy.fighting ||
            (enemy.order.type === "move" &&
              world.map.euclideanDistSquared(
                enemy.order.tile,
                city.anchorTile,
              ) < current) ||
            (enemy.order.type === "attack" &&
              world.squad(enemy.order.targetId)?.playerId === player.id);
        if (!approaching) continue;
        const distance =
            Math.min(
              ...sites.map((s) =>
                Math.sqrt(
                  world.map.euclideanDistSquared(world.tileOf(enemy), s.tile),
                ),
              ),
            ) *
              FIXED -
            this.expansion.unit(enemy).attack.range,
          arrival =
            Math.max(0, distance) / Math.max(1, world.ordinarySpeed(enemy));
        if (arrival < quote.ticks + 100) {
          project.phase = "paused";
          project.reason = "No safe construction window before hostile contact";
          project.quietSince = world.tick;
          this.economy.ledger.release(project.id);
          return;
        }
      }
    const liquid = this.liquid(player),
      available = this.economy.ledger.spendable(player.id, liquid, project.id),
      cost = quote.cost;
    // Emergency replacement/growth commitments retain their stock. The wall
    // allowance is an entitlement limit, never new money or forecast credit.
    if (
      (cost.gold ?? 0) > allowance.amount ||
      !affordableAiCost(available, cost)
    ) {
      project.phase = "proposed";
      project.reason = "Saving the next useful defense phase";
      return;
    }
    if (
      !this.economy.ledger.tryReserve(
        {
          id: project.id,
          claimant: project.id,
          playerId: player.id,
          generation: project.generation,
          priority: "growth",
          amounts: cost,
          createdTick: world.tick,
          progressTick: world.tick,
          expiresTick: world.tick + 2400,
        },
        liquid,
      )
    )
      return;
    project.phase = "reserved";
    project.funded = cost;
    if (world.tick < this.nextBuild) return;
    const step = quote.steps[0],
      before = new Set(world.buildingsAt(step.tile).map((b) => b.id)),
      rejection = world.applyCommand({
        type: "build",
        playerId: player.id,
        buildingType: step.type,
        tile: step.tile,
        age: project.age,
      });
    this.diagnostics.commands++;
    this.economy.ledger.release(project.id);
    if (rejection) {
      project.phase = "paused";
      project.reason = rejection;
      this.diagnostics.rejected++;
      return;
    }
    const paid = world.buildingsAt(step.tile).find((b) => !before.has(b.id))!;
    project.paid.push(paid.id);
    project.next++;
    project.lastProgress = world.tick;
    project.phase = project.next === 1 ? "building" : "linking";
    allowance.amount = Math.max(0, allowance.amount - (step.cost.gold ?? 0));
    this.nextBuild = world.tick + 20;
    // Preserve the rest of the useful opening phase after its first payment.
    const remaining: Cost = {
      gold: Math.max(0, (cost.gold ?? 0) - (step.cost.gold ?? 0)),
      items: {},
    };
    const items: Inventory = {};
    for (const [id, n] of Object.entries(cost.items ?? {}))
      items[id] = Math.max(0, n - (step.cost.items?.[id] ?? 0));
    remaining.items = items;
    if ((remaining.gold ?? 0) > 0 || Object.values(items).some((n) => n > 0))
      this.economy.ledger.tryReserve(
        {
          id: project.id,
          claimant: project.id,
          playerId: player.id,
          generation: project.generation,
          priority: "growth",
          amounts: remaining,
          createdTick: world.tick,
          progressTick: world.tick,
          expiresTick: world.tick + 2400,
        },
        this.liquid(player),
      );
  }
}
