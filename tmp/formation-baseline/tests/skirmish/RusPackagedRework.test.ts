import { describe, expect, it } from "vitest";
import saved from "../../skirmish/plans/technology-plan.json";
import { readTechnologyPlan } from "../../src/skirmish/planning/TechnologyPlanMigration";
import { createRusPackagedRework } from "../../src/skirmish/planning/RusPackagedRework";
import { validatePlan } from "../../src/skirmish/planning/TechnologyPlan";
import { layoutResearch } from "../../src/skirmish/planning/TechnologyPlanGraph";
const plan = readTechnologyPlan(saved);
const source = plan.civilizations.find(c => c.id === "russians-rework")!;
describe("Rus packaged planner sketch", () => {
 it("adds an independent eight-age draft and binds every available troop to its package",()=>{
  const before=structuredClone(source),draft=createRusPackagedRework(source);
  expect(source).toEqual(before);expect(draft.name).toBe("Rus — eight-age rework");
  expect(draft.technologies).toHaveLength(125);expect(draft.ages).toHaveLength(8);
  expect(validatePlan({schemaVersion:2,civilizations:[draft]})).toEqual([]);
  expect(draft.units.filter(unit=>unit.availability==="available")).toHaveLength(42);
  for(const unit of draft.units.filter(unit=>unit.availability==="available")) {
   expect(unit.prerequisites).toHaveLength(1);
   expect(draft.technologies.some(node=>node.id===unit.prerequisites[0])).toBe(true);
  }
  expect(layoutResearch(draft.technologies,draft.ages.map(age=>age.id),4)).toHaveLength(8);
 });
 it("keeps specialist military branches terminal and requires only the three specified upgrades for siege",()=>{
  const draft=createRusPackagedRework(source);
  for(const node of draft.technologies.filter(node=>/-(heavy-mobile|ranged-mobile|bombers)$/.test(node.id)))
   expect(draft.technologies.some(child=>child.prerequisites.includes(node.id))).toBe(false);
  for(const node of draft.technologies.filter(node=>node.id.endsWith("-siege"))) {
   expect(node.prerequisites).toHaveLength(3);
   expect(node.prerequisites.map(id=>id.slice(id.lastIndexOf("-") + 1)).sort()).toEqual(["fortifications","mobile","ranged"]);
  }
 });
 it("packages port, factory/mine and equipment subjects and moves oil rigs to economics",()=>{
  const draft=createRusPackagedRework(source);
  for(const age of draft.ages) {
   const economic=draft.technologies.find(node=>node.id===`rus-${age.id.toLowerCase()}-factories-mines`)!;
   expect(economic.buildingUnlocks).toEqual(["Factory","Mine"]);
   const foundation=draft.technologies.find(node=>node.id===`rus-${age.id.toLowerCase()}-barracks-equipment`)!;
   expect(foundation.buildingUnlocks).toContain("Barracks");
  }
  const rigs=draft.technologies.filter(node=>node.buildingUnlocks?.includes("Oil Rig"));
  expect(rigs).toHaveLength(1);expect(rigs[0].tree).toBe("economic");
  expect(draft.technologies.some(node=>/Integrated Fleet Command|Quiet Propulsion/.test(node.name))).toBe(false);
 });
 it("puts bomber atomic weapons in pre-modern, and combined missile/MIRV/drone unlocks in modern",()=>{
  const draft=createRusPackagedRework(source);
  expect(draft.technologies.some(node=>node.id.endsWith("-fighters"))).toBe(false);
  for(const age of ["earlymodern","modern"]) {
   const airfield=draft.technologies.find(node=>node.id===`rus-${age}-airfields`)!;
   expect(airfield.name).toContain("Fighters");
   expect(airfield.description).toContain("production recipe");
   expect(draft.technologies.find(node=>node.id===`rus-${age}-bombers`)!.prerequisites).toEqual([airfield.id]);
  }
  const nuclear=draft.technologies.find(node=>node.id==="rus-earlymodern-nuclear-weapons")!;
  expect(nuclear.description).toContain("H-bomb artwork");expect(nuclear.buildingUnlocks).toContain("Nuclear Weapons Facility");
  const missiles=draft.technologies.find(node=>node.id==="rus-modern-missile-infrastructure")!;
  expect(missiles.buildingUnlocks).toEqual(["Missile Silo","Missile Defence"]);
  expect(draft.technologies.find(node=>node.id==="rus-modern-mirvs-drones")!.prerequisites).toEqual([missiles.id]);
  const original=source.technologies.find(node=>node.name==="Coastal Navigation")!;
  const coastal=draft.technologies.find(node=>node.name==="Coastal Navigation")!;
  expect(coastal.gold).toBe(original.gold);expect(coastal.researchSeconds).toBe(original.researchSeconds);
 });
});
