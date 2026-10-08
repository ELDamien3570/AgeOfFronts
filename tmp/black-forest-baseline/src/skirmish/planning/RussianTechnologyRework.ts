import type { CivilizationPlan, PlannedTechnology } from "./TechnologyPlan";
import { applyRussianTroopAvailability } from "./TroopTreePlan";

/** Editable design proposal; no runtime content is changed by this draft. */
export function createRussianRework(
  source: CivilizationPlan,
): CivilizationPlan {
  const draft = structuredClone(source);
  draft.id = "russians-rework";
  draft.name = "Russians — eight-age rework";
  draft.notes =
    "Eight-age proposal. Napoleonic replaces the former Early Modern; Early Modern covers 1914–1970; Modern covers the present day. Split unlocks, upgrades, prices and research times are proposals, not balanced gameplay values. Original Russian plan is retained for comparison.";
  draft.ages = [
    ...source.ages.slice(0, 5),
    { id: "Napoleonic", name: "Napoleonic", period: "" },
    { id: "EarlyModern", name: "Early Modern", period: "1914–1970" },
    { id: "Modern", name: "Modern", period: "Present day" },
  ];
  for (const node of [...draft.technologies, ...draft.units]) {
    node.age =
      node.age === "EarlyModern"
        ? "Napoleonic"
        : node.age === "Modern"
          ? "EarlyModern"
          : node.age;
  }
  const find = (id: string) => draft.technologies.find((t) => t.id === id)!;
  const rename = (id: string, name: string, description: string) =>
    Object.assign(find(id), { name, description, decision: "proposed" });
  const add = (
    age: string,
    tree: PlannedTechnology["tree"],
    slug: string,
    name: string,
    parents: string[],
    description: string,
    kind: PlannedTechnology["kind"] = "upgrade",
    gold = 30000,
    researchSeconds = 90,
  ) => {
    const id = `russian-${slug}`;
    draft.technologies.push({
      id,
      age,
      tree,
      name,
      prerequisites: parents,
      description,
      kind,
      gold,
      researchSeconds,
      order:
        Math.max(
          0,
          ...draft.technologies
            .filter((t) => t.age === age && t.tree === tree)
            .map((t) => t.order),
        ) + 1,
      notes:
        "Proposed unlock/effect and provisional price. Tune before gameplay integration.",
      decision: "proposed",
    });
    return id;
  };
  rename(
    "earlymodern-musket-and-artillery-drill",
    "Line Musketeers",
    "Unlock line musketeers. Artillery, bayonet and volley upgrades are separate research.",
  );
  rename(
    "earlymodern-pistoliers",
    "Cossack Lancers",
    "Unlock light cavalry armed with lances; mounted firearm troops have their own unlock.",
  );
  rename(
    "earlymodern-howitzer-engineering",
    "Artillery Foundries",
    "Unlock artillery production; individual artillery upgrades are researched separately.",
  );
  const grenadiers = add(
    "Napoleonic",
    "warfare",
    "grenadier-companies",
    "Grenadier Companies",
    ["earlymodern-musket-and-artillery-drill"],
    "Unlock Napoleonic frontline infantry.",
    "unlock",
    12000,
    60,
  );
  const cuirassiers = add(
    "Napoleonic",
    "warfare",
    "cuirassiers",
    "Cuirassiers",
    ["earlymodern-pistoliers"],
    "Unlock armoured heavy cavalry.",
    "unlock",
    16000,
    70,
  );
  const mounted = add(
    "Napoleonic",
    "warfare",
    "mounted-musketeers",
    "Mounted Musketeers",
    ["earlymodern-pistoliers"],
    "Unlock ranged cavalry carrying muskets.",
    "unlock",
    14000,
    60,
  );
  add(
    "Napoleonic",
    "warfare",
    "bayonet-drill",
    "Bayonet Drill",
    [grenadiers],
    "Improve infantry close combat.",
    "upgrade",
    14000,
    60,
  );
  add(
    "Napoleonic",
    "warfare",
    "volley-fire",
    "Volley Fire",
    ["earlymodern-musket-and-artillery-drill"],
    "Improve ranged infantry fire against infantry.",
    "upgrade",
    14000,
    60,
  );
  add(
    "Napoleonic",
    "warfare",
    "artillery-carriages",
    "Artillery Carriages",
    ["earlymodern-howitzer-engineering"],
    "Improve artillery mobility.",
    "upgrade",
    18000,
    70,
  );
  const copper = add(
    "Napoleonic",
    "naval",
    "copper-sheathing",
    "Copper Sheathing",
    ["earlymodern-ships-of-the-line"],
    "Improve warship speed and durability.",
    "upgrade",
    14000,
    60,
  );
  const holds = add(
    "Napoleonic",
    "naval",
    "merchant-holds",
    "Expanded Merchant Holds",
    ["earlymodern-ocean-transport"],
    "Increase merchant cargo capacity.",
    "upgrade",
    12000,
    60,
  );
  find("earlymodern-fleet-coordination").prerequisites = [copper, holds];
  const tools = add(
    "Napoleonic",
    "economic",
    "machine-tools",
    "Machine Tools",
    ["earlymodern-manufactories"],
    "Improve manufacturing output.",
    "upgrade",
    14000,
    60,
  );
  const depots = add(
    "Napoleonic",
    "economic",
    "supply-depots",
    "Supply Depots",
    ["earlymodern-long-distance-commerce"],
    "Increase storage and supply throughput.",
    "upgrade",
    12000,
    60,
  );
  find("earlymodern-military-provisioning").prerequisites = [tools, depots];
  rename(
    "modern-modern-armaments",
    "Industrial Armaments",
    "Foundation for individual twentieth-century infantry and vehicle unlocks.",
  );
  rename(
    "modern-combined-arms",
    "Combined Arms Doctrine",
    "Coordinate separately unlocked infantry, armour and air support.",
  );
  find("modern-combined-arms").kind = "upgrade";
  rename(
    "modern-military-aviation",
    "Military Airfields",
    "Unlock aviation infrastructure; fighters and bombers are researched individually.",
  );
  rename(
    "modern-strategic-weapons",
    "Nuclear Weapons",
    "Unlock early nuclear weapons; modern precision missiles and MIRV systems are separate research.",
  );
  const rifle = add(
    "EarlyModern",
    "warfare",
    "rifle-infantry",
    "Rifle Infantry",
    ["modern-modern-armaments"],
    "Unlock assault infantry.",
    "unlock",
  );
  const mg = add(
    "EarlyModern",
    "warfare",
    "machine-gun-teams",
    "Machine Gun Teams",
    ["modern-modern-armaments"],
    "Unlock ranged infantry countering infantry.",
    "unlock",
  );
  const trucks = add(
    "EarlyModern",
    "warfare",
    "gun-trucks",
    "Gun Trucks",
    ["modern-modern-armaments"],
    "Unlock fast light vehicles with mounted machine guns.",
    "unlock",
  );
  const apc = add(
    "EarlyModern",
    "warfare",
    "apc-production",
    "APC Production",
    [trucks],
    "Unlock protected heavy cavalry equivalent.",
    "unlock",
    40000,
    100,
  );
  const tanks = add(
    "EarlyModern",
    "warfare",
    "tank-production",
    "Tank Production",
    [trucks],
    "Unlock cannon-armed ranged cavalry equivalent.",
    "unlock",
    45000,
    100,
  );
  const anti = add(
    "EarlyModern",
    "warfare",
    "anti-tank-teams",
    "Anti-Tank Teams",
    [rifle],
    "Unlock infantry countering cavalry and armoured vehicles.",
    "unlock",
  );
  const radios = add(
    "EarlyModern",
    "warfare",
    "infantry-radios",
    "Infantry Radios",
    [rifle, mg],
    "Improve infantry coordination.",
  );
  const armour = add(
    "EarlyModern",
    "warfare",
    "tank-armour",
    "Improved Tank Armour",
    [tanks],
    "Improve tank survivability.",
  );
  const fighters = add(
    "EarlyModern",
    "warfare",
    "fighter-squadrons",
    "Fighter Squadrons",
    ["modern-military-aviation"],
    "Unlock fighters.",
    "unlock",
    40000,
    100,
  );
  add(
    "EarlyModern",
    "warfare",
    "bomber-squadrons",
    "Bomber Squadrons",
    ["modern-military-aviation"],
    "Unlock bombers.",
    "unlock",
    45000,
    100,
  );
  add(
    "EarlyModern",
    "warfare",
    "anti-aircraft-guns",
    "Anti-Aircraft Guns",
    [mg],
    "Unlock ground anti-aircraft weapons.",
    "unlock",
  );
  find("modern-combined-arms").prerequisites = [radios, armour, apc, fighters];
  rename(
    "modern-modern-warships",
    "Destroyer Warfare",
    "Unlock steel warships; submarine systems are separate research.",
  );
  const diesel = add(
    "EarlyModern",
    "naval",
    "diesel-submarines",
    "Diesel Submarines",
    ["modern-powered-vessels"],
    "Unlock conventional submarines.",
    "unlock",
    45000,
    100,
  );
  const radar = add(
    "EarlyModern",
    "naval",
    "naval-radar",
    "Naval Radar",
    ["modern-modern-warships"],
    "Improve ship detection.",
  );
  const cargo = add(
    "EarlyModern",
    "naval",
    "container-shipping",
    "Container Shipping",
    ["modern-amphibious-transport"],
    "Improve maritime freight capacity.",
  );
  find("modern-fleet-operations").prerequisites = [diesel, radar, cargo];
  const assembly = add(
    "EarlyModern",
    "economic",
    "assembly-line-upgrades",
    "Mechanised Assembly Lines",
    ["modern-industrial-production"],
    "Improve industrial output.",
  );
  const refining = add(
    "EarlyModern",
    "economic",
    "oil-refining",
    "Oil Refining",
    ["modern-petroleum-extraction"],
    "Improve fuel production.",
  );
  const rail = add(
    "EarlyModern",
    "economic",
    "rail-freight",
    "Rail Freight",
    ["modern-motor-freight"],
    "Unlock high-capacity overland freight.",
    "unlock",
  );
  find("modern-integrated-logistics").prerequisites = [
    assembly,
    refining,
    rail,
  ];
  const network = add(
    "Modern",
    "warfare",
    "networked-command",
    "Networked Command",
    ["modern-combined-arms"],
    "Foundation for present-day Russian military research.",
    "unlock",
    65000,
    120,
  );
  const optics = add(
    "Modern",
    "warfare",
    "infantry-optics",
    "Infantry Optics",
    [network],
    "Improve present-day infantry accuracy.",
    "upgrade",
    70000,
    120,
  );
  const electronics = add(
    "Modern",
    "warfare",
    "vehicle-electronics",
    "Vehicle Electronics",
    [network],
    "Unlock present-day gun trucks, APCs and battle tanks.",
    "unlock",
    80000,
    120,
  );
  const drones = add(
    "Modern",
    "warfare",
    "battlefield-drones",
    "Battlefield Drones",
    [network],
    "Unlock reconnaissance drones.",
    "unlock",
    75000,
    120,
  );
  const guidance = add(
    "Modern",
    "warfare",
    "anti-tank-guidance",
    "Anti-Tank Guidance",
    [optics],
    "Unlock modern anti-tank infantry.",
    "unlock",
    85000,
    150,
  );
  const fire = add(
    "Modern",
    "warfare",
    "tank-fire-control",
    "Tank Fire Control",
    [electronics],
    "Improve tank accuracy.",
    "upgrade",
    85000,
    150,
  );
  const ew = add(
    "Modern",
    "warfare",
    "electronic-warfare",
    "Electronic Warfare",
    [drones],
    "Improve resistance to hostile targeting.",
    "upgrade",
    90000,
    150,
  );
  const loiter = add(
    "Modern",
    "warfare",
    "loitering-munitions",
    "Loitering Munitions",
    [drones],
    "Unlock individual attack drones.",
    "unlock",
    95000,
    150,
  );
  const precision = add(
    "Modern",
    "warfare",
    "precision-missiles",
    "Precision Missiles",
    ["modern-strategic-weapons", network],
    "Unlock precision conventional missile strikes.",
    "unlock",
    120000,
    180,
  );
  add(
    "Modern",
    "warfare",
    "mirv-systems",
    "MIRV Systems",
    [precision],
    "Upgrade strategic nuclear delivery systems.",
    "upgrade",
    180000,
    240,
  );
  const command = add(
    "Modern",
    "warfare",
    "integrated-battlefield-command",
    "Integrated Battlefield Command",
    [guidance, fire, ew],
    "Coordinate modern infantry and vehicles.",
    "upgrade",
    140000,
    180,
  );
  const unmanned = add(
    "Modern",
    "warfare",
    "unmanned-warfare",
    "Advanced Unmanned Warfare",
    [loiter, ew],
    "Coordinate autonomous attack platforms.",
    "upgrade",
    160000,
    180,
  );
  add(
    "Modern",
    "warfare",
    "drone-swarms",
    "Drone Swarms",
    [command, unmanned, precision],
    "Endgame unlock: coordinated mass attack drones. Proposed high-cost infantry-pressure capability; target rules and counters remain to be designed.",
    "capstone",
    1250000,
    360,
  );
  const digital = add(
    "Modern",
    "economic",
    "digital-economy",
    "Digital Economy",
    ["modern-integrated-logistics"],
    "Foundation for present-day production and freight.",
    "unlock",
    65000,
    120,
  );
  const automated = add(
    "Modern",
    "economic",
    "automated-factories",
    "Automated Factories",
    [digital],
    "Unlock automated production.",
    "unlock",
    80000,
    120,
  );
  const routes = add(
    "Modern",
    "economic",
    "trade-route-management",
    "Trade Route Management",
    [digital],
    "Improve management of overland trade routes.",
    "upgrade",
    75000,
    120,
  );
  const advancedRail = add(
    "Modern",
    "economic",
    "advanced-rail-networks",
    "Advanced Rail Networks",
    [digital],
    "Unlock advanced rail infrastructure.",
    "unlock",
    90000,
    150,
  );
  const manufacturing = add(
    "Modern",
    "economic",
    "precision-manufacturing",
    "Precision Manufacturing",
    [automated],
    "Increase factory productivity.",
    "upgrade",
    100000,
    150,
  );
  const warehousing = add(
    "Modern",
    "economic",
    "intelligent-warehouses",
    "Intelligent Warehouses",
    [routes],
    "Increase loading throughput and storage.",
    "upgrade",
    95000,
    150,
  );
  const electric = add(
    "Modern",
    "economic",
    "freight-electrification",
    "Freight Electrification",
    [advancedRail],
    "Upgrade overland freight efficiency.",
    "upgrade",
    110000,
    180,
  );
  const regional = add(
    "Modern",
    "economic",
    "regional-coordination",
    "Regional Freight Coordination",
    [manufacturing, warehousing, electric],
    "Integrate production and overland logistics.",
    "upgrade",
    150000,
    180,
  );
  const hyper = add(
    "Modern",
    "economic",
    "hypersonic-rail",
    "Hypersonic Rail",
    [regional],
    "Endgame unlock: instant overland trade on connected eligible routes.",
    "capstone",
    1000000,
    300,
  );
  find(hyper).notes =
    "Futuristic gameplay proposal. Suggested balance guardrail: remove travel time but retain real goods, cargo capacity, loading throughput and route eligibility. Prices are placeholders.";
  const naval = add(
    "Modern",
    "naval",
    "modern-naval-systems",
    "Modern Naval Systems",
    ["modern-fleet-operations"],
    "Foundation for present-day naval research.",
    "unlock",
    65000,
    120,
  );
  const frigates = add(
    "Modern",
    "naval",
    "missile-frigates",
    "Guided-Missile Frigates",
    [naval],
    "Unlock modern surface warships.",
    "unlock",
    85000,
    150,
  );
  const transports = add(
    "Modern",
    "naval",
    "modern-transport-fleet",
    "Modern Transport Fleet",
    [naval],
    "Unlock modern troop and cargo vessels.",
    "unlock",
    80000,
    120,
  );
  const subs = add(
    "Modern",
    "naval",
    "advanced-submarine-systems",
    "Advanced Submarine Systems",
    [naval],
    "Develop modern submarine engineering.",
    "unlock",
    95000,
    150,
  );
  const missiles = add(
    "Modern",
    "naval",
    "naval-missiles",
    "Naval Missiles",
    [frigates],
    "Improve surface strike capability.",
    "upgrade",
    100000,
    150,
  );
  const hulls = add(
    "Modern",
    "naval",
    "transport-hulls",
    "Reinforced Transport Hulls",
    [transports],
    "Improve transport survivability.",
    "upgrade",
    95000,
    150,
  );
  const quiet = add(
    "Modern",
    "naval",
    "quiet-propulsion",
    "Quiet Propulsion",
    [subs],
    "Improve submarine stealth.",
    "upgrade",
    110000,
    180,
  );
  add(
    "Modern",
    "naval",
    "naval-air-defence",
    "Naval Air Defence",
    [frigates],
    "Improve fleet anti-aircraft protection.",
    "upgrade",
    100000,
    150,
  );
  add(
    "Modern",
    "naval",
    "maritime-cargo-systems",
    "Maritime Cargo Systems",
    [transports],
    "Improve sea-trade loading and cargo throughput.",
    "upgrade",
    95000,
    150,
  );
  const fleet = add(
    "Modern",
    "naval",
    "integrated-fleet-command",
    "Integrated Fleet Command",
    [missiles, hulls, quiet],
    "Coordinate the modern fleet.",
    "upgrade",
    150000,
    180,
  );
  add(
    "Modern",
    "naval",
    "nuclear-submarines",
    "Nuclear Submarines",
    [fleet, quiet],
    "Endgame unlock: nuclear-powered submarines with sustained submerged operations. Nuclear propulsion does not itself unlock nuclear missiles.",
    "capstone",
    1200000,
    360,
  );
  const unlocks = {
    frontline: rifle,
    antiCavalry: anti,
    rangedInfantry: mg,
    lightCavalry: trucks,
    heavyCavalry: apc,
    rangedCavalry: tanks,
  };
  for (const unit of draft.units.filter((u) => u.age === "EarlyModern"))
    unit.prerequisites = [unlocks[unit.role]];
  for (const unit of draft.units.filter((u) => u.age === "Napoleonic")) {
    const links = {
      frontline: grenadiers,
      antiCavalry: "",
      rangedInfantry: "earlymodern-musket-and-artillery-drill",
      lightCavalry: "earlymodern-pistoliers",
      heavyCavalry: cuirassiers,
      rangedCavalry: mounted,
    };
    if (links[unit.role]) unit.prerequisites = [links[unit.role]];
    if (unit.role === "rangedInfantry") unit.name = "Line Musketeers";
  }
  const names = [
    "Assault Infantry",
    "ATGM Teams",
    "Machine Gunners",
    "Gun Trucks",
    "Armoured Personnel Carriers",
    "Main Battle Tanks",
  ];
  draft.units.push(
    ...draft.units
      .filter((u) => u.age === "EarlyModern")
      .map((u, i) => ({
        ...structuredClone(u),
        id: `present-day-${u.role.toLowerCase()}`,
        age: "Modern",
        name: names[i],
        availability: "available" as const,
        decision: "proposed" as const,
        prerequisites: [
          u.role === "antiCavalry"
            ? guidance
            : u.role === "frontline" || u.role === "rangedInfantry"
              ? optics
              : electronics,
        ],
        notes:
          "Present-day role proposal. Light cavalry = gun truck; heavy cavalry = APC; ranged cavalry = tank.",
      })),
  );
  applyRussianTroopAvailability(draft);
  return draft;
}
