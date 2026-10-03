import type { Coast } from "../CoastIndex";
import type { BuildingType, Player } from "../Protocol";
import { buildingTechnology, producerCompatible } from "../content/Buildings";
import { PRODUCTION_RECIPES } from "../content/Production";
import { resourceTechnology } from "../content/Resources";
import { UNITS } from "../content/Units";
import type { AiInvestment } from "./AiEconomicPlanner";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import type { AiProductionDemand } from "./AiMilitaryDemand";
import type { Expansion } from "./Expansion";

interface LandPage { anchor: number; tiles: number[]; cursor: number; }

/** Ownership-maintained coast index; no faction-wide map search per decision. */
export class AiPlacementCandidates {
  private readonly coast = new Map<number, Coast[]>();
  private readonly ownedCoast = new Map<number, Set<number>>();
  private readonly cursors = new Map<number, number>();
  private readonly siteCursors = new Map<string, number>();
  private readonly landPages = new Map<string, LandPage>();
  private readonly coastOwner = new Map<number, number>();
  constructor(private readonly expansion: Expansion) {
    for (const group of expansion.world.coast.connections())
      for (const edge of group.edges) {
        const entries = this.coast.get(edge.landTile) ?? [];
        entries.push(edge);
        this.coast.set(edge.landTile, entries);
      }
  }
  changed(tile: number, owner: number): void {
    if (!this.coast.has(tile)) return;
    const previous = this.coastOwner.get(tile);
    if (previous) this.ownedCoast.get(previous)?.delete(tile);
    this.coastOwner.set(tile, owner);
    if (owner) {
      const tiles = this.ownedCoast.get(owner) ?? new Set<number>();
      tiles.add(tile);
      this.ownedCoast.set(owner, tiles);
    }
  }
  checkpoint() {
    return { types: [...this.cursors], sites: [...this.siteCursors], lands: [...this.landPages] };
  }
  restore(saved: ReturnType<AiPlacementCandidates["checkpoint"]>): void {
    this.cursors.clear();
    for (const [id, cursor] of saved.types) this.cursors.set(id, cursor);
    this.siteCursors.clear();
    for (const [id, cursor] of saved.sites) this.siteCursors.set(id, cursor);
    this.landPages.clear();
    for (const [key, page] of structuredClone(saved.lands ?? [])) this.landPages.set(key, page);
    this.ownedCoast.clear();
    this.coastOwner.clear();
    for (const tile of this.coast.keys())
      this.changed(tile, this.expansion.world.owners[tile]);
  }
  coasts(playerId: number): readonly number[] {
    return [...(this.ownedCoast.get(playerId) ?? [])].sort((a, b) => a - b);
  }
  private landPage(player: Player, key: string): LandPage {
    let page = this.landPages.get(key);
    if (!page || page.anchor !== player.base || page.cursor >= page.tiles.length) {
      const after = page?.anchor === player.base ? page.tiles[page.tiles.length - 1] : undefined;
      let tiles = this.expansion.world.ownedLandNearest(player.id, player.base, 64, after);
      if (!tiles.length && after !== undefined) tiles = this.expansion.world.ownedLandNearest(player.id, player.base, 64);
      page = { anchor: player.base, tiles, cursor: 0 };
      this.landPages.set(key, page);
    }
    return page;
  }
  candidates(
    player: Player,
    snapshot: AiEconomicSnapshot,
    demand?: AiProductionDemand,
  ): AiInvestment[] {
    const world = this.expansion.world,
      output: AiInvestment[] = [];
    const types: BuildingType[] = [
      "city",
      "barracks",
      "archery",
      "stables",
      "mine",
      "factory",
      "blacksmith",
      "armory",
      "arms-factory",
      "depot",
      "siege-workshop",
      "port",
      "oil-well",
      "oil-rig",
    ];
    const start = this.cursors.get(player.id) ?? 0;
    this.cursors.set(player.id, (start + 4) % types.length);
    let tested = 0;
    for (let i = 0; i < types.length && tested < 8; i++) {
      const type = types[(start + i) % types.length];
      const key = `${player.id}:${type}`;
      if (!buildingTechnology(type, snapshot.age)) continue;
      const count = snapshot.buildings.filter((b) => b.type === type).length;
      const units = UNITS.filter(
        (u) =>
          u.building === type && snapshot.research.includes(u.technologyId),
      );
      const recipes = PRODUCTION_RECIPES.filter(
        (r) =>
          r.building === type && snapshot.research.includes(r.technologyId),
      );
      const compatibleWorkshop = snapshot.buildings.some(b => producerCompatible(b.type, type));
      let missingProducer = !compatibleWorkshop && ["factory", "blacksmith", "armory", "arms-factory"].includes(type) && recipes.some(r =>
        Object.keys(r.outputs).some(id => (demand?.equipment[id] ?? demand?.materials[id] ?? 0) >
          (snapshot.liquid.items?.[id] ?? 0) + (snapshot.incoming[id] ?? 0)));
      let objective = !count && units.length ? 6000 : 0;
      if (
        !count &&
        recipes.some(
          (r) =>
            Object.keys(r.outputs).some(
              (id) =>
                (demand?.equipment[id] ?? demand?.materials[id] ?? 0) >
                (snapshot.liquid.items?.[id] ?? 0) +
                  (snapshot.incoming[id] ?? 0),
            ) ||
            Object.entries(r.inputs).every(
              ([id, n]) => (snapshot.liquid.items?.[id] ?? 0) >= n,
            ),
        )
      )
        objective += 5000;
      if (type === "city" && !count) objective = 5000;
      if (missingProducer) objective = Math.max(objective, 12000);
      const extraction = ["mine", "oil-well", "oil-rig"].includes(type);
      let tiles: readonly number[];
      let page: LandPage | undefined;
      if (extraction) {
        const ownedDeposits = this.expansion.supply.deposits.filter(d => world.owners[d.tile] === player.id);
        const needed = new Set(ownedDeposits.filter(d =>
          snapshot.research.includes(resourceTechnology(d.resource).id) &&
          (demand?.materials[d.resource] ?? demand?.equipment[d.resource] ?? 0) >
            (snapshot.liquid.items?.[d.resource] ?? 0) + (snapshot.incoming[d.resource] ?? 0) &&
          !ownedDeposits.some(other => other.resource === d.resource && snapshot.buildings.some(b => b.tile === other.tile &&
            (b.type === "mine" || b.type === "oil-well" || b.type === "oil-rig")))
        ).map(d => d.resource));
        const availableDeposits = ownedDeposits
          .filter(
            (d) =>
              !snapshot.buildings.some((b) => b.tile === d.tile) &&
              (type === "mine"
                ? !["horses", "oil"].includes(d.resource)
                : d.resource === "oil"),
          ).sort((a,b) => a.tile - b.tile);
        const neededDeposits = availableDeposits.filter(d => needed.has(d.resource));
        const deposits = neededDeposits.length ? neededDeposits : availableDeposits;
        tiles = deposits.map(d => d.tile);
        missingProducer = deposits.length > 0 && needed.has(deposits[0].resource);
        objective = missingProducer ? 12000 : !count ? 5000 : 1000;
      } else if (type === "port") {
        // Bootstrap navigation without waiting for another faction to build
        // the first market. Further sites support growing factory capacity.
        const desired = Math.max(1, Math.ceil(snapshot.buildings.filter(b => b.type === "factory").length / 8));
        if (count >= desired) continue;
        tiles = this.coasts(player.id);
        objective = tiles.length ? (!count ? 7000 : 4000) : 0;
      } else {
        if (!objective && count >= 2) continue;
        // Advance past a filled capital rather than revisiting its nearest
        // 64 tiles forever. Each page and exact-check allowance remain bounded.
        page = this.landPage(player, key);
        tiles = page.tiles;
      }
      if (
        !objective &&
        ![
          "city",
          "factory",
          "barracks",
          "archery",
          "stables",
          "blacksmith",
          "armory",
          "arms-factory",
        ].includes(type)
      )
        continue;
      const cursor = page?.cursor ?? this.siteCursors.get(key) ?? 0;
      const attempts = Math.min(page ? tiles.length - cursor : tiles.length, 8 - tested);
      for (let j = 0; j < attempts; j++) {
        const tile = tiles[(cursor + j) % tiles.length];
        this.siteCursors.set(key, (cursor + j + 1) % tiles.length);
        if (page) page.cursor = cursor + j + 1;
        tested++;
        if (world.buildingSite(player.id, type, tile, snapshot.age) === null) {
          output.push({ type, tile, objective, reason: `${missingProducer ? "production-prerequisite" : "capacity"}:${type}` });
          break;
        }
      }
    }
    return output;
  }
}
