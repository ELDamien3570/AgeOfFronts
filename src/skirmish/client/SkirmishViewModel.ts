import type { ShipType, Snapshot, SquadType } from "../Protocol";
import { FIXED, MAX_SQUADS, SQUAD_TROOPS } from "../Protocol";
import { BUILDING_RULES, MAX_SHIPS, SHIP_RULES } from "../Rules";
import { UNIT, UNITS, VESSEL, VESSELS } from "../content/Units";
import { AGES, type Age } from "../domain/Definitions";
import { costRejection } from "../domain/Supply";

export interface SelectionState {
  selected: Set<number>;
  selectedShips: Set<number>;
  selectedBuilding: number | null;
  selectedAircraft?: Set<number>;
}

// Presentation state derives from a read-only domain snapshot. No recruitment,
// combat, resource transfers, or construction happens in the view model.
export class SkirmishViewModel {
  constructor(
    readonly state: Snapshot,
    readonly selection: SelectionState,
    readonly choices: Partial<Record<SquadType | ShipType, string>> = {},
    readonly autoTier = false,
    readonly tierLimit?: Age,
  ) {}

  get player() {
    return this.state.players[0];
  }
  get ownSquads() {
    return this.state.squads.filter((s) => s.playerId === 1);
  }
  get selectedSquads() {
    return this.ownSquads.filter(
      (s) => s.embarkedOn === null && this.selection.selected.has(s.id),
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
  } {
    const naval = kind === "transport" || kind === "warship";
    if (this.autoTier && this.state.expansion) {
      const candidates = (
        naval
          ? VESSELS.filter((v) => v.kind === kind)
          : UNITS.filter(
              (u) =>
                u.line === kind &&
                ["frontline", "ranged", "mounted"].includes(u.role),
            )
      )
        .filter(
          (u) =>
            !this.tierLimit ||
            AGES.indexOf(u.age) <= AGES.indexOf(this.tierLimit),
        )
        .slice()
        .reverse();
      for (const candidate of candidates) {
        const quote = new SkirmishViewModel(this.state, this.selection, {
          ...this.choices,
          [kind]: candidate.id,
        }).recruitment(kind);
        if (quote.enabled) return quote;
      }
      const latest = candidates.find((u) =>
        this.state.expansion!.progression[this.player.id].completed.includes(
          u.technologyId,
        ),
      );
      return new SkirmishViewModel(this.state, this.selection, {
        ...this.choices,
        [kind]: latest?.id ?? `stoneage-${kind}`,
      }).recruitment(kind);
    }
    const definitionId = this.choices[kind] ?? `stoneage-${kind}`;
    const landDefinition =
      this.state.expansion && !naval ? UNIT.get(definitionId) : undefined;
    const vesselDefinition =
      this.state.expansion && naval ? VESSEL.get(definitionId) : undefined;
    const definition = landDefinition ?? vesselDefinition;
    const forces = [
      ...this.selectedSquads,
      ...this.state.ships.filter(
        (s) => this.selection.selectedShips.has(s.id) && s.playerId === 1,
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
          b.playerId === 1 &&
          this.state.owners[b.tile] === 1 &&
          b.remainingTicks === 0 &&
          (naval
            ? b.type === "port"
            : landDefinition
              ? b.type === landDefinition.building
              : BUILDING_RULES[b.type].squad === kind) &&
          (!definition ||
            AGES.indexOf(b.age ?? "StoneAge") >= AGES.indexOf(definition.age)),
      )
      .sort((a, b) => distance(a.tile) - distance(b.tile) || a.id - b.id)[0];
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
      reason = "Research this unit's technology first";
    else if (!building)
      reason = naval
        ? "Needs a completed friendly port"
        : `Needs a completed friendly ${kind === "infantry" ? "barracks" : kind === "archer" ? "archery range" : "stables"}`;
    else if (naval && this.player.gold < SHIP_RULES[kind].cost)
      reason = "Not enough gold";
    else if (!naval && this.player.reserves < SQUAD_TROOPS)
      reason = "Needs 1,000 reserve troops";
    else if (
      naval &&
      this.state.ships.filter((s) => s.playerId === 1).length >= MAX_SHIPS
    )
      reason = "Fleet limit reached";
    else if (!naval && this.ownSquads.length >= MAX_SQUADS)
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
    };
  }

  get replenishableSquads() {
    return this.selectedSquads.filter(
      (s) =>
        s.troops < SQUAD_TROOPS &&
        !s.refit &&
        this.state.owners[
          Math.floor(s.y / FIXED) * this.state.width + Math.floor(s.x / FIXED)
        ] === 1,
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
  get transport() {
    if (this.selection.selectedShips.size !== 1) return undefined;
    return this.state.ships.find(
      (s) =>
        this.selection.selectedShips.has(s.id) &&
        s.playerId === 1 &&
        s.kind === "transport",
    );
  }
  get cargo() {
    return this.transport
      ? this.state.squads.filter((s) => s.embarkedOn === this.transport!.id)
      : [];
  }
}
