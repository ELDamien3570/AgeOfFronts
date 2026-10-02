import type { BuildingType, ShipType, SquadType } from "../Protocol";
import { FIXED, SQUAD_TROOPS, TICKS_PER_SECOND } from "../Protocol";
import {
  ARCHER_CHARGE_REQUIRED,
  ARCHER_MOVING_CHARGE,
  ARCHER_STATIONARY_CHARGE,
  BUILDING_RULES,
  REPLENISH_DELAY,
  REPLENISH_PER_SECOND,
  SHIP_RULES,
  SQUAD_RULES,
} from "../Rules";
import { buildingTechnology } from "../content/Buildings";
import { GUN_NEST_ATTACK, TRENCH_COVER } from "../content/Defences";
import { cityReserveIncome } from "../content/Economy";
import { supplyItemName } from "../content/Equipment";
import { resourceTechnology } from "../content/Resources";
import { TECHNOLOGY } from "../content/Technology";
import { UNIT, VESSEL } from "../content/Units";
import { promotionLevel, scaledAttack, XP_THRESHOLDS } from "../domain/Combat";
import {
  AGE_NAMES,
  AGES,
  type Resource,
  type UnitDefinition,
} from "../domain/Definitions";
import {
  breedingPerSecond,
  unitEffects,
  vesselEffects,
} from "../domain/ResearchEffects";
import { PRODUCTION_RECIPES } from "../domain/Supply";
import { CONSTRUCTION, LAND_RECRUITMENT, NAVAL_RECRUITMENT } from "./Controls";
import { EmpireViewModel } from "./EmpireViewModel";
import { SkirmishViewModel } from "./SkirmishViewModel";

export type HudKind =
  | BuildingType
  | SquadType
  | ShipType
  | "fighter"
  | Resource
  | "bomber";
export interface HudStat {
  label: string;
  value: string;
}
export interface HudCard {
  title: string;
  subtitle: string;
  kind?: HudKind;
  stats: HudStat[];
  description: string;
  definitionId?: string;
  groupKey?: string;
  compact?: { stats: HudStat[]; description: string };
  status?: string;
  meter?: { label: string; value: number; max: number };
  promotion?: { level: number; xp: number; next: number | null };
}
export interface SelectedEntity extends HudCard {
  ref: string;
  kind: HudKind;
  playerId: number;
  count: number;
  category: "squad" | "ship" | "building" | "aircraft" | "resource";
}
export type SelectionCard =
  | { mode: "empty"; entities: SelectedEntity[] }
  | {
      mode: "detail" | "group";
      entities: SelectedEntity[];
      card: SelectedEntity;
    }
  | { mode: "mixed"; entities: SelectedEntity[] };

const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});
const fmt = (n: number) => numberFormat.format(n);
const stat = (label: string, value: string): HudStat => ({ label, value });

function createSquadCard(kind: SquadType): HudCard {
  const rules = SQUAD_RULES[kind];
  const ranged = kind === "archer";
  return {
    title: rules.name,
    subtitle: ranged ? "Ranged squad" : "Melee squad",
    kind,
    stats: [
      stat("Recruitment", `${fmt(SQUAD_TROOPS)} reserves`),
      stat("Full strength", `${fmt(SQUAD_TROOPS)} troops`),
      stat("Speed", `${rules.speedPercent}% · terrain affects movement`),
      stat("Attack range", `${fmt(rules.range / FIXED)} cells`),
      stat(
        ranged ? "Volley damage" : "Damage / sec",
        fmt(rules.damage * (ranged ? 1 : TICKS_PER_SECOND)),
      ),
      ...(ranged
        ? [
            stat("Close volley", fmt(rules.closeDamage)),
            stat(
              "Stationary volley",
              `${fmt(ARCHER_CHARGE_REQUIRED / ARCHER_STATIONARY_CHARGE / TICKS_PER_SECOND)} sec`,
            ),
            stat(
              "Moving volley",
              `${fmt(ARCHER_CHARGE_REQUIRED / ARCHER_MOVING_CHARGE / TICKS_PER_SECOND)} sec`,
            ),
          ]
        : []),
    ],
    description:
      "Damage shown at full strength. Casualties reduce attack strength. Recruitment uses the nearest ready matching building to your selection, or your camp.",
    compact: {
      stats: [
        stat("Recruitment", `${fmt(SQUAD_TROOPS)} reserves`),
        stat("Speed", `${rules.speedPercent}%`),
        stat("Range", `${fmt(rules.range / FIXED)} cells`),
        stat(
          ranged ? "Volley damage" : "Damage / sec",
          fmt(rules.damage * (ranged ? 1 : TICKS_PER_SECOND)),
        ),
        ...(ranged
          ? [
              stat("Close volley", fmt(rules.closeDamage)),
              stat(
                "Volley timing",
                `${fmt(ARCHER_CHARGE_REQUIRED / ARCHER_STATIONARY_CHARGE / TICKS_PER_SECOND)}s still · ${fmt(ARCHER_CHARGE_REQUIRED / ARCHER_MOVING_CHARGE / TICKS_PER_SECOND)}s moving`,
              ),
            ]
          : []),
      ],
      description: "Damage at full troop strength.",
    },
  };
}
function createShipCard(kind: ShipType): HudCard {
  const rule = SHIP_RULES[kind];
  return {
    title: rule.name,
    subtitle: kind === "transport" ? "Squad carrier" : "Naval combat",
    kind,
    stats: [
      stat("Recruitment", `${fmt(rule.cost)} gold`),
      stat("Hull health", fmt(rule.health)),
      stat(
        "Sailing speed",
        `${fmt((rule.speed * TICKS_PER_SECOND) / FIXED)} cells / sec`,
      ),
      ...(rule.capacity
        ? [stat("Capacity", `${rule.capacity} whole squads`)]
        : [
            stat("Attack range", `${rule.range / FIXED} cells`),
            stat("Damage / sec", fmt(rule.damage * TICKS_PER_SECOND)),
          ]),
    ],
    description: rule.capacity
      ? "Right click a friendly transport with selected squads to meet at a coast and board. Excess squads wait ashore. Sunk transports lose their cargo."
      : "Automatically attacks enemy ships in range. Damage decreases with hull health. Ships sail only on water.",
  };
}
function createBuildingCard(kind: BuildingType): HudCard {
  const rule = BUILDING_RULES[kind];
  return {
    title: rule.name,
    subtitle: rule.squad ? "Military building" : "Economic building",
    kind,
    stats: [
      stat("Construction cost", `${fmt(rule.cost)} gold`),
      stat("Build time", `${rule.ticks / TICKS_PER_SECOND} sec`),
      ...(rule.reserveIncome
        ? [stat("Reserve income", `+${rule.reserveIncome} / sec`)]
        : []),
      ...(rule.goldIncome
        ? [stat("Gold income", `+${rule.goldIncome} / sec`)]
        : []),
      ...(rule.squad
        ? [stat("Recruitment", SQUAD_RULES[rule.squad].name)]
        : []),
      ...(kind === "port"
        ? [stat("Recruitment", "Transports & warships")]
        : []),
    ],
    description: `Place on friendly ${kind === "port" ? "coastal " : ""}land. Same-type copies can share a tile; each has its own cost, construction and full benefit. Capturing the tile transfers the entire stack.`,
  };
}

// Rule descriptions are static. Project live health, orders and availability
// separately so a large selection does not reformat identical stats per unit.
const squadCards: Record<SquadType, HudCard> = {
  infantry: createSquadCard("infantry"),
  archer: createSquadCard("archer"),
  cavalry: createSquadCard("cavalry"),
};
const shipCards: Record<ShipType, HudCard> = {
  transport: createShipCard("transport"),
  warship: createShipCard("warship"),
};
const buildingCards = Object.fromEntries(
  (Object.keys(BUILDING_RULES) as BuildingType[]).map((type) => [
    type,
    createBuildingCard(type),
  ]),
) as Record<BuildingType, HudCard>;

function unitCard(unit: UnitDefinition, xp = 0): HudCard {
  const a = scaledAttack(unit.attack, 1000, 1000, xp);
  const stats = [
    stat("Unit age", AGE_NAMES[AGES.indexOf(unit.age)]),
    stat(
      "Melee Armour",
      unit.armourKind === "points"
        ? `${unit.meleeArmour} points`
        : `${unit.meleeArmour / 100}%`,
    ),
    stat(
      "Ranged Armour",
      unit.armourKind === "points"
        ? `${unit.rangedArmour} points`
        : `${unit.rangedArmour / 100}%`,
    ),
    stat("Melee Attack", a.channel === "melee" ? fmt(a.damage) : "—"),
    stat("Ranged Attack", a.channel === "ranged" ? fmt(a.damage) : "—"),
    stat("Range", `${fmt(a.range / FIXED)} cells`),
    stat("Targets", a.targets.join(", ")),
    stat(
      "Reload Time",
      `${a.reloadTicks / 20}s · ${(a.reloadTicks * a.movingReloadPercent) / 2000}s moving`,
    ),
    stat("Speed", `${unit.speedPercent}% · terrain applies`),
    stat(
      "Occupation",
      unit.undefendedCaptureTicks
        ? `${unit.undefendedCaptureTicks / 20}s undefended · nearby enemies prevent fast capture`
        : unit.canCapture
          ? "Normal local capture"
          : "Cannot capture land",
    ),
    stat(
      "Bonuses",
      Object.entries(a.bonuses)
        .map(([tag, n]) => `+${n} vs ${tag}`)
        .join(", ") || "None",
    ),
    stat(
      "Bonus resistance",
      Object.entries(unit.bonusResistance)
        .map(([tag, n]) => `${n} vs ${tag}`)
        .join(", ") || "None",
    ),
    stat(
      "Projectile Size",
      a.projectile
        ? `${fmt(a.projectile.diameter / FIXED)} cell diameter`
        : "Not applicable",
    ),
    stat(
      "Blast Radius",
      a.projectile
        ? `${fmt(a.projectile.blastRadius / FIXED)} cells`
        : "Not applicable",
    ),
    ...(unit.charge
      ? [
          stat("Charge Speed", `${unit.charge.speedPercent}%`),
          stat("Charge Damage", String(unit.charge.damage)),
          stat("Charge Reload Time", `${unit.charge.cooldownTicks / 20}s`),
        ]
      : []),
  ];
  return {
    title: unit.name,
    subtitle: `${AGE_NAMES[AGES.indexOf(unit.age)]} · ${unit.role}`,
    kind: unit.line,
    definitionId: unit.id,
    groupKey: `${unit.id}:${promotionLevel(xp)}`,
    stats,
    description: unit.placeholder
      ? "Temporary presentation · authoritative stats shown above."
      : "Damage is per attack at full strength. Armour protects the base channel; target bonuses have separate resistance.",
    compact: {
      stats: [
        stat(
          "Research",
          TECHNOLOGY.get(unit.technologyId)?.name ?? unit.technologyId,
        ),
        stat(
          "Building",
          `${BUILDING_RULES[unit.building].name} · ${AGE_NAMES[AGES.indexOf(unit.age)]} or later`,
        ),
        stat("Cost", `${unit.cost.gold ?? 0} gold · 1,000 reserves`),
        stat(
          "Supplies",
          Object.entries(unit.cost.items ?? {})
            .map(([id, n]) => `${n} ${supplyItemName(id)}`)
            .join(", ") || "None",
        ),
        ...stats.filter((s) =>
          ["Range", "Reload Time", "Bonuses"].includes(s.label),
        ),
      ],
      description: "Recruit from a matching completed building of this tier.",
    },
  };
}
function vesselCard(
  id: string,
  research: readonly string[] = [],
  xp = 0,
): HudCard | undefined {
  const base = VESSEL.get(id);
  if (!base || base.kind === "trade") return;
  const v = vesselEffects(base, research);
  const attack = v.attack
    ? scaledAttack(v.attack, v.health, v.health, xp)
    : undefined;
  return {
    title: v.name,
    subtitle: AGE_NAMES[AGES.indexOf(v.age)],
    kind: v.kind as ShipType,
    definitionId: id,
    groupKey: `${id}:${promotionLevel(xp)}`,
    description: "Construction requires the matching researched port tier.",
    stats: [
      stat("Research", TECHNOLOGY.get(v.technologyId)?.name ?? v.technologyId),
      stat("Building", `Port · ${AGE_NAMES[AGES.indexOf(v.age)]} or later`),
      stat("Recruitment", `${v.cost.gold} gold`),
      stat(
        "Supplies",
        Object.entries(v.cost.items ?? {})
          .map(([id, n]) => `${n} ${id}`)
          .join(", ") || "None",
      ),
      stat("Hull health", String(v.health)),
      stat("Capacity", `${v.capacity} whole squads`),
      stat("Range", `${(v.attack?.range ?? 0) / FIXED} cells`),
      stat("Attack", String(attack?.damage ?? 0)),
      stat("Reload", `${(v.attack?.reloadTicks ?? 0) / 20}s`),
    ],
  };
}
// HUD projections only observe domain rules and snapshots. Focused inspection
// belongs to the view and never changes the selected army or its commands.
export class HudViewModel {
  get playerId(): number { return this.game.playerId; }

  constructor(readonly game: SkirmishViewModel) {}

  actionCard(id: string): HudCard | undefined {
    const land = LAND_RECRUITMENT.find((a) => `recruit-${a.kind}` === id);
    const naval = NAVAL_RECRUITMENT.find((a) => a.kind === id);
    const build = CONSTRUCTION.find((a) => `build-${a.kind}` === id);
    if (land || naval) {
      const kind = land?.kind ?? naval!.kind;
      const choice = this.game.recruitment(kind);
      return {
        ...(choice.definitionId
          ? land
            ? unitCard(
                unitEffects(
                  UNIT.get(choice.definitionId)!,
                  this.game.state.expansion!.progression[this.playerId].completed,
                ),
              )
            : vesselCard(
                choice.definitionId,
                this.game.state.expansion!.progression[this.playerId].completed,
              )!
          : land
            ? squadCards[land.kind]
            : shipCards[naval!.kind]),
        status:
          choice.reason ||
          `Ready · ${BUILDING_RULES[choice.building!.type].name} #${choice.building!.id}`,
      };
    }
    if (build) {
      const rule = BUILDING_RULES[build.kind];
      const choice = this.game.state.expansion
        ? new EmpireViewModel(this.game.state, this.game.selection).buildChoice(
            build.kind,
          )
        : undefined;
      return {
        ...buildingCards[build.kind],
        ...(choice
          ? {
              stats: [
                ...(choice.age
                  ? [
                      stat(
                        "Research",
                        TECHNOLOGY.get(
                          buildingTechnology(build.kind, choice.age)!,
                        )?.name ?? "Unavailable",
                      ),
                    ]
                  : []),
                stat("Cost", `${choice.cost?.gold ?? "—"} gold`),
                stat(
                  "Materials",
                  Object.entries(choice.cost?.items ?? {})
                    .map(([id, n]) => `${n} ${id}`)
                    .join(", ") || "None",
                ),
              ],
              description:
                build.kind === "factory"
                  ? "Makes finite commercial goods and strategic recipes; delivery earns gold."
                  : build.kind === "port"
                    ? "Fleet construction and trade endpoint; no passive gold."
                    : buildingCards[build.kind].description,
            }
          : {}),
        status:
          this.game.state.winner !== null || this.game.player.eliminated
            ? "Skirmish finished"
            : (choice?.reason ??
              (this.game.player.gold < rule.cost
                ? "Not enough gold"
                : "Choose a location on friendly land")),
      };
    }
    if (id === "replenish") {
      if (this.game.selectedBuildings.length > 0) {
        const repairable = this.game.repairableBuildings;
        return {
          title: "Repair selected buildings",
          subtitle: "R · structure repair",
          stats: [
            stat("Selected buildings", String(this.game.selectedBuildings.length)),
            stat("Damaged buildings", String(repairable.length)),
          ],
          description:
            "Repairs damaged selected friendly buildings over time using gold.",
          status: repairable.length > 0
            ? (this.game.player.gold > 0 ? "Ready" : "Not enough gold")
            : "No repair needed",
        };
      }
      return {
        title: "Replenish selected squads",
        subtitle: "R · manual reinforcement",
        stats: [
          stat("Transfer rate", `${REPLENISH_PER_SECOND} reserves / sec`),
          stat("Combat cooldown", `${REPLENISH_DELAY / TICKS_PER_SECOND} sec`),
          stat("Eligible squads", String(this.game.replenishableSquads.length)),
        ],
        description:
          "Only damaged selected squads on friendly land receive the order. They stop until full or given another order. Other selected units keep their orders.",
        status: this.game.canReplenish
          ? "Ready"
          : "Needs damaged squads on friendly land and available reserves",
      };
    }
    if (id === "hold")
      return {
        title: "Hold selected units",
        subtitle: "T · stop and clear routes",
        stats: [],
        description:
          "Stops selected squads and ships and clears their queued movement orders. Units can still automatically fight enemies within range.",
        status: this.entities.some((e) => e.category !== "building")
          ? "Ready"
          : "Select squads or ships",
      };
    if (id === "all")
      return {
        title: "Select all land squads",
        subtitle: "Ctrl A · selection",
        stats: [],
        description:
          "Selects every friendly squad currently on land. Embarked squads become selectable again after landing. Ships are selected separately.",
      };
    return undefined;
  }

  depositCard(id: number): SelectedEntity | undefined {
    const { state, selection } = this.game;
    const deposit = state.expansion?.deposits.find((d) => d.id === id);
    if (!deposit || !state.expansion) return;
    const empire = new EmpireViewModel(state, selection);
    if (!empire.resources.depositVisible(deposit.resource)) return;
    const technology = resourceTechnology(deposit.resource),
      researched = empire.has(technology.id),
      branch = technology.tree[0].toUpperCase() + technology.tree.slice(1),
      research = stat(
        "Research node",
        `${technology.name} · ${AGE_NAMES[AGES.indexOf(technology.age)]} · ${branch}`,
      ),
      extraction = stat(
        "Extraction",
        deposit.resource === "horses"
          ? "Own this deposit"
          : deposit.resource === "oil"
            ? "Own this deposit and build an oil well / offshore rig"
            : "Own this deposit and build a mine",
      );
    return {
      ref: `deposit:${deposit.id}`,
      kind: deposit.resource,
      category: "resource",
      playerId: deposit.owner,
      count: 1,
      title: `${deposit.resource.replace(/([a-z])([A-Z])/g, "$1 $2")} deposit`,
      subtitle: deposit.owner
        ? (state.players.find((p) => p.id === deposit.owner)?.name ?? "Owned")
        : "Unclaimed",
      status: researched
        ? `Research complete: ${technology.name}`
        : `Requires research: ${technology.name}`,
      description:
        "Own this deposit, complete its research, and meet the extraction requirements to collect it.",
      stats: [
        research,
        extraction,
        stat("Base yield", `${deposit.yieldPerSecond} / sec before upgrades`),
        stat(
          "Stock",
          deposit.owner === 1
            ? fmt(state.expansion.inventories[this.playerId][deposit.resource] ?? 0)
            : "Foreign inventory hidden",
        ),
      ],
      compact: {
        stats: [research, extraction],
        description: `${deposit.yieldPerSecond} / sec before upgrades`,
      },
    };
  }

  get entities(): SelectedEntity[] {
    const { state, selection } = this.game;
    const inspected = this.game.inspectedSquad;
    const squads: SelectedEntity[] = (
      inspected ? [inspected] : this.game.selectedSquads
    ).map((s) => ({
      ...(s.definitionId
        ? unitCard(
            unitEffects(
              UNIT.get(s.definitionId)!,
              state.expansion!.progression[s.playerId].completed,
            ),
            s.xp,
          )
        : squadCards[s.kind]),
      ref: `squad:${s.id}`,
      kind: s.kind,
      category: "squad",
      playerId: s.playerId,
      count: 1,
      title: `${UNIT.get(s.definitionId ?? "")?.name ?? SQUAD_RULES[s.kind].name} #${s.id}`,
      subtitle:
        s.playerId === this.playerId
          ? "1 squad selected"
          : `${state.players.find((p) => p.id === s.playerId)?.name ?? "Enemy"} · ${AGE_NAMES[AGES.indexOf(UNIT.get(s.definitionId ?? "")?.age ?? "StoneAge")]} · read only`,
      meter: { label: "Troop strength", value: s.troops, max: SQUAD_TROOPS },
      status: s.refit
        ? `Refitting · ${Math.ceil(s.refit.remainingTicks / 20)}s`
        : s.charge
          ? `Charge · ${s.charge.phase}`
          : s.fighting
            ? "In combat"
            : s.order.type === "board"
              ? "Meeting transport"
              : s.order.type === "replenish"
                ? "Replenishing"
                : s.order.type === "attack"
                  ? "Attack order"
                  : s.order.type === "move"
                    ? "Moving"
                    : "Holding",
      promotion: state.expansion
        ? {
            level: promotionLevel(s.xp ?? 0),
            xp: s.xp ?? 0,
            next: XP_THRESHOLDS[promotionLevel(s.xp ?? 0)] ?? null,
          }
        : undefined,
      stats: [
        ...(state.expansion
          ? [
              stat(
                "Faction age",
                AGE_NAMES[
                  AGES.indexOf(state.expansion.progression[s.playerId].age)
                ],
              ),
            ]
          : []),
        stat("Queued orders", String(s.queuedOrders.length)),
        ...(s.definitionId
          ? [
              ...unitCard(
                unitEffects(
                  UNIT.get(s.definitionId)!,
                  state.expansion!.progression[s.playerId].completed,
                ),
                s.xp,
              ).stats,
              stat(
                "Promotion",
                `Level ${promotionLevel(s.xp ?? 0)} · ${s.xp ?? 0} XP`,
              ),
            ]
          : squadCards[s.kind].stats
        ).filter(
          (v) => v.label !== "Recruitment" && v.label !== "Full strength",
        ),
      ],
    }));
    if (inspected) return squads;
    const ships: SelectedEntity[] = state.ships
      .filter((s) => s.playerId === this.playerId && selection.selectedShips.has(s.id))
      .map((s) => ({
        ...(s.definitionId
          ? vesselCard(
              s.definitionId,
              state.expansion!.progression[s.playerId].completed,
              s.xp,
            )!
          : shipCards[s.kind]),
        ref: `ship:${s.id}`,
        kind: s.kind,
        category: "ship",
        playerId: s.playerId,
        count: 1,
        title: `${VESSEL.get(s.definitionId ?? "")?.name ?? SHIP_RULES[s.kind].name} #${s.id}`,
        subtitle: "1 ship selected",
        meter: {
          label: "Hull health",
          value: s.health,
          max:
            VESSEL.get(s.definitionId ?? "")?.health ??
            SHIP_RULES[s.kind].health,
        },
        status: s.refit
          ? `Refitting · ${Math.ceil(s.refit.remainingTicks / 20)} sec`
          : s.fighting
            ? "In combat"
            : s.boarding
              ? "Meeting squads"
              : s.destination !== null
                ? "Sailing"
                : "Holding",
        stats: [
          stat(
            "Squads aboard",
            String(state.squads.filter((u) => u.embarkedOn === s.id).length),
          ),
          stat("Queued waypoints", String(s.waypoints.length)),
          ...(s.definitionId
            ? [
                stat(
                  "Promotion",
                  `Level ${promotionLevel(s.xp ?? 0)} · ${s.xp ?? 0} XP`,
                ),
              ]
            : []),
          ...(s.definitionId
            ? vesselCard(
                s.definitionId,
                state.expansion!.progression[s.playerId].completed,
                s.xp,
              )!.stats
            : shipCards[s.kind].stats
          ).filter(
            (v) => v.label !== "Recruitment" && v.label !== "Hull health",
          ),
        ],
      }));
    const selectedBuildings = state.buildings.filter((b) =>
      selection.selectedBuildings?.has(b.id),
    );
    const representatives = selectedBuildings.filter(
      (b, index) =>
        selectedBuildings.findIndex(
          (other) => other.tile === b.tile && other.type === b.type,
        ) === index,
    );
    const buildings: SelectedEntity[] = (
      representatives.length
        ? representatives
        : this.game.building
          ? [this.game.building]
          : []
    ).map((b) => {
      const stack = b
        ? (representatives.length ? selectedBuildings : state.buildings).filter(
            (other) => other.tile === b.tile && other.type === b.type,
          )
        : [];
      const completed = stack.filter(
        (other) => other.remainingTicks === 0,
      ).length;
      const remaining = stack.reduce(
        (sum, other) => sum + other.remainingTicks,
        0,
      );
      return {
        ...buildingCards[b.type],
        ref: `building:${b.id}`,
        kind: b.type,
        definitionId: b.age
          ? `building-${b.age.toLowerCase()}-${b.type}`
          : undefined,
        category: "building",
        playerId: b.playerId,
        count: stack.length,
        title:
          stack.length > 1
            ? `${BUILDING_RULES[b.type].name} ×${stack.length}`
            : `${BUILDING_RULES[b.type].name} #${b.id}`,
        subtitle: `${b.playerId === this.playerId ? "Friendly" : "Enemy"} building${stack.length > 1 ? " stack" : ""}`,
        stats:
          stack.length > 1
            ? [
                stat("Buildings", String(stack.length)),
                stat("Ready", String(completed)),
                stat("Under construction", String(stack.length - completed)),
                ...(BUILDING_RULES[b.type].reserveIncome
                  ? [
                      stat(
                        "Combined reserve income",
                        `+${fmt(completed * BUILDING_RULES[b.type].reserveIncome)} / sec`,
                      ),
                    ]
                  : []),
                ...(BUILDING_RULES[b.type].goldIncome
                  ? [
                      stat(
                        "Combined gold income",
                        `+${fmt(completed * BUILDING_RULES[b.type].goldIncome)} / sec`,
                      ),
                    ]
                  : []),
                ...buildingCards[b.type].stats.filter(
                  (s) => !["Reserve income", "Gold income"].includes(s.label),
                ),
              ]
            : buildingCards[b.type].stats,
        status: remaining
          ? `${Math.ceil(remaining / TICKS_PER_SECOND)} sec until ${stack.length > 1 ? "all copies are ready" : "ready"}`
          : "Ready",
        ...(state.expansion
          ? {
              stats: [
                stat("Age", AGE_NAMES[AGES.indexOf(b.age ?? "StoneAge")]),
                stat("Buildings", `${completed}/${stack.length} ready`),
                ...this.buildingDetails(b),
                ...(b.type === "city"
                  ? [
                      stat(
                        "Reserve income",
                        `+${stack.filter((b) => !b.remainingTicks).reduce((sum, b) => sum + cityReserveIncome(b.age ?? "StoneAge"), 0)} / sec`,
                      ),
                    ]
                  : b.type === "factory"
                    ? [
                        stat(
                          "Economy",
                          "Commercial goods · gold paid on delivery",
                        ),
                      ]
                    : b.type === "port"
                      ? [stat("Role", "Fleet construction and trade endpoint")]
                      : []),
              ],
            }
          : {}),
        ...(b.health !== undefined && !remaining
          ? {
              meter: {
                label: "Building health",
                value: stack.reduce((sum, b) => sum + (b.health ?? 0), 0),
                max: stack.reduce((sum, b) => sum + (b.maxHealth ?? 0), 0),
              },
            }
          : {}),
        ...(remaining
          ? {
              meter: {
                label: "Construction",
                value: BUILDING_RULES[b.type].ticks - remaining,
                max: BUILDING_RULES[b.type].ticks,
              },
            }
          : {}),
      };
    });
    const aircraft: SelectedEntity[] = (state.expansion?.aircraft ?? [])
      .filter((a) => a.playerId === this.playerId && selection.selectedAircraft?.has(a.id))
      .map((a) => ({
        ref: `aircraft:${a.id}`,
        kind: a.definitionId,
        definitionId: a.definitionId,
        category: "aircraft",
        playerId: a.playerId,
        count: 1,
        title: `${a.definitionId === "fighter" ? "Fighter" : "Bomber"} #${a.id}`,
        subtitle: "1 aircraft selected",
        status: a.state,
        meter: { label: "Aircraft health", value: a.health, max: 1000 },
        stats: [
          stat("Fuel", `${Math.ceil(a.fuelTicks / 20)}s`),
          stat("Airfield", `#${a.airfieldId}`),
          stat(
            "Role",
            a.definitionId === "fighter"
              ? "Air-to-air · 200 damage / 2s · 8 cells"
              : "Ground bomb · 2,500 base + 2,000 structure bonus",
          ),
          stat("Orders", "Right click or Sortie · automatic return"),
        ],
        description:
          "Ready aircraft take sortie orders. Flights use finite fuel and return to their own airfield.",
      }));
    const deposit =
      selection.selectedDeposit === null ||
      selection.selectedDeposit === undefined
        ? undefined
        : this.depositCard(selection.selectedDeposit);
    const deposits = deposit ? [deposit] : [];
    return [...squads, ...ships, ...aircraft, ...buildings, ...deposits];
  }

  selectionCard(
    focusedRef: string | null,
    entities = this.entities,
  ): SelectionCard {
    if (!entities.length) return { mode: "empty", entities };
    const focused = entities.find((e) => e.ref === focusedRef);
    if (focused)
      return {
        mode: "detail",
        entities,
        card: {
          ...focused,
          subtitle:
            entities.length > 1
              ? `Inspecting 1 of ${entities.length} selected ${focused.category === "building" ? "buildings" : "units"}`
              : focused.subtitle,
        },
      };
    if (entities.length === 1)
      return { mode: "detail", entities, card: entities[0] };
    const first = entities[0];
    if (first.category === "building") return { mode: "mixed", entities };
    if (
      entities.every(
        (e) =>
          e.kind === first.kind &&
          e.category === first.category &&
          e.groupKey === first.groupKey,
      )
    ) {
      const value = entities.reduce((sum, e) => sum + (e.meter?.value ?? 0), 0);
      const max = entities.reduce((sum, e) => sum + (e.meter?.max ?? 0), 0);
      const statuses = new Set(entities.map((e) => e.status));
      return {
        mode: "group",
        entities,
        card: {
          ...first,
          ref: "group",
          count: entities.length,
          title: first.title.replace(/ #\d+$/, ""),
          subtitle: `${entities.length} ${first.category === "ship" ? "ships" : "squads"} selected`,
          meter: { label: first.meter!.label, value, max },
          status: statuses.size === 1 ? first.status : "Multiple orders",
          description: `Stats are per ${first.category === "ship" ? "ship" : "squad"} at full strength. Damage decreases with ${first.category === "ship" ? "hull health" : "troop strength"}.`,
          promotion: first.promotion
            ? {
                level: first.promotion.level,
                xp: entities.reduce(
                  (sum, e) => sum + (e.promotion?.xp ?? 0),
                  0,
                ),
                next:
                  first.promotion.next === null
                    ? null
                    : first.promotion.next * entities.length,
              }
            : undefined,
          stats: first.stats.filter(
            (s) =>
              ![
                "Queued orders",
                "Queued waypoints",
                "Squads aboard",
                ...(first.promotion ? ["Promotion"] : []),
              ].includes(s.label),
          ),
        },
      };
    }
    return { mode: "mixed", entities };
  }
  private buildingDetails(b: import("../Protocol").Building): HudStat[] {
    const empire = new EmpireViewModel(this.game.state, this.game.selection),
      result: HudStat[] = [];
    const producer = empire.producers.find((p) => p.building.id === b.id);
    if (producer?.recipes.length) {
      result.push(stat("Production", empire.productionStatus(b.id)));
      const recipe = producer.job
        ? PRODUCTION_RECIPES.find((r) => r.id === producer.job!.recipeId)
        : producer.selected;
      if (recipe) {
        const choice = empire.productionChoice(b.id, recipe.id);
        result.push(
          stat(
            "Inputs",
            choice.inputs
              .map(
                (i) => `${empire.itemName(i.id)} ${i.available}/${i.required}`,
              )
              .join(", ") || "None",
          ),
          stat(
            "Outputs",
            choice.outputs
              .map((i) => `${i.amount} ${empire.itemName(i.id)}`)
              .join(", "),
          ),
          stat(
            "Cycle",
            `${(producer.job?.totalTicks ?? choice.cycleTicks) / 20}s · repeats while supplied`,
          ),
        );
      }
    }
    if (b.type === "stables")
      result.push(
        stat(
          "Horse breeding",
          `+${breedingPerSecond(empire.expansion.progression[b.playerId].completed)} / sec when complete`,
        ),
      );
    if (b.type === "mine" || b.type === "oil-well" || b.type === "oil-rig") {
      const deposit = empire.expansion.deposits.find((d) => d.tile === b.tile);
      result.push(
        stat(
          "Deposit",
          deposit
            ? empire.resources.depositVisible(deposit.resource)
              ? empire.itemName(deposit.resource)
              : "Unknown until a later age"
            : "None",
        ),
      );
    }
    if (b.type === "gun-nest")
      result.push(
        stat("Targets", "Hostile ground troops"),
        stat("Ranged Attack", String(GUN_NEST_ATTACK.damage)),
        stat("Range", `${GUN_NEST_ATTACK.range / FIXED} cells`),
        stat("Reload", `${GUN_NEST_ATTACK.reloadTicks / 20}s`),
        stat("Infantry bonus", String(GUN_NEST_ATTACK.bonuses.infantry)),
      );
    if (b.type === "trench")
      result.push(
        stat(
          "Cover",
          `${TRENCH_COVER.reduction / 100}% ranged/melee protection`,
        ),
        stat(
          "Occupancy",
          `${TRENCH_COVER.slots} owned infantry · ${TRENCH_COVER.radius / FIXED} cell`,
        ),
        stat("Crossing", "Passable · no wall blocking"),
      );
    if (b.type === "missile-silo" || b.type === "mirv-launcher")
      result.push(
        stat(
          "Payload",
          b.type === "missile-silo"
            ? "ICBM or hydrogen · one manufactured payload per launch"
            : "MIRV · one manufactured payload per launch",
        ),
        stat(
          "Launcher",
          b.remainingTicks
            ? "Under construction"
            : (b.launchReadyTick ?? 0) > empire.state.tick
              ? `Reloading ${Math.ceil(((b.launchReadyTick ?? 0) - empire.state.tick) / 20)}s`
              : "Ready · payload and gold required",
        ),
      );
    return result;
  }
}
