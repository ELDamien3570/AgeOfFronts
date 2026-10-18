import { AI_DOCTRINES } from "../content/AiDoctrines";
import { personalityOf } from "../content/AiPersonalities";
import { TICKS_PER_SECOND, type Player, type Squad } from "../Protocol";
import type { Cohort } from "./AiCombatPower";
import { combatAdvantage, combatCohorts } from "./AiCombatPower";
import { AGES } from "./Definitions";
import type { Expansion } from "./Expansion";
import { readyFraction, strengthFraction } from "./Manpower";
import { cohortDps } from "./TacticalEstimate";
import { sustainedInterval } from "./WeaponTiming";

/** Shared with the existing army scheduler: at most four independent missions. */
export function armyMissionCapacity(armySize: number, squads: number): number {
  return Math.min(armySize, 1 + Math.floor(squads / 40), 4);
}

export function campaignDeploymentCapacity(
  expansion: Expansion,
  player: Player,
  squads = expansion.world.squadFacts().aliveByOwner(player.id).length,
) {
  const armySize = expansion.armies.capacity(player.id);
  const other = expansion.operations
    .theatres(player.id)
    .filter((t) => t.purpose !== "offense");
  const committed =
    expansion.economy.military.armyPlanner.nonOffensiveCommitment(player.id);
  const reservedSlots =
    Math.max(other.length, committed.defenseSlots) + committed.coastSlots;
  const reservedSquads =
    Math.max(
      other.reduce((n, t) => n + t.desiredSquads, 0),
      committed.defenseSquads,
    ) + committed.coastSquads;
  return {
    maxSquads:
      Math.max(0, armyMissionCapacity(armySize, squads) - reservedSlots) *
      armySize,
    reservedSquads,
    committedSquads: committed.defenseSquads + committed.coastSquads,
  };
}

/** Selection order is shared with the army assembler. Quality only breaks
 * ties within a doctrinal role; it never changes the combat damage rules. */
export function campaignSquadOrder(
  expansion: Expansion,
  player: Player,
  a: Squad,
  b: Squad,
): number {
  const roles = AI_DOCTRINES[personalityOf(player).id].preferredRoles;
  const ua = expansion.unit(a),
    ub = expansion.unit(b);
  const ar = roles.indexOf(ua.role),
    br = roles.indexOf(ub.role);
  return (
    (ar < 0 ? 99 : ar) - (br < 0 ? 99 : br) ||
    AGES.indexOf(ub.age) - AGES.indexOf(ua.age) ||
    a.id - b.id
  );
}

/** An offensive must leave its home reserve behind. Recovering, refitting,
 * transported and independently leased squads cannot finance a declaration. */
export function campaignForce(expansion: Expansion, player: Player): Squad[] {
  const doctrine = AI_DOCTRINES[personalityOf(player).id];
  const available = expansion.world
    .squadFacts()
    .aliveByOwner(player.id)
    .filter((s) => {
      const lease = expansion.economy.assets.leases.get(`squad:${s.id}`);
      return (
        readyFraction(s) >= 0.5 &&
        strengthFraction(s) >= doctrine.minimumHealth / 1000 &&
        s.embarkedOn === null &&
        !s.fighting &&
        s.order.type === "hold" &&
        !expansion.armies.armyOf(s.id) &&
        !s.refit &&
        !s.manpower?.enlargement &&
        !s.charge &&
        !s.structureTarget &&
        (!lease ||
          lease.priority === "operation" ||
          lease.priority === "patrol")
      );
    })
    .sort((a, b) => campaignSquadOrder(expansion, player, a, b));
  const reserve = expansion.operations.invasionReserve(
    player.id,
    available.length,
  );
  const capacity = campaignDeploymentCapacity(expansion, player);
  return available.slice(
    0,
    Math.min(
      capacity.maxSquads,
      Math.max(
        0,
        available.length -
          reserve -
          Math.max(0, capacity.reservedSquads - capacity.committedSquads),
      ),
    ),
  );
}

export type CampaignAssessmentCache = Map<
  string,
  { cohorts: Cohort[]; speed: number }
>;
export function campaignAdvantage(
  expansion: Expansion,
  player: Player,
  rival: Player,
  committed = false,
  cache: CampaignAssessmentCache = new Map(),
  projectedFieldSquads?: number,
): number {
  const view = (owner: Player, field: boolean) => {
    const key = `${owner.id}:${field}`;
    let row = cache.get(key);
    if (!row) {
      const squads = field
        ? campaignForce(expansion, owner)
        : expansion.world.squadFacts().aliveByOwner(owner.id);
      row = {
        cohorts: combatCohorts(expansion, squads),
        speed: Math.max(
          1,
          ...squads.map((s) => {
            const unit = expansion.unit(s),
              ordinary = expansion.world.ordinarySpeed(s);
            return Math.max(
              ordinary,
              (ordinary * (unit.charge?.speedPercent ?? unit.speedPercent)) /
                Math.max(1, unit.speedPercent),
            );
          }),
        ),
      };
      cache.set(key, row);
    }
    return row;
  };
  const own = view(player, !committed),
    enemy = view(rival, false),
    actual = own.cohorts.reduce((sum, cohort) => sum + cohort.count, 0),
    scale =
      projectedFieldSquads === undefined
        ? 1
        : projectedFieldSquads / Math.max(1, actual),
    a =
      scale === 1
        ? own.cohorts
        : own.cohorts.map((c) => ({
            ...c,
            count: c.count * scale,
            width: c.width * scale,
            health: c.health * scale,
            strength: c.strength * scale,
            contributors: c.contributors * scale,
            troops: (c.troops ?? 0) * scale,
            meleeContributors: (c.meleeContributors ?? 0) * scale,
          })),
    b = enemy.cohorts;
  // Sustained mutual DPS assumes both forces are already in range. It badly
  // undervalues rifles against melee. Price a conservative approach before
  // that same resolver; no era multiplier or new damage/armour authority.
  // Ongoing wars get no hypothetical fresh approach volleys. This deliberately
  // underprices distant reserve arrivals rather than granting shots at contact.
  const afterA = committed ? a : approachSurvivors(a, b, own.speed);
  const afterB = committed ? b : approachSurvivors(b, a, enemy.speed);
  if (!afterA.length || !afterB.length) return combatAdvantage(afterA, afterB);
  const dps = (rows: readonly Cohort[], targets: readonly Cohort[]) => {
    const targetHealth = targets.reduce((n, c) => n + c.health, 0);
    const ownFront = rows.reduce((n, c) => n + c.width, 0),
      enemyFront = targets.reduce((n, c) => n + c.width, 0);
    let total = 0;
    for (const c of rows) {
      const hybrid =
        c.unit.attack.channel === "ranged" &&
        c.unit.meleeAttack?.perSoldier &&
        c.unit.rangedAttack?.perSoldier;
      const meleeProfile = hybrid
        ? c.unit.meleeAttack!
        : c.unit.attack.channel === "melee"
          ? c.unit.attack
          : undefined;
      const ranks = c.shape === "modern-loose" ? 1 : (meleeProfile?.ranks ?? 2);
      // One opposing frontage budget across the whole force. Thirty rifle
      // squads cannot all reserve a full contact edge against four enemies.
      const contactBudget = meleeProfile
        ? Math.min(
            hybrid ? (c.meleeContributors ?? 0) : c.contributors,
            Math.min(c.width, (enemyFront * c.width) / Math.max(1, ownFront)) *
              ranks,
          )
        : 0;
      const ranged = {
        ...c,
        contributors: hybrid
          ? Math.min(
              c.contributors,
              Math.max(0, (c.troops ?? c.contributors) - contactBudget),
            )
          : c.contributors,
      };
      for (const target of targets) {
        if (c.unit.attack.channel === "ranged")
          total +=
            (cohortDps([ranged], [target]) * target.health) /
            Math.max(1, targetHealth);
        if (meleeProfile) {
          const contact = {
            ...c,
            unit: { ...c.unit, attack: meleeProfile },
            contributors:
              (contactBudget * target.width) / Math.max(1, enemyFront),
          };
          total += cohortDps([contact], [target]);
        }
      }
    }
    return total;
  };
  const healthA = afterA.reduce((n, c) => n + c.health, 0),
    healthB = afterB.reduce((n, c) => n + c.health, 0);
  const ratio =
    (dps(afterA, afterB) * healthA) /
    Math.max(1e-9, dps(afterB, afterA) * healthB);
  return Math.round(Math.max(0, Math.min(8, ratio)) * 1024) / 1024;
}

/** At most composition-pairs work. Half the approach is discounted for cover,
 * contact geometry and targeting; at least 35% survives the opening estimate.
 * Sustained fire, mass and counters must still justify the actual invasion. */
function approachSurvivors(
  victims: readonly Cohort[],
  shooters: readonly Cohort[],
  victimSpeed: number,
): Cohort[] {
  const health = victims.reduce((n, c) => n + c.health, 0);
  return victims.map((victim) => {
    let damage = 0;
    for (const shooter of shooters) {
      const attack = shooter.unit.attack;
      if (
        attack.channel !== "ranged" ||
        attack.range <= victim.unit.attack.range
      )
        continue;
      const ticks = Math.min(
        8 * TICKS_PER_SECOND,
        (attack.range - victim.unit.attack.range) / victimSpeed,
      );
      const preparation = attack.preparation?.ticks ?? 0;
      const interval = sustainedInterval(attack);
      const firingTicks = Math.max(0, ticks - preparation);
      // Require a complete conservative firing opportunity; no partial volley
      // grants a long-range siege weapon guaranteed approach damage.
      const volleys =
        ticks >= preparation
          ? 1 + Math.floor(firingTicks / Math.max(1, interval))
          : 0;
      damage +=
        ((((cohortDps([shooter], [victim]) * volleys * interval) /
          TICKS_PER_SECOND) *
          victim.health) /
          Math.max(1, health)) *
        0.5;
    }
    const remaining = Math.max(0.35, 1 - damage / Math.max(1, victim.health));
    return {
      ...victim,
      health: victim.health * remaining,
      strength: victim.strength * remaining,
      contributors: victim.contributors * remaining,
      width: victim.width * remaining,
      troops: (victim.troops ?? 0) * remaining,
      meleeContributors: (victim.meleeContributors ?? 0) * remaining,
    };
  });
}

/** Computed only on a scheduled strategic think, not for all factions per frame.
 * Definition and refit state wake unchanged headcounts after modernization. */
export function campaignQualityKey(
  expansion: Expansion,
  player: Player,
): string {
  return expansion.world
    .squadFacts()
    .aliveByOwner(player.id)
    .map(
      (s) =>
        `${s.id}:${s.definitionId}:${s.refit?.targetId ?? ""}:${s.refit ? 1 : 0}:${Math.floor(readyFraction(s) * 4)}`,
    )
    .join(",");
}
