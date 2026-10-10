import { describe, expect, it } from "vitest";
import { technologyDetails } from "../../src/skirmish/client/TechnologyDetails";
import {
  TECHNOLOGIES,
  technologyAt,
} from "../../src/skirmish/content/Technology";
import { VESSELS } from "../../src/skirmish/content/Units";
import { vesselEffects } from "../../src/skirmish/domain/ResearchEffects";

const text = (id: string) =>
  technologyDetails(TECHNOLOGIES.find((t) => t.id === id)!).join("\n");
describe("technology inspection", () => {
  it("covers all registered nodes without design notes or placeholder values", () => {
    expect(TECHNOLOGIES.length).toBeGreaterThan(85);
    for (const technology of TECHNOLOGIES) {
      expect(technology.description.length).toBeLessThan(600);
      expect(technology.description).not.toMatch(
        /authoring|placeholder|inferred|shared infrastructure|definition for|separate handling/,
      );
      expect(technologyDetails(technology).length).toBeGreaterThan(0);
      expect(technologyDetails(technology).join(" ")).not.toMatch(
        /undefined|NaN/,
      );
    }
  });
  it("shows cavalry equipment, production inputs and the halved base cycle", () => {
    expect(text("rus-bronzeage-mobile")).toContain(
      "20 horses + 2 Bronze Age equipment",
    );
    expect(text("rus-bronzeage-barracks-equipment")).toContain(
      "12 bronze → 1 Bronze Age equipment · 10s base cycle at Blacksmith",
    );
    expect(text("rus-earlymodern-barracks-equipment")).toContain(
      "12 steel + 10 gunpowder",
    );
  });
  it("keeps fleet improvements separate from trade and reports afloat squad hulls", () => {
    const node = technologyAt("ClassicalAge", "naval", 4);
    const transport = VESSELS.find(
      (v) => v.age === "ClassicalAge" && v.kind === "transport",
    )!;
    const upgraded = vesselEffects(transport, [node.id]);
    expect(upgraded.health).toBeGreaterThan(transport.health);
    expect(text(node.id)).toContain("Squads afloat: ");
    expect(text(node.id)).toContain(
      `hull ${transport.health} → ${upgraded.health}`,
    );
    expect(text(node.id)).not.toContain("Sea trade:");
    expect(text("rus-classicalage-ports")).toContain(
      `Squads cross water as ${transport.name}: ${transport.health} hull`,
    );
  });
  it("reports logistics tiers as replacements and locates horse breeding on its real unlock", () => {
    expect(text("rus-earlymodern-factories-mines")).toContain(
      "Recipe production rate: 170% of base",
    );
    expect(text("rus-earlymodern-roads")).toContain("6 horses/s");
    expect(text("rus-classicalage-roads")).toContain("3 horses/s");
    expect(text("rus-classicalage-cities")).not.toContain("horses/s");
    expect(text("rus-earlymodern-roads")).toContain(
      "120 goods base cargo · 150 with Stone Age cargo handling",
    );
  });
  it("shows strategic launch cost, per-warhead blast values, and aircraft limits", () => {
    expect(text("rus-modern-missile-infrastructure")).toContain(
      "10,000 gold + 1 matching payload · 60s launcher cooldown",
    );
    expect(text("rus-modern-mirvs-drones")).toContain(
      "MIRV: 8 warheads × 3,000 attack · 3-tile blast radius per warhead",
    );
    expect(text("rus-modern-missile-infrastructure")).toContain(
      "Hydrogen bomb: 40,000 attack · 28-tile blast radius",
    );
    expect(text("rus-earlymodern-airfields")).toContain(
      "6 per launch site · 32 per faction",
    );
    expect(text("rus-earlymodern-bombers")).toContain("4-tile blast radius");
    expect(text("rus-modern-fortifications")).toContain(
      "6 infantry squads per trench tile",
    );
  });
});
