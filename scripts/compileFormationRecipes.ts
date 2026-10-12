import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import recruitment from "../src/skirmish/content/russian-recruitment.json";
import { UNITS } from "../src/skirmish/content/Units";
import { AGES } from "../src/skirmish/domain/Definitions";
const positive = z.number().int().positive();
const recipe = z
  .object({
    model: z.enum(["soldiers", "hull"]),
    capacity: positive.max(144),
    enlargedCapacity: positive.max(144),
    soldierHp: positive.max(100000),
    reserveCost: positive,
    technologyId: z.string().optional(),
  })
  .strict();
const technology = z
  .object({
    id: z.string(),
    age: z.enum(AGES),
    name: z.string(),
    tree: z.literal("warfare"),
    slot: positive,
    prerequisites: z.array(z.string()).min(1),
    gold: positive,
    ticks: positive,
    capabilities: z.array(z.string()),
    description: z.string(),
    optional: z.literal(true),
  })
  .strict();
const schema = z
  .object({
    schemaVersion: z.literal(1),
    rulesVersion: z.literal(11),
    recipes: z.record(z.string(), recipe),
    technologies: z.array(technology).length(8),
  })
  .strict();
const data = schema.parse(
  JSON.parse(readFileSync("skirmish/plans/formation-recipes.json", "utf8")),
);
const ids = new Set(UNITS.map((u) => u.id)),
  techIds = new Set(data.technologies.map((t) => t.id)),
  base = new Set(recruitment.technologies.map((t) => t.id));
if (Object.keys(data.recipes).length !== ids.size || techIds.size !== 8)
  throw new Error("Formation catalog coverage mismatch");
for (const [id, r] of Object.entries(data.recipes))
  if (
    !ids.has(id) ||
    r.enlargedCapacity < r.capacity ||
    Boolean(r.technologyId) !== r.enlargedCapacity > r.capacity ||
    (r.technologyId && !techIds.has(r.technologyId))
  )
    throw new Error(`Invalid formation recipe ${id}`);
for (const t of data.technologies)
  if (base.has(t.id) || !t.prerequisites.every((id) => base.has(id)))
    throw new Error(`Invalid optional capacity technology ${t.id}`);
writeFileSync(
  "src/skirmish/content/formation-recipes.json",
  JSON.stringify(data, null, 2) + "\n",
);
console.log(
  `Compiled ${ids.size} formation recipes and ${techIds.size} optional capacity technologies`,
);
