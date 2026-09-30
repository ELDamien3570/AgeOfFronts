import type { ShipType, Snapshot, SquadType } from "../Protocol";
import { FIXED, MAX_SQUADS, SQUAD_TROOPS } from "../Protocol";
import { BUILDING_RULES, MAX_SHIPS, SHIP_RULES } from "../Rules";

export interface SelectionState {
  selected: Set<number>;
  selectedShips: Set<number>;
  selectedBuilding: number | null;
}

// Presentation state derives from a read-only domain snapshot. No recruitment,
// combat, resource transfers, or construction happens in the view model.
export class SkirmishViewModel {
  constructor(
    readonly state: Snapshot,
    readonly selection: SelectionState,
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
  recruitment(kind: SquadType | ShipType) {
    const naval = kind === "transport" || kind === "warship";
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
          (naval ? b.type === "port" : BUILDING_RULES[b.type].squad === kind),
      )
      .sort((a, b) => distance(a.tile) - distance(b.tile) || a.id - b.id)[0];
    let reason = "";
    if (this.player.eliminated || this.state.winner !== null)
      reason = "Skirmish finished";
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
    return { building, enabled: reason === "", reason };
  }

  get replenishableSquads() {
    return this.selectedSquads.filter(
      (s) =>
        s.troops < SQUAD_TROOPS &&
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
