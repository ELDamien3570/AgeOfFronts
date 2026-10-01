import type { BuildingType, ShipType, Snapshot, SquadType } from "../Protocol";
import {
  buildingCost,
  buildingTechnology,
  producerCompatible,
} from "../content/Buildings";
import {
  ADVANCES,
  TECHNOLOGIES,
  TECHNOLOGY,
  technologyAt,
  treeWorkload,
} from "../content/Technology";
import { defaultUnit, UNIT, UNITS, VESSEL, VESSELS } from "../content/Units";
import { AGE_NAMES, AGES, TREES, type Age } from "../domain/Definitions";
import {
  advanceRejection,
  researchRejection,
  treeCompletion,
} from "../domain/Progression";
import {
  costRejection,
  PRODUCTION_RECIPES,
  productionRejection,
  productionTicks,
} from "../domain/Supply";
import { ResourceViewModel } from "./ResourceViewModel";
import { SkirmishViewModel, type SelectionState } from "./SkirmishViewModel";
export class EmpireViewModel {
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
    return this.state.players[0];
  }
  get progression() {
    return this.expansion.progression[1];
  }
  get inventory() {
    return this.expansion.inventories[1];
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
      ageName: AGE_NAMES[AGES.indexOf(progression.age)],
      advancementSeconds: progression.advancement
        ? Math.ceil(progression.advancement.remainingTicks / 20)
        : null,
    };
  }
  has(id: string): boolean {
    return this.progression.completed.includes(id);
  }
  nodes(age: Age) {
    return TECHNOLOGIES.filter((t) => t.age === age).map((t) => ({
      ...t,
      completed: this.has(t.id),
      researching: this.progression.research[t.tree]?.technologyId === t.id,
      reason: researchRejection(this.progression, this.player.gold, t.id),
    }));
  }
  get summary() {
    return TREES.map(
      (tree) =>
        `${tree[0].toUpperCase()}${tree.slice(1)} ${treeCompletion(this.progression, tree)}/${treeWorkload(this.progression.age, tree)}`,
    ).join(" · ");
  }
  get advance() {
    const cost = ADVANCES[AGES.indexOf(this.progression.age)];
    return {
      cost,
      reason: advanceRejection(this.progression, this.player.gold),
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
      return t && this.has(t);
    });
  }
  buildChoice(type: BuildingType, age = this.buildingAge(type)) {
    if (!age)
      return { reason: "Research required", age: undefined, cost: undefined };
    const cost = buildingCost(type, age);
    return {
      age,
      cost,
      reason: costRejection(this.player, this.inventory, cost),
    };
  }
  buildingPreview(type: BuildingType) {
    const unlocked = this.buildingAge(type);
    const age = unlocked ?? AGES.find((a) => buildingTechnology(type, a));
    return {
      age,
      cost: age ? buildingCost(type, age) : undefined,
      reason: unlocked
        ? this.buildChoice(type, unlocked).reason
        : "Research required",
    };
  }
  get producers() {
    return this.state.buildings
      .filter((b) => b.playerId === 1)
      .map((b) => ({
        building: b,
        job: this.expansion.production[b.id],
        selected: PRODUCTION_RECIPES.find(
          (r) => r.id === this.expansion.productionPlans?.[b.id]?.recipeId,
        ),
        recipes: PRODUCTION_RECIPES.filter(
          (r) =>
            producerCompatible(b.type, r.building) && this.has(r.technologyId),
        ),
      }));
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
        1,
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
    if (!producer) return "Producer unavailable";
    if (producer.building.remainingTicks)
      return `Construction · ${Math.ceil(producer.building.remainingTicks / 20)}s`;
    if (producer.job)
      return `${PRODUCTION_RECIPES.find((r) => r.id === producer.job!.recipeId)!.name} · ${Math.ceil(producer.job.remainingTicks / 20)}s`;
    if (!producer.selected) return "Choose a repeating production pattern";
    const choice = this.productionChoice(buildingId, producer.selected.id);
    const missing = choice.inputs.filter((i) => i.available < i.required);
    return (
      choice.reason ??
      (missing.length
        ? `Waiting: ${missing.map((i) => `${this.itemName(i.id)} ${i.available}/${i.required}`).join(", ")}`
        : `${producer.selected.name} · ready to start`)
    );
  }
  refit(focusedId?: number) {
    const selected = this.state.squads.filter(
      (s) =>
        s.playerId === 1 &&
        s.embarkedOn === null &&
        (focusedId === undefined
          ? this.selection.selected.has(s.id)
          : s.id === focusedId),
    );
    if (!selected.length) return null;
    const first =
      UNIT.get(selected[0].definitionId ?? "") ?? defaultUnit(selected[0].kind);
    if (selected.some((s) => s.definitionId !== selected[0].definitionId))
      return {
        reason: "Inspect a compatible group to refit",
        target: undefined,
        selected,
        cost: undefined,
      };
    const target = this.units(first.line).filter(
      (u) =>
        u.role === first.role && AGES.indexOf(u.age) > AGES.indexOf(first.age),
    )[0];
    if (!target)
      return {
        reason: "Research the next tier to unlock a refit",
        target: undefined,
        selected,
        cost: undefined,
      };
    const items = Object.fromEntries(
      Object.entries(target.cost.items ?? {})
        .filter(([id]) => id !== "horses")
        .map(([id, amount]) => [id, amount * selected.length]),
    );
    const cost = {
      gold: (500 + AGES.indexOf(target.age) * 300) * selected.length,
      items,
    };
    const reason = selected.some(
      (s) =>
        Boolean(s.refit) ||
        s.moved ||
        s.fighting ||
        this.state.owners[
          Math.floor(s.y / 256) * this.state.width + Math.floor(s.x / 256)
        ] !== 1,
    )
      ? "Needs owned land and no combat or active refit"
      : costRejection(this.player, this.inventory, cost);
    return { reason, target, selected, cost };
  }
  shipRefit(focusedId?: number) {
    const selected = this.state.ships.filter(
      (s) =>
        s.playerId === 1 &&
        (focusedId === undefined
          ? this.selection.selectedShips.has(s.id)
          : s.id === focusedId),
    );
    if (!selected.length) return null;
    const first = VESSEL.get(
      selected[0].definitionId ?? `stoneage-${selected[0].kind}`,
    )!;
    const target = this.vessels(first.kind as ShipType).find(
      (v) => AGES.indexOf(v.age) > AGES.indexOf(first.age),
    );
    if (!target)
      return {
        reason: "Research the next vessel tier",
        selected,
        target: undefined,
        cost: undefined,
      };
    const cost = {
      gold: (500 + AGES.indexOf(target.age) * 300) * selected.length,
      items: Object.fromEntries(
        Object.entries(target.cost.items ?? {}).map(([id, n]) => [
          id,
          n * selected.length,
        ]),
      ),
    };
    const reason = selected.some(
      (s) =>
        s.definitionId !== selected[0].definitionId ||
        Boolean(s.refit) ||
        s.fighting ||
        s.destination !== null ||
        Boolean(s.boarding),
    )
      ? "Needs a compatible stationary fleet out of combat"
      : costRejection(this.player, this.inventory, cost);
    return { selected, target, cost, reason };
  }
  get incoming() {
    return this.expansion.diplomacy.offers.filter((o) => o.recipient === 1);
  }
  technologyName(id: string) {
    return TECHNOLOGY.get(id)?.name ?? id;
  }
  itemName(id: string) {
    return UNIT.get(id.replace(/^equipment:/, ""))?.name
      ? `${UNIT.get(id.replace(/^equipment:/, ""))!.name} equipment`
      : id
          .replace(/^equipment:|^payload:/, "")
          .replace(/([a-z])([A-Z])/g, "$1 $2");
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
  aircraft(kind: "fighter" | "bomber") {
    const building = this.state.buildings
      .filter(
        (b) =>
          b.playerId === 1 &&
          !b.remainingTicks &&
          b.type === "airstrip" &&
          this.expansion.aircraft.filter((a) => a.airfieldId === b.id).length <
            6,
      )
      .sort(
        (a, b) => this.distance(a.tile) - this.distance(b.tile) || a.id - b.id,
      )[0];
    const cost = {
      gold: 5000,
      reserves: 1000,
      items: { [`equipment:${kind}`]: 1, oil: 20 },
    };
    const reason = !this.has(technologyAt("Modern", "warfare", 3).id)
      ? "Research Military Aviation"
      : !building
        ? "Needs an airstrip with a free slot"
        : this.expansion.aircraft.filter((a) => a.playerId === 1).length >= 32
          ? "Aircraft limit reached"
          : costRejection(this.player, this.inventory, cost);
    return { building, cost, reason };
  }
  launcher(payload: "icbm" | "hydrogen" | "mirv") {
    const candidates = [
      ...this.state.buildings
        .filter(
          (b) =>
            b.playerId === 1 &&
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
            s.playerId === 1 &&
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
    const reason = !this.has(technologyAt("Modern", "warfare", 4).id)
      ? "Research Strategic Weapons"
      : !launcher
        ? "Needs a ready compatible launcher"
        : launcher.ready > this.state.tick
          ? "Selected launcher is reloading or deploying"
          : costRejection(this.player, this.inventory, cost);
    return { launcher, cost, reason };
  }
}
