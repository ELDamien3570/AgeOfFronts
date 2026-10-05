import { buildingFootprint } from "../BuildingFootprint";
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
import { extractionPriority, stoneExtractionAllowed } from "./AiExtractionPolicy";
import { TRADE_RULES, tradeStockPerSecond } from "../content/Economy";
import { militaryPosture } from "./AiMilitaryPosture";
import { personalityOf } from "../content/AiPersonalities";
import { cityReserveIncome } from "../content/Economy";
import { productionTicks } from "./Supply";

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
  /** Coarse coverage sectors summarize coastline, never constrain water routes. */
  navalAnchors(playerId:number,sea:number):number[] {
    const {world}=this.expansion,sectors=new Map<string,number>();
    for(const land of this.coasts(playerId)) {
      const edge=this.coast.get(land)?.find(e=>world.waterPaths.component[e.waterTile]===sea);
      if(!edge)continue;
      const key=`${Math.floor(world.map.x(land)/32)}:${Math.floor(world.map.y(land)/32)}`;
      if(!sectors.has(key))sectors.set(key,edge.waterTile);
    }
    return [...sectors.values()];
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
      "airstrip",
      "missile-defence",
      "missile-silo",
      "mirv-launcher",
    ];
    const start = this.cursors.get(player.id) ?? 0;
    const sourceGoods = {factory: 0, port: 0};
    for (const b of snapshot.buildings)
      if (!b.remainingTicks && (b.type === "factory" || b.type === "port"))
        sourceGoods[b.type] += this.expansion.supply.goods.get(b.id) ?? 0;
    const traders = this.expansion.trade.actors.filter(a=>a.playerId===player.id).length;
    const posture=militaryPosture(snapshot,personalityOf(player),this.expansion.progression.technologySpeed);
    const missing=Math.max(0,posture.target-snapshot.squads.length-snapshot.recruitment.filter(j=>j.category==="land").length);
    const support=new Map<BuildingType,number>();
    if (posture.wealthy && demand) {
      const required=new Map<string,number>();
      for (const [role,desired] of Object.entries(demand.units)) {
        const unit=[...UNITS].reverse().find(u=>u.role===role && snapshot.research.includes(u.technologyId));
        if (!unit) continue;
        const deficit=Math.max(0,(desired??0)-snapshot.force.role(unit.role));
        for (const [item,n] of Object.entries(unit.cost.items??{})) {
          required.set(item,(required.get(item)??0)+deficit*n);
        }
      }
      const stocked={...snapshot.liquid.items};
      // Include upstream steel/gunpowder refining, not just the final workshop.
      // Otherwise twelve arms factories still starve behind two refineries.
      const capacity=(item:string,quantity:number,chain:ReadonlySet<string>)=>{
        const available=Math.min(quantity,stocked[item]??0);stocked[item]=(stocked[item]??0)-available;quantity-=available;
        if(!quantity || chain.has(item))return;
        const recipe=[...PRODUCTION_RECIPES].reverse().find(r=>r.outputs[item] && snapshot.research.includes(r.technologyId));
        if(!recipe)return;
        const batches=Math.ceil(quantity/recipe.outputs[item]);
        support.set(recipe.building,(support.get(recipe.building)??0)+batches*productionTicks(recipe,snapshot.research)/6000);
        const next=new Set(chain);next.add(item);
        for(const [input,n] of Object.entries(recipe.inputs))capacity(input,batches*n,next);
      };
      for(const [item,n] of required)capacity(item,n,new Set());
    }
    let tested = 0;
    for (let i = 0; i < types.length && tested < 8; i++) {
      const type = types[(start + i) % types.length];
      // Resume after the type that consumed the allowance, rather than a fixed
      // stride that can repeatedly miss prerequisite producers as the catalog grows.
      this.cursors.set(player.id,(start+i+1)%types.length);
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
      if (posture.wealthy && Math.min(12,support.get(type)??0)>count) objective=Math.max(objective,9000);
      if (posture.wealthy && type==="city" && missing>0 && snapshot.reserveIncome+(snapshot.liquid.reserves??0)/300<missing*1000/300 && count<12)
        objective=Math.max(objective,9000+Math.min(4000,Math.ceil((missing*1000/300-snapshot.reserveIncome)/cityReserveIncome(snapshot.age))*500));
      if (type === "airstrip" && snapshot.age === "Modern" && count < 2)
        objective=Math.max(objective,8000);
      if (["missile-silo","mirv-launcher"].includes(type) && snapshot.age === "Modern" && count < 2)
        objective=Math.max(objective,7000);
      const safeGrowth = snapshot.threatTroops <= snapshot.readyTroops / 2 && snapshot.readyTroops >= 4000;
      const factories = snapshot.buildings.filter(b => b.type === "factory").length;
      const ports = snapshot.buildings.filter(b => b.type === "port").length;
      const productiveLand = this.expansion.economy.tradeQuotes.best(player.id,false);
      const productiveSea = this.expansion.economy.tradeQuotes.best(player.id,true);
      // More producers help only when existing couriers actually exhaust stock.
      // Positive revenue alone says nothing about marginal sale capacity.
      const sourceStock = (naval: boolean) => sourceGoods[naval ? "port" : "factory"];
      const growth = (naval: boolean) => {
        const evidence = naval ? productiveSea : productiveLand;
        return safeGrowth && factories + ports < TRADE_RULES.actorCap && traders < TRADE_RULES.actorCap && !!evidence &&
          evidence.quote.riskAdjustedGoldPer1000Ticks > 0 && evidence.quote.returned === 0 &&
          sourceStock(naval) < TRADE_RULES.minimumDrop;
      };
      const landGrowth = growth(false), seaGrowth = growth(true);
      if (type === "factory" && landGrowth) objective = Math.max(objective,3000);
      // Repeated unsold land cargo is receiving-capacity evidence, not a reason
      // to keep adding factories. Cities create sale capacity as well as reserves.
      const cityCapacity = snapshot.buildings.filter(b=>b.type==="city" && !b.remainingTicks).length *
        TRADE_RULES.receivingGoodsPerSecondPerBuilding;
      const goodsOutput = snapshot.buildings.filter(b=>b.type==="factory" && !b.remainingTicks)
        .reduce((n,b)=>n+tradeStockPerSecond(b.age ?? "StoneAge"),0);
      if (type === "city" && safeGrowth && count < 12 && productiveLand &&
        productiveLand.quote.returned > 0 && sourceStock(false) >= TRADE_RULES.minimumDrop &&
        goodsOutput > cityCapacity)
        objective = Math.max(objective,3500);
      if (snapshot.isolated && type === "city" && count < 3) objective = Math.max(objective,6000);
      const extraction = ["mine", "oil-well", "oil-rig"].includes(type);
      let tiles: readonly number[];
      let page: LandPage | undefined;
      let preferredTile: number | undefined;
      if (type==="missile-defence") {
        const cities=snapshot.buildings.filter(b=>b.type==="city" && !b.remainingTicks && (b.health??1)>0);
        const desired=posture.wealthy ? 10 : 1;
        const site=cities.map(city=>{
          const defenses=snapshot.buildings.filter(b=>b.type===type && (b.health??1)>0 && world.map.euclideanDistSquared(city.tile,b.tile)<=8**2);
          const groups=new Map<number,number>();for(const defense of defenses)groups.set(defense.tile,(groups.get(defense.tile)??0)+1);
          const stack=[...groups].sort((a,b)=>b[1]-a[1] || a[0]-b[0])[0];
          return {city,stackTile:stack?.[0],stackCount:stack?.[1]??0};
        }).filter(row=>row.stackCount<desired).sort((a,b)=>a.stackCount-b.stackCount || a.city.id-b.city.id)[0];
        if (!site) continue;
        preferredTile=site.stackTile;
        tiles=world.ownedLandNearest(player.id,site.city.tile,64).filter(tile=>world.map.euclideanDistSquared(tile,site.city.tile)<=8**2);
        objective=posture.wealthy ? 9000 : 7000;
      } else if (extraction) {
        const ownedDeposits = this.expansion.supply.deposits.filter(d => world.owners[d.tile] === player.id);
        const needed = new Set(ownedDeposits.filter(d =>
          snapshot.research.includes(resourceTechnology(d.resource).id) &&
          (demand?.materials[d.resource] ?? demand?.equipment[d.resource] ?? 0) >
            (snapshot.liquid.items?.[d.resource] ?? 0) + (snapshot.incoming[d.resource] ?? 0) &&
          (d.resource === "oil" || !ownedDeposits.some(other => other.resource === d.resource && snapshot.buildings.some(b => b.tile === other.tile &&
            (b.type === "mine" || b.type === "oil-well" || b.type === "oil-rig"))))
        ).map(d => d.resource));
        const availableDeposits = ownedDeposits
          .filter(
            (d) =>
              !snapshot.buildings.some((b) => b.tile === d.tile) &&
              (d.resource !== "stone" || (stoneExtractionAllowed(snapshot.buildings) &&
                ![...needed].some(resource => extractionPriority(resource) === 0))) &&
              (type === "mine"
                ? !["horses", "oil"].includes(d.resource)
                : d.resource === "oil"),
          ).sort((a,b) => extractionPriority(a.resource) - extractionPriority(b.resource) || a.tile - b.tile);
        const neededDeposits = availableDeposits.filter(d => needed.has(d.resource));
        const deposits = neededDeposits.length ? neededDeposits : availableDeposits;
        tiles = deposits.map(d => d.tile);
        missingProducer = deposits.length > 0 && needed.has(deposits[0].resource);
        objective = missingProducer ? 12000 : !count ? 5000 : 1000;
      } else if (type === "port") {
        // Bootstrap navigation without waiting for another faction to build
        // the first market. Further trade sites need actual producer starvation.
        const desired = Math.max(snapshot.isolated ? 2 : 1,
          seaGrowth ? ports + 1 : 0);
        if (count >= desired) continue;
        // Any occupied perimeter cell may meet the coast; the anchor itself
        // may be one cell inland on east/south-facing shores.
        const shape = buildingFootprint("port"), anchors = new Set<number>();
        for (const coast of this.coasts(player.id)) {
          const x=world.map.x(coast), y=world.map.y(coast);
          for(let dy=0;dy<shape.height;dy++) for(let dx=0;dx<shape.width;dx++)
            if(world.map.isValidCoord(x-dx,y-dy)) anchors.add(world.map.ref(x-dx,y-dy));
        }
        const source=productiveSea && world.building(productiveSea.source);
        const stack=source?.type === "port" && snapshot.buildings.filter(b=>b.type==="port" && b.tile===source.tile).length<TRADE_RULES.maximumStack ? source.tile : undefined;
        preferredTile=stack;
        tiles = [...anchors].sort((a,b)=>Number(b===stack)-Number(a===stack) || a-b);
        objective = tiles.length ? (!count ? snapshot.isolated ? 11000 : 7000 : seaGrowth ? 3000 : 2000) : 0;
      } else {
        if (!objective && count >= 2) continue;
        // Advance past a filled capital rather than revisiting its nearest
        // 64 tiles forever. Each page and exact-check allowance remain bounded.
        page = this.landPage(player, key);
        tiles = page.tiles;
        if(type === "factory" && landGrowth) {
          const source=world.building(productiveLand?.source ?? productiveSea?.source ?? -1);
          if(source?.type==="factory" && snapshot.buildings.filter(b=>b.type==="factory" && b.tile===source.tile).length<TRADE_RULES.maximumStack)
            preferredTile=source.tile;
        }
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
      if(preferredTile!==undefined && tested<8) {
        tested++;
        if(this.expansion.economy.recovery.canBuild(player.id,type,preferredTile) &&
          world.buildingSite(player.id,type,preferredTile,snapshot.age)===null) {
          output.push({type,tile:preferredTile,objective,reason:`capacity:${type}`});
          continue;
        }
      }
      const attempts = Math.min(page ? tiles.length - cursor : tiles.length, 8 - tested);
      for (let j = 0; j < attempts; j++) {
        const tile = tiles[(cursor + j) % tiles.length];
        this.siteCursors.set(key, (cursor + j + 1) % tiles.length);
        if (page) page.cursor = cursor + j + 1;
        tested++;
        if (!this.expansion.economy.recovery.canBuild(player.id,type,tile)) continue;
        if (world.buildingSite(player.id, type, tile, snapshot.age) === null) {
          output.push({ type, tile, objective, reason: `${missingProducer ? "production-prerequisite" : "capacity"}:${type}` });
          break;
        }
      }
    }
    return output;
  }
}
