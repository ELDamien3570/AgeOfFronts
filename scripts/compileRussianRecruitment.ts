import { readFileSync, writeFileSync } from "node:fs";
import baseline from "../src/skirmish/content/technologies.json";
import { readTechnologyPlan } from "../src/skirmish/planning/TechnologyPlanMigration";
import { buildTroopProposals } from "../src/skirmish/planning/TroopTreePlan";

const plan = readTechnologyPlan(
  JSON.parse(readFileSync("skirmish/plans/technology-plan.json", "utf8")),
);
const civ = plan.civilizations.find((c) => c.id === "russians-rework")!;
const supportedBuildings = new Set([
  "city",
  "factory",
  "mine",
  "port",
  "barracks",
  "archery",
  "stables",
  "tower",
  "blacksmith",
  "armory",
  "arms-factory",
  "siege-workshop",
  "depot",
  "airstrip",
  "oil-well",
  "oil-rig",
  "gun-nest",
  "trench",
  "missile-silo",
  "mirv-launcher",
  "missile-defence",
]);
const units = buildTroopProposals(civ).map((p) => ({
  id: p.unit.id,
  name: p.unit.name,
  age: p.unit.age,
  troopClass: p.unit.role,
  technologyId: p.unit.prerequisites[0],
  gold: p.gold,
  trainingSeconds: p.trainingSeconds,
}));
const nodes = new Map(
  baseline.map((t) => [
    t.id,
    {
      ...t,
      age:
        t.age === "EarlyModern"
          ? "Napoleonic"
          : t.age === "Modern"
            ? "EarlyModern"
            : t.age,
    },
  ]),
);
const modernSlots = {
  warfare: [
    "russian-networked-command",
    "russian-infantry-optics",
    "russian-vehicle-electronics",
    "russian-tank-fire-control",
  ],
  naval: [
    "russian-modern-naval-systems",
    "russian-modern-transport-fleet",
    "russian-missile-frigates",
    "russian-naval-missiles",
  ],
  economic: [
    "russian-digital-economy",
    "russian-automated-factories",
    "russian-trade-route-management",
    "russian-precision-manufacturing",
  ],
};
const visited = new Set<string>();
const add = (id: string) => {
  if (visited.has(id)) return;
  visited.add(id);
  const t = civ.technologies.find((t) => t.id === id);
  if (!t) throw new Error(`Missing prerequisite ${id}`);
  // Naval/economic baseline effects stay intact until their independent migration.
  if (nodes.has(id) && t.tree !== "warfare") return;
  if (t.gold === null || t.researchSeconds === null)
    throw new Error(`Unpriced research ${id}`);
  const old = nodes.get(id);
  const ids = modernSlots[t.tree];
  const slot =
    t.age === "Modern" && ids.includes(id)
      ? ids.indexOf(id) + 1
      : (old?.slot ?? 0);
  nodes.set(id, {
    id,
    name: t.name,
    age: t.age,
    tree: t.tree,
    slot,
    prerequisites: t.prerequisites,
    gold: t.gold,
    ticks: t.researchSeconds * 20,
    capabilities: [],
    description: t.description,
  });
  t.prerequisites.forEach(add);
};
units.forEach((u) => add(u.technologyId));
Object.values(modernSlots).flat().forEach(add);
add("russian-bomber-squadrons");
for (const t of civ.technologies) {
  const prefix = `russian-building-${t.age.toLowerCase()}-`;
  if (
    t.id.startsWith(prefix) &&
    supportedBuildings.has(t.id.slice(prefix.length))
  )
    add(t.id);
  if (t.id.startsWith("russian-support-")) add(t.id);
}
// Stable foundation slots remain a compatibility API; additional unlocks use
// explicit IDs and append to each branch, never displace an existing effect.
for (const age of civ.ages)
  for (const tree of ["naval", "warfare", "economic"] as const) {
    const branch = [...nodes.values()].filter(
      (t) => t.age === age.id && t.tree === tree,
    );
    let slot = Math.max(0, ...branch.map((t) => t.slot));
    for (const t of branch
      .filter((t) => !t.slot)
      .sort((a, b) => a.id.localeCompare(b.id, "en")))
      t.slot = ++slot;
  }
writeFileSync(
  "src/skirmish/content/russian-recruitment.json",
  JSON.stringify(
    { schemaVersion: 1, units, technologies: [...nodes.values()] },
    null,
    2,
  ) + "\n",
);
console.log(
  `${units.length} troops; ${nodes.size} runtime research definitions`,
);
