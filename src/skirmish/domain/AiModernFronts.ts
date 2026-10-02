import { FIXED, type Player, type Squad } from "../Protocol";
import { buildingTechnology } from "../content/Buildings";
import { affordableAiCost } from "./AiBudgetLedger";
import { quoteAiDefense, type AiDefenseSite } from "./AiDefenseQuote";
import type { AiEconomicDirector } from "./AiEconomicDirector";
import type { AiFrontRecord } from "./AiFrontRecords";
import type { Cost, Inventory } from "./Definitions";
import type { Expansion } from "./Expansion";

interface Assessment {
  cursor: number;
  length: number;
  available: number;
  members: number[];
  enemyTroops: number;
  nearest: number;
}
export interface ModernSection {
  id: string;
  playerId: number;
  generation: number;
  frontId: string;
  anchor: number;
  direction: number;
  sites: AiDefenseSite[];
  paid: number[];
  members: number[];
  reserve: number;
  phase: "staffing" | "funding" | "building" | "holding" | "withdrawn";
  since: number;
  nextDecision: number;
  quietSince: number;
  reason?: string;
  assessment?: Assessment;
}
/** Funded three-site Modern sections: two occupied trenches, one supported gun
 * position, and a mobile reserve. Paid structures survive retreat and takeover. */
export class AiModernFronts {
  readonly sections = new Map<number, ModernSection>();
  private player = 0;
  private nextBuild = 0;
  private readonly retries = new Map<number, number>();
  readonly diagnostics = { work: 0, commands: 0, reused: 0, withdrawals: 0 };
  constructor(
    private readonly expansion: Expansion,
    private readonly economy: AiEconomicDirector,
  ) {}
  checkpoint() {
    return structuredClone({
      sections: [...this.sections],
      player: this.player,
      nextBuild: this.nextBuild,
      retries: [...this.retries],
    });
  }
  restore(saved: ReturnType<AiModernFronts["checkpoint"]>): void {
    this.sections.clear();
    for (const [id, s] of structuredClone(saved.sections))
      this.sections.set(id, s);
    this.player = saved.player;
    this.nextBuild = saved.nextBuild;
    this.retries.clear();
    for (const [id, t] of saved.retries) this.retries.set(id, t);
  }
  release(playerId: number): void {
    const section = this.sections.get(playerId);
    if (section) {
      this.economy.assets.release(section.id);
      this.economy.ledger.release(section.id);
    }
    this.sections.delete(playerId);
    this.retries.delete(playerId);
  }
  production(playerId: number): Inventory {
    const section = this.sections.get(playerId);
    if (!section || ["holding", "withdrawn"].includes(section.phase)) return {};
    const quote = this.quote(section);
    return typeof quote === "string" ? {} : (quote.cost.items ?? {});
  }
  private liquid(player: Player): Cost {
    return {
      gold: player.gold,
      reserves: player.reserves,
      items: this.expansion.supply.inventories[player.id],
    };
  }
  private enabled(player: Player): boolean {
    const state = this.expansion.progression.states[player.id],
      tech = buildingTechnology("trench", "Modern");
    return (
      this.economy.enabled(player) &&
      state.age === "Modern" &&
      !!tech &&
      state.completed.includes(tech)
    );
  }
  private funded(section: ModernSection, site: AiDefenseSite) {
    return this.expansion.world
      .buildingsAt(site.tile)
      .find(
        (b) =>
          b.playerId === section.playerId &&
          b.type === site.type &&
          (b.health ?? 1) > 0,
      );
  }
  private quote(section: ModernSection) {
    const { world } = this.expansion;
    return quoteAiDefense({
      map: world.map,
      owners: world.owners,
      player: world.players.find((p) => p.id === section.playerId)!,
      age: "Modern",
      buildings: world.buildings,
      buildingFacts: world.buildingFacts(),
      fortifications: this.expansion.fortifications,
      diplomacy: this.expansion.diplomacy,
      resources: this.expansion.supply.resourceSites,
      sites: section.sites.filter((site) => !this.funded(section, site)),
    });
  }
  private propose(
    player: Player,
    front: AiFrontRecord,
  ): ModernSection | undefined {
    const { world } = this.expansion,
      dx = [1, -1, 0, 0][front.direction],
      dy = [0, 0, 1, -1][front.direction],
      px = -dy,
      py = dx;
    const point = (back: number, side: number) => {
      const x = world.map.x(front.anchor) - dx * back + px * side,
        y = world.map.y(front.anchor) - dy * back + py * side;
      return world.map.isValidCoord(x, y) ? world.map.ref(x, y) : undefined;
    };
    const tiles = [point(4, -2), point(4, 2), point(8, 0)],
      reserve = point(12, 0);
    if (
      tiles.some((t) => t === undefined) ||
      reserve === undefined ||
      !world.paths.walkable(reserve) ||
      world.owners[reserve] !== player.id
    )
      return;
    const facts = world.buildingFacts();
    if (
      facts.countOfType(player.id, "trench") > 8 ||
      facts.countOfType(player.id, "gun-nest") > 4
    )
      return;
    const section: ModernSection = {
      id: `front:${player.id}:${front.id}`,
      playerId: player.id,
      generation: world.aiGeneration(player.id),
      frontId: front.id,
      anchor: front.anchor,
      direction: front.direction,
      sites: tiles.map((tile, i) => ({
        tile: tile!,
        type: i < 2 ? "trench" : "gun-nest",
      })),
      paid: [],
      members: [],
      reserve,
      phase: "staffing",
      since: world.tick,
      nextDecision: world.tick,
      quietSince: world.tick,
    };
    if (typeof this.quote(section) === "string") return;
    for (const site of section.sites) {
      const b = this.funded(section, site);
      if (b) {
        section.paid.push(b.id);
        this.diagnostics.reused++;
      }
    }
    return section;
  }
  private withdraw(section: ModernSection, reason: string): void {
    const { world } = this.expansion,
      player = world.players.find((p) => p.id === section.playerId)!;
    const members = section.members.filter(
      (id) =>
        this.economy.assets.owns(`squad:${id}`, section.id) &&
        world.squad(id)?.playerId === player.id,
    );
    if (members.length)
      world.applyCommand({
        type: "order",
        playerId: player.id,
        squadIds: members,
        order: { type: "move", tile: player.base },
      });
    this.economy.assets.release(section.id);
    this.economy.ledger.release(section.id);
    section.members = [];
    section.assessment = undefined;
    section.phase = "withdrawn";
    section.reason = reason;
    section.nextDecision = world.tick + 400;
    this.diagnostics.withdrawals++;
  }
  private suitable(squad: Squad, section: ModernSection): boolean {
    return (
      squad.playerId === section.playerId &&
      squad.troops >= 700 &&
      squad.embarkedOn === null &&
      !squad.refit &&
      !squad.charge &&
      !squad.structureTarget &&
      (!squad.fighting ||
        this.economy.assets.owns(`squad:${squad.id}`, section.id)) &&
      squad.order.type !== "board" &&
      !this.expansion.armies.armyOf(squad.id) &&
      (!this.economy.assets.held(`squad:${squad.id}`) ||
        this.economy.assets.owns(`squad:${squad.id}`, section.id)) &&
      ["frontline", "ranged", "artillery", "anti-air"].includes(
        this.expansion.unit(squad).role,
      ) &&
      this.expansion.world.paths.connected(
        this.expansion.world.tileOf(squad),
        section.reserve,
      )
    );
  }
  private assessment(section: ModernSection, budget: number): number {
    const { world } = this.expansion;
    if (
      !section.assessment ||
      section.assessment.length !== world.squads.length
    )
      section.assessment = {
        cursor: 0,
        length: world.squads.length,
        available: 0,
        members: [],
        enemyTroops: 0,
        nearest: Infinity,
      };
    const scan = section.assessment;
    let used = 0;
    while (used < budget && scan.cursor < world.squads.length) {
      const squad = world.squads[scan.cursor++];
      used++;
      if (this.suitable(squad, section)) {
        scan.available++;
        const frontline = this.expansion.unit(squad).role === "frontline";
        const similar = scan.members.filter((id) => {
          const s = world.squad(id);
          return (
            s && (this.expansion.unit(s).role === "frontline") === frontline
          );
        }).length;
        if (similar < 6) scan.members.push(squad.id);
      } else if (
        squad.embarkedOn === null &&
        world.hostile(section.playerId, squad.playerId)
      ) {
        const distance = world.map.euclideanDistSquared(
          world.tileOf(squad),
          section.anchor,
        );
        if (distance <= 24 ** 2) {
          scan.enemyTroops += squad.troops;
          scan.nearest = Math.min(
            scan.nearest,
            Math.max(
              0,
              Math.sqrt(distance) * FIXED -
                this.expansion.unit(squad).attack.range,
            ) / Math.max(1, world.ordinarySpeed(squad)),
          );
        }
      }
    }
    return used;
  }
  private command(section: ModernSection, ids: number[], tile: number): void {
    const { world } = this.expansion,
      live = ids.map((id) => world.squad(id)).filter((s): s is Squad => !!s);
    if (
      live.some(
        (s) =>
          world.map.euclideanDistSquared(world.tileOf(s), tile) > 1 &&
          !(s.order.type === "move" && s.order.tile === tile),
      )
    ) {
      world.applyCommand({
        type: "order",
        playerId: section.playerId,
        squadIds: live.map((s) => s.id),
        order: { type: "move", tile },
      });
      this.diagnostics.commands++;
    }
  }
  private advance(section: ModernSection, player: Player): void {
    const { world } = this.expansion,
      scan = section.assessment!;
    section.nextDecision = world.tick + 40;
    section.assessment = undefined;
    const current = section.members
      .map((id) => world.squad(id))
      .filter((s): s is Squad => !!s && this.suitable(s, section));
    if (section.members.length && current.length < 3) {
      this.withdraw(section, "Garrison losses require recovery");
      return;
    }
    if (
      scan.enemyTroops >
        Math.max(2000, current.reduce((sum, s) => sum + s.troops, 0) * 2) &&
      section.members.length
    ) {
      this.withdraw(section, "Overmatched front");
      return;
    }
    const available = scan.members
      .map((id) => world.squad(id))
      .filter((s): s is Squad => !!s && this.suitable(s, section));
    const infantry = available.filter(
      (s) => this.expansion.unit(s).role === "frontline",
    );
    const support = available.filter((s) =>
      ["ranged", "artillery", "anti-air"].includes(this.expansion.unit(s).role),
    );
    if (scan.available < 6 || infantry.length < 2 || !support.length) {
      section.phase = "staffing";
      section.reason =
        "Two trench squads, support and a mobile reserve required";
      this.economy.ledger.release(section.id);
      return;
    }
    const chosen = [infantry[0].id, infantry[1].id, support[0].id];
    const reserve = available.find((s) => !chosen.includes(s.id));
    if (!reserve) return;
    chosen.push(reserve.id);
    if (
      !this.economy.assets.acquire(
        chosen.map((id) => ({
          asset: `squad:${id}` as const,
          controller: section.id,
          playerId: player.id,
          generation: section.generation,
          priority: "defense" as const,
          createdTick: world.tick,
          expiresTick: world.tick + 400,
        })),
      )
    )
      return;
    this.economy.assets.retain(
      section.id,
      new Set(chosen.map((id) => `squad:${id}` as const)),
    );
    section.members = chosen;
    // Never build under approaching fire. Existing paid cover may still be held.
    const quote = this.quote(section);
    if (typeof quote === "string") {
      this.withdraw(section, quote);
      return;
    }
    const incomplete = quote.steps.length > 0;
    if (incomplete && scan.nearest < quote.ticks + 100) {
      section.quietSince = world.tick;
      section.phase = "funding";
      section.reason = "No safe construction window";
      this.economy.ledger.release(section.id);
      return;
    }
    if (quote.steps.length) {
      section.phase = "funding";
      if (
        world.tick - section.quietSince < 100 ||
        !affordableAiCost(
          this.economy.ledger.spendable(
            player.id,
            this.liquid(player),
            section.id,
          ),
          quote.cost,
        )
      )
        return;
      if (
        !this.economy.ledger.tryReserve(
          {
            id: section.id,
            claimant: section.id,
            playerId: player.id,
            generation: section.generation,
            priority: "committed",
            amounts: quote.cost,
            createdTick: section.since,
            progressTick: world.tick,
            expiresTick: world.tick + 400,
          },
          this.liquid(player),
        )
      )
        return;
      if (
        world.tick < this.nextBuild ||
        section.sites.some((site) => this.funded(section, site)?.remainingTicks)
      )
        return;
      const site = quote.steps[0],
        rejection = world.applyCommand({
          type: "build",
          playerId: player.id,
          buildingType: site.type,
          tile: site.tile,
          age: "Modern",
        });
      this.economy.ledger.release(section.id);
      this.diagnostics.commands++;
      this.nextBuild = world.tick + 20;
      if (rejection) {
        section.reason = rejection;
        return;
      }
      const paid = this.funded(section, site)!;
      section.paid.push(paid.id);
      section.phase = "building";
      const remaining = this.quote(section);
      if (typeof remaining !== "string" && remaining.steps.length)
        this.economy.ledger.tryReserve(
          {
            id: section.id,
            claimant: section.id,
            playerId: player.id,
            generation: section.generation,
            priority: "committed",
            amounts: remaining.cost,
            createdTick: section.since,
            progressTick: world.tick,
            expiresTick: world.tick + 400,
          },
          this.liquid(player),
        );
      return;
    }
    if (
      section.sites.some((site) => this.funded(section, site)?.remainingTicks)
    ) {
      section.phase = "building";
      return;
    }
    this.economy.ledger.release(section.id);
    const ready = chosen.every(
      (id, i) =>
        world.map.euclideanDistSquared(
          world.tileOf(world.squad(id)!),
          i < 3 ? section.sites[i].tile : section.reserve,
        ) <= 1,
    );
    section.phase = ready ? "holding" : "staffing";
    section.reason = ready ? undefined : "Moving garrison into cover";
    chosen.forEach((id, i) =>
      this.command(
        section,
        [id],
        i < 3 ? section.sites[i].tile : section.reserve,
      ),
    );
  }
  step(budget = 32): number {
    const { world } = this.expansion;
    this.diagnostics.work = 0;
    if (!world.players.length) return 0;
    for (
      let checked = 0;
      checked < world.players.length && this.diagnostics.work < budget;
      checked++
    ) {
      const player = world.players[this.player++ % world.players.length];
      this.diagnostics.work++;
      if (!this.enabled(player)) {
        this.release(player.id);
        continue;
      }
      let section = this.sections.get(player.id);
      if (
        section &&
        section.phase !== "withdrawn" &&
        (section.generation !== world.aiGeneration(player.id) ||
          world.owners[section.reserve] !== player.id)
      ) {
        this.withdraw(section, "Rear access or control changed");
        continue;
      }
      if (section && world.tick < section.nextDecision) continue;
      const front = section && this.economy.fronts.records.get(section.frontId);
      if (
        section &&
        section.phase !== "withdrawn" &&
        (!front ||
          !this.economy.fronts.valid({
            ...front,
            anchor: section.anchor,
            direction: section.direction,
          }))
      ) {
        this.withdraw(section, "Front moved or treaty changed");
        continue;
      }
      if (section?.phase === "withdrawn") {
        this.sections.delete(player.id);
        section = undefined;
      }
      if (!section) {
        if ((this.retries.get(player.id) ?? 0) > world.tick) continue;
        const fronts = this.economy.fronts
          .forPlayer(player.id)
          .filter(
            (f) =>
              world.tick - f.stableSince >= 100 && this.economy.fronts.valid(f),
          )
          .sort((a, b) => b.edges - a.edges || a.anchor - b.anchor);
        this.retries.set(player.id, world.tick + 400);
        for (const front of fronts.slice(0, 4)) {
          section = this.propose(player, front);
          if (section) break;
        }
        if (!section) continue;
        this.sections.set(player.id, section);
      }
      this.diagnostics.work += this.assessment(
        section,
        Math.max(0, budget - this.diagnostics.work),
      );
      if (section.assessment!.cursor === world.squads.length)
        this.advance(section, player);
      break;
    }
    return this.diagnostics.work;
  }
}
