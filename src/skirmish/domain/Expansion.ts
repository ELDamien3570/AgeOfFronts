import { restoreArray } from "../StateTransfer";
import type { GameMap } from "../../core/game/GameMap";
import { DamageLedger } from "../Conquest";
import type { LandPaths, WaterPaths } from "../Pathfinding";
import type {
  Building,
  BuildingType,
  Command,
  Player,
  Ship,
  Squad,
} from "../Protocol";
import { FIXED, TICKS_PER_SECOND } from "../Protocol";
import { personalityOf } from "../content/AiPersonalities";
import {
  DEFENSIVE_BUILDINGS,
  buildingCost,
  buildingIntegrity,
  buildingTechnology,
} from "../content/Buildings";
import { CONTENT_HASH } from "../content/Catalog";
import { TECHNOLOGIES, technologyAt } from "../content/Technology";
import { UNIT, UNITS, VESSEL, VESSELS } from "../content/Units";
import { AiModernization } from "./AiMilitaryDevelopment";
import { AiForceInventory } from "./AiForceInventory";
import {
  acceptsAlliance,
  buildingPriority,
  economicBuildingTarget,
} from "./AiPersonality";
import { Armies, type ArmyWorld } from "./Armies";
import { Battle, type BattleWorld } from "./Battle";
import {
  AGES,
  type Age,
  type Aircraft,
  type ExpansionSnapshot,
  type MatchEvent,
  type TechnologySpeed,
  type UnitDefinition,
} from "./Definitions";
import { Diplomacy } from "./Diplomacy";
import { Fortifications, type TowerSiteIndex } from "./Fortifications";
import {
  Progression,
  advanceRejection,
  researchRejection,
} from "./Progression";
import { unitRefitCost } from "./Refitting";
import { vesselEffects } from "./ResearchEffects";
import { Roads } from "./Roads";
import { Recruitment, RECRUITMENT_SECONDS } from "./Recruitment";
import type { RecruitmentJob } from "./Definitions";
import { Supply, costRejection, spend } from "./Supply";
import { Trade } from "./Trade";
import { modernizeMilitaryBuildings } from "./MilitaryInfrastructure";
import { structureAim } from "./StructureTargeting";
import { squadRadius, standable, tilePoint } from "../SquadGeometry";
import type { CoastIndex } from "../CoastIndex";
import { AiEconomicDirector } from "./AiEconomicDirector";
export interface ExpansionWorld extends BattleWorld, ArmyWorld {
  recruitment: Recruitment;
  options?: { runAi?: boolean; aiEconomy?: boolean; aiDefenses?:boolean; aiNaval?:boolean; deferredPlanning?:boolean; territoryIncomeScale?:number; resourceDensity?: 1 | 2 | 3 | 5; resourceOutput?: 1 | 2 | 3 | 5; alliances?: boolean; startingAge?: Age };
  map: GameMap;
  owners: Uint8Array;
  claims: Uint8Array;
  progress: Uint8Array;
  paths: LandPaths;
  waterPaths: WaterPaths;
  coast: CoastIndex;
  winner: number | null;
  applyCommand(command: Command): string | null;
  buildingsAt(tile: number): readonly Building[];
  towersNear(tile:number,radius:number):Iterable<Building>;
  tileOf(squad: { x: number; y: number }): number;
  ownedLand(playerId: number): Iterable<number>;
  /** The `limit` owned tiles closest to `anchor`, ordered by distance then id. */
  ownedLandNearest(playerId: number, anchor: number, limit: number): number[];
  buildingSite(playerId: number, type: BuildingType, tile: number, age?: Age): string | null;
  squadCapacity(player: Player): number;
  aiGeneration(playerId: number): number;
  ship(id:number):Ship | undefined;
  building(id:number):Building | undefined;
}
// Match-level application coordinator; each domain service owns its own rules.
// All services operate on the same authoritative world, never a parallel game.
export class Expansion {
  checkpoint() { return structuredClone({progression:this.progression.checkpoint(),diplomacy:this.diplomacy.checkpoint(),fortifications:this.fortifications.checkpoint(),supply:this.supply.checkpoint(),trade:this.trade.checkpoint(),roads:this.roads.checkpoint(),battle:this.battle.checkpoint(),armies:this.armies.checkpoint(),modernization:this.modernization.checkpoint(),economy:this.economy.checkpoint(),aircraft:this.aircraft,winners:this.winners,events:this.events,nextEvent:this.nextEvent}); }
  restore(saved: ReturnType<Expansion["checkpoint"]>): void {
    const state=structuredClone(saved);
    this.progression.restore(state.progression);
    this.diplomacy.restore(state.diplomacy);
    this.fortifications.restore(state.fortifications);
    this.supply.restore(state.supply);
    this.trade.restore(state.trade);
    this.roads.restore(state.roads);
    this.battle.restore(state.battle);
    this.armies.restore(state.armies);
    this.modernization.restore(state.modernization);
    if (state.economy) this.economy.restore(state.economy);
    restoreArray(this.aircraft,state.aircraft); restoreArray(this.winners,state.winners); restoreArray(this.events,state.events); this.nextEvent=state.nextEvent;
  }

  readonly progression: Progression;
  readonly diplomacy = new Diplomacy();
  readonly fortifications: Fortifications;
  readonly supply: Supply;
  readonly trade: Trade;
  readonly roads: Roads;
  readonly battle: Battle;
  readonly armies: Armies;
  readonly modernization = new AiModernization();
  readonly economy: AiEconomicDirector;
  private readonly towerSites:TowerSiteIndex;
  readonly aircraft: Aircraft[] = [];
  readonly winners: number[] = [];
  readonly events: MatchEvent[] = [];
  private nextEvent = 1;
  announce(event: Omit<MatchEvent, "id" | "tick">): void {
    this.events.push({ ...event, id: this.nextEvent++, tick: this.world.tick });
    if (this.events.length > 80) this.events.shift();
  }
  readonly victoryMode: "solo" | "allied";
  readonly startingAge: Age;
  constructor(
    readonly world: ExpansionWorld,
    seed: number,
    mode: "solo" | "allied" = "solo",
    technologySpeed: TechnologySpeed = 1,
    startingAge: Age = world.options?.startingAge ?? "StoneAge",
  ) {
    this.startingAge = startingAge;
    this.towerSites={at:tile=>world.buildingsAt(tile),nearby:(tile,radius)=>world.towersNear(tile,radius)};
    this.progression = new Progression(technologySpeed, startingAge);
    this.victoryMode = mode;
    this.fortifications = new Fortifications(world.map, this.diplomacy);
    this.supply = new Supply(world.map, this.progression, seed, world.options?.resourceDensity, world.options?.resourceOutput);
    this.roads = new Roads(world.map);
    this.trade = new Trade(
      world,
      this.supply,
      this.progression,
      this.diplomacy,
      this.fortifications,
      this.roads,
    );
    this.battle = new Battle(
      world,
      world.map.width(),
      world.map.height(),
      this.diplomacy,
      this.fortifications,
      this.progression,
    );
    this.battle.setWidth(world.map.width());
    this.armies = new Armies(world, this.progression);
    this.economy = new AiEconomicDirector(this);
    this.supply.aiProduction = playerId => this.economy.production(playerId);
  }
  add(player: Player): void {
    if (player.kind === "tribe") {
      this.progression.add(player.id, "StoneAge");
    } else {
      this.progression.add(player.id, this.startingAge);
    }
    this.supply.add(player.id);
  }
  unit(squad: Squad): UnitDefinition {
    return this.battle.definition(squad);
  }
  available(player: Player, line: Squad["kind"]): UnitDefinition | undefined {
    return UNITS.filter(
      (u) =>
        u.line === line &&
        ["frontline", "ranged", "mounted"].includes(u.role) &&
        this.progression.has(player.id, u.technologyId),
    ).slice(-1)[0];
  }
  recruitment(player: Player, line: Squad["kind"]) {
    for (const unit of UNITS.filter(
      (u) =>
        u.line === line && ["frontline", "ranged", "mounted"].includes(u.role),
    )
      .slice()
      .reverse()) {
      if (
        !this.progression.has(player.id, unit.technologyId) ||
        costRejection(player, this.supply.inventories[player.id], unit.cost)
      )
        continue;
      const building = this.world.buildings.find(
        (b) =>
          b.playerId === player.id &&
          !b.remainingTicks &&
          b.type === unit.building &&
          AGES.indexOf(b.age ?? "StoneAge") >= AGES.indexOf(unit.age),
      );
      if (building) return { unit, building };
    }
    return undefined;
  }
  vessel(ship: Ship) {
    return vesselEffects(
      VESSEL.get(ship.definitionId ?? "") ??
        VESSELS.find((v) => v.age === "StoneAge" && v.kind === ship.kind)!,
      this.progression.states[ship.playerId].completed,
    );
  }
  buildRejection(
    player: Player,
    type: BuildingType,
    tile: number,
    age: Age,
    placementOnly = false,
  ): string | null {
    const technology = buildingTechnology(type, age);
    if (!technology || (!placementOnly && !this.progression.has(player.id, technology)))
      return "Research this building's technology first";
    const plan =
      type === "tower"
        ? this.fortifications.towerPlan(
            tile,
            player.id,
            age,
            this.towerSites,
          )
        : null;
    if (
      type === "tower" &&
      this.world.squads.some(
        (s) =>
          s.embarkedOn === null &&
          (this.world.tileOf(s) === tile ||
            plan?.links.some((l) => l.tiles.includes(this.world.tileOf(s)))),
      )
    )
      return "Move troops clear of the tower and planned wall tiles";
    if (this.fortifications.blocked(tile, player.id))
      return "Cannot build on an intact wall";
    this.supply.resourceSites.update(this.supply.deposits);
    const node = this.supply.resourceSites.at(tile);
    if (
      type === "mine" &&
      (!node || node.resource === "horses" || node.resource === "oil")
    )
      return "Mines must be placed directly on a mineral deposit";
    if ((type === "oil-well" || type === "oil-rig") && node?.resource !== "oil")
      return "Oil extraction needs an oil deposit";
    const resourceSite = this.supply.resourceSites.rejection(type,tile);
    if (resourceSite) return resourceSite;
    const existingCount = this.world.buildings.filter(
      (b) => b.playerId === player.id && b.type === type,
    ).length;
    const cost = buildingCost(type, age, existingCount),
      wallCost =
        type === "tower"
          ? plan!.gold
          : 0;
    return placementOnly ? null : costRejection(player, this.supply.inventories[player.id], {
      ...cost,
      gold: (cost.gold ?? 0) + wallCost,
    });
  }
  built(player: Player, building: Building): void {
    const age = building.age ?? this.progression.states[player.id].age;
    const plan =
      building.type === "tower"
        ? this.fortifications.towerPlan(
              building.tile,
              player.id,
              age,
              this.towerSites,
            )
        : null;
    const existingCount = Math.max(
      0,
      this.world.buildings.filter(
        (b) => b.playerId === player.id && b.type === building.type,
      ).length - 1,
    );
    const cost = buildingCost(building.type, age, existingCount);
    spend(player, this.supply.inventories[player.id], {
      ...cost,
      gold: (cost.gold ?? 0) + (plan?.gold ?? 0),
    });
    building.age = age;
    building.maxHealth = buildingIntegrity(building.type, age);
    building.health = building.maxHealth;
    if (plan) this.fortifications.addTower(building, plan);
  }
  command(player: Player, command: Command): string | null | undefined {
    const { world } = this;
    if (command.type === "alliance" && world.options?.alliances === false) return "Alliances are disabled for this match";
    const armyResult = this.armies.command(player, command);
    if (armyResult !== undefined) return armyResult;
    if (command.type === "research")
      return player.kind === "tribe"
        ? "Tribes remain in the Stone Age"
        : this.progression.research(player, command.technologyId);
    if (command.type === "advance-age")
      return player.kind === "tribe"
        ? "Tribes remain in the Stone Age"
        : this.progression.advance(player);
    if (command.type === "production-priority")
      return this.supply.setPriorities(player, world.buildings, command.buildingType, command.recipeIds);
    if (command.type === "reset-production-priorities") {
      this.supply.resetPriorities(player.id);
      return null;
    }
    if (command.type === "produce")
      return this.supply.setProduction(
        player,
        world.buildings.find((b) => b.id === command.buildingId),
        command.recipeId,
      );
    if (command.type === "alliance") {
      const previous = JSON.stringify(this.diplomacy.state);
      const result = this.diplomacy.action(
        player,
        world.players.find((p) => p.id === command.otherId),
        command.action,
        world.tick,
      );
      if (!result && previous !== JSON.stringify(this.diplomacy.state))
        this.announce({
          kind: "diplomacy",
          actorId: player.id,
          otherId: command.otherId,
          // A reciprocal offer accepts the incoming offer. Record the outcome
          // now; later snapshots may arrive after this alliance already ends.
          action:
            command.action === "offer" &&
            this.diplomacy.allied(player.id, command.otherId)
              ? "accept"
              : command.action,
        });
      if (!result && this.diplomacy.allied(player.id, command.otherId)) {
        for (const s of world.squads) {
          if (
            s.charge?.targetId &&
            !this.diplomacy.hostile(
              s.playerId,
              world.squads.find((t) => t.id === s.charge!.targetId)?.playerId ??
                0,
            )
          ) {
            s.charge = null;
            s.order = { type: "hold" };
            s.path = [];
          }
          if (s.structureTarget) {
            const target =
              world.buildings.find(
                (b) => b.id === s.structureTarget!.buildingId,
              ) ??
              this.fortifications.barriers.find(
                (b) => b.id === s.structureTarget!.barrierId,
              );
            if (
              !target ||
              !this.diplomacy.hostile(s.playerId, target.playerId)
            ) {
              s.structureTarget = null;
              s.order = { type: "hold" };
              s.path = [];
            }
          }
          if (
            s.order.type === "attack" &&
            !this.diplomacy.hostile(
              s.playerId,
              world.squads.find(
                (t) => t.id === (s.order as { targetId: number }).targetId,
              )?.playerId ?? 0,
            )
          ) {
            s.order = { type: "hold" };
            s.path = [];
          }
          s.queuedOrders = s.queuedOrders.filter(
            (o) =>
              o.type !== "attack" ||
              this.diplomacy.hostile(
                s.playerId,
                world.squads.find((t) => t.id === o.targetId)?.playerId ?? 0,
              ),
          );
        }
        for (let tile = 0; tile < world.owners.length; tile++)
          if (
            world.claims[tile] &&
            this.diplomacy.allied(world.owners[tile], world.claims[tile])
          ) {
            world.claims[tile] = 0;
            world.progress[tile] = 0;
          }
      }
      return result;
    }
    if (command.type === "repair") {
      const ids =
        command.buildingIds ??
        (command.buildingId !== undefined ? [command.buildingId] : []);
      if (ids.length) {
        let lastError: string | null = null;
        let anySuccess = false;
        for (const buildingId of ids) {
          const res = this.fortifications.repair(
            player,
            world.buildings.find((b) => b.id === buildingId),
            undefined,
          );
          if (res === null) anySuccess = true;
          else lastError = res;
        }
        return anySuccess
          ? null
          : (lastError ?? "Choose a completed owned structure");
      }
      return this.fortifications.repair(
        player,
        undefined,
        this.fortifications.barriers.find((w) => w.id === command.barrierId),
      );
    }
    if (command.type === "recruit-aircraft")
      return this.recruitAircraft(
        player,
        command.buildingId,
        command.definitionId,
        command.autoRecruit === true,
        command.buildingIds,
      );
    if (command.type === "sortie") {
      const selected = [...new Set(command.aircraftIds)].map((id) =>
        this.aircraft.find((a) => a.id === id),
      );
      if (
        !selected.length ||
        selected.some(
          (a) => !a || a.playerId !== player.id || a.state !== "ready",
        ) ||
        !this.validPosition(command.x, command.y)
      )
        return "Select ready owned aircraft and a valid destination";
      for (const a of selected as Aircraft[]) {
        a.target = { x: command.x, y: command.y };
        a.state = "outbound";
        a.fuelTicks = 1200;
      }
      return null;
    }
    if (command.type === "launch")
      return this.launch(
        player,
        command.launcherId,
        command.payload,
        command.x,
        command.y,
      );
    if (command.type === "refit-ships") {
      const target = VESSEL.get(command.definitionId),
        selected = [...new Set(command.shipIds)].map((id) =>
          world.ships.find((s) => s.id === id),
        );
      if (
        !target ||
        target.kind === "trade" ||
        !this.progression.has(player.id, target.technologyId)
      )
        return "Research a military vessel refit first";
      if (
        !selected.length ||
        selected.some(
          (s) =>
            !s ||
            s.playerId !== player.id ||
            Boolean(s.refit) ||
            s.fighting ||
            s.destination !== null ||
            Boolean(s.boarding) ||
            s.kind !== target.kind ||
            AGES.indexOf(this.vessel(s).age) >= AGES.indexOf(target.age),
        )
      )
        return "Refit a compatible stationary fleet out of combat";
      const cost = {
        gold: (500 + AGES.indexOf(target.age) * 300) * selected.length,
        items: Object.fromEntries(
          Object.entries(target.cost.items ?? {}).map(([id, n]) => [
            id,
            n * selected.length,
          ]),
        ),
      };
      const reason = costRejection(
        player,
        this.supply.inventories[player.id],
        cost,
      );
      if (reason) return reason;
      spend(player, this.supply.inventories[player.id], cost);
      for (const s of selected as Ship[]) {
        s.refit = { targetId: target.id, remainingTicks: 200, totalTicks: 200 };
        s.waypoints = [];
        s.path = [];
        s.attackTargetId = null;
      }
      return null;
    }
    if (command.type === "naval-attack") {
      const target =
          world.ships.find((s) => s.id === command.targetId) ??
          world.buildings.find((b) => b.id === command.targetId),
        selected = [...new Set(command.shipIds)].map((id) =>
          world.ships.find((s) => s.id === id),
        );
      if (!target || !this.diplomacy.hostile(player.id, target.playerId))
        return "Choose an enemy vessel or coastal structure";
      if (
        !selected.length ||
        selected.some(
          (s) =>
            !s || s.playerId !== player.id || s.kind !== "warship" || s.refit,
        )
      )
        return "Select your available warships";
      for (const s of selected as Ship[]) {
        s.attackTargetId = target.id;
        s.lastPlanTick = -60;
      }
      return null;
    }
    if (command.type === "refit") {
      const target = UNIT.get(command.definitionId),
        selected = [...new Set(command.squadIds)].map((id) =>
          world.squads.find((s) => s.id === id),
        );
      if (!target || !this.progression.has(player.id, target.technologyId))
        return "Research the requested refit first";
      if (
        !selected.length ||
        selected.some(
          (s) =>
            !s ||
            s.playerId !== player.id ||
            s.embarkedOn !== null ||
            Boolean(s.refit) ||
            s.moved ||
            s.fighting ||
            world.owners[world.tileOf(s)] !== player.id ||
            this.unit(s).line !== target.line ||
            this.unit(s).role !== target.role ||
            AGES.indexOf(this.unit(s).age) >= AGES.indexOf(target.age),
        )
      )
        return "Refit a compatible stationary group on owned land, out of combat";
      const cost = unitRefitCost(target, selected.length);
      const rejection = costRejection(
        player,
        this.supply.inventories[player.id],
        cost,
      );
      if (rejection) return rejection;
      spend(player, this.supply.inventories[player.id], cost);
      for (const s of selected as Squad[]) {
        s.refit = { targetId: target.id, totalTicks: 200, remainingTicks: 200 };
        s.order = { type: "hold" };
        s.queuedOrders = [];
        s.path = [];
        s.charge = null;
      }
      return null;
    }
    if (command.type === "charge") {
      const selected = [...new Set(command.squadIds)].map((id) =>
        world.squads.find((s) => s.id === id),
      );
      if (!selected.length || !this.validPosition(command.x, command.y))
        return "Choose units and a valid charge destination";
      if (
        selected.some(
          (s) =>
            !s ||
            s.playerId !== player.id ||
            s.embarkedOn !== null ||
            Boolean(s.refit) ||
            !this.unit(s).charge ||
            (s.chargeReadyTick ?? 0) > world.tick ||
            Boolean(s.charge) ||
            Math.hypot(s.x - command.x, s.y - command.y) >
              this.unit(s).charge!.maximumDistance,
        )
      )
        return "Every requested unit must have a ready charge in range";
      const tile = world.map.ref(
        Math.floor(command.x / FIXED),
        Math.floor(command.y / FIXED),
      );
      const paths = selected.map((s) =>
        world.paths.find(world.tileOf(s!), tile, (t) =>
          this.fortifications.blocked(t, player.id),
        ),
      );
      if (paths.some((p) => !p)) return "Charge destination is blocked";
      if (
        command.targetId !== undefined &&
        !this.diplomacy.hostile(
          player.id,
          world.squads.find((s) => s.id === command.targetId)?.playerId ?? 0,
        )
      )
        return "Choose a hostile charge target";
      selected.forEach((s, i) => {
        s!.charge = {
          phase: "approach",
          x: command.x,
          y: command.y,
          startTick: world.tick,
          committedTick: 0,
          targetId: command.targetId,
        };
        s!.order = { type: "move", tile };
        s!.path = paths[i]!;
        s!.nextPathIndex = 0;
        s!.queuedOrders = [];
        s!.structureTarget = null;
      });
      return null;
    }
    if (command.type === "attack-structure") {
      const building = world.buildings.find((b) => b.id === command.buildingId),
        barrier = this.fortifications.barriers.find(
          (w) => w.id === command.barrierId,
        ),
        target = building ?? barrier;
      if (!target || !this.diplomacy.hostile(player.id, target.playerId))
        return "Choose an enemy structure";
      const selected = [...new Set(command.squadIds)].map((id) =>
        world.squads.find((s) => s.id === id),
      );
      if (
        !selected.length ||
        selected.some(
          (s) =>
            !s || s.playerId !== player.id || s.embarkedOn !== null || s.refit,
        )
      )
        return "Select your available troops";
      const orders: { s: Squad; tile: number; path: number[] }[] = [];
      for (const s of selected as Squad[]) {
        const targetTiles = building ? [building.tile] : barrier!.tiles;
        const approaches = new Set<number>();
        const extent = Math.ceil(this.unit(s).attack.range / FIXED);
        for (const tile of targetTiles)
        for (
          let y = Math.max(0, world.map.y(tile) - extent);
          y <= Math.min(world.map.height() - 1, world.map.y(tile) + extent);
          y++
        )
          for (
            let x = Math.max(0, world.map.x(tile) - extent);
            x <= Math.min(world.map.width() - 1, world.map.x(tile) + extent);
            x++
          ) {
            const t = world.map.ref(x, y);
            if (
              world.paths.walkable(t) &&
              !this.fortifications.blocked(t, player.id) &&
              standable(world.map, tilePoint(world.map, t), squadRadius(s.kind)) &&
              structureAim(tilePoint(world.map, t), targetTiles, this.unit(s).attack.range,
                player.id, world.map.width(), this.fortifications)
            )
              approaches.add(t);
          }
        let found: { tile: number; path: number[] } | undefined;
        const before = world.paths.work;
        for (const t of [...approaches].sort(
          (a, b) =>
            world.map.euclideanDistSquared(a, world.tileOf(s)) -
              world.map.euclideanDistSquared(b, world.tileOf(s)) || a - b,
        ).slice(0, 32)) {
          const remaining = 4096 - (world.paths.work - before);
          if (remaining <= 0) break;
          const path = world.paths.find(world.tileOf(s), t, (n) =>
            this.fortifications.blocked(n, player.id),
            remaining,
          );
          if (path) {
            found = { tile: t, path };
            break;
          }
        }
        if (!found)
          return "No legal structure approach found within the planning budget";
        orders.push({ s, ...found });
      }
      for (const { s, tile, path } of orders) {
        s.order = { type: "move", tile };
        s.path = path;
        s.nextPathIndex = 0;
        s.queuedOrders = [];
        s.charge = null;
        s.structureTarget = {
          buildingId: building?.id,
          barrierId: barrier?.id,
        };
      }
      return null;
    }
    return undefined;
  }
  private validPosition(x: number, y: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < this.world.map.width() * FIXED &&
      y < this.world.map.height() * FIXED
    );
  }
  private recruitAircraft(
    player: Player,
    id: number,
    kind: "fighter" | "bomber",
    automatic = false,
    buildingIds?: readonly number[],
  ): string | null {
    let field = this.world.buildings.find(
      (b) =>
        b.id === id &&
        b.type === "airstrip" &&
        b.playerId === player.id &&
        !b.remainingTicks &&
        this.world.owners[b.tile] === player.id && (b.health ?? 1) > 0,
    );
    const anchorTile = field?.tile ?? player.base;
    if (automatic || buildingIds) field = this.world.recruitment.chooseProducer(this.world.buildings.filter(b => b.playerId === player.id
      && (!buildingIds || buildingIds.includes(b.id))
      && this.world.owners[b.tile] === player.id && b.type === "airstrip" && !b.remainingTicks && (b.health ?? 1) > 0
      && this.aircraft.filter(a => a.airfieldId === b.id).length + this.world.recruitment.count(player.id, "aircraft", b.id) < 6),
      tile => this.world.map.euclideanDistSquared(tile, anchorTile));
    if (
      !field ||
      !["fighter", "bomber"].includes(kind) ||
      !this.progression.has(player.id, technologyAt("Modern", "warfare", 3).id)
    )
      return "Needs researched aviation and a completed owned airstrip";
    if (
      this.aircraft.filter((a) => a.airfieldId === field.id).length + this.world.recruitment.count(player.id, "aircraft", field.id) >= 6 ||
      this.aircraft.filter((a) => a.playerId === player.id).length + this.world.recruitment.count(player.id, "aircraft") >= 32
    )
      return "Airfield or aircraft capacity reached";
    const cost = {
        gold: 5000,
      },
      rejection = costRejection(
        player,
        this.supply.inventories[player.id],
        cost,
      );
    if (rejection) return rejection;
    spend(player, this.supply.inventories[player.id], cost);
    this.world.recruitment.enqueue({ playerId: player.id, buildingId: field.id, category: "aircraft", kind,
      definitionId: kind, cost, totalTicks: RECRUITMENT_SECONDS.aircraft * TICKS_PER_SECOND });
    return null;
  }
  completeAircraft(job: RecruitmentJob): boolean {
    const field = this.world.buildings.find(b => b.id === job.buildingId && b.playerId === job.playerId);
    if (!field) return false;
    this.aircraft.push({
      id: this.world.allocateId(),
      playerId: job.playerId,
      definitionId: job.kind as "fighter" | "bomber",
      airfieldId: job.buildingId,
      ...this.battle.position(field),
      health: 1000,
      target: null,
      state: "ready",
      reloadTick: 0,
      fuelTicks: 1200,
    });
    return true;
  }
  private launch(
    player: Player,
    id: number,
    payload: "icbm" | "hydrogen" | "mirv",
    x: number,
    y: number,
  ): string | null {
    if (
      !["icbm", "hydrogen", "mirv"].includes(payload) ||
      !this.validPosition(x, y) ||
      !this.progression.has(player.id, technologyAt("Modern", "warfare", 4).id)
    )
      return "Research Strategic Weapons and choose a valid target";
    const building = this.world.buildings.find(
      (b) =>
        b.id === id &&
        b.playerId === player.id &&
        !b.remainingTicks &&
        (b.health ?? 1) > 0 &&
        ((b.type === "missile-silo" && payload !== "mirv") ||
          (b.type === "mirv-launcher" && payload === "mirv")),
    );
    const unit = this.world.squads.find(
      (s) =>
        s.id === id &&
        s.playerId === player.id &&
        this.unit(s).role === "launcher" &&
        payload === "mirv" &&
        s.troops > 0 &&
        !s.refit &&
        !s.fighting &&
        !s.charge &&
        s.order.type === "hold" &&
        !s.moved &&
        s.embarkedOn === null &&
        (s.deploymentTicks ?? 0) >= 100,
    );
    const launcher = building ?? unit;
    if (!launcher)
      return "Choose a compatible ready launcher; mobile launchers must stand clear of combat for five seconds";
    const ready = building?.launchReadyTick ?? unit?.chargeReadyTick ?? 0;
    if (ready > this.world.tick) return "Launcher is reloading";
    const cost = { gold: 10000, items: { [`payload:${payload}`]: 1 } },
      rejection = costRejection(
        player,
        this.supply.inventories[player.id],
        cost,
      );
    if (rejection) return rejection;
    if (this.battle.projectiles.length >= 4092)
      return "Strategic flight capacity reached";
    spend(player, this.supply.inventories[player.id], cost);
    if (building) building.launchReadyTick = this.world.tick + 1200;
    else unit!.chargeReadyTick = this.world.tick + 1200;
    const position = building ? this.battle.position(building) : unit!;
    this.battle.fire(
      {
        id,
        playerId: player.id,
        x: position.x,
        y: position.y,
        domain: building ? "building" : "squad",
      },
      { x, y },
      {
        channel: "ranged",
        damage: payload === "hydrogen" ? 40000 : 24000,
        range: 0,
        reloadTicks: 1200,
        movingReloadPercent: 100,
        bonuses: { structure: 10000, wall: 10000 },
        penetration: 5000,
        targets: [
          "infantry",
          "ranged",
          "mounted",
          "vehicle",
          "siege",
          "ship",
          "structure",
          "wall",
        ],
        projectile: {
          diameter: FIXED / 2,
          speed: FIXED,
          blastRadius:
            (payload === "hydrogen" ? 7 : payload === "mirv" ? 3 : 5) * FIXED,
        },
      },
      payload === "hydrogen" ? 40000 : 24000,
      payload === "mirv" ? "mirv" : "icbm",
      720,
      payload === "mirv" ? 4 : 0,
      payload,
    );
    return null;
  }
  beforeStep(): void {
    const { world } = this;
    this.progression.step(world.players, (player, age) =>
      this.announce({ kind: "age", actorId: player.id, age }),
    );
    modernizeMilitaryBuildings(world.buildings, this.progression.states);
    const treaties = [...this.diplomacy.state.alliances];
    this.diplomacy.step(world.tick, world.players);
    for (const treaty of treaties)
      if (treaty.expiresTick <= world.tick)
        this.announce({
          kind: "diplomacy",
          actorId: treaty.a,
          otherId: treaty.b,
          action: "expire",
        });
    this.fortifications.step(world.tick, world.buildings);
    this.supply.step(world.tick, world.players, world.buildings, world.owners, world.squads);
    for (const s of world.ships)
      if (s.refit && --s.refit.remainingTicks <= 0) {
        s.definitionId = s.refit.targetId;
        s.xp = 0;
        s.refit = null;
      }
    for (const s of world.squads) {
      if (s.refit && --s.refit.remainingTicks <= 0) {
        const target = UNIT.get(s.refit.targetId)!;
        s.definitionId = target.id;
        s.kind = target.line;
        s.xp = 0;
        s.nextAttackTick = world.tick;
        s.refit = null;
      }
      if (
        s.charge?.phase === "approach" &&
        world.tick - s.charge.startTick >= this.unit(s).charge!.runupTicks
      ) {
        s.charge.phase = "committed";
        s.charge.committedTick = world.tick;
        s.chargeReadyTick = world.tick + this.unit(s).charge!.cooldownTicks;
      }
    }
    this.modernization.clean(world.squads, world.tick);
    this.economy.step();
    if (world.tick % 3 === 0 && world.options?.runAi !== false)
      this.thinkProgression();
  }
  afterMovement(): void {
    for (const s of this.world.squads)
      if (this.unit(s).role === "launcher")
        s.deploymentTicks =
          s.troops > 0 &&
          !s.refit &&
          !s.charge &&
          s.embarkedOn === null &&
          !s.moved &&
          !s.fighting &&
          s.order.type === "hold"
            ? Math.min(100, (s.deploymentTicks ?? 0) + 1)
            : 0;
    this.advanceAircraft();
    this.trade.step();
    this.battle.advanceProjectiles();
    for (let i = this.world.buildings.length - 1; i >= 0; i--)
      if ((this.world.buildings[i].health ?? 1) <= 0)
        this.world.buildings.splice(i, 1);
    for (let i = this.aircraft.length - 1; i >= 0; i--)
      if (
        this.aircraft[i].health <= 0 ||
        this.world.players.find((p) => p.id === this.aircraft[i].playerId)
          ?.eliminated
      )
        this.aircraft.splice(i, 1);
  }
  private advanceAircraft(): void {
    for (const a of this.aircraft) {
      if (a.health <= 0) continue;
      const base = this.world.buildings.find(
        (b) =>
          b.id === a.airfieldId &&
          b.playerId === a.playerId &&
          !b.remainingTicks,
      );
      if (!base) {
        a.health = 0;
        continue;
      }
      if (a.definitionId === "fighter" && a.state !== "ready") {
        const enemy = this.aircraft
          .filter(
            (t) =>
              this.diplomacy.hostile(a.playerId, t.playerId) &&
              (t.x - a.x) ** 2 + (t.y - a.y) ** 2 < (8 * FIXED) ** 2,
          )
          .sort((b, c) => b.id - c.id)[0];
        if (enemy && this.world.tick >= a.reloadTick) {
          if (enemy.health <= 0) continue;
          const health = enemy.health;
          enemy.health -= 200;
          if (health > 0 && enemy.health <= 0) {
            const damage = new DamageLedger();
            damage.add(enemy.id, a.playerId, Math.min(200, health));
            this.world.recordMilitaryLosses([enemy], damage);
          }
          a.reloadTick = this.world.tick + 40;
        }
      }
      if (!a.target) continue;
      const goal =
          a.state === "returning" ? this.battle.position(base) : a.target,
        dx = goal.x - a.x,
        dy = goal.y - a.y,
        distance = Math.hypot(dx, dy);
      if (--a.fuelTicks <= 0) {
        a.health = 0;
        continue;
      }
      if (distance > 180) {
        a.x += Math.round((dx * 180) / distance);
        a.y += Math.round((dy * 180) / distance);
        continue;
      }
      a.x = goal.x;
      a.y = goal.y;
      if (a.state === "returning") {
        a.state = "ready";
        a.target = null;
        a.fuelTicks = 1200;
      } else {
        if (a.definitionId === "bomber")
          this.battle.fire(
            { ...a, domain: "aircraft" },
            a.target,
            {
              channel: "ranged",
              damage: 2500,
              range: 0,
              reloadTicks: 1,
              movingReloadPercent: 100,
              bonuses: { structure: 2000 },
              penetration: 2000,
              targets: [
                "infantry",
                "ranged",
                "mounted",
                "vehicle",
                "siege",
                "structure",
                "wall",
              ],
              projectile: {
                diameter: FIXED / 3,
                speed: FIXED,
                blastRadius: 2 * FIXED,
              },
            },
            2500,
            "bomb",
            20,
            0,
            "bomb",
          );
        a.state = "returning";
      }
    }
  }
  private thinkProgression(): void {
    for (const player of this.world.players) {
      if (
        !player.ai ||
        player.eliminated ||
        this.world.tick % 60 !== (player.id % 20) * 3
      )
        continue;
      if (player.kind === "tribe") {
        this.thinkTribeDevelopment(player);
        continue;
      }
      const state = this.progression.states[player.id];
      const personality = personalityOf(player);
      if (!this.economy.enabled(player)) {
      if (
        !advanceRejection(state, player.gold, this.progression.technologySpeed)
      )
        this.world.applyCommand({ type: "advance-age", playerId: player.id });
      for (const tree of personality.researchOrder) {
        const next = TECHNOLOGIES.find(
          (t) =>
            t.tree === tree &&
            !researchRejection(
              state,
              player.gold,
              t.id,
              this.progression.technologySpeed,
            ),
        );
        if (next)
          this.world.applyCommand({
            type: "research",
            playerId: player.id,
            technologyId: next.id,
          });
      }
      const own = this.world.buildings.filter((b) => b.playerId === player.id);
      const squadCount = this.world.squads.filter((s) => s.playerId === player.id).length;
      // Nearest owned land is order-independent (it is derived from ownership),
      // so checkpoints never need the per-player tile sets.
      let nearestOwned: number[] | undefined;
      // Supply applies the same automatic allocation to humans and AI.
      for (const type of buildingPriority(personality, [
        "city",
        "barracks",
        "factory",
        "mine",
        "archery",
        "stables",
        "blacksmith",
        "armory",
        "arms-factory",
        "siege-workshop",
        "depot",
        "port",
        "oil-well",
        "oil-rig",
        "airstrip",
        "missile-defence",
        "missile-silo",
        "mirv-launcher",
      ])) {
        const extraction = type === "mine" || type === "oil-well" || type === "oil-rig";
        if (
          !extraction &&
          own.filter((b) => b.type === type && b.age === state.age).length >=
            economicBuildingTarget(
              personality,
              type,
              squadCount,
            )
        )
          continue;
        const tech = buildingTechnology(type, state.age);
        if (!tech || !this.progression.has(player.id, tech)) continue;
        // Location-independent affordability precedes every location search.
        // These types do not generate walls; final commands still own payment.
        if (costRejection(player, this.supply.inventories[player.id],
          buildingCost(type, state.age, own.filter((b) => b.type === type).length))) continue;
        const candidates =
          extraction
            ? this.supply.deposits
                .filter(
                  (d) =>
                    d.owner === player.id &&
                    !own.some((b) => b.tile === d.tile && b.type === type),
                )
                .map((d) => d.tile)
            : (nearestOwned ??= this.world.ownedLandNearest(
                player.id,
                player.base,
                256,
              )).slice();
        for (const tile of candidates.sort(
          (a, b) =>
            this.world.map.euclideanDistSquared(a, player.base) -
              this.world.map.euclideanDistSquared(b, player.base) || a - b,
        ))
          if (
            this.world.applyCommand({
              type: "build",
              playerId: player.id,
              buildingType: type,
              tile,
            }) === null
          )
            break;
      }
      this.thinkCapabilities(player);
      }
      for (const offer of this.diplomacy.state.offers.filter(
        (o) => o.recipient === player.id,
      )) {
        const proposer = this.world.players.find(
          (p) => p.id === offer.proposer,
        )!;
        const accept = acceptsAlliance(
          personality,
          player,
          proposer,
          this.diplomacy.state.alliances.filter(
            (t) => t.a === player.id || t.b === player.id,
          ).length,
          (this.diplomacy.state.betrayal[proposer.id] ?? 0) > this.world.tick,
        );
        this.world.applyCommand({
          type: "alliance",
          playerId: player.id,
          otherId: proposer.id,
          action: accept ? "accept" : "reject",
        });
      }
      if (this.victoryMode === "allied")
        for (const treaty of this.diplomacy.state.alliances.filter(
          (t) => t.a === player.id || t.b === player.id,
        ))
          if (treaty.expiresTick - this.world.tick <= 600)
            this.world.applyCommand({
              type: "alliance",
              playerId: player.id,
              otherId: treaty.a === player.id ? treaty.b : treaty.a,
              action: "renew",
            });
      // Proactive coalitions only in allied-conquest matches. Solo opponents
      // still respond to offers, but do not create new conquest deadlocks.
      const interval = personality.diplomacy.offerIntervalTicks;
      if (
        this.victoryMode === "allied" &&
        interval &&
        this.world.tick >= 1800 &&
        Math.floor(this.world.tick / 60) % (interval / 60) ===
          player.id % (interval / 60) &&
        !this.diplomacy.state.offers.some((o) => o.proposer === player.id)
      ) {
        const allies = this.diplomacy.state.alliances.filter(
          (t) => t.a === player.id || t.b === player.id,
        ).length;
        const partner = this.world.players
          .filter(
            (p) =>
              p.id !== player.id &&
              !this.diplomacy.allied(player.id, p.id) &&
              acceptsAlliance(
                personality,
                player,
                p,
                allies,
                (this.diplomacy.state.betrayal[p.id] ?? 0) > this.world.tick,
              ),
          )
          .sort(
            (a, b) =>
              this.world.map.euclideanDistSquared(player.base, a.base) -
                this.world.map.euclideanDistSquared(player.base, b.base) ||
              a.id - b.id,
          )[0];
        if (partner)
          this.world.applyCommand({
            type: "alliance",
            playerId: player.id,
            otherId: partner.id,
            action: "offer",
          });
      }
    }
  }
  private thinkTribeDevelopment(player: Player): void {
    const own = this.world.buildings.filter((b) => b.playerId === player.id);
    const targets: BuildingType[] = [];
    if (!own.some((b) => b.type === "city")) targets.push("city");
    if (own.filter((b) => b.type === "barracks").length < 2) targets.push("barracks");
    for (const type of targets) {
      const count = own.filter((b) => b.type === type).length;
      const cost = buildingCost(type, "StoneAge", count);
      if (player.gold < (cost.gold ?? 0)) continue;
      const candidates = (this.world.ownedLandNearest(player.id, player.base, 256) ?? []).slice();
      candidates.sort((a, b) =>
        this.world.map.euclideanDistSquared(a, player.base) -
        this.world.map.euclideanDistSquared(b, player.base) || a - b
      );
      for (const tile of candidates) {
        if (
          this.world.applyCommand({
            type: "build",
            playerId: player.id,
            buildingType: type,
            tile,
            age: "StoneAge",
          }) === null
        )
          break;
      }
    }
  }
  private thinkCapabilities(player: Player): void {
    const personality = personalityOf(player);
    const force = new AiForceInventory(player.id, this.world.squads, this.world.recruitment.jobs);
    const own = this.world.buildings.filter(
        (b) => b.playerId === player.id && !b.remainingTicks,
      ),
      squads = this.world.squads.filter(
        (s) => s.playerId === player.id && s.embarkedOn === null,
      ),
      stock = this.supply.inventories[player.id];
    const enemies = this.world.squads.filter((s) =>
      this.diplomacy.hostile(player.id, s.playerId),
    );
    this.modernization.reserve(
      player,
      squads,
      this.progression.states[player.id].completed,
      stock,
      this.world.tick,
    );
    let rally: number | undefined;
    for (const squad of squads) {
      const lease = this.modernization.leases.get(squad.id);
      if (!lease || squad.refit) continue;
      if (this.world.owners[this.world.tileOf(squad)] !== player.id) {
        if (rally === undefined) {
          if (this.world.owners[player.base] === player.id) rally = player.base;
          else {
            let bestDistance = Infinity;
            for (const tile of this.world.ownedLand(player.id)) {
              const distance = this.world.map.euclideanDistSquared(
                tile,
                player.base,
              );
              if (
                distance < bestDistance ||
                (distance === bestDistance && tile < (rally ?? Infinity))
              ) {
                rally = tile;
                bestDistance = distance;
              }
            }
          }
        }
        if (
          rally !== undefined &&
          (squad.order.type !== "move" || squad.order.tile !== rally)
        )
          this.world.applyCommand({
            type: "order",
            playerId: player.id,
            squadIds: [squad.id],
            order: { type: "move", tile: rally },
          });
      } else if (!squad.moved && !squad.fighting) {
        this.world.applyCommand({
          type: "refit",
          playerId: player.id,
          squadIds: [squad.id],
          definitionId: lease.targetId,
        });
      } else if (squad.order.type !== "hold") {
        this.world.applyCommand({
          type: "order",
          playerId: player.id,
          squadIds: [squad.id],
          order: { type: "hold" },
        });
      }
    }
    for (const u of UNITS.filter(
      (u) =>
        !["frontline", "ranged", "mounted"].includes(u.role) &&
        this.progression.has(player.id, u.technologyId),
    )
      .slice()
      .reverse()) {
      if (
        force.role(u.role) >=
          (["siege", "artillery"].includes(u.role)
            ? personality.siegeCopies
            : 2) ||
        costRejection(player, stock, u.cost)
      )
        continue;
      const b = own.find(
        (b) =>
          b.type === u.building &&
          AGES.indexOf(b.age ?? "StoneAge") >= AGES.indexOf(u.age),
      );
      if (b) {
        this.world.applyCommand({
          type: "recruit",
                autoRecruit: true,
          playerId: player.id,
          buildingId: b.id,
          definitionId: u.id,
        });
        break;
      }
    }
    for (const s of squads.filter(
      (s) =>
        this.unit(s).attack.bonuses.structure &&
        !s.refit &&
        !this.modernization.holds(s.id),
    )) {
      const target = this.world.buildings
        .filter(
          (b) =>
            this.diplomacy.hostile(player.id, b.playerId) &&
            (b.health ?? 1) > 0,
        )
        .sort(
          (a, b) =>
            this.world.map.euclideanDistSquared(this.world.tileOf(s), a.tile) -
              this.world.map.euclideanDistSquared(
                this.world.tileOf(s),
                b.tile,
              ) || a.id - b.id,
        )[0];
      // Keep the current approach (or firing position) when the same live,
      // hostile structure remains best. Reissuing resets its path every think.
      if (target && s.structureTarget?.buildingId !== target.id)
        this.world.applyCommand({
          type: "attack-structure",
          playerId: player.id,
          squadIds: [s.id],
          buildingId: target.id,
        });
    }
    for (const kind of ["warship", "transport"] as const) {
      const count = this.world.ships.filter(
        (s) => s.playerId === player.id && s.kind === kind,
      ).length + force.queuedShips(kind);
      if (
        count >=
        Math.min(
          32,
          Math.max(
            1,
            Math.ceil(
              squads.length /
                (kind === "warship" ? personality.squadsPerWarship : 16),
            ),
          ),
        )
      )
        continue;
      for (const v of VESSELS.filter(
        (v) =>
          v.kind === kind && this.progression.has(player.id, v.technologyId),
      )
        .slice()
        .reverse()) {
        const port = own.find(
          (b) =>
            b.type === "port" &&
            AGES.indexOf(b.age ?? "StoneAge") >= AGES.indexOf(v.age),
        );
        if (port && !costRejection(player, stock, v.cost)) {
          this.world.applyCommand({
            type: "recruit-ship",
                autoRecruit: true,
            playerId: player.id,
            buildingId: port.id,
            shipType: kind,
            definitionId: v.id,
          });
          break;
        }
      }
    }
    const plannedAircraft = new Map<string, number>();
    for (const base of own.filter((b) => b.type === "airstrip"))
      for (const definitionId of ["fighter", "bomber"] as const)
        if (
          this.aircraft.filter(
            (a) => a.playerId === player.id && a.definitionId === definitionId,
          ).length + force.queuedAircraft(definitionId) + (plannedAircraft.get(definitionId) ?? 0) < 4
        )
          if (this.world.applyCommand({
            type: "recruit-aircraft",
                autoRecruit: true,
            playerId: player.id,
            buildingId: base.id,
            definitionId,
          }) === null) plannedAircraft.set(definitionId, (plannedAircraft.get(definitionId) ?? 0) + 1);
    const enemy = enemies.sort((a, b) => a.id - b.id)[0];
    if (enemy) {
      const ready = this.aircraft.filter(
        (a) => a.playerId === player.id && a.state === "ready",
      );
      if (ready.length)
        this.world.applyCommand({
          type: "sortie",
          playerId: player.id,
          aircraftIds: ready.map((a) => a.id),
          x: enemy.x,
          y: enemy.y,
        });
      for (const launcher of [
        ...own.filter((b) =>
          ["missile-silo", "mirv-launcher"].includes(b.type),
        ),
        ...squads.filter((s) => this.unit(s).role === "launcher"),
      ]) {
        const payload =
          "type" in launcher && launcher.type === "missile-silo"
            ? stock["payload:hydrogen"]
              ? "hydrogen"
              : "icbm"
            : "mirv";
        this.world.applyCommand({
          type: "launch",
          playerId: player.id,
          launcherId: launcher.id,
          payload,
          x: enemy.x,
          y: enemy.y,
        });
      }
    }
  }
  canCaptureTile(squad: Squad, tile: number): boolean {
    if (
      this.world.owners[tile] !== squad.playerId &&
      this.diplomacy.allied(squad.playerId, this.world.owners[tile])
    )
      return false;
    if (
      this.world
        .buildingsAt(tile)
        .some(
          (b) =>
            b.tile === tile &&
            DEFENSIVE_BUILDINGS.includes(b.type) &&
            (b.health ?? 1) > 0 &&
            this.diplomacy.hostile(squad.playerId, b.playerId),
        )
    )
      return false;
    if (!this.fortifications.hasObstacles) return true;
    return this.fortifications.clear(
      squad,
      {
        x: (this.world.map.x(tile) + 0.5) * FIXED,
        y: (this.world.map.y(tile) + 0.5) * FIXED,
      },
      squad.playerId,
    );
  }
  coalition(): number[] | null {
    if (this.victoryMode !== "allied") return null;
    const live = this.world.players.filter((p) => !p.eliminated);
    // Pairwise alliance is insufficient at match opening: conquest must first
    // remove at least one regular faction, and every surviving tribe must fall.
    if (
      live.some((p) => p.kind === "tribe") ||
      !this.world.players.some((p) => p.kind === "regular" && p.eliminated) ||
      live.some((a) => live.some((b) => !this.diplomacy.allied(a.id, b.id)))
    )
      return null;
    return live.map((p) => p.id);
  }
  snapshot(): ExpansionSnapshot {
    return {
      armies: this.armies.snapshot(),
      rulesetId: "ages-v1",
      contentHash: CONTENT_HASH,
      technologySpeed: this.progression.technologySpeed,
      fortificationRevision: this.fortifications.version,
      events: this.events,
      roadRevision: this.roads.revision,
      roads: this.roads.packed(),
      progression: this.progression.states,
      inventories: this.supply.inventories,
      production: this.supply.jobs,
      recruitment: this.world.recruitment.jobs,
      productionPlans: this.supply.productionPlans(),
      productionPriorities: this.supply.priorities,
      deposits: this.supply.deposits,
      diplomacy: this.diplomacy.state,
      traders: this.trade.actors.map(
        ({ path: _path, nextPathIndex: _index, ...actor }) => actor,
      ),
      barriers: this.fortifications.barriers,
      projectiles: this.battle.projectiles,
      aircraft: this.aircraft,
      victoryMode: this.victoryMode,
      winners: this.winners,
      deliveredGold: this.trade.deliveredGold,
      tradeCapturedValue: this.trade.capturedValue,
      tradeLostValue: this.trade.lostValue,
    };
  }
}
