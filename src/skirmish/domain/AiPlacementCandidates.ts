import { buildingFootprint } from "../BuildingFootprint";
import type { Coast } from "../CoastIndex";
import { stackLimit } from "../Construction";
import { portWaterTiles } from "../PortWaterAccess";
import type { BuildingType, Player } from "../Protocol";
import { secondsToTicks } from "../Protocol";
import { personalityOf } from "../content/AiPersonalities";
import {
  buildingTechnology,
  producerCompatible,
  productionBuildingType,
} from "../content/Buildings";
import {
  TRADE_RULES,
  marketDropCapacity,
} from "../content/Economy";
import { PRODUCTION_RECIPES } from "../content/Production";
import { resourceTechnology } from "../content/Resources";
import { UNITS } from "../content/Units";
import { manpowerCapacity } from "./AiManpowerCapacity";
import { preferredRecruitmentUnit } from "./AiRecruitmentPolicy";
import type { AiInvestment } from "./AiEconomicPlanner";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import {
  extractionPriority,
  stoneExtractionAllowed,
} from "./AiExtractionPolicy";
import { infrastructureCapacity } from "./AiInfrastructureCapacity";
import type { AiProductionDemand } from "./AiMilitaryDemand";
import { militaryPosture } from "./AiMilitaryPosture";
import { aiTradeCapacity } from "./AiTradeCapacity";
import type { Expansion } from "./Expansion";
import { scaledRecipeCost } from "./Manpower";
import { recruitmentVariant } from "../content/FormationRecipes";

/** First producers for an actually intended field force. A reserve of siege
 * equipment alone must not repeatedly outrank a paid progression commitment.
 * The catalogue walk is bounded and includes foundations as funded producers. */
export function productionBootstrap(
  snapshot: AiEconomicSnapshot,
  demand?: AiProductionDemand,
) {
  const buildings = new Set<BuildingType>(),
    resources = new Set<string>(),
    visited = new Set<string>();
  const hasProducer = (type: BuildingType) =>
    snapshot.buildings.some(
      (b) => (b.health ?? 1) > 0 && producerCompatible(b.type, type),
    );
  const visit = (item: string, amount: number): void => {
    if (
      visited.has(item) ||
      visited.size >= 32 ||
      (snapshot.liquid.items?.[item] ?? 0) + (snapshot.incoming[item] ?? 0) >=
        amount
    )
      return;
    visited.add(item);
    const recipe = PRODUCTION_RECIPES.filter(
      (r) =>
        !r.manualOnly &&
        r.outputs[item] &&
        snapshot.research.includes(r.technologyId),
    ).sort(
      (a, b) =>
        Number(hasProducer(b.building)) - Number(hasProducer(a.building)) ||
        a.ticks - b.ticks ||
        a.id.localeCompare(b.id),
    )[0];
    if (!recipe) {
      resources.add(item);
      return;
    }
    if (!hasProducer(recipe.building))
      buildings.add(
        productionBuildingType(
          recipe.building,
          snapshot.age,
          snapshot.research,
        ),
      );
    for (const [input, n] of Object.entries(recipe.inputs)) visit(input, n);
  };
  for (const role of [
    "frontline",
    "ranged",
    "mounted",
    "siege",
    "artillery",
  ] as const) {
    if (
      ((role === "siege" || role === "artillery") &&
        (!snapshot.invasion ||
          (demand?.units[role] ?? 0) <= snapshot.force.role(role))) ||
      !(demand?.units[role] ?? 0)
    )
      continue;
    const unit = preferredRecruitmentUnit(snapshot, role);
    if (!unit) continue;
    if (
      (demand?.units[role] ?? 0) > snapshot.force.role(role) &&
      !hasProducer(unit.building)
    )
      buildings.add(unit.building);
    for (const [item, n] of Object.entries(
      scaledRecipeCost(unit, recruitmentVariant(unit.id, snapshot.research))
        .items ?? {},
    )) {
      if (
        (demand?.equipment[item] ?? 0) >
        (snapshot.liquid.items?.[item] ?? 0) + (snapshot.incoming[item] ?? 0)
      )
        visit(item, n);
    }
  }
  return { buildings, resources };
}

interface LandPage {
  anchor: number;
  tiles: number[];
  cursor: number;
  revision?: string;
  exhausted?: boolean;
  stackCursor?: number;
  candidate?: number;
  hasSpace?: boolean;
}

/** Ownership-maintained coast index; no faction-wide map search per decision. */
export class AiPlacementCandidates {
  private readonly coast = new Map<number, Coast[]>();
  private readonly ownedCoast = new Map<number, Set<number>>();
  private readonly cursors = new Map<number, number>();
  private readonly recruitmentCursors = new Map<number, number>();
  private readonly siteCursors = new Map<string, number>();
  private readonly landPages = new Map<string, LandPage>();
  private readonly coastOwner = new Map<number, number>();
  private readonly ownershipRevisions = new Map<number, number>();
  constructor(private readonly expansion: Expansion) {
    for (const group of expansion.world.coast.connections())
      for (const edge of group.edges) {
        const entries = this.coast.get(edge.landTile) ?? [];
        entries.push(edge);
        this.coast.set(edge.landTile, entries);
      }
  }
  changed(tile: number, owner: number, oldOwner?: number): void {
    if (owner)
      this.ownershipRevisions.set(
        owner,
        (this.ownershipRevisions.get(owner) ?? 0) + 1,
      );
    const priorOwner = oldOwner ?? this.coastOwner.get(tile);
    if (priorOwner && priorOwner !== owner)
      this.ownershipRevisions.set(
        priorOwner,
        (this.ownershipRevisions.get(priorOwner) ?? 0) + 1,
      );
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
    return {
      types: [...this.cursors],
      recruitmentTypes: [...this.recruitmentCursors],
      sites: [...this.siteCursors],
      lands: [...this.landPages],
      ownershipRevisions: [...this.ownershipRevisions],
    };
  }
  restore(
    saved: Omit<
      ReturnType<AiPlacementCandidates["checkpoint"]>,
      "ownershipRevisions" | "recruitmentTypes"
    > & { ownershipRevisions?: [number, number][]; recruitmentTypes?: [number, number][] },
  ): void {
    this.cursors.clear();
    for (const [id, cursor] of saved.types) this.cursors.set(id, cursor);
    this.recruitmentCursors.clear();
    for(const [id,cursor] of saved.recruitmentTypes??[])this.recruitmentCursors.set(id,cursor);
    this.siteCursors.clear();
    for (const [id, cursor] of saved.sites) this.siteCursors.set(id, cursor);
    this.landPages.clear();
    for (const [key, page] of structuredClone(saved.lands ?? []))
      this.landPages.set(key, page);
    this.ownedCoast.clear();
    this.coastOwner.clear();
    for (const tile of this.coast.keys())
      this.changed(tile, this.expansion.world.owners[tile]);
    this.ownershipRevisions.clear();
    for (const [id, revision] of saved.ownershipRevisions ?? [])
      this.ownershipRevisions.set(id, revision);
  }
  coasts(playerId: number): readonly number[] {
    return [...(this.ownedCoast.get(playerId) ?? [])].sort((a, b) => a - b);
  }
  /** Coarse coverage sectors summarize coastline, never constrain water routes. */
  navalAnchors(playerId: number, sea: number): number[] {
    const { world } = this.expansion,
      sectors = new Map<string, number>();
    for (const land of this.coasts(playerId)) {
      const edge = this.coast
        .get(land)
        ?.find((e) => world.waterPaths.component[e.waterTile] === sea);
      if (!edge) continue;
      const key = `${Math.floor(world.map.x(land) / 32)}:${Math.floor(world.map.y(land) / 32)}`;
      if (!sectors.has(key)) sectors.set(key, edge.waterTile);
    }
    return [...sectors.values()];
  }
  private revision(snapshot: AiEconomicSnapshot): string {
    return JSON.stringify([
      this.ownershipRevisions.get(snapshot.playerId) ?? 0,
      snapshot.age,
      this.expansion.fortifications.version,
      snapshot.buildings.map((b) => [b.id, b.type, b.tile]),
    ]);
  }
  private landPage(
    player: Player,
    key: string,
    snapshot: AiEconomicSnapshot,
  ): LandPage {
    let page = this.landPages.get(key);
    const revision = this.revision(snapshot);
    if (
      !page ||
      page.anchor !== player.base ||
      (page.exhausted && page.revision !== revision)
    ) {
      page = {
        anchor: player.base,
        tiles: this.expansion.world.ownedLandNearest(
          player.id,
          player.base,
          64,
        ),
        cursor: 0,
        revision,
      };
      this.landPages.set(key, page);
    } else if (!page.exhausted && page.cursor >= page.tiles.length) {
      const after = page.tiles[page.tiles.length - 1];
      const tiles =
        after === undefined
          ? []
          : this.expansion.world.ownedLandNearest(
              player.id,
              player.base,
              64,
              after,
            );
      if (!tiles.length && (page.revision !== revision || page.hasSpace)) {
        page = {
          anchor: player.base,
          tiles: this.expansion.world.ownedLandNearest(
            player.id,
            player.base,
            64,
          ),
          cursor: 0,
          revision,
        };
        this.landPages.set(key, page);
      } else {
        page.tiles = tiles;
        page.cursor = 0;
      }
    }
    if (!page.tiles.length) page.exhausted = true;
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
      "airstrip",
      "nuclear-facility",
      "drone-facility",
      "anti-air-emplacement",
      "missile-defence",
      "missile-silo",
      "mirv-launcher",
    ];
    const start = this.cursors.get(player.id) ?? 0;
    const bootstrap = productionBootstrap(snapshot,demand);
    const tradeCapacity = aiTradeCapacity(
      this.expansion, player, snapshot, this.coasts(player.id),
      this.ownershipRevisions.get(player.id) ?? 0,
    );
    const manpower=manpowerCapacity(snapshot,demand);
    const missingTraining=new Set(Object.entries(demand?.units??{}).flatMap(([role,count])=>{
      const unit=preferredRecruitmentUnit(snapshot,role as Parameters<typeof preferredRecruitmentUnit>[1]);
      return unit && count!>snapshot.force.role(unit.role) && !snapshot.buildings.some(b=>(b.health??1)>0&&producerCompatible(b.type,unit.building)) ? [unit.building] : [];
    }));
    if(manpower.shortage>0)missingTraining.add("city");
    for(const type of bootstrap.buildings)missingTraining.add(type);
    if(!tradeCapacity.hasProductiveFactory && tradeCapacity.factoryTarget > snapshot.buildings.filter(b=>b.type==="factory").length && !this.expansion.trade.controls[player.id]?.landPaused)missingTraining.add("factory");
    if(!tradeCapacity.hasProductivePort && tradeCapacity.usefulSeas.size && !this.expansion.trade.controls[player.id]?.seaPaused)missingTraining.add("port");
    const urgent=types.filter(type=>missingTraining.has(type));
    const priorityCursor=this.recruitmentCursors.get(player.id)??0;
    const first=urgent[priorityCursor%Math.max(1,urgent.length)];
    if(first)this.recruitmentCursors.set(player.id,priorityCursor+1);
    const ordinary=types.map((_,i)=>types[(start+i)%types.length]);
    // Rotate the same eight exact checks across finite military/economic
    // bootstrap paths; growing manpower demand cannot starve the first source.
    // A cached legal quote costs one check, leaving ordinary work its balance.
    const ordered=first?[first,...ordinary.filter(type=>type!==first)]:ordinary;
    const sourceGoods = { factory: 0, port: 0 };
    for (const b of snapshot.buildings)
      if (!b.remainingTicks && (b.type === "factory" || b.type === "port"))
        sourceGoods[b.type] += this.expansion.supply.goods.get(b.id) ?? 0;
    const posture = militaryPosture(
      snapshot,
      personalityOf(player),
      this.expansion.progression.technologySpeed,
    );
    const capacity = infrastructureCapacity(snapshot, demand);
    const receivingStacks = new Map<number, number>();
    for (const b of snapshot.buildings)
      if (["city", "port"].includes(b.type) && (b.health ?? 1) > 0)
        receivingStacks.set(b.tile, (receivingStacks.get(b.tile) ?? 0) + 1);
    const cityCapacity = [...receivingStacks.values()].reduce(
      (n, stack) => n + marketDropCapacity(stack),
      0,
    );
    let tested = 0;
    for (let i = 0; i < ordered.length && tested < 8; i++) {
      const type = ordered[i];
      if (
        productionBuildingType(type, snapshot.age, snapshot.research) !== type
      )
        continue;
      // Resume after the type that consumed the allowance, rather than a fixed
      // stride that can repeatedly miss prerequisite producers as the catalog grows.
      if(type!==first)this.cursors.set(player.id, (types.indexOf(type) + 1) % types.length);
      const key = `${player.id}:${type}`;
      if (!buildingTechnology(type, snapshot.age)) continue;
      const count = snapshot.buildings.filter((b) => b.type === type).length;
      const firstTradeProducer = type === "factory"
        ? !this.expansion.trade.controls[player.id]?.landPaused && !tradeCapacity.hasProductiveFactory && tradeCapacity.factoryTarget > count
        : type === "port" && !this.expansion.trade.controls[player.id]?.seaPaused && !tradeCapacity.hasProductivePort && tradeCapacity.usefulSeas.size > 0;
      const bottleneck = bootstrap.buildings.has(type) || firstTradeProducer ? "bootstrap" as const : "capacity" as const;
      const units = UNITS.filter(
        (u) =>
          u.building === type && snapshot.research.includes(u.technologyId),
      );
      const recipes = PRODUCTION_RECIPES.filter(
        (r) =>
          r.building === type && snapshot.research.includes(r.technologyId),
      );
      const compatibleWorkshop = snapshot.buildings.some((b) =>
        producerCompatible(b.type, type),
      );
      let missingProducer =
        !compatibleWorkshop &&
        ((["factory", "blacksmith", "armory", "arms-factory"].includes(type) &&
        recipes.some((r) =>
          Object.keys(r.outputs).some(
            (id) =>
              (demand?.equipment[id] ?? demand?.materials[id] ?? 0) >
              (snapshot.liquid.items?.[id] ?? 0) + (snapshot.incoming[id] ?? 0),
          ),
        )) || units.some(unit=>(demand?.units[unit.role]??0)>snapshot.force.role(unit.role)&&
          preferredRecruitmentUnit(snapshot,unit.role)?.building===type));
      let objective = !count && units.length ? 6000 : 0;
      if(firstTradeProducer) objective = Math.max(objective,9000);
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
      let reason = firstTradeProducer ? "trade-capacity" : "capacity";
      if (Math.min(12, capacity.workshops.get(type) ?? 0) > count) {
        objective = Math.max(
          objective,
          capacity.processingReady(type) ? 14000 : 9000,
        );
        reason = capacity.processingReady(type)
          ? "production-ready"
          : "production-capacity";
      }
      const producerIds = new Set(
        snapshot.buildings.filter((b) => b.type === type).map((b) => b.id),
      );
      const queued = snapshot.recruitment
        .filter(
          (job) => producerIds.has(job.buildingId) && job.category === "land",
        )
        .reduce((ticks, job) => ticks + job.remainingTicks, 0);
      if (
        units.length &&
        snapshot.headroom > 0 &&
        (snapshot.liquid.reserves ?? 0) >= 12 &&
        Object.entries(snapshot.liquid.items ?? {}).some(
          ([id, n]) => id.startsWith("equipment:") && n > 0,
        ) &&
        queued > secondsToTicks(20) * Math.max(1, count)
      ) {
        objective = Math.max(objective, 6500);
        reason = "production-capacity";
      }
      if (
        type === "city" &&
        manpower.shortage > 0
      ) {
        objective = Math.max(
          objective,
          9000 +
            Math.min(
              4000,
              manpower.extraCities * 500,
            ),
        );
        reason="production-capacity";
      }
      if (
        ["airstrip", "nuclear-facility", "drone-facility"].includes(type) &&
        ["EarlyModern", "Modern"].includes(snapshot.age) &&
        count < 2
      )
        objective = Math.max(objective, 8000);
      if (
        ["missile-silo", "mirv-launcher"].includes(type) &&
        snapshot.age === "Modern" &&
        count < 2
      )
        objective = Math.max(objective, 7000);
      if (
        type === "anti-air-emplacement" &&
        count < 2 &&
        this.expansion.aircraft.some(
          (a) =>
            a.health > 0 &&
            a.state !== "ready" &&
            a.definitionId !== "drone" &&
            this.expansion.diplomacy.hostile(player.id, a.playerId),
        )
      )
        objective = Math.max(objective, 8500);
      const safeGrowth =
        snapshot.threatTroops <= snapshot.readyTroops / 2 &&
        snapshot.readyTroops >= 48;
      const productiveLand = this.expansion.economy.tradeQuotes.best(
        player.id,
        false,
      );
      const landGrowth = safeGrowth && tradeCapacity.factoryTarget > count;
      if (type === "factory" && landGrowth) {
        objective = Math.max(objective, tradeCapacity.factoryUtility);
        if (reason !== "production-ready" && reason !== "production-capacity")
          reason = "trade-capacity";
      }
      // Unsold cargo now indicates too few distinct stops per trip, not a
      // shared receiving rate. Include paid receivers under construction so
      // the AI cannot order the same capacity remedy every decision.
      if (
        type === "city" &&
        safeGrowth &&
        count < 12 &&
        productiveLand &&
        productiveLand.quote.returned > 0 &&
        sourceGoods.factory >= TRADE_RULES.minimumDrop &&
        productiveLand.quote.quantity > cityCapacity
      )
        objective = Math.max(objective, 3500);
      if (snapshot.isolated && type === "city" && count < 3)
        objective = Math.max(objective, 6000);
      const extraction = ["mine", "oil-well", "oil-rig"].includes(type);
      let tiles: readonly number[];
      let page: LandPage | undefined;
      if (type === "missile-defence") {
        const cities = snapshot.buildings.filter(
          (b) => b.type === "city" && !b.remainingTicks && (b.health ?? 1) > 0,
        );
        const desired = posture.wealthy ? 10 : 1;
        const site = cities
          .map((city) => ({
            city,
            count: snapshot.buildings.filter(
              (b) =>
                b.type === type &&
                (b.health ?? 1) > 0 &&
                world.map.euclideanDistSquared(city.tile, b.tile) <= 8 ** 2,
            ).length,
          }))
          .filter((row) => row.count < desired)
          .sort((a, b) => a.count - b.count || a.city.id - b.city.id)[0];
        if (!site) continue;

        const revision = this.revision(snapshot);
        page = this.landPages.get(key);
        if (
          !page ||
          page.anchor !== site.city.tile ||
          (page.cursor >= page.tiles.length &&
            (page.revision !== revision || page.hasSpace))
        ) {
          const tiles: number[] = [];
          const x = world.map.x(site.city.tile),
            y = world.map.y(site.city.tile);
          for (let dy = -8; dy <= 8; dy++)
            for (let dx = -8; dx <= 8; dx++)
              if (
                dx * dx + dy * dy <= 8 ** 2 &&
                world.map.isValidCoord(x + dx, y + dy)
              )
                tiles.push(world.map.ref(x + dx, y + dy));
          page = { anchor: site.city.tile, tiles, cursor: 0, revision };
          this.landPages.set(key, page);
        }
        tiles = page.tiles;
        if (page.cursor >= tiles.length) page.exhausted = true;
        objective = posture.wealthy ? 9000 : 7000;
      } else if (extraction) {
        const ownedDeposits = this.expansion.supply.deposits.filter(
          (d) => world.owners[d.tile] === player.id,
        );
        const needed = new Set(
          ownedDeposits
            .filter(
              (d) =>
                snapshot.research.includes(resourceTechnology(d.resource).id) &&
                capacity.extractionNeeded(d, ownedDeposits),
            )
            .map((d) => d.resource),
        );
        if (type === "mine") {
          const revision = this.revision(snapshot);
          const minerals = [...needed].filter(resource => !["horses", "oil"].includes(resource) &&
            (resource !== "stone" || stoneExtractionAllowed(snapshot.buildings) && ![...needed].some(r => extractionPriority(r) === 0)))
            .sort((a, b) => extractionPriority(a) - extractionPriority(b) || (a < b ? -1 : a > b ? 1 : 0));
          let proposed = false;
          for (const resource of minerals) {
            const sites = ownedDeposits.filter(d => d.resource === resource).sort((a, b) => a.tile - b.tile);
            const freeKey = `${key}:${resource}:free`;
            let free = this.landPages.get(freeKey);
            if (!free || free.revision !== revision) {
              free = { anchor: player.base, tiles: sites.filter(d => !snapshot.buildings.some(b => b.tile === d.tile)).map(d => d.tile), cursor: 0, revision };
              this.landPages.set(freeKey, free);
            } else if (free.exhausted && free.hasSpace) {
              // Safety may change without a geometry revision; retry unsafe free
              // deposits before concentrating more output on a safe old mine.
              free.cursor = 0; free.exhausted = false; free.hasSpace = false;
            }
            while (free.cursor < free.tiles.length && tested < 8) {
              const tile = free.tiles[free.cursor++];
              tested++;
              if (world.buildingSite(player.id, type, tile, snapshot.age) !== null) continue;
              if (!this.expansion.economy.recovery.canBuild(player.id, type, tile)) { free.hasSpace = true; continue; }
              const first = !snapshot.buildings.some(b => b.type === "mine" && this.expansion.supply.resourceSites.at(b.tile)?.resource === resource);
              output.push({ type, tile, objective: 12000, reason: "production-prerequisite:mine", bottleneck: first && bootstrap.resources.has(resource) ? "bootstrap" : "capacity" });
              // Keep a lawful free choice until the paid build changes geometry.
              free.cursor--; proposed = true; break;
            }
            free.exhausted = free.cursor >= free.tiles.length;
            if (proposed || tested >= 8) break;
            if (!free.exhausted) continue;
            // Deposit scarcity, rather than exhaustion of arbitrary land pages,
            // permits a capped stack. Other useful same-resource sites win first.
            const stacked = sites.filter(d => {
              const at = snapshot.buildings.filter(b => b.tile === d.tile);
              return at.length > 0 && at.every(b => b.type === "mine") && at.length < stackLimit("mine");
            }).sort((a, b) => snapshot.buildings.filter(x => x.tile === a.tile).length - snapshot.buildings.filter(x => x.tile === b.tile).length || a.tile - b.tile);
            for (const site of stacked) {
              if (tested >= 8) break;
              tested++;
              if (world.buildingSite(player.id, type, site.tile, snapshot.age) !== null || !this.expansion.economy.recovery.canBuild(player.id, type, site.tile)) continue;
              output.push({ type, tile: site.tile, objective: 12000, reason: "production-capacity:mine", bottleneck: "capacity" });
              proposed = true; break;
            }
            if (proposed) break;
          }
          continue;
        }
        const availableDeposits = ownedDeposits
          .filter(
            (d) =>
              needed.has(d.resource) &&
              !snapshot.buildings.some((b) => b.tile === d.tile) &&
              (d.resource !== "stone" ||
                (stoneExtractionAllowed(snapshot.buildings) &&
                  ![...needed].some(
                    (resource) => extractionPriority(resource) === 0,
                  ))) &&
              d.resource === "oil",
          )
          .sort(
            (a, b) =>
              extractionPriority(a.resource) - extractionPriority(b.resource) ||
              a.tile - b.tile,
          );
        const neededDeposits = availableDeposits.filter((d) =>
          needed.has(d.resource),
        );
        const deposits = neededDeposits.length
          ? neededDeposits
          : availableDeposits;
        tiles = deposits.map((d) => d.tile);
        missingProducer =
          deposits.length > 0 && needed.has(deposits[0].resource);
        objective = missingProducer ? 12000 : 0;
        if (!objective) continue;
      } else if (type === "port") {
        // One strategic bootstrap port remains possible before foreign markets
        // exist. Further sites must have funded dispatch and receiving demand.
        if (count >= tradeCapacity.portTarget || (count > 0 && !safeGrowth && !firstTradeProducer))
          continue;
        // Any occupied perimeter cell may meet the coast; the anchor itself
        // may be one cell inland on east/south-facing shores.
        const revision = `${this.revision(snapshot)}:${[...tradeCapacity.usefulSeas].sort((a, b) => a - b).join(",")}`;
        page = this.landPages.get(key);
        if (
          !page ||
          page.anchor !== player.base ||
          (page.cursor >= page.tiles.length &&
            (page.revision !== revision || page.hasSpace))
        ) {
          const shape = buildingFootprint("port"),
            anchors = new Set<number>();
          for (const coast of this.coasts(player.id)) {
            if (
              tradeCapacity.usefulSeas.size &&
              !world.map
                .neighbors(coast)
                .some((water) =>
                  tradeCapacity.usefulSeas.has(
                    world.waterPaths.component[water],
                  ),
                )
            )
              continue;
            const x = world.map.x(coast),
              y = world.map.y(coast);
            for (let dy = 0; dy < shape.height; dy++)
              for (let dx = 0; dx < shape.width; dx++)
                if (world.map.isValidCoord(x - dx, y - dy))
                  anchors.add(world.map.ref(x - dx, y - dy));
          }
          page = {
            anchor: player.base,
            tiles: [...anchors].sort((a, b) => a - b),
            cursor: 0,
            revision,
          };
          this.landPages.set(key, page);
        }
        tiles = page.tiles;
        if (page.cursor >= tiles.length) page.exhausted = true;
        objective = tiles.length
          ? !count
            ? snapshot.isolated
              ? 11000
              : 7000
            : tradeCapacity.portUtility
          : 0;
        if (count) reason = "trade-capacity";
      } else {
        if (!objective && count >= 2) continue;
        // Advance past a filled capital rather than revisiting its nearest
        // 64 tiles forever. Each page and exact-check allowance remain bounded.
        page = this.landPage(player, key, snapshot);
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
      if (page?.candidate !== undefined) {
        tested++;
        const tile = page.candidate;
        if (
          (type !== "port" ||
            !tradeCapacity.usefulSeas.size ||
            portWaterTiles(world.map, tile).some((w) =>
              tradeCapacity.usefulSeas.has(world.waterPaths.component[w]),
            )) &&
          !snapshot.buildings.some((b) => b.tile === tile) &&
          world.buildingSite(player.id, type, tile, snapshot.age) === null
        ) {
          if (this.expansion.economy.recovery.canBuild(player.id, type, tile)) {
            output.push({
              type,
              tile,
              objective,
              bottleneck,
              reason: `${missingProducer && reason !== "production-ready" ? "production-prerequisite" : reason}:${type}`,
            });
            continue;
          }
          page.hasSpace = true;
        }
        page.candidate = undefined;
      }
      if (page?.exhausted && page.hasSpace) {
        page.exhausted = false;
        continue;
      }
      if (page?.exhausted) {
        // Exhaustion is a proof for the current ownership and building geometry,
        // not permission to stack just because the nearest page was full.
        const stacks = snapshot.buildings.filter(
          (b) =>
            b.type === type &&
            (b.health ?? 1) > 0 &&
            (type !== "missile-defence" ||
              world.map.euclideanDistSquared(page!.anchor, b.tile) <= 8 ** 2),
        );
        const stackTiles = [...new Set(stacks.map((b) => b.tile))].filter(
          (tile) =>
            stacks.filter((b) => b.tile === tile).length <
            Math.min(
              stackLimit(type),
              type === "port" || type === "factory"
                ? TRADE_RULES.maximumStack
                : stackLimit(type),
            ),
        );
        const at = page.stackCursor ?? 0;
        const attempts = Math.min(stackTiles.length, 8 - tested);
        for (let j = 0; j < attempts; j++) {
          const tile = stackTiles[(at + j) % stackTiles.length];
          page.stackCursor = (at + j + 1) % stackTiles.length;
          tested++;
          if (
            this.expansion.economy.recovery.canBuild(player.id, type, tile) &&
            world.buildingSite(player.id, type, tile, snapshot.age) === null
          ) {
            output.push({
              type,
              tile,
              objective,
              bottleneck,
              reason: `${missingProducer && reason !== "production-ready" ? "production-prerequisite" : reason}:${type}`,
            });
            break;
          }
        }
        continue;
      }
      const attempts = Math.min(
        page ? tiles.length - cursor : tiles.length,
        8 - tested,
      );
      for (let j = 0; j < attempts; j++) {
        const tile = tiles[(cursor + j) % tiles.length];
        this.siteCursors.set(key, (cursor + j + 1) % tiles.length);
        if (page) page.cursor = cursor + j + 1;
        tested++;
        if (snapshot.buildings.some((b) => b.tile === tile)) continue;
        if (
          type === "port" &&
          tradeCapacity.usefulSeas.size &&
          !portWaterTiles(world.map, tile).some((w) =>
            tradeCapacity.usefulSeas.has(world.waterPaths.component[w]),
          )
        )
          continue;
        if (world.buildingSite(player.id, type, tile, snapshot.age) === null) {
          if (
            !this.expansion.economy.recovery.canBuild(player.id, type, tile)
          ) {
            if (page) page.hasSpace = true;
            continue;
          }
          if (page) page.candidate = tile;
          output.push({
            type,
            tile,
            objective,
            bottleneck,
            reason: `${missingProducer && reason !== "production-ready" ? "production-prerequisite" : reason}:${type}`,
          });
          break;
        }
      }
    }
    return output;
  }
}
