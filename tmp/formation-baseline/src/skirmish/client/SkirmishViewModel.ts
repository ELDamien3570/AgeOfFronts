import { availableGold } from "../domain/Gold";
import { squadCap, shipCap } from "../FactionRules";
import type { ShipType, Snapshot, SquadType } from "../Protocol";
import { FIXED, SQUAD_TROOPS } from "../Protocol";
import { BUILDING_RULES, SHIP_RULES } from "../Rules";
import { TECHNOLOGY } from "../content/Technology";
import { UNIT, UNITS, VESSEL, VESSELS } from "../content/Units";
import { AGE_NAMES, AGES, type Age } from "../domain/Definitions";
import { costRejection } from "../domain/Supply";

export interface SelectionState {
  selected: Set<number>;
  selectedShips: Set<number>;
  selectedBuilding: number | null;
  selectedBuildings?: ReadonlySet<number>;
  selectedAircraft?: Set<number>;
  selectedDeposit?: number | null;
  inspectedSquadId?: number | null;
}

// Presentation state derives from a read-only domain snapshot. No recruitment,
// combat, resource transfers, or construction happens in the view model.
export class SkirmishViewModel {
  get playerId(): number { return this.state.localPlayerId ?? 1; }

  constructor(
    readonly state: Snapshot,
    readonly selection: SelectionState,
    readonly choices: Partial<Record<SquadType | ShipType, string>> = {},
    readonly autoTier = false,
    readonly tierLimit?: Age,
  ) {}

  get player() {
    return this.state.players.find(player => player.id === this.playerId)!;
  }
  get ownSquads() {
    return this.state.squads.filter((s) => s.playerId === this.playerId);
  }
  get squadCapacity() {
    return squadCap(
      this.player,
      this.state.expansion?.progression[this.player.id]?.age,
    );
  }
  get selectedSquads() {
    return this.ownSquads.filter(
      (s) => s.embarkedOn === null && this.selection.selected.has(s.id),
    );
  }
  get inspectedSquad() {
    return this.state.squads.find(
      (s) =>
        s.id === this.selection.inspectedSquadId &&
        s.playerId !== this.playerId &&
        s.troops > 0 &&
        s.embarkedOn === null,
    );
  }
  get building() {
    return this.state.buildings.find(
      (b) => b.id === this.selection.selectedBuilding,
    );
  }
  recruitment(kind: SquadType | ShipType): {
    building: Snapshot["buildings"][number] | undefined;
    enabled: boolean;
    reason: string;
    definitionId: string | undefined;
    buildingIds: number[] | undefined;
  } {
    const naval = kind === "warship";
    if (this.autoTier && this.state.expansion) {
      const candidates = (
        naval
          ? VESSELS.filter((v) => v.kind === kind)
          : UNITS.filter(
              (u) =>
                u.line === kind &&
                u.troopClass === (kind === "infantry" ? "frontline" : kind === "archer" ? "rangedInfantry" : "lightCavalry"),
            )
      )
        .filter(
          (u) =>
            !this.tierLimit ||
            AGES.indexOf(u.age) <= AGES.indexOf(this.tierLimit),
        )
        .slice()
        .reverse();
      if (this.building)
        for (const candidate of candidates) {
          const quote = this.recruitmentQuote(kind, candidate.id, true);
          if (quote.enabled) return quote;
        }
      for (const candidate of candidates) {
        const quote = this.recruitmentQuote(kind, candidate.id);
        if (quote.enabled) return quote;
      }
      const latest = candidates.find((u) =>
        this.state.expansion!.progression[this.player.id].completed.includes(
          u.technologyId,
        ),
      );
      return this.recruitmentQuote(kind, latest?.id ?? `stoneage-${kind}`);
    }
    return this.recruitmentQuote(
      kind,
      this.choices[kind] ?? `stoneage-${kind}`,
    );
  }

  private recruitmentQuote(
    kind: SquadType | ShipType,
    definitionId: string,
    selectedOnly = false,
  ) {
    const naval = kind === "warship";
    const landDefinition =
      this.state.expansion && !naval ? UNIT.get(definitionId) : undefined;
    const vesselDefinition =
      this.state.expansion && naval ? VESSEL.get(definitionId) : undefined;
    const definition = landDefinition ?? vesselDefinition;
    const scope = this.selection.selectedBuildings?.size ? this.selection.selectedBuildings : undefined;
    const workloads = new Map<number, number>();
    for (const job of this.state.expansion?.recruitment ?? []) workloads.set(job.buildingId, (workloads.get(job.buildingId) ?? 0) + job.remainingTicks);
    const forces = [
      ...this.selectedSquads,
      ...this.state.ships.filter(
        (s) => this.selection.selectedShips.has(s.id) && s.playerId === this.playerId,
      ),
    ];
    const origin = forces.length
      ? {
          x: forces.reduce((sum, unit) => sum + unit.x, 0) / forces.length,
          y: forces.reduce((sum, unit) => sum + unit.y, 0) / forces.length,
        }
      : {
          x: ((this.player.base % this.state.width) + 0.5) * FIXED,
          y: (Math.floor(this.player.base / this.state.width) + 0.5) * FIXED,
        };
    const distance = (tile: number) =>
      (((tile % this.state.width) + 0.5) * FIXED - origin.x) ** 2 +
      ((Math.floor(tile / this.state.width) + 0.5) * FIXED - origin.y) ** 2;
    const building = this.state.buildings
      .filter(
        (b) =>
          b.playerId === this.playerId &&
          (!scope || scope.has(b.id)) &&
          (!selectedOnly || (scope ? scope.has(b.id) : b.id === this.selection.selectedBuilding)) &&
          (b.health ?? 1) > 0 &&
          this.state.owners[b.tile] === this.playerId &&
          b.remainingTicks === 0 &&
          (naval
            ? b.type === "port"
            : landDefinition
              ? b.type === landDefinition.building
              : BUILDING_RULES[b.type].squad === kind) &&
          (!definition ||
            AGES.indexOf(b.age ?? "StoneAge") >= AGES.indexOf(definition.age)),
      )
      .sort(
        (a, b) =>
          (scope ? (workloads.get(a.id) ?? 0) - (workloads.get(b.id) ?? 0) : Number(b.id === this.selection.selectedBuilding) - Number(a.id === this.selection.selectedBuilding)) ||
          distance(a.tile) - distance(b.tile) ||
          a.id - b.id,
      )[0];
    let reason = "";
    if (this.player.eliminated || this.state.winner !== null)
      reason = "Skirmish finished";
    else if (
      this.state.expansion &&
      (!definition ||
        !this.state.expansion.progression[this.player.id].completed.includes(
          definition.technologyId,
        ))
    )
      reason = definition
        ? `Requires research: ${TECHNOLOGY.get(definition.technologyId)?.name ?? definition.technologyId}`
        : "Unit definition unavailable";
    else if (!building)
      reason = `Needs a completed friendly ${BUILDING_RULES[landDefinition?.building ?? (naval ? "port" : kind === "infantry" ? "barracks" : kind === "archer" ? "archery" : "stables")].name.toLowerCase()}${definition ? ` (${AGE_NAMES[AGES.indexOf(definition.age)]} or later)` : ""}`;
    else if (naval && availableGold(this.player) < SHIP_RULES[kind].cost)
      reason = "Not enough gold";
    else if (!naval && this.player.reserves < SQUAD_TROOPS)
      reason = "Needs 1,000 reserve troops";
    else if (
      naval &&
      this.state.ships.filter((s) => s.playerId === this.playerId && s.kind === kind).length +
        (this.state.expansion?.recruitment ?? []).filter(j => j.playerId === this.playerId && j.category === "ship" && j.kind === kind).length >= shipCap(this.player, kind as ShipType)
    )
      reason = `${kind === "warship" ? "Warship" : "Transport"} limit reached`;
    else if (!naval && this.ownSquads.length + (this.state.expansion?.recruitment ?? []).filter(j => j.playerId === this.playerId && j.category === "land").length >= this.squadCapacity)
      reason = "Squad limit reached";
    if (!reason && definition)
      reason =
        costRejection(
          this.player,
          this.state.expansion!.inventories[this.player.id],
          definition.cost,
        ) ?? "";
    return {
      building,
      enabled: reason === "",
      reason,
      definitionId: definition?.id,
      buildingIds: scope ? [...scope] : undefined,
    };
  }

  get replenishableSquads() {
    return this.selectedSquads.filter(
      (s) =>
        s.troops < SQUAD_TROOPS &&
        !s.refit &&
        this.state.owners[
          Math.floor(s.y / FIXED) * this.state.width + Math.floor(s.x / FIXED)
        ] === this.playerId,
    );
  }
  get canReplenish() {
    return (
      this.replenishableSquads.length > 0 &&
      this.state.winner === null &&
      !this.player.eliminated &&
      this.player.reserves > 0
    );
  }
  get selectedBuildings() {
    const scope = this.selection.selectedBuildings;
    const focus = this.selection.selectedBuilding;
    const ids = new Set<number>(scope ?? []);
    if (focus !== null && focus !== undefined) ids.add(focus);
    return this.state.buildings.filter((b) => ids.has(b.id));
  }
  get repairableBuildings() {
    return this.selectedBuildings.filter(
      (b) =>
        b.playerId === this.playerId &&
        !b.remainingTicks &&
        (b.health ?? 1200) < (b.maxHealth ?? 1200),
    );
  }
  get canRepairBuildings() {
    return (
      this.selectedBuildings.some((b) => b.playerId === this.playerId) &&
      this.state.winner === null &&
      !this.player.eliminated &&
      availableGold(this.player) > 0
    );
  }
}
