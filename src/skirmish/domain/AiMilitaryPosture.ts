import { recruitmentVariant } from "../content/FormationRecipes";
import { ADVANCES, TECHNOLOGIES } from "../content/Technology";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import type { AiPersonality } from "./AiPersonality";
import { preferredRecruitmentUnit } from "./AiRecruitmentPolicy";
import { AGES } from "./Definitions";
import { scaledRecipeCost } from "./Manpower";

export function militaryPosture(
  snapshot: AiEconomicSnapshot,
  personality: AiPersonality,
  speed: 1 | 2 | 3 = snapshot.technologySpeed ?? 1,
) {
  const age = AGES.indexOf(snapshot.age);
  // Protect an advancement and one expensive outstanding node in each tree.
  // Paid jobs have already left liquid gold; never reserve them a second time.
  const research = ["warfare", "economic", "naval"].reduce(
    (sum, tree) =>
      sum +
      Math.max(
        0,
        ...TECHNOLOGIES.filter(
          (t) =>
            !t.optional &&
            t.age === snapshot.age &&
            t.tree === tree &&
            !snapshot.research.includes(t.id) &&
            !snapshot.paidResearch?.includes(t.id),
        ).map((t) => t.gold),
      ),
    0,
  );
  const protectedGold = Math.ceil(
    ((snapshot.advancing ? 0 : (ADVANCES[age]?.gold ?? 0)) + research) / speed,
  );
  const wealthy =
    age >= AGES.indexOf("EarlyModern") &&
    (snapshot.liquid.gold ?? 0) - protectedGold >=
      Math.max(250000, snapshot.cap * 5000);
  const aggressive = [
    "conqueror",
    "rider",
    "skirmisher",
    "engineer",
    "admiral",
  ].includes(personality.id);
  const developmentGold = Math.max(
    0,
    (snapshot.liquid.gold ?? 0) - protectedGold,
  );
  // This is a planning share, never reserved or granted money. Execution must
  // still fund recruitment and every upstream building through the live ledger.
  const militaryBudget = Math.floor(developmentGold / 4);
  const roles = (["frontline", "ranged", "mounted"] as const).flatMap(
    (role, i) => {
      const unit = preferredRecruitmentUnit(snapshot, role),
        weight = personality.recruitment[i];
      return unit && weight > 0 ? [{ unit, weight }] : [];
    },
  );
  const weights = roles.reduce((sum, row) => sum + row.weight, 0);
  const formationGold = weights
    ? Math.max(
        1,
        Math.ceil(
          roles.reduce(
            (sum, { unit, weight }) =>
              sum +
              (scaledRecipeCost(
                unit,
                recruitmentVariant(unit.id, snapshot.research),
              ).gold ?? 0) *
                weight,
            0,
          ) / weights,
        ),
      )
    : Infinity;
  const affordableAdditional = Math.floor(militaryBudget / formationGold);
  const current = Object.values(snapshot.force.core).reduce(
    (sum, n) => sum + n,
    0,
  );
  const ceiling = Math.floor(
    snapshot.cap *
      (aggressive ? 0.95 : personality.id === "warden" ? 0.65 : 0.75),
  );
  const target = Math.min(ceiling, current + affordableAdditional);
  return {
    wealthy,
    target,
    protectedGold,
    developmentGold,
    militaryBudget,
    affordableAdditional,
    mobilizing: target > current,
    formationGold,
  };
}
