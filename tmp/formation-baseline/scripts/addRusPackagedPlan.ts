import { readFileSync, writeFileSync } from "node:fs";
import { createRusPackagedRework } from "../src/skirmish/planning/RusPackagedRework";
import { validatePlan } from "../src/skirmish/planning/TechnologyPlan";
import { readTechnologyPlan } from "../src/skirmish/planning/TechnologyPlanMigration";
const path = "skirmish/plans/technology-plan.json";
const plan = readTechnologyPlan(JSON.parse(readFileSync(path, "utf8")));
const source = plan.civilizations.find((civ) => civ.id === "russians-rework");
if (!source) throw new Error("Missing original Russian eight-age plan");
const before = JSON.stringify(plan.civilizations);
const draft = createRusPackagedRework(source);
if (plan.civilizations.some((civ) => civ.id === draft.id))
  throw new Error(
    "Rus proposal already exists; edit its saved planner draft instead of overwriting it",
  );
if (JSON.stringify(plan.civilizations) !== before)
  throw new Error("Existing civilizations changed");
plan.civilizations.push(draft);
const errors = validatePlan(plan);
if (errors.length) throw new Error(errors.join("\n"));
writeFileSync(path, JSON.stringify(plan, null, 2) + "\n");
console.log(
  `Added ${draft.name}: ${draft.technologies.length} nodes, ${draft.units.filter((unit) => unit.availability === "available").length} available troops; existing civilizations preserved.`,
);
