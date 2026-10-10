import { readFileSync, writeFileSync } from "node:fs";
import baseline from "../src/skirmish/content/technologies.json";
import { validatePlan } from "../src/skirmish/planning/TechnologyPlan";
import { readTechnologyPlan } from "../src/skirmish/planning/TechnologyPlanMigration";
// Deliberate build step: planner edits never silently change a running match.
const plan = readTechnologyPlan(
  JSON.parse(readFileSync("skirmish/plans/technology-plan.json", "utf8")),
);
const civ = plan.civilizations.find(
  (c) => c.id === "russians-rus-eight-age-rework",
)!;
if (!civ || validatePlan(plan).length)
  throw new Error("Invalid saved Rus plan");
const previous = JSON.parse(
  readFileSync("src/skirmish/content/russian-recruitment.json", "utf8"),
);
const ages = civ.ages.map((a) => a.id);
const folderTypes: Record<string, string> = {
  City: "city",
  Factory: "factory",
  Mine: "mine",
  Port: "port",
  Barracks: "barracks",
  Blacksmith: "blacksmith",
  Armory: "armory",
  "Arms Factory": "arms-factory",
  "Archery Range": "archery",
  Stables: "stables",
  "Vehicle Depot": "depot",
  Tower: "tower",
  "Siege Workshop": "siege-workshop",
  "Military Airstrip": "airstrip",
  "Oil Well": "oil-well",
  "Oil Rig": "oil-rig",
  "Gun Nest": "gun-nest",
  Trench: "trench",
  "Anti-Aircraft Emplacement": "anti-air-emplacement",
  "Nuclear Weapons Facility": "nuclear-facility",
  "Missile Silo": "missile-silo",
  "Missile Defence": "missile-defence",
  "MIRV Launch Complex": "mirv-launcher",
  "Drone Facility": "drone-facility",
};
const buildings: Record<string, string> = {};
const aliases: Record<string, string> = {};
const id = (age: string, slug: string) => `rus-${age.toLowerCase()}-${slug}`;
const exists = new Set(civ.technologies.map((t) => t.id));
const terms = (age: string, tree: string, slot: number) => {
  const baseAge =
    age === "Napoleonic"
      ? "EarlyModern"
      : age === "EarlyModern" || age === "Modern"
        ? "Modern"
        : age;
  const b = baseline.find(
    (t) => t.age === baseAge && t.tree === tree && t.slot === slot,
  )!;
  const multiplier = age === "Modern" ? 1.25 : 1;
  return {
    gold: Math.ceil(b.gold * multiplier),
    ticks: Math.ceil((b.ticks * multiplier) / 20) * 20,
  };
};
const implemented = new Set([
  "cargo-canoes",
  "port-sea-trade",
  "coastal-navigation",
  "ports",
  "warships",
  "sea-traders",
  "ship-improvements",
  "submarines",
  "naval-missiles-air-defence",
  "factories-mines",
  "roads",
  "land-traders",
  "cities",
  "oil-extraction",
  "barracks-equipment",
  "ranged",
  "mobile",
  "fortifications",
  "siege",
  "ranged-mobile",
  "heavy-mobile",
  "airfields",
  "bombers",
  "nuclear-weapons",
  "missile-infrastructure",
  "mirvs-drones",
]);
const counts = new Map<string, number>();
const technologies = civ.technologies.map((t) => {
  const key = `${t.age}:${t.tree}`,
    slot = (counts.get(key) ?? 0) + 1;
  counts.set(key, slot);
  for (const folder of t.buildingUnlocks ?? []) {
    const type = folderTypes[folder];
    if (!type && !["Walls", "Palisades", "Gates"].includes(folder))
      throw new Error(`Unsupported building subject: ${folder}`);
    if (type) {
      buildings[`${t.age}:${type}`] = t.id;
      aliases[`russian-building-${t.age.toLowerCase()}-${type}`] = t.id;
    }
  }
  const slug = t.id.slice(`rus-${t.age.toLowerCase()}-`.length);
  if (!implemented.has(slug))
    throw new Error(`Unimplemented research package: ${t.id}`);
  const termSlot = [
    "cargo-canoes",
    "ports",
    "factories-mines",
    "barracks-equipment",
  ].includes(slug)
    ? 1
    : [
          "port-sea-trade",
          "roads",
          "ranged",
          "airfields",
          "ranged-mobile",
          "bombers",
        ].includes(slug)
      ? 2
      : [
            "mobile",
            "heavy-mobile",
            "sea-traders",
            "land-traders",
            "warships",
            "submarines",
            "oil-extraction",
          ].includes(slug)
        ? 3
        : 4;
  const quote = terms(t.age, t.tree, termSlot);
  // Stone foundations remain free as in the base culture. Coastal Navigation keeps authored terms.
  if (
    t.age === "StoneAge" &&
    ["factories-mines", "barracks-equipment"].includes(slug)
  ) {
    quote.gold = 0;
    quote.ticks = 0;
  }
  return {
    id: t.id,
    name: t.name,
    age: t.age,
    tree: t.tree,
    slot,
    prerequisites: t.prerequisites,
    gold: t.gold ?? quote.gold,
    ticks: t.researchSeconds === null ? quote.ticks : t.researchSeconds * 20,
    capabilities: [slug],
    description: t.description,
  };
});
for (const t of baseline) {
  const age =
    t.age === "EarlyModern"
      ? "Napoleonic"
      : t.age === "Modern"
        ? "EarlyModern"
        : t.age;
  const slugs =
    t.tree === "warfare"
      ? ["barracks-equipment", "ranged", "mobile", "siege"]
      : t.tree === "economic"
        ? ["factories-mines", "cities", "roads", "land-traders"]
        : age === "StoneAge"
          ? [
              "cargo-canoes",
              "port-sea-trade",
              "port-sea-trade",
              "coastal-navigation",
            ]
          : ["ports", "sea-traders", "warships", "ship-improvements"];
  const target = id(age, slugs[Math.min(t.slot, 4) - 1]);
  if (exists.has(target)) aliases[t.id] = target;
}
Object.assign(aliases, {
  "bronzeage-armies": id("BronzeAge", "barracks-equipment"),
  "stoneage-stone-mining": id("StoneAge", "factories-mines"),
  "latemedieval-powder-milling": id("LateMedieval", "factories-mines"),
  "modern-petroleum-extraction": id("EarlyModern", "oil-extraction"),
  "modern-strategic-weapons": id("Modern", "missile-infrastructure"),
  "modern-combined-arms": id("Modern", "fortifications"),
  "russian-fighter-squadrons": id("EarlyModern", "airfields"),
  "russian-bomber-squadrons": id("EarlyModern", "bombers"),
  "russian-mirv-systems": id("Modern", "mirvs-drones"),
  "russian-naval-missiles": id("Modern", "naval-missiles-air-defence"),
});
const units = previous.units.map((u: any) => {
  const authored = civ.units.find((p) => p.id === u.id);
  if (!authored || authored.prerequisites.length !== 1)
    throw new Error(`Missing package for ${u.id}`);
  aliases[u.technologyId] = authored.prerequisites[0];
  return { ...u, technologyId: authored.prerequisites[0] };
});
for (const t of previous.technologies) {
  if (t.id.startsWith("russian-support-"))
    aliases[t.id] = id(
      t.age,
      t.id.endsWith("launcher")
        ? "mirvs-drones"
        : t.id.includes("anti-air")
          ? "fortifications"
          : "siege",
    );
}
for (const [alias, target] of Object.entries(aliases))
  if (!exists.has(target)) throw new Error(`Unbound ${alias}: ${target}`);
writeFileSync(
  "src/skirmish/content/russian-recruitment.json",
  JSON.stringify(
    {
      schemaVersion: 2,
      planId: civ.id,
      units,
      technologies,
      buildings,
      aliases,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `${technologies.length} packaged technologies; ${units.length} troop recipes`,
);
