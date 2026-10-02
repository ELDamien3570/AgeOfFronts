import type { Coast } from "../CoastIndex";
import type { BuildingType, Player } from "../Protocol";
import { buildingTechnology } from "../content/Buildings";
import { PRODUCTION_RECIPES } from "../content/Production";
import { UNITS } from "../content/Units";
import type { AiInvestment } from "./AiEconomicPlanner";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import type { AiProductionDemand } from "./AiMilitaryDemand";
import type { Expansion } from "./Expansion";

/** Ownership-maintained coast index; no faction-wide map search per decision. */
export class AiPlacementCandidates {
  private readonly coast = new Map<number, Coast[]>();
  private readonly ownedCoast = new Map<number, Set<number>>();
  private readonly cursors = new Map<number, number>();
  private readonly siteCursors = new Map<string, number>();
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
    return { types: [...this.cursors], sites: [...this.siteCursors] };
  }
  restore(saved: ReturnType<AiPlacementCandidates["checkpoint"]>): void {
    this.cursors.clear();
    for (const [id, cursor] of saved.types) this.cursors.set(id, cursor);
    this.siteCursors.clear();
    for (const [id, cursor] of saved.sites) this.siteCursors.set(id, cursor);
    this.ownedCoast.clear();
    this.coastOwner.clear();
    for (const tile of this.coast.keys())
      this.changed(tile, this.expansion.world.owners[tile]);
  }
  coasts(playerId: number): readonly number[] {
    return [...(this.ownedCoast.get(playerId) ?? [])].sort((a, b) => a - b);
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
    let nearest: number[] | undefined,
      tested = 0;
    for (let i = 0; i < types.length && tested < 8; i++) {
      const type = types[(start + i) % types.length];
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
      const extraction = ["mine", "oil-well", "oil-rig"].includes(type);
      let tiles: readonly number[];
      if (extraction) {
        tiles = this.expansion.supply.deposits
          .filter(
            (d) =>
              world.owners[d.tile] === player.id &&
              !snapshot.buildings.some((b) => b.tile === d.tile) &&
              (type === "mine"
                ? !["horses", "oil"].includes(d.resource)
                : d.resource === "oil"),
          )
          .map((d) => d.tile)
          .sort((a, b) => a - b);
        objective = !count ? 5000 : 1000;
      } else if (type === "port") {
        const foreign = world.buildings.filter(
          (b) =>
            b.playerId !== player.id && b.type === "port" && !b.remainingTicks,
        );
        tiles = this.coasts(player.id).filter((tile) =>
          this.coast
            .get(tile)!
            .some((edge) =>
              foreign.some((port) =>
                world.map
                  .neighbors(port.tile)
                  .some((w) => world.waterPaths.connected(edge.waterTile, w)),
              ),
            ),
        );
        objective = !count && tiles.length ? 5000 : 0;
      } else {
        if (!objective && count >= 2) continue;
        tiles = nearest ??= world.ownedLandNearest(player.id, player.base, 64);
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
      const key = `${player.id}:${type}`,
        cursor = this.siteCursors.get(key) ?? 0;
      const attempts = Math.min(tiles.length, 8 - tested);
      for (let j = 0; j < attempts; j++) {
        const tile = tiles[(cursor + j) % tiles.length];
        this.siteCursors.set(key, (cursor + j + 1) % tiles.length);
        tested++;
        if (world.buildingSite(player.id, type, tile, snapshot.age) === null) {
          output.push({ type, tile, objective, reason: `capacity:${type}` });
          break;
        }
      }
    }
    return output;
  }
}
