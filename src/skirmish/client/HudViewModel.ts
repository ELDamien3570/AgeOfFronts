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
import { UNIT, VESSEL } from "../content/Units";
import { promotionLevel } from "../domain/Combat";
import { AGE_NAMES, AGES, type UnitDefinition } from "../domain/Definitions";
import { unitEffects, vesselEffects } from "../domain/ResearchEffects";
import { CONSTRUCTION, LAND_RECRUITMENT, NAVAL_RECRUITMENT } from "./Controls";
import { EmpireViewModel } from "./EmpireViewModel";
import { SkirmishViewModel } from "./SkirmishViewModel";

export type HudKind =
  | BuildingType
  | SquadType
  | ShipType
  | "fighter"
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
}
export interface SelectedEntity extends HudCard {
  ref: string;
  kind: HudKind;
  playerId: number;
  count: number;
  category: "squad" | "ship" | "building" | "aircraft";
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
  const a = unit.attack,
    level = promotionLevel(xp),
    bonus = [0, 0.03, 0.06, 0.1, 0.13, 0.16, 0.2][level - 1];
  const stats = [
    stat("Melee Armour", `${unit.meleeArmour / 100}%`),
    stat("Ranged Armour", `${unit.rangedArmour / 100}%`),
    stat(
      "Melee Attack",
      a.channel === "melee" ? fmt(Math.floor(a.damage * (1 + bonus))) : "—",
    ),
    stat(
      "Ranged Attack",
      a.channel === "ranged" ? fmt(Math.floor(a.damage * (1 + bonus))) : "—",
    ),
    stat("Range", `${fmt(a.range / FIXED)} cells`),
    stat(
      "Reload Time",
      `${a.reloadTicks / 20}s · ${(a.reloadTicks * a.movingReloadPercent) / 2000}s moving`,
    ),
    stat("Speed", `${unit.speedPercent}% · terrain applies`),
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
    groupKey: `${unit.id}:${level}`,
    stats,
    description: unit.placeholder
      ? "Temporary presentation · authoritative stats shown above."
      : "Damage is per attack at full strength. Armour protects the base channel; target bonuses have separate resistance.",
    compact: {
      stats: [
        stat("Cost", `${unit.cost.gold ?? 0} gold · 1,000 reserves`),
        stat(
          "Supplies",
          Object.entries(unit.cost.items ?? {})
            .map(([id, n]) => `${n} ${id.replace("equipment:", "")}`)
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
): HudCard | undefined {
  const base = VESSEL.get(id);
  if (!base || base.kind === "trade") return;
  const v = vesselEffects(base, research);
  return {
    title: v.name,
    subtitle: AGE_NAMES[AGES.indexOf(v.age)],
    kind: v.kind as ShipType,
    definitionId: id,
    groupKey: id,
    description: "Construction requires the matching researched port tier.",
    stats: [
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
      stat("Attack", String(v.attack?.damage ?? 0)),
      stat("Reload", `${(v.attack?.reloadTicks ?? 0) / 20}s`),
    ],
  };
}
// HUD projections only observe domain rules and snapshots. Focused inspection
// belongs to the view and never changes the selected army or its commands.
export class HudViewModel {
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
                  this.game.state.expansion!.progression[1].completed,
                ),
              )
            : vesselCard(
                choice.definitionId,
                this.game.state.expansion!.progression[1].completed,
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
    if (id === "replenish")
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
    if (id === "hold")
      return {
        title: "Hold selected units",
        subtitle: "X · stop and clear routes",
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

  get entities(): SelectedEntity[] {
    const { state, selection } = this.game;
    const squads: SelectedEntity[] = this.game.selectedSquads.map((s) => ({
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
      subtitle: "1 squad selected",
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
      stats: [
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
                `${"★".repeat(promotionLevel(s.xp ?? 0))} · ${s.xp ?? 0} XP`,
              ),
            ]
          : squadCards[s.kind].stats
        ).filter(
          (v) => v.label !== "Recruitment" && v.label !== "Full strength",
        ),
      ],
    }));
    const ships: SelectedEntity[] = state.ships
      .filter((s) => s.playerId === 1 && selection.selectedShips.has(s.id))
      .map((s) => ({
        ...(s.definitionId
          ? vesselCard(
              s.definitionId,
              state.expansion!.progression[s.playerId].completed,
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
                  `${"★".repeat(promotionLevel(s.xp ?? 0))} · ${s.xp ?? 0} XP`,
                ),
              ]
            : []),
          ...(s.definitionId
            ? vesselCard(
                s.definitionId,
                state.expansion!.progression[s.playerId].completed,
              )!.stats
            : shipCards[s.kind].stats
          ).filter(
            (v) => v.label !== "Recruitment" && v.label !== "Hull health",
          ),
        ],
      }));
    const b = this.game.building;
    const stack = b
      ? state.buildings.filter(
          (other) => other.tile === b.tile && other.type === b.type,
        )
      : [];
    const completed = stack.filter(
      (other) => other.remainingTicks === 0,
    ).length;
    const remaining = stack.reduce(
      (maximum, other) => Math.max(maximum, other.remainingTicks),
      0,
    );
    const buildings: SelectedEntity[] = b
      ? [
          {
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
            subtitle: `${b.playerId === 1 ? "Friendly" : "Enemy"} building${stack.length > 1 ? " stack" : ""}`,
            stats:
              stack.length > 1
                ? [
                    stat("Buildings", String(stack.length)),
                    stat("Ready", String(completed)),
                    stat(
                      "Under construction",
                      String(stack.length - completed),
                    ),
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
                      (s) =>
                        !["Reserve income", "Gold income"].includes(s.label),
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
                    ...(b.type === "city"
                      ? [
                          stat(
                            "Reserve income",
                            `+${stack.filter((b) => !b.remainingTicks).reduce((sum, b) => sum + 40 * (1 + AGES.indexOf(b.age ?? "StoneAge")), 0)} / sec`,
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
                          ? [
                              stat(
                                "Role",
                                "Fleet construction and trade endpoint",
                              ),
                            ]
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
          },
        ]
      : [];
    const aircraft: SelectedEntity[] = (state.expansion?.aircraft ?? [])
      .filter((a) => a.playerId === 1 && selection.selectedAircraft?.has(a.id))
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
    return [...squads, ...ships, ...aircraft, ...buildings];
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
              ? `Inspecting 1 of ${entities.length} selected units`
              : focused.subtitle,
        },
      };
    if (entities.length === 1)
      return { mode: "detail", entities, card: entities[0] };
    const first = entities[0];
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
          stats: first.stats.filter(
            (s) =>
              !["Queued orders", "Queued waypoints", "Squads aboard"].includes(
                s.label,
              ),
          ),
        },
      };
    }
    return { mode: "mixed", entities };
  }
}
