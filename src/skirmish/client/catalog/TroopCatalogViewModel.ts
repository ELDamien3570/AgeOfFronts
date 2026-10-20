import { supplyItemName } from "../../content/Equipment";
import { recruitmentVariant } from "../../content/FormationRecipes";
import { TECHNOLOGIES, TECHNOLOGY } from "../../content/Technology";
import { UNITS } from "../../content/Units";
import { scaledAttack, XP_THRESHOLDS } from "../../domain/Combat";
import {
  AGE_NAMES,
  AGES,
  type Age,
  type AttackProfile,
} from "../../domain/Definitions";
import { recipeCapacity, scaledRecipeCost } from "../../domain/Manpower";
import { landRecruitmentTicks } from "../../domain/Recruitment";
import { unitEffects } from "../../domain/ResearchEffects";
import { FIXED, TICKS_PER_SECOND } from "../../Protocol";
import { BUILDING_RULES } from "../../Rules";

const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});
const fmt = (n: number) => numberFormat.format(n);
const seconds = (ticks: number) => `${fmt(ticks / TICKS_PER_SECOND)}s`;

export class TroopCatalogViewModel {
  search = "";
  age: Age | "" = "";
  role = "";
  /** Applies the unit's own-age research, i.e. its Larger formations recipe. */
  upgraded = false;
  level = 1;
  readonly compared = new Set<string>();
  get roles() {
    return [...new Set(UNITS.map((u) => u.role))];
  }
  get cards() {
    return UNITS.filter(
      (u) =>
        (!this.age || u.age === this.age) &&
        (!this.role || u.role === this.role) &&
        (!this.search ||
          `${u.name} ${u.role} ${u.tags.join(" ")}`
            .toLowerCase()
            .includes(this.search.toLowerCase())),
    ).map((u) => this.card(u.id));
  }
  get comparison() {
    return [...this.compared].map((id) => this.card(id));
  }
  compare(id: string): void {
    if (this.compared.has(id)) this.compared.delete(id);
    else if (this.compared.size < 3 && UNITS.some((u) => u.id === id))
      this.compared.add(id);
  }
  /** The first nine stats are the card headline; the rest sit under details. */
  card(id: string) {
    const base = UNITS.find((u) => u.id === id)!;
    const research = this.upgraded
      ? TECHNOLOGIES.filter(
          (t) => AGES.indexOf(t.age) <= AGES.indexOf(base.age),
        ).map((t) => t.id)
      : [];
    const unit = unitEffects(base, research);
    const recipe = unit.formationRecipe!;
    const soldiers = recipe.model === "soldiers";
    const variant = recruitmentVariant(unit.id, research);
    const capacity = recipeCapacity(unit, variant);
    const cost = scaledRecipeCost(unit, variant);
    const xp = XP_THRESHOLDS[this.level - 1] ?? 0;
    // Full strength: every soldier (or the single hull) contributes.
    const resolve = (profile: AttackProfile | undefined) =>
      profile && scaledAttack(profile, capacity, capacity, xp);
    const attack = resolve(unit.attack)!;
    const melee = resolve(unit.meleeAttack);
    const ranged = resolve(unit.rangedAttack);
    const armour = (n: number) =>
      unit.armourKind === "points" ? `${fmt(n)} points` : `${n / 100}%`;
    const largerTechnology = recipe.technologyId
      ? (TECHNOLOGY.get(recipe.technologyId)?.name ?? recipe.technologyId)
      : undefined;
    const headline: [string, string][] = [
      ["Squad size", soldiers ? `${capacity} soldiers` : "1 vehicle"],
      [
        "Health",
        soldiers
          ? `${fmt(recipe.soldierHp)} per soldier · ${fmt(recipe.soldierHp * capacity)} squad`
          : `${fmt(recipe.soldierHp)} hull`,
      ],
      ["Gold", fmt(cost.gold ?? 0)],
      [
        "Reserves",
        soldiers
          ? `${fmt(cost.reserves ?? 0)} (1 per soldier)`
          : `${fmt(cost.reserves ?? 0)} crew`,
      ],
      ["Training time", seconds(landRecruitmentTicks(unit, variant))],
      ...((soldiers
        ? [
            ["Melee damage / soldier", melee ? fmt(melee.damage) : "—"],
            ["Ranged damage / soldier", ranged ? fmt(ranged.damage) : "—"],
          ]
        : [
            ["Damage / attack", `${fmt(attack.damage)} ${attack.channel}`],
            ["Reload", seconds(attack.reloadTicks)],
          ]) as [string, string][]),
      ["Range", `${fmt(attack.range / FIXED)} cells`],
      ["Speed", `${unit.speedPercent}%`],
    ];
    const weapons: [string, string][] = soldiers
      ? [
          ["Melee attacks per minute", melee?.rpm ? String(melee.rpm) : "—"],
          ["Ranged shots per minute", ranged?.rpm ? String(ranged.rpm) : "—"],
          ["Shots per reload", ranged ? String(ranged.shotsPerReload) : "—"],
          [
            "Reload time",
            ranged ? `${fmt((ranged.reloadMs ?? 0) / 1000)}s` : "—",
          ],
          ...(ranged?.accuracy
            ? ([
                [
                  "Accuracy (contact / maximum range)",
                  `${ranged.accuracy.near}% / ${ranged.accuracy.far}%`,
                ],
              ] as [string, string][])
            : []),
          ["Attack interval", seconds(attack.reloadTicks)],
          [
            "Moving attack interval",
            seconds((attack.reloadTicks * attack.movingReloadPercent) / 100),
          ],
          [
            "Formation tactics",
            "Flank/rear raise melee damage; shield wall protects its front; square resists cavalry; loose reduces ranged hits",
          ],
        ]
      : [
          [
            "Moving reload",
            seconds((attack.reloadTicks * attack.movingReloadPercent) / 100),
          ],
        ];
    return {
      id,
      name: unit.name,
      age: AGE_NAMES[AGES.indexOf(unit.age)],
      role: unit.role,
      selected: this.compared.has(id),
      stats: [
        ...headline,
        [
          "Larger formation",
          !soldiers || recipe.enlargedCapacity <= recipe.capacity
            ? "Not available"
            : variant === "enlarged"
              ? `Applied · base recipe ${recipe.capacity} soldiers`
              : `${recipe.enlargedCapacity} soldiers with ${largerTechnology}`,
        ],
        [
          "Supplies",
          Object.entries(cost.items ?? {})
            .map(([item, n]) => `${n} ${supplyItemName(item)}`)
            .join(" · ") || "None",
        ],
        ...weapons,
        ["Melee armour", armour(unit.meleeArmour)],
        ["Ranged armour", armour(unit.rangedArmour)],
        [
          "Research",
          TECHNOLOGY.get(unit.technologyId)?.name ?? unit.technologyId,
        ],
        [
          "Building",
          `${BUILDING_RULES[unit.building].name} · ${AGE_NAMES[AGES.indexOf(unit.age)]} or later`,
        ],
        ["Target classes", attack.targets.join(", ")],
        ["Unit classes", unit.tags.join(", ")],
        [
          "Bonuses",
          Object.entries(attack.bonuses)
            .map(([tag, n]) => `+${fmt(n)} vs ${tag}`)
            .join(" · ") || "None",
        ],
        [
          "Bonus resistance",
          Object.entries(unit.bonusResistance)
            .map(([tag, n]) => `${fmt(n)} vs ${tag}`)
            .join(" · ") || "None",
        ],
        ["Armour penetration", `${fmt(attack.penetration / 100)}%`],
        [
          "Projectile size",
          `${fmt((attack.projectile?.diameter ?? 0) / FIXED)} cells`,
        ],
        [
          "Projectile speed",
          attack.projectile
            ? `${fmt((attack.projectile.speed * TICKS_PER_SECOND) / FIXED)} cells/sec`
            : "Not applicable",
        ],
        [
          "Blast radius",
          `${fmt((attack.projectile?.blastRadius ?? 0) / FIXED)} cells`,
        ],
        [
          "Capture",
          unit.canCapture
            ? unit.undefendedCaptureTicks
              ? `${seconds(unit.undefendedCaptureTicks)} undefended`
              : "Local occupation"
            : "Cannot capture",
        ],
        ...((unit.charge
          ? [
              [
                "Charge",
                `${unit.meleeAttack ? `${unit.chargeMultiplier ?? 1}× melee${unit.charge.bonusDurationTicks !== undefined ? ` for ${seconds(unit.charge.bonusDurationTicks)} after contact` : " at impact"}` : `${fmt(unit.charge.damage)} damage`} · ${seconds(unit.charge.cooldownTicks)} cooldown`,
              ],
              ["Charge speed", `${unit.charge.speedPercent}%`],
              ["Charge radius", `${fmt(unit.charge.radius / FIXED)} cells`],
              ["Charge run-up", seconds(unit.charge.runupTicks)],
              [
                "Charge travel",
                `${fmt(unit.charge.maximumDistance / FIXED)} cells maximum`,
              ],
              [
                "Charge armour penetration",
                `${fmt(unit.charge.penetration / 100)}%`,
              ],
            ]
          : []) as [string, string][]),
      ] as [string, string][],
    };
  }
}
