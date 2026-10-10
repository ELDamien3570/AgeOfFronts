import {
  buildingCost,
  buildingTechnology,
  buildingTicks,
  producerCompatible,
} from "../content/Buildings";
import { supplyItemName } from "../content/Equipment";
import { aircraftTechnology, FLIGHT_RULES } from "../content/FlightOperations";
import {
  ADVANCES,
  canonicalTechnologyId,
  TECHNOLOGIES,
  TECHNOLOGY,
  treeWorkload,
} from "../content/Technology";
import { UNIT, UNITS, VESSEL, VESSELS } from "../content/Units";
import { automaticProductionPriorities } from "../domain/AutomaticProduction";
import { quoteBuildingUpgrades } from "../domain/BuildingUpgrades";
import { AGE_NAMES, AGES, TREES, type Age } from "../domain/Definitions";
import { availableGold } from "../domain/Gold";
import {
  advanceRejection,
  researchRejection,
  researchTerms,
  treeCompletion,
} from "../domain/Progression";
import { quoteLandRefits, quoteShipRefits } from "../domain/RefitQuote";
import {
  costRejection,
  PRODUCTION_RECIPES,
  productionRejection,
  productionTicks,
} from "../domain/Supply";
import type { BuildingType, ShipType, Snapshot, SquadType } from "../Protocol";
import { FactionViewModel } from "./FactionViewModel";
import { productionText } from "./ProductionText";
import { ResourceViewModel } from "./ResourceViewModel";
import { SkirmishViewModel, type SelectionState } from "./SkirmishViewModel";
export class EmpireViewModel {
  get playerId(): number {
    return this.state.localPlayerId ?? 1;
  }

  readonly resources: ResourceViewModel;
  constructor(
    readonly state: Snapshot,
    readonly selection: SelectionState,
  ) {
    this.resources = new ResourceViewModel(
      this.progression.age,
      this.inventory,
    );
  }
  get expansion() {
    return this.state.expansion!;
  }
  get player() {
    return this.state.players.find((player) => player.id === this.playerId)!;
  }
  get progression() {
    return this.expansion.progression[this.playerId];
  }
  get technologySpeed() {
    return this.expansion.technologySpeed;
  }
  get inventory() {
    return this.expansion.inventories[this.playerId];
  }
  get ageName() {
    return AGE_NAMES[AGES.indexOf(this.progression.age)];
  }
  faction(id: number) {
    const player = this.state.players.find((p) => p.id === id);
    const progression = this.expansion.progression[id];
    if (!player || !progression) return null;
    return {
      player,
      identity: new FactionViewModel(player),
      age: progression.age,
      ageName: AGE_NAMES[AGES.indexOf(progression.age)],
      advancementSeconds: progression.advancement
        ? Math.ceil(progression.advancement.remainingTicks / 20)
        : null,
    };
  }
  militaryCounts(id: number) {
    return {
      squads: this.state.squads.filter((s) => s.playerId === id && s.troops > 0)
        .length,
      boats: this.state.ships.filter(
        (s) => s.playerId === id && s.kind === "warship" && s.health > 0,
      ).length,
      planes: this.expansion.aircraft.filter(
        (a) => a.playerId === id && a.health > 0,
      ).length,
    };
  }
  has(id: string): boolean {
    return this.progression.completed.includes(canonicalTechnologyId(id));
  }
  nodes(age: Age) {
    return TECHNOLOGIES.filter((t) => t.age === age).map((t) => ({
      ...t,
      ...researchTerms(t, this.technologySpeed),
      completed: this.has(t.id),
      researching: this.progression.research[t.tree]?.technologyId === t.id,
      reason: researchRejection(
        this.progression,
        availableGold(this.player),
        t.id,
        this.technologySpeed,
      ),
    }));
  }
  get summary() {
    return TREES.map(
      (tree) =>
        `${tree[0].toUpperCase()}${tree.slice(1)} ${treeCompletion(this.progression, tree)}/${treeWorkload(this.progression.age, tree)}`,
    ).join(" · ");
  }
  get advance() {
    const definition = ADVANCES[AGES.indexOf(this.progression.age)],
      cost = definition && researchTerms(definition, this.technologySpeed);
    return {
      cost,
      reason: advanceRejection(
        this.progression,
        availableGold(this.player),
        this.technologySpeed,
        this.expansion.maximumAge,
      ),
    };
  }
  units(line?: SquadType) {
    return UNITS.filter(
      (u) =>
        this.has(u.technologyId) &&
        (!line ||
          (u.line === line &&
            ["frontline", "ranged", "mounted"].includes(u.role))),
    );
  }
  vessels(kind?: ShipType) {
    return VESSELS.filter(
      (v) =>
        this.has(v.technologyId) &&
        v.kind !== "trade" &&
        (!kind || v.kind === kind),
    );
  }
  buildingAge(type: BuildingType): Age | undefined {
    return [...AGES].reverse().find((age) => {
      const t = buildingTechnology(type, age);
      return (
        AGES.indexOf(age) <= AGES.indexOf(this.progression.age) &&
        t &&
        this.has(t)
      );
    });
  }
  buildChoice(type: BuildingType, age = this.buildingAge(type)) {
    if (!age)
      return {
        reason: this.buildingResearchRequirement(type),
        age: undefined,
        cost: undefined,
        ticks: undefined,
      };
    const count = this.state.buildings.filter(
      (b) => b.playerId === this.playerId && b.type === type,
    ).length;
    const cost = buildingCost(type, age, count);
    const ticks = buildingTicks(type, count);
    return {
      age,
      cost,
      ticks,
      reason: costRejection(this.player, this.inventory, cost),
    };
  }
  private buildingResearchRequirement(type: BuildingType): string {
    const age = AGES.find((a) => buildingTechnology(type, a));
    const id = age && buildingTechnology(type, age);
    return id
      ? `Requires research: ${this.technologyName(id)} (${AGE_NAMES[AGES.indexOf(age!)]})`
      : "Building unavailable";
  }
  buildingVisible(type: BuildingType): boolean {
    return (
      !!this.buildingAge(type) ||
      !!buildingTechnology(type, this.progression.age)
    );
  }
  buildingPreview(type: BuildingType) {
    const unlocked = this.buildingAge(type);
    const age = unlocked ?? AGES.find((a) => buildingTechnology(type, a));
    const count = this.state.buildings.filter(
      (b) => b.playerId === this.playerId && b.type === type,
    ).length;
    return {
      age,
      cost: age ? buildingCost(type, age, count) : undefined,
      ticks: buildingTicks(type, count),
      requiredTechnology: age
        ? this.technologyName(buildingTechnology(type, age)!)
        : undefined,
      reason: unlocked
        ? this.buildChoice(type, unlocked).reason
        : this.buildingResearchRequirement(type),
    };
  }
  get producers() {
    return this.state.buildings
      .filter(
        (b) =>
          b.playerId === this.playerId &&
          (b.health ?? 1) > 0 &&
          PRODUCTION_RECIPES.some((r) =>
            producerCompatible(b.type, r.building),
          ),
      )
      .map((b) => ({
        building: b,
        job: this.expansion.production[b.id],
        mode: this.productionMode(b.id),
        selected: PRODUCTION_RECIPES.find(
          (r) => r.id === this.expansion.productionPlans?.[b.id]?.recipeId,
        ),
        recipes: PRODUCTION_RECIPES.filter(
          (r) =>
            producerCompatible(b.type, r.building) && this.has(r.technologyId),
        ),
      }));
  }
  get productionGroups() {
    const groups = new Map<BuildingType, typeof this.producers>();
    for (const producer of this.producers) {
      const group = groups.get(producer.building.type) ?? [];
      group.push(producer);
      groups.set(producer.building.type, group);
    }
    return [...groups].map(([type, producers]) => {
      const manual =
        this.expansion.productionPriorities?.[this.playerId]?.[type];
      const automaticPriorityIds = automaticProductionPriorities(
        type,
        this.progression.completed,
      );
      const priorityIds = manual ?? automaticPriorityIds;
      const jobs = new Map<string, number>();
      for (const { job } of producers)
        if (job) jobs.set(job.recipeId, (jobs.get(job.recipeId) ?? 0) + 1);
      return {
        type,
        count: producers.length,
        ready: producers.filter((p) => !p.building.remainingTicks).length,
        mode:
          manual === undefined
            ? ("auto" as const)
            : manual.length
              ? ("manual" as const)
              : ("paused" as const),
        priorityIds,
        automaticPriorityIds,
        recipes: PRODUCTION_RECIPES.filter((r) =>
          producerCompatible(type, r.building),
        ).map((recipe) => ({
          ...recipe,
          prioritized: priorityIds.includes(recipe.id),
          reason: this.has(recipe.technologyId)
            ? null
            : productionText("requires_research", {
                technology: this.technologyName(recipe.technologyId),
              }),
          cycleTicks: productionTicks(recipe, this.progression.completed),
        })),
        running: [...jobs].map(([recipeId, count]) => ({
          recipe: PRODUCTION_RECIPES.find((r) => r.id === recipeId),
          recipeId,
          count,
        })),
      };
    });
  }
  get hasManualProduction(): boolean {
    return (
      Object.keys(this.expansion.productionPriorities?.[this.playerId] ?? {})
        .length > 0 ||
      Object.values(this.expansion.productionPlans ?? {}).some(
        (plan) => plan.owner === this.playerId,
      )
    );
  }
  productionMode(buildingId: number): "auto" | "manual" | "paused" {
    const plan = this.expansion.productionPlans?.[buildingId];
    if (plan?.owner === this.playerId)
      return plan.recipeId === "paused" ? "paused" : "manual";
    const building = this.state.buildings.find((b) => b.id === buildingId);
    const priorities =
      building &&
      this.expansion.productionPriorities?.[this.playerId]?.[building.type];
    return priorities === undefined
      ? "auto"
      : priorities.length
        ? "manual"
        : "paused";
  }
  productionChoice(buildingId: number, recipeId: string) {
    const building = this.state.buildings.find((b) => b.id === buildingId),
      recipe = PRODUCTION_RECIPES.find((r) => r.id === recipeId);
    return {
      recipe,
      cycleTicks: recipe
        ? productionTicks(recipe, this.progression.completed)
        : 0,
      reason: productionRejection(
        this.playerId,
        building,
        recipe,
        this.progression.completed,
      ),
      inputs: Object.entries(recipe?.inputs ?? {}).map(([id, required]) => ({
        id,
        required,
        available: this.inventory[id] ?? 0,
      })),
      outputs: Object.entries(recipe?.outputs ?? {}).map(([id, amount]) => ({
        id,
        amount,
      })),
    };
  }
  productionStatus(buildingId: number) {
    const producer = this.producers.find((p) => p.building.id === buildingId);
    if (!producer) return productionText("unavailable");
    if (producer.building.remainingTicks)
      return productionText("construction", {
        seconds: Math.ceil(producer.building.remainingTicks / 20),
      });
    if (producer.job) {
      const recipe = PRODUCTION_RECIPES.find(
        (r) => r.id === producer.job!.recipeId,
      );
      const seconds = Math.ceil(producer.job.remainingTicks / 20);
      if (producer.mode === "paused")
        return productionText("pausing", {
          recipe: recipe?.name ?? producer.job.recipeId,
          seconds,
        });
      if (producer.selected && producer.selected.id !== producer.job.recipeId)
        return productionText("manual_next", {
          current: recipe?.name ?? producer.job.recipeId,
          seconds,
          next: producer.selected.name,
        });
      return productionText("active", {
        mode: productionText(producer.mode === "auto" ? "automatic" : "manual"),
        recipe: recipe?.name ?? producer.job.recipeId,
        seconds,
      });
    }
    if (producer.mode === "paused") return productionText("paused_idle");
    if (producer.mode === "manual" && !producer.selected)
      return productionText("manual_idle");
    if (!producer.selected)
      return productionText(
        producer.recipes.length ? "automatic_idle" : "automatic_locked",
      );
    const choice = this.productionChoice(buildingId, producer.selected.id);
    const missing = choice.inputs.filter((i) => i.available < i.required);
    return (
      choice.reason ??
      (missing.length
        ? productionText("waiting", {
            inputs: missing
              .map((i) => `${this.itemName(i.id)} ${i.available}/${i.required}`)
              .join(", "),
          })
        : productionText("ready", { recipe: producer.selected.name }))
    );
  }
  buildingUpgrade() {
    const ids = this.selection.selectedBuildings?.size
      ? [...this.selection.selectedBuildings]
      : this.selection.selectedBuilding === null
        ? []
        : [this.selection.selectedBuilding];
    if (!ids.length) return null;
    return quoteBuildingUpgrades(
      this.player,
      this.progression,
      this.inventory,
      this.state.buildings,
      this.state.owners,
      ids,
    );
  }
  refit(focusedId?: number) {
    const selected = this.state.squads.filter(
      (s) => s.playerId === this.playerId && this.selection.selected.has(s.id),
    );
    return quoteLandRefits(
      selected,
      focusedId,
      {
        player: this.player,
        research: this.progression.completed,
        inventory: this.inventory,
      },
      this.state.owners,
      this.state.width,
    );
  }
  shipRefit(focusedId?: number) {
    const selected = this.state.ships.filter(
      (s) =>
        s.playerId === this.playerId && this.selection.selectedShips.has(s.id),
    );
    return quoteShipRefits(selected, focusedId, {
      player: this.player,
      research: this.progression.completed,
      inventory: this.inventory,
    });
  }
  get allianceRenewals() {
    return this.expansion.diplomacy.alliances
      .filter(
        (t) =>
          !t.longTerm &&
          (t.a === this.playerId || t.b === this.playerId) &&
          t.expiresTick > this.state.tick &&
          t.expiresTick - this.state.tick <= 600,
      )
      .flatMap((t) => {
        const otherId = t.a === this.playerId ? t.b : t.a;
        const other = this.state.players.find(
          (p) => p.id === otherId && !p.eliminated,
        );
        return other
          ? [
              {
                key: t.id + ":" + t.expiresTick,
                otherId,
                name: other.name,
                seconds: Math.ceil((t.expiresTick - this.state.tick) / 20),
                requested: t.renewal.includes(this.playerId),
              },
            ]
          : [];
      });
  }

  get incoming() {
    return this.expansion.diplomacy.offers.filter(
      (o) => o.recipient === this.playerId,
    );
  }
  technologyName(id: string) {
    return TECHNOLOGY.get(id)?.name ?? id;
  }
  itemName(id: string) {
    return supplyItemName(id);
  }
  recruitDefinition(id: string) {
    const u = UNIT.get(id)!;
    return new SkirmishViewModel(this.state, this.selection, {
      [u.line]: id,
    }).recruitment(u.line);
  }
  vesselName(id: string) {
    return VESSEL.get(id)?.name ?? id;
  }
  get origin() {
    const forces = [
      ...this.state.squads.filter((s) => this.selection.selected.has(s.id)),
      ...this.state.ships.filter((s) => this.selection.selectedShips.has(s.id)),
      ...this.expansion.aircraft.filter((a) =>
        this.selection.selectedAircraft?.has(a.id),
      ),
    ];
    return forces.length
      ? {
          x: forces.reduce((n, s) => n + s.x, 0) / forces.length,
          y: forces.reduce((n, s) => n + s.y, 0) / forces.length,
        }
      : {
          x: ((this.player.base % this.state.width) + 0.5) * 256,
          y: (Math.floor(this.player.base / this.state.width) + 0.5) * 256,
        };
  }
  private distance(tile: number) {
    const p = this.origin;
    return (
      (((tile % this.state.width) + 0.5) * 256 - p.x) ** 2 +
      ((Math.floor(tile / this.state.width) + 0.5) * 256 - p.y) ** 2
    );
  }
  aircraft(kind: "fighter" | "bomber" | "drone") {
    const workloads = new Map<number, number>();
    for (const job of this.expansion.recruitment ?? [])
      workloads.set(
        job.buildingId,
        (workloads.get(job.buildingId) ?? 0) + job.remainingTicks,
      );
    const building = this.state.buildings
      .filter(
        (b) =>
          b.playerId === this.playerId &&
          !b.remainingTicks &&
          b.type === (kind === "drone" ? "drone-facility" : "airstrip") &&
          (!this.selection.selectedBuildings?.size ||
            this.selection.selectedBuildings.has(b.id)) &&
          this.state.owners[b.tile] === this.playerId &&
          (b.health ?? 1) > 0 &&
          this.expansion.aircraft.filter((a) => a.airfieldId === b.id).length +
            (this.expansion.recruitment ?? []).filter(
              (j) =>
                j.playerId === this.playerId &&
                j.category === "aircraft" &&
                j.buildingId === b.id,
            ).length <
            6,
      )
      .sort(
        (a, b) =>
          (this.selection.selectedBuildings?.size
            ? (workloads.get(a.id) ?? 0) - (workloads.get(b.id) ?? 0)
            : Number(b.id === this.selection.selectedBuilding) -
              Number(a.id === this.selection.selectedBuilding)) ||
          this.distance(a.tile) - this.distance(b.tile) ||
          a.id - b.id,
      )[0];
    const cost = {
      gold: FLIGHT_RULES[kind].gold,
    };
    const reason = !this.has(
      aircraftTechnology(
        kind,
        building?.age ?? (kind === "drone" ? "Modern" : "EarlyModern"),
      ),
    )
      ? `Research ${this.technologyName(aircraftTechnology(kind, building?.age ?? (kind === "drone" ? "Modern" : "EarlyModern")))}`
      : !building
        ? "Needs an airstrip with a free slot"
        : this.expansion.aircraft.filter((a) => a.playerId === this.playerId)
              .length +
              (this.expansion.recruitment ?? []).filter(
                (j) =>
                  j.playerId === this.playerId && j.category === "aircraft",
              ).length >=
            32
          ? "Aircraft limit reached"
          : costRejection(this.player, this.inventory, cost);
    return {
      building,
      cost,
      reason,
      buildingIds: this.selection.selectedBuildings?.size
        ? [...this.selection.selectedBuildings]
        : undefined,
    };
  }
  launcher(payload: "icbm" | "hydrogen" | "mirv") {
    const candidates = [
      ...this.state.buildings
        .filter(
          (b) =>
            b.playerId === this.playerId &&
            !b.remainingTicks &&
            (b.health ?? 1) > 0 &&
            (payload === "mirv"
              ? b.type === "mirv-launcher"
              : b.type === "missile-silo"),
        )
        .map((b) => ({
          id: b.id,
          tile: b.tile,
          selected: this.selection.selectedBuilding === b.id,
          ready: b.launchReadyTick ?? 0,
        })),
      ...this.state.squads
        .filter(
          (s) =>
            s.playerId === this.playerId &&
            payload === "mirv" &&
            UNIT.get(s.definitionId ?? "")?.role === "launcher",
        )
        .map((s) => ({
          id: s.id,
          tile:
            Math.floor(s.y / 256) * this.state.width + Math.floor(s.x / 256),
          selected: this.selection.selected.has(s.id),
          ready:
            s.troops <= 0 ||
            s.order.type !== "hold" ||
            Boolean(s.charge) ||
            s.moved ||
            s.fighting ||
            Boolean(s.refit) ||
            s.embarkedOn !== null ||
            (s.deploymentTicks ?? 0) < 100
              ? Infinity
              : (s.chargeReadyTick ?? 0),
        })),
    ];
    const selected = candidates.filter((c) => c.selected),
      launcher = (
        selected.length
          ? selected
          : candidates.filter((c) => c.ready <= this.state.tick)
      ).sort(
        (a, b) => this.distance(a.tile) - this.distance(b.tile) || a.id - b.id,
      )[0];
    const cost = { gold: 10000, items: { [`payload:${payload}`]: 1 } };
    const reason = !this.has("modern-strategic-weapons")
      ? "Research Missile Infrastructure"
      : !launcher
        ? "Needs a ready compatible launcher"
        : launcher.ready > this.state.tick
          ? "Selected launcher is reloading or deploying"
          : costRejection(this.player, this.inventory, cost);
    return { launcher, cost, reason };
  }
}
