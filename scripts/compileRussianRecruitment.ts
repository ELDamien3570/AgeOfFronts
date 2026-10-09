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
const upgrades = new Set([
  "russian-bayonet-drill",
  "russian-volley-fire",
  "russian-artillery-carriages",
  "russian-copper-sheathing",
  "russian-merchant-holds",
  "russian-machine-tools",
  "russian-supply-depots",
  "russian-container-shipping",
  "russian-assembly-line-upgrades",
  "russian-transport-hulls",
  "russian-maritime-cargo-systems",
]);
const unsupported = new Set(
  civ.technologies
    .filter((t) =>
      /drone|unmanned|electronic-warfare|submarine|quiet-propulsion|naval-radar|naval-air-defence|integrated-fleet-command|rail|freight-electrification|warehouse|regional-coordination|oil-refining|oil-refinery|nuclear-weapons-facility/.test(
        t.id,
      ),
    )
    .map((t) => t.id),
);
const unavailable = new Set<string>();
const canImplement = (id: string, visiting = new Set<string>()): boolean => {
  if (unsupported.has(id)) return false;
  const t = civ.technologies.find((t) => t.id === id);
  if (!t || t.gold === null || t.researchSeconds === null || visiting.has(id))
    return false;
  const parents = new Set(visiting);
  parents.add(id);
  return t.prerequisites.every(
    (parent) =>
      (nodes.has(parent) && !unsupported.has(parent)) ||
      canImplement(parent, parents),
  );
};
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
  if (!canImplement(id)) {
    unavailable.add(id);
    return;
  }
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
// Refresh every implemented node from the saved page, including changed names,
// prices and dependencies. Do not insert research with no gameplay effect.
for (const t of civ.technologies) {
  if (!(nodes.has(t.id) || upgrades.has(t.id))) continue;
  if (canImplement(t.id)) {
    visited.delete(t.id);
    add(t.id);
  } else {
    unavailable.add(t.id);
    // Preserve the supported gameplay effect, but visibly flag the planner edge
    // that cannot be enabled until its unfinished prerequisites exist.
    const old = nodes.get(t.id);
    if (old && t.gold !== null && t.researchSeconds !== null)
      nodes.set(t.id, {
        ...old,
        name: t.name,
        gold: t.gold,
        ticks: t.researchSeconds * 20,
        description: `${t.description} Planner prerequisite migration pending: ${t.prerequisites.filter((parent) => !canImplement(parent)).join(", ")}.`,
      });
  }
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
writeFileSync(
  "skirmish/plans/RuntimeTechnologyGaps.json",
  JSON.stringify(
    {
      missingMechanics: civ.technologies
        .filter((t) => !nodes.has(t.id))
        .map((t) => t.id)
        .sort(),
      retainedRuntimePrerequisites: [...unavailable].sort(),
    },
    null,
    2,
  ) + "\n",
);
