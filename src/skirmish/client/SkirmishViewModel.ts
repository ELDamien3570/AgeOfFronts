import { scaledRecipeCost, recipeCapacity } from '../domain/Manpower';
import { recruitmentVariant } from '../content/FormationRecipes';
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
  highGround?(squad:Snapshot["squads"][number],snapshot:Snapshot):{range:number;rangeBp:number;damageBp:number;targetId?:number};
  selected: Set<number>;
  selectedShips: Set<number>;
  selectedBuilding: number | null;
  selectedBuildings?: ReadonlySet<number>;
  selectedAircraft?: Set<number>;
  selectedDeposit?: number | null;
  inspectedSquadId?: number | null;
}
interface RecruitmentFacts {
  player: Snapshot['players'][number];
  scope?: ReadonlySet<number>;
  selectedBuilding: number | null;
  workloads: Map<number, number>;
  origin: { x: number; y: number };
  squadCount: number;
  warshipCount: number;
  queuedLand: number;
  queuedWarships: number;
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
    cost: import('../domain/Definitions').Cost | undefined;
    capacity: number | undefined;
    buildingIds: number[] | undefined;
  } {
    return this.recruitmentFor(kind, this.recruitmentFacts());
  }

  /** Borrow common facts only inside this synchronous query batch. Every new
   * snapshot/selection update and command acquires fresh counts and origin. */
  recruitmentQuotes(kinds: readonly (SquadType | ShipType)[]) {
    const facts = this.recruitmentFacts();
    return new Map(kinds.map(kind => [kind, this.recruitmentFor(kind, facts)] as const));
  }

  private recruitmentFacts(): RecruitmentFacts {
    const player = this.player, playerId = this.playerId;
    let squadCount = 0, warshipCount = 0, queuedLand = 0, queuedWarships = 0;
    const forces: { x: number; y: number }[] = [];
    for (const squad of this.state.squads) if (squad.playerId === playerId) {
      squadCount++;
      if (squad.embarkedOn === null && this.selection.selected.has(squad.id)) forces.push(squad);
    }
    for (const ship of this.state.ships) if (ship.playerId === playerId) {
      warshipCount++;
      if (this.selection.selectedShips.has(ship.id)) forces.push(ship);
    }
    const workloads = new Map<number, number>();
    for (const job of this.state.expansion?.recruitment ?? []) {
      workloads.set(job.buildingId, (workloads.get(job.buildingId) ?? 0) + job.remainingTicks);
      if (job.playerId === playerId) {
        if (job.category === 'land') queuedLand++;
        else if (job.category === 'ship') queuedWarships++;
      }
    }
    const origin = forces.length ? {
      x: forces.reduce((sum, unit) => sum + unit.x, 0) / forces.length,
      y: forces.reduce((sum, unit) => sum + unit.y, 0) / forces.length,
    } : {
      x: ((player.base % this.state.width) + 0.5) * FIXED,
      y: (Math.floor(player.base / this.state.width) + 0.5) * FIXED,
    };
    return {player, scope: this.selection.selectedBuildings?.size ? this.selection.selectedBuildings : undefined,
      selectedBuilding: this.selection.selectedBuilding, workloads, origin, squadCount, warshipCount, queuedLand, queuedWarships};
  }

  private recruitmentFor(kind: SquadType | ShipType, facts: RecruitmentFacts) {
    const naval = kind === "warship" || kind === "carrier";
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
          // Research is a necessary condition for every quote. Do not prepare
          // queue, selection and building facts for a tier that cannot be used.
          if (!this.state.expansion.progression[this.playerId].completed.includes(candidate.technologyId)) continue;
          const quote = this.recruitmentQuote(kind, candidate.id, facts, true);
          if (quote.enabled) return quote;
        }
      for (const candidate of candidates) {
        if (!this.state.expansion.progression[this.playerId].completed.includes(candidate.technologyId)) continue;
        const quote = this.recruitmentQuote(kind, candidate.id, facts);
        if (quote.enabled) return quote;
      }
      const latest = candidates.find((u) =>
        this.state.expansion!.progression[this.player.id].completed.includes(
          u.technologyId,
        ),
      );
      return this.recruitmentQuote(kind, latest?.id ?? `stoneage-${kind}`, facts);
    }
    return this.recruitmentQuote(
      kind,
      this.choices[kind] ?? `stoneage-${kind}`,
      facts,
    );
  }

  private recruitmentQuote(
    kind: SquadType | ShipType,
    definitionId: string,
    facts: RecruitmentFacts,
    selectedOnly = false,
  ) {
    const naval = kind === "warship" || kind === "carrier";
    const landDefinition =
      this.state.expansion && !naval ? UNIT.get(definitionId) : undefined;
    const vesselDefinition =
      this.state.expansion && naval ? VESSEL.get(definitionId) : undefined;
    const definition = landDefinition ?? vesselDefinition;
    const variant=landDefinition?recruitmentVariant(landDefinition.id,this.state.expansion!.progression[this.playerId].completed):"base";
    const cost=landDefinition?scaledRecipeCost(landDefinition,variant):vesselDefinition?.cost;
    const capacity=landDefinition?recipeCapacity(landDefinition,variant):undefined;
    const { scope, workloads, origin, player, selectedBuilding } = facts;
    const distance = (tile: number) =>
      (((tile % this.state.width) + 0.5) * FIXED - origin.x) ** 2 +
      ((Math.floor(tile / this.state.width) + 0.5) * FIXED - origin.y) ** 2;
    const building = this.state.buildings
      .filter(
        (b) =>
          b.playerId === this.playerId &&
          (!scope || scope.has(b.id)) &&
          (!selectedOnly || (scope ? scope.has(b.id) : b.id === selectedBuilding)) &&
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
          (scope ? (workloads.get(a.id) ?? 0) - (workloads.get(b.id) ?? 0) : Number(b.id === selectedBuilding) - Number(a.id === selectedBuilding)) ||
          distance(a.tile) - distance(b.tile) ||
          a.id - b.id,
      )[0];
    let reason = "";
    if (player.eliminated || this.state.winner !== null)
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
    else if (naval && availableGold(player) < SHIP_RULES[kind].cost)
      reason = "Not enough gold";
    else if (!naval && player.reserves < (landDefinition?.cost.reserves ?? SQUAD_TROOPS))
      reason = this.state.expansion ? `Needs ${landDefinition?.cost.reserves??12} reserve soldiers` : "Needs 1,000 reserve troops";
    else if (
      naval &&
      facts.warshipCount + facts.queuedWarships >= shipCap(player, kind as ShipType)
    )
      reason = `${kind === "warship" ? "Warship" : "Transport"} limit reached`;
    else if (!naval && facts.squadCount + facts.queuedLand >= this.squadCapacity)
      reason = "Squad limit reached";
    if (!reason && definition)
      reason =
        costRejection(
          player,
          this.state.expansion!.inventories[this.player.id],
          cost!,
        ) ?? "";
    return {
      building,
      enabled: reason === "",
      reason,
      definitionId: definition?.id,
      cost,capacity,
      buildingIds: scope ? [...scope] : undefined,
    };
  }

  get replenishableSquads() {
    return this.selectedSquads.filter(
      (s) =>
        s.troops < (s.manpower?.capacity ?? SQUAD_TROOPS) &&
        !s.refit && !s.manpower?.enlargement &&
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
