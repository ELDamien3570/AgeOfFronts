import { TECHNOLOGIES, TECHNOLOGY } from "../../content/Technology";
import { UNITS } from "../../content/Units";
import { supplyItemName } from "../../content/Equipment";
import { scaledAttack, XP_THRESHOLDS } from "../../domain/Combat";
import { AGE_NAMES, AGES, type Age } from "../../domain/Definitions";
import { unitEffects } from "../../domain/ResearchEffects";
import { FIXED, SQUAD_TROOPS, TICKS_PER_SECOND } from "../../Protocol";
import { BUILDING_RULES } from "../../Rules";

export class TroopCatalogViewModel {
  search = "";
  age: Age | "" = "";
  role = "";
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
  card(id: string) {
    const base = UNITS.find((u) => u.id === id)!;
    const research = this.upgraded
      ? TECHNOLOGIES.filter(
          (t) => AGES.indexOf(t.age) <= AGES.indexOf(base.age),
        ).map((t) => t.id)
      : [];
    const unit = unitEffects(base, research);
    const attack = scaledAttack(
      unit.attack,
      SQUAD_TROOPS,
      SQUAD_TROOPS,
      XP_THRESHOLDS[this.level - 1] ?? 0,
    );
    const armour = (n: number) =>
      unit.armourKind === "points" ? `${n} points` : `${n / 100}%`;
    return {
      id,
      name: unit.name,
      age: AGE_NAMES[AGES.indexOf(unit.age)],
      role: unit.role,
      selected: this.compared.has(id),
      stats: [
        ["Gold", String(unit.cost.gold ?? 0)],
        ["Reserves", String(unit.cost.reserves ?? 0)],
        ["Damage / attack", `${attack.damage} ${attack.channel}`],
        ["Reload", `${attack.reloadTicks / TICKS_PER_SECOND}s`],
        [
          "Moving reload",
          `${(attack.reloadTicks * attack.movingReloadPercent) / (100 * TICKS_PER_SECOND)}s`,
        ],
        ["Range", `${attack.range / FIXED} cells`],
        ["Melee armour", armour(unit.meleeArmour)],
        ["Ranged armour", armour(unit.rangedArmour)],
        ["Speed", `${unit.speedPercent}%`],
        [
          "Research",
          TECHNOLOGY.get(unit.technologyId)?.name ?? unit.technologyId,
        ],
        [
          "Building",
          `${BUILDING_RULES[unit.building].name} · ${AGE_NAMES[AGES.indexOf(unit.age)]} or later`,
        ],
        [
          "Supplies",
          Object.entries(unit.cost.items ?? {})
            .map(([item, n]) => `${n} ${supplyItemName(item)}`)
            .join(" · ") || "None",
        ],
        ["Target classes", attack.targets.join(", ")],
        ["Unit classes", unit.tags.join(", ")],
        [
          "Bonuses",
          Object.entries(attack.bonuses)
            .map(([tag, n]) => `+${n} vs ${tag}`)
            .join(" · ") || "None",
        ],
        [
          "Bonus resistance",
          Object.entries(unit.bonusResistance)
            .map(([tag, n]) => `${n} vs ${tag}`)
            .join(" · ") || "None",
        ],
        ["Penetration", String(attack.penetration)],
        [
          "Projectile size",
          `${(attack.projectile?.diameter ?? 0) / FIXED} cells`,
        ],
        [
          "Projectile speed",
          attack.projectile
            ? `${(attack.projectile.speed * TICKS_PER_SECOND) / FIXED} cells/sec`
            : "Not applicable",
        ],
        [
          "Blast radius",
          `${(attack.projectile?.blastRadius ?? 0) / FIXED} cells`,
        ],
        [
          "Capture",
          unit.canCapture
            ? unit.undefendedCaptureTicks
              ? `${unit.undefendedCaptureTicks / TICKS_PER_SECOND}s undefended`
              : "Local occupation"
            : "Cannot capture",
        ],
        ...(unit.charge
          ? [
              [
                "Charge",
                `${unit.charge.damage} damage · ${unit.charge.cooldownTicks / TICKS_PER_SECOND}s cooldown`,
              ],
              ["Charge speed", `${unit.charge.speedPercent}%`],
              ["Charge radius", `${unit.charge.radius / FIXED} cells`],
              [
                "Charge run-up",
                `${unit.charge.runupTicks / TICKS_PER_SECOND}s`,
              ],
              [
                "Charge travel",
                `${unit.charge.maximumDistance / FIXED} cells maximum`,
              ],
              ["Charge penetration", String(unit.charge.penetration)],
            ]
          : []),
      ],
    };
  }
}
