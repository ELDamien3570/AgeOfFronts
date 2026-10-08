import { readFileSync, writeFileSync } from "node:fs";
import { applyRussianExplicitUnlocks } from "../src/skirmish/planning/RussianExplicitUnlocks";
import { readTechnologyPlan } from "../src/skirmish/planning/TechnologyPlanMigration";
import { buildTroopProposals } from "../src/skirmish/planning/TroopTreePlan";

// Review artifact for the first gameplay slice. This is not a second planner:
// preserve authored prices, names and links, including the complete dependency
// closure. Runtime registration follows the explicit capability migration.
const path = "skirmish/plans/technology-plan.json";
const original = readFileSync(path, "utf8");
const plan = readTechnologyPlan(JSON.parse(original));
const civ = plan.civilizations.find((c) => c.id === "russians-rework");
if (!civ) throw new Error("Missing Russian rework civilization");
applyRussianExplicitUnlocks(civ);
const ages = civ.ages.slice(0, 5).map((a) => a.id);
const units = buildTroopProposals(civ)
  .filter((p) => ages.includes(p.unit.age))
  .map((p) => {
    if (p.unit.prerequisites.length !== 1)
      throw new Error(`Expected one unlock for ${p.unit.id}`);
    return {
      id: p.unit.id,
      name: p.unit.name,
      age: p.unit.age,
      role: p.unit.role,
      technologyId: p.unit.prerequisites[0],
      gold: p.gold,
      trainingSeconds: p.trainingSeconds,
    };
  });
const included = new Set<string>();
const visit = (id: string) => {
  if (included.has(id)) return;
  const t = civ.technologies.find((t) => t.id === id);
  if (!t || !ages.includes(t.age))
    throw new Error(`Unsupported early roster prerequisite: ${id}`);
  if (t.gold === null || t.researchSeconds === null)
    throw new Error(`Unpriced prerequisite: ${id}`);
  included.add(id);
  t.prerequisites.forEach(visit);
};
units.forEach((u) => visit(u.technologyId));
const technologies = civ.technologies
  .filter((t) => included.has(t.id))
  .map((t) => ({
    id: t.id,
    name: t.name,
    age: t.age,
    tree: t.tree,
    kind: t.kind,
    prerequisites: t.prerequisites,
    gold: t.gold!,
    ticks: t.researchSeconds! * 20,
    description: t.description,
  }));
readTechnologyPlan(plan);
if (readFileSync(path, "utf8") !== original)
  throw new Error(
    "Planner changed during compilation; retry after reviewing the changes.",
  );
writeFileSync(path, JSON.stringify(plan, null, 2) + "\n");
writeFileSync(
  "src/skirmish/content/russian-early-roster.json",
  JSON.stringify({ schemaVersion: 1, units, technologies }, null, 2) + "\n",
);
console.log(
  `Compiled ${units.length} troops and ${technologies.length} required research nodes for review.`,
);
