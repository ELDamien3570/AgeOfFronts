import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
const bounded = z.number().int().min(0).max(100000);
const rpm = z.number().int().min(1).max(1200);
const base = z.object({ damageHp: bounded.positive(), rpm }).strict();
const melee = base.extend({ ranks: z.number().int().min(1).max(8) }).strict();
const ranged = base
  .extend({
    shotsPerReload: z.number().int().min(1).max(1000),
    reloadMs: z.number().int().min(0).max(600000),
  })
  .strict();
const entry = z
  .object({
    melee,
    ranged: ranged.nullable(),
    defence: z.object({ meleeHp: bounded, rangedHp: bounded }).strict(),
    primaryBonus: z
      .object({
        target: z.enum([
          "infantry",
          "ranged",
          "mounted",
          "vehicle",
          "siege",
          "structure",
          "wall",
          "ship",
          "aircraft",
        ]),
        damageHp: bounded,
      })
      .strict(),
    chargeMultiplier: z.number().min(1).max(10),
  })
  .strict();
const data = z
  .object({
    schemaVersion: z.literal(1),
    rulesVersion: z.literal(7),
    weapons: z.record(z.string(), entry),
  })
  .strict()
  .parse(
    JSON.parse(readFileSync("skirmish/plans/soldier-weapons.json", "utf8")),
  );
const formations = JSON.parse(
  readFileSync("skirmish/plans/formation-recipes.json", "utf8"),
);
const ids = Object.entries(formations.recipes)
  .filter(([, r]: [string, any]) => r.model === "soldiers")
  .map(([id]) => id);
if (
  ids.length !== Object.keys(data.weapons).length ||
  ids.some((id) => !data.weapons[id])
)
  throw new Error("Soldier weapon catalogue coverage mismatch");
writeFileSync(
  "src/skirmish/content/soldier-weapons.json",
  JSON.stringify(data, null, 2) + "\n",
);
console.log(
  `Compiled ${ids.length} soldier weapon profiles; hull weapons retained separately`,
);
