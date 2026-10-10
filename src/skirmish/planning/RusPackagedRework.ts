import type { CivilizationPlan, PlannedTechnology } from "./TechnologyPlan";

/** Planner-only proposal. No runtime catalogue, gameplay rule or balance is registered. */
export function createRusPackagedRework(
  source: CivilizationPlan,
): CivilizationPlan {
  const draft = structuredClone(source);
  draft.id = "russians-rus-eight-age-rework";
  draft.name = "Rus — eight-age rework";
  draft.notes =
    "Packaged eight-age sketch. Building tiers and their troop/equipment recipes are researched together. Specialist military unlocks are optional terminal side branches. Pre-modern means 1914–1970; Modern means present day. Prices, timers and small stat increases remain TBD, except unchanged Stone Age Coastal Navigation. Heavy cavalry starts with the available Druzhina roster in Early Medieval; unavailable earlier heavy-cavalry placeholders remain unavailable. Age-up requirements will be designed separately: do not require every optional leaf. Planner only; original trees and normal skirmish are unchanged.";
  draft.ages = draft.ages.map((age) =>
    age.id === "EarlyModern"
      ? { ...age, name: "Pre-modern", period: "1914–1970" }
      : age,
  );
  draft.technologies = [];
  const ids = (age: string, slug: string) => `rus-${age.toLowerCase()}-${slug}`;
  function add(
    age: string,
    tree: PlannedTechnology["tree"],
    slug: string,
    name: string,
    parents: string[],
    description: string,
    buildings: string[] = [],
    kind: PlannedTechnology["kind"] = "unlock",
  ) {
    const node: PlannedTechnology = {
      id: ids(age, slug),
      age,
      tree,
      order:
        draft.technologies.filter(
          (node) => node.age === age && node.tree === tree,
        ).length + 1,
      name,
      prerequisites: parents,
      description,
      buildingUnlocks: buildings,
      kind,
      notes:
        "Planner sketch. Price and duration TBD. Any slight stat increases are design intent; magnitudes TBD.",
      decision: "proposed",
      gold: null,
      researchSeconds: null,
    };
    draft.technologies.push(node);
    return node.id;
  }
  const troops = (age: string, roles: string[]) =>
    draft.units.filter(
      (unit) =>
        unit.age === age &&
        unit.availability === "available" &&
        roles.includes(unit.role),
    );
  const names = (age: string, roles: string[]) =>
    troops(age, roles)
      .map((unit) => unit.name)
      .join(", ");
  let previousNaval: string | undefined,
    previousEconomy: string | undefined,
    previousWarfare: string | undefined;
  const metal = [
    "stone tools; no metal smelting",
    "copper, tin and bronze smelting",
    "iron smelting",
    "improved ironworking",
    "steel production",
    "steel and gunpowder-era production",
    "industrial steel production",
    "modern alloy and equipment production",
  ];
  for (const [index, age] of draft.ages.entries()) {
    const id = age.id,
      modern = id === "Modern",
      premodern = id === "EarlyModern",
      industrial = modern || premodern;
    const label = age.name;
    if (index === 0) {
      const cargo = add(
        id,
        "naval",
        "cargo-canoes",
        "Cargo Canoes",
        [],
        "Unlock squad transport technology: squads use cargo canoes to cross water. No port is required to unlock this transport tier.",
      );
      const port = add(
        id,
        "naval",
        "port-sea-trade",
        "Port, War Canoes & Sea Trade",
        [cargo],
        "Unlock ports and their war-canoe and sea-trader recipes together. Ports create sea traders and warships and receive trade deliveries.",
        ["Port"],
      );
      previousNaval = add(
        id,
        "naval",
        "coastal-navigation",
        "Coastal Navigation",
        [port],
        "Unchanged upgrade: improve squad transport hulls and sailing speed, military sailing speed and warship firing rate. Trade ships are unchanged.",
        [],
        "upgrade",
      );
      const coastal = source.technologies.find(
        (node) => node.age === id && node.name === "Coastal Navigation",
      )!;
      Object.assign(draft.technologies[draft.technologies.length - 1], {
        gold: coastal.gold,
        researchSeconds: coastal.researchSeconds,
        notes:
          "Preserve the existing Coastal Navigation effects and research terms. Its prerequisite is now the bundled port/warship/trader unlock.",
      });
    } else {
      const port = add(
        id,
        "naval",
        "ports",
        `${label} Ports`,
        [previousNaval!],
        "Unlock the new port tier and automatically upgrade every existing port. Slightly increase receiving capacity, cargo-stock generation, land and sea cargo per trip, and building health. This node bundles the tier benefits; no separate port-building research.",
        ["Port"],
      );
      const war = add(
        id,
        "naval",
        "warships",
        modern ? "Modern Missile Warships" : `${label} Warships`,
        [port],
        "Unlock this age's improved warship recipe at the upgraded port. This is the warship branch of the port upgrade.",
      );
      const trade = add(
        id,
        "naval",
        "sea-traders",
        `${label} Sea Traders`,
        [port],
        "Upgrade the sea traders spawned by ports to this age's improved trader tier, with a slight increase in cargo capacity per trip.",
      );
      previousNaval = add(
        id,
        "naval",
        "ship-improvements",
        modern ? "General Fleet Improvements" : `${label} Naval Improvements`,
        [war, trade],
        modern
          ? "One general improvement for researched warships, submarines, squad transports and sea traders: slight durability, cargo/receiving and warship firing-rate improvements as applicable. Bundles Reinforced Transport Hulls and Maritime Cargo Systems; no Integrated Fleet Command or separate submarine-improvement node."
          : "Slightly improve squad transport and warship durability, and warship firing rate. Improves the existing fleet without another unit/building unlock.",
        [],
        "upgrade",
      );
      if (premodern)
        add(
          id,
          "naval",
          "submarines",
          "Diesel Submarines",
          [war],
          "Unlock submarines and their port recipe. This is an optional specialization; submarine improvements are included in the later Modern General Fleet Improvements node. No quiet-propulsion chain.",
        );
      if (modern) {
        add(
          id,
          "naval",
          "naval-missiles-air-defence",
          "Naval Missiles & Air Defence",
          [war],
          "One optional upgrade combining naval missile capability and fleet air defence. Replaces the two separate missile/air-defence upgrades.",
          [],
          "upgrade",
        );
        add(
          id,
          "naval",
          "submarines",
          "Nuclear Submarines",
          [war, ids("EarlyModern", "submarines")],
          "Unlock the modern nuclear-powered submarine tier and its port recipe. Nuclear propulsion does not grant nuclear missiles. General Fleet Improvements supplies the later modest submarine improvements.",
        );
      }
    }
    const economy = add(
      id,
      "economic",
      "factories-mines",
      index ? `${label} Factories & Mines` : "Workshops & Stone Mining",
      previousEconomy ? [previousEconomy] : [],
      `Unlock/upgrade factories and mines together, including extraction and ${metal[index]}. Factories create trade cargo, spawn overland traders, and smelt the available metals. No separate recipe unlock research.`,
      ["Factory", "Mine"],
    );
    const roads = add(
      id,
      "economic",
      "roads",
      index ? `${label} Road Networks` : "Paths & Roads",
      [economy],
      "Improve overland roads and trade-route infrastructure for this age. Exact road benefits remain TBD.",
      [],
      "upgrade",
    );
    const traders = add(
      id,
      "economic",
      "land-traders",
      index ? `${label} Overland Trade` : "Overland Traders",
      [economy],
      "Unlock/upgrade overland traders spawned by factories, with a modest improvement in cargo per trip and delivery efficiency. Exact numbers remain TBD.",
      [],
      index ? "upgrade" : "unlock",
    );
    previousEconomy = add(
      id,
      "economic",
      "cities",
      index ? `${label} Cities` : "Settlement Administration",
      [roads, traders],
      index ? "Upgrade cities, improving reserve generation, receiving capacity and building health. This closes the age's economic spine." : "Cities are buildable from the start. Improve city reserve generation and building health by 10%, and receiving capacity by 10%. This closes the Stone Age economic branch.",
      ["City"],
      index ? "upgrade" : "unlock",
    );
    if (premodern)
      add(
        id,
        "economic",
        "oil-extraction",
        "Oil Wells & Offshore Rigs",
        [economy],
        "Unlock oil extraction through oil wells and offshore oil rigs. The oil-rig unlock belongs to economics, not naval. Supplies fuel for the industrial-age army and fleet.",
        ["Oil Well", "Oil Rig"],
      );
    const equipment = industrial
      ? "Arms Factory"
      : id === "Napoleonic"
        ? "Armory"
        : "Blacksmith";
    const foundation = add(
      id,
      "warfare",
      "barracks-equipment",
      `${label} Infantry & Equipment`,
      previousWarfare ? [previousWarfare] : [],
      index
        ? `Unlock/upgrade barracks and ${equipment.toLowerCase()} together, including this tier's equipment-production recipes and barracks troop recipes: ${names(id, ["frontline", "antiCavalry"])}. These recipes require no individual follow-up unlocks.`
        : `Unlock/upgrade barracks and their troop recipes: ${names(id, ["frontline", "antiCavalry"])}. Stone Age troops require no manufactured equipment.`,
      index ? ["Barracks", equipment] : ["Barracks"],
    );
    const ranged = add(
      id,
      "warfare",
      "ranged",
      industrial ? `${label} Ranged Infantry` : `${label} Ranged Training`,
      [foundation],
      `Upgrade the ranged recruitment building and its equipment/troop recipes together: ${names(id, ["rangedInfantry"])}.`,
      ["Archery Range"],
    );
    const cavalry = add(
      id,
      "warfare",
      "mobile",
      industrial ? `${label} Vehicle Depot` : `${label} Stables`,
      [foundation],
      industrial
        ? `Replace the stable progression with vehicle-depot upgrades and the base light-vehicle recipe: ${names(id, ["lightCavalry"])}. Heavy and ranged vehicle recipes are separate optional side branches.`
        : `Upgrade stables, their light-cavalry equipment recipe and ${names(id, ["lightCavalry"])} together.`,
      [industrial ? "Vehicle Depot" : "Stables"],
    );
    const fort = add(
      id,
      "warfare",
      "fortifications",
      `${label} Fortifications`,
      [foundation],
      industrial
        ? "Unlock/upgrade this tier's gun nests, trenches and anti-aircraft emplacements together, with modest fortification durability improvements."
        : "Unlock/upgrade this tier's towers, walls/palisades and gates together, with modest fortification durability improvements.",
      industrial
        ? ["Gun Nest", "Trench", "Anti-Aircraft Emplacement"]
        : ["Tower", index ? "Walls" : "Palisades", "Gates"],
    );
    previousWarfare = add(
      id,
      "warfare",
      "siege",
      `${label} Siege Engineering`,
      [ranged, cavalry, fort],
      "Unlock/upgrade the siege workshop and all siege/artillery equipment and recruitment recipes available in this age. No separate workshop or per-engine research. Requires ranged, cavalry/vehicle and fortification upgrades.",
      ["Siege Workshop"],
    );
    if (troops(id, ["rangedCavalry"]).length)
      add(
        id,
        "warfare",
        "ranged-mobile",
        industrial
          ? names(id, ["rangedCavalry"])
          : `${names(id, ["rangedCavalry"])} — Horse Archery`,
        [industrial ? cavalry : ranged],
        `Optional terminal unlock: ${names(id, ["rangedCavalry"])} and its equipment/recruitment recipe. No technology requires this node. ${industrial ? "Produced at the vehicle depot." : "Produced at stables; the research branches from ranged training."}`,
      );
    if (troops(id, ["heavyCavalry"]).length)
      add(
        id,
        "warfare",
        "heavy-mobile",
        names(id, ["heavyCavalry"]),
        [cavalry],
        `Optional terminal unlock: ${names(id, ["heavyCavalry"])} and its equipment/recruitment recipe at ${industrial ? "the vehicle depot" : "stables"}. No technology requires this node.`,
      );
    if (industrial) {
      const airfield = add(
        id,
        "warfare",
        "airfields",
        `${label} Airfields & Fighters`,
        [foundation],
        "Unlock/upgrade military airfields together with this age's fighters and their production recipe. Bombers remain a separate optional specialization.",
        ["Military Airstrip"],
      );
      add(
        id,
        "warfare",
        "bombers",
        `${label} Bombers`,
        [airfield],
        "Optional terminal unlock: this age's bombers and their production recipe. No technology requires this specialization. Pre-modern bombers can carry atomic bombs after Nuclear Weapons is researched.",
      );
    }
    if (premodern)
      add(
        id,
        "warfare",
        "nuclear-weapons",
        "Nuclear Weapons & Atomic Bombs",
        [previousWarfare],
        "End-of-pre-modern unlock: nuclear weapons facility and A-bomb production/loading for bombers. Reuse the existing H-bomb artwork for a bomber-dropped atomic bomb. Bomber specialization is required to produce the delivery aircraft, but is not a research prerequisite of this node. Proposed capability; not yet implemented in gameplay.",
        ["Nuclear Weapons Facility"],
      );
    if (modern) {
      const missiles = add(
        id,
        "warfare",
        "missile-infrastructure",
        "Missile Silos & Missile Defence",
        [fort],
        "One unlock for missile silos and missile-defence construction, with their associated missile/defence recipes. Removes separate unlock tolls for these two buildings.",
        ["Missile Silo", "Missile Defence"],
      );
      add(
        id,
        "warfare",
        "mirvs-drones",
        "MIRVs & Drone Systems",
        [missiles],
        "One later terminal unlock for MIRV systems, MIRV launch complexes and drone systems/facilities together. Drone roles, counters and exact effects still need design; this is a planner proposal, not an implemented runtime capability.",
        ["MIRV Launch Complex", "Drone Facility"],
        "capstone",
      );
    }
    for (const unit of draft.units.filter((unit) => unit.age === id)) {
      if (unit.availability !== "available") {
        unit.prerequisites = [];
        continue;
      }
      unit.prerequisites = [
        ids(
          id,
          unit.role === "frontline" || unit.role === "antiCavalry"
            ? "barracks-equipment"
            : unit.role === "rangedInfantry"
              ? "ranged"
              : unit.role === "lightCavalry"
                ? "mobile"
                : unit.role === "heavyCavalry"
                  ? "heavy-mobile"
                  : "ranged-mobile",
        ),
      ];
    }
  }
  return draft;
}
