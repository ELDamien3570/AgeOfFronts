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
import { CONSTRUCTION, LAND_RECRUITMENT, NAVAL_RECRUITMENT } from "./Controls";
import { SkirmishViewModel } from "./SkirmishViewModel";

export type HudKind = BuildingType | SquadType | ShipType;
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
  compact?: { stats: HudStat[]; description: string };
  status?: string;
  meter?: { label: string; value: number; max: number };
}
export interface SelectedEntity extends HudCard {
  ref: string;
  kind: HudKind;
  playerId: number;
  count: number;
  category: "squad" | "ship" | "building";
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
const buildingCards: Record<BuildingType, HudCard> = {
  city: createBuildingCard("city"),
  factory: createBuildingCard("factory"),
  port: createBuildingCard("port"),
  barracks: createBuildingCard("barracks"),
  archery: createBuildingCard("archery"),
  stables: createBuildingCard("stables"),
};

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
        ...(land ? squadCards[land.kind] : shipCards[naval!.kind]),
        status:
          choice.reason ||
          `Ready · ${BUILDING_RULES[choice.building!.type].name} #${choice.building!.id}`,
      };
    }
    if (build) {
      const rule = BUILDING_RULES[build.kind];
      return {
        ...buildingCards[build.kind],
        status:
          this.game.state.winner !== null || this.game.player.eliminated
            ? "Skirmish finished"
            : this.game.player.gold < rule.cost
              ? "Not enough gold"
              : "Choose a location on friendly land",
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
      ...squadCards[s.kind],
      ref: `squad:${s.id}`,
      kind: s.kind,
      category: "squad",
      playerId: s.playerId,
      count: 1,
      title: `${SQUAD_RULES[s.kind].name} #${s.id}`,
      subtitle: "1 squad selected",
      meter: { label: "Troop strength", value: s.troops, max: SQUAD_TROOPS },
      status: s.fighting
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
        ...squadCards[s.kind].stats.filter(
          (v) => v.label !== "Recruitment" && v.label !== "Full strength",
        ),
      ],
    }));
    const ships: SelectedEntity[] = state.ships
      .filter((s) => s.playerId === 1 && selection.selectedShips.has(s.id))
      .map((s) => ({
        ...shipCards[s.kind],
        ref: `ship:${s.id}`,
        kind: s.kind,
        category: "ship",
        playerId: s.playerId,
        count: 1,
        title: `${SHIP_RULES[s.kind].name} #${s.id}`,
        subtitle: "1 ship selected",
        meter: {
          label: "Hull health",
          value: s.health,
          max: SHIP_RULES[s.kind].health,
        },
        status: s.fighting
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
          ...shipCards[s.kind].stats.filter(
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
    return [...squads, ...ships, ...buildings];
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
        (e) => e.kind === first.kind && e.category === first.category,
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
          title:
            first.category === "ship"
              ? SHIP_RULES[first.kind as ShipType].name
              : SQUAD_RULES[first.kind as SquadType].name,
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
