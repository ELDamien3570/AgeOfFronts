import { ADVANCES, TECHNOLOGIES } from "../content/Technology";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import type { AiPersonality } from "./AiPersonality";
import { AGES } from "./Definitions";

export function militaryPosture(
  snapshot: AiEconomicSnapshot,
  personality: AiPersonality,
  speed: 1 | 2 | 3 = 1,
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
            t.age === snapshot.age &&
            t.tree === tree &&
            !snapshot.research.includes(t.id),
        ).map((t) => t.gold),
      ),
    0,
  );
  const protectedGold = Math.ceil(
    ((ADVANCES[age]?.gold ?? 0) + research) / speed,
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
  const target = wealthy
    ? Math.floor(
        snapshot.cap *
          (aggressive ? 0.95 : personality.id === "warden" ? 0.65 : 0.75),
      )
    : 0;
  return { wealthy, target, protectedGold };
}
