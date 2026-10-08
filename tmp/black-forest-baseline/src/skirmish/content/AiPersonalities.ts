import type { Player } from "../Protocol";
import type { AiPersonality, AiPersonalityId } from "../domain/AiPersonality";

const base: AiPersonality = {
  id: "balanced",
  name: "Marshal",
  description:
    "Builds a mixed army, consolidates its homeland and commits measured raids.",
  recruitment: [1, 1, 1],
  raidSlots: 2,
  raidAfterTicks: 1200,
  minimumRaidSquads: 8,
  homeRadiusPercent: 100,
  interceptRange: 20,
  replenishBelow: 650,
  researchOrder: ["economic", "warfare", "naval"],
  buildingOrder: ["city", "barracks", "factory", "archery", "stables", "port"],
  economicCopies: 1,
  squadsPerWarship: 8,
  siegeCopies: 2,
  diplomacy: {
    maximumAllies: 2,
    minimumPartnerLandRatio: 0.8,
    offerIntervalTicks: 0,
  },
};

function personality(
  id: AiPersonalityId,
  name: string,
  description: string,
  changes: Partial<Omit<AiPersonality, "id" | "name" | "description">>,
): AiPersonality {
  return Object.freeze({ ...base, ...changes, id, name, description });
}

export const AI_PERSONALITIES: readonly AiPersonality[] = [
  Object.freeze(base),
  personality(
    "admiral",
    "Sea Lord",
    "Prioritizes ports and naval research, supports a larger warship fleet and consolidates land with a mixed army.",
    {
      squadsPerWarship: 6,
      economicCopies: 2,
      researchOrder: ["naval", "warfare", "economic"],
      buildingOrder: [
        "barracks",
        "port",
        "factory",
        "city",
        "archery",
        "stables",
      ],
      diplomacy: {
        maximumAllies: 1,
        minimumPartnerLandRatio: 0.9,
        offerIntervalTicks: 0,
      },
    },
  ),
  personality(
    "conqueror",
    "Conqueror",
    "Favors infantry and warfare research; sends larger raids once its home frontier is secure.",
    {
      recruitment: [3, 2, 2],
      raidSlots: 3,
      raidAfterTicks: 900,
      researchOrder: ["warfare", "economic", "naval"],
      buildingOrder: [
        "barracks",
        "factory",
        "archery",
        "city",
        "stables",
        "port",
      ],
      diplomacy: {
        maximumAllies: 1,
        minimumPartnerLandRatio: 1.25,
        offerIntervalTicks: 0,
      },
    },
  ),
  personality(
    "warden",
    "Warden",
    "Consolidates a wider homeland, favors infantry and replenishes earlier; launches smaller raids.",
    {
      recruitment: [3, 2, 1],
      raidSlots: 1,
      homeRadiusPercent: 115,
      replenishBelow: 750,
      buildingOrder: [
        "city",
        "barracks",
        "archery",
        "factory",
        "stables",
        "port",
      ],
      diplomacy: {
        maximumAllies: 2,
        minimumPartnerLandRatio: 0.65,
        offerIntervalTicks: 2400,
      },
    },
  ),
  personality(
    "builder",
    "Steward",
    "Prioritizes cities and production, fields infantry and protects a compact, productive homeland.",
    {
      recruitment: [3, 2, 1],
      raidSlots: 1,
      economicCopies: 2,
      homeRadiusPercent: 110,
      buildingOrder: [
        "city",
        "factory",
        "barracks",
        "blacksmith",
        "armory",
        "archery",
        "stables",
        "port",
      ],
      diplomacy: {
        maximumAllies: 2,
        minimumPartnerLandRatio: 0.65,
        offerIntervalTicks: 2400,
      },
    },
  ),
  personality(
    "merchant",
    "Merchant Prince",
    "Invests in cities, factories and ports, favors ranged troops and supports a larger coastal fleet.",
    {
      recruitment: [2, 3, 1],
      economicCopies: 2,
      raidSlots: 1,
      squadsPerWarship: 6,
      researchOrder: ["economic", "naval", "warfare"],
      buildingOrder: [
        "factory",
        "city",
        "port",
        "barracks",
        "archery",
        "stables",
      ],
      diplomacy: {
        maximumAllies: 3,
        minimumPartnerLandRatio: 0.5,
        offerIntervalTicks: 1800,
      },
    },
  ),
  personality(
    "scholar",
    "Innovator",
    "Funds economic research and workshops first while retaining a balanced army and normal troop refits.",
    {
      recruitment: [2, 3, 2],
      economicCopies: 2,
      buildingOrder: [
        "factory",
        "city",
        "barracks",
        "blacksmith",
        "armory",
        "arms-factory",
        "archery",
        "stables",
        "port",
      ],
      diplomacy: {
        maximumAllies: 2,
        minimumPartnerLandRatio: 0.6,
        offerIntervalTicks: 2400,
      },
    },
  ),
  personality(
    "rider",
    "Horse Lord",
    "Favors cavalry and stables, then uses larger raiding groups after consolidating its starting land.",
    {
      recruitment: [2, 1, 3],
      raidSlots: 3,
      raidAfterTicks: 1000,
      researchOrder: ["warfare", "economic", "naval"],
      buildingOrder: [
        "barracks",
        "stables",
        "factory",
        "city",
        "archery",
        "port",
      ],
      diplomacy: {
        maximumAllies: 1,
        minimumPartnerLandRatio: 1,
        offerIntervalTicks: 0,
      },
    },
  ),
  personality(
    "skirmisher",
    "Ranger",
    "Favors ranged troops, pursues nearby enemies selectively and keeps more squads on local expansion.",
    {
      recruitment: [2, 3, 1],
      interceptRange: 16,
      replenishBelow: 700,
      buildingOrder: [
        "barracks",
        "archery",
        "city",
        "factory",
        "stables",
        "port",
      ],
      diplomacy: {
        maximumAllies: 2,
        minimumPartnerLandRatio: 0.7,
        offerIntervalTicks: 2400,
      },
    },
  ),
  personality(
    "engineer",
    "Siege Engineer",
    "Prioritizes warfare and siege production, supports infantry with extra siege specialists and methodical raids.",
    {
      recruitment: [3, 2, 1],
      siegeCopies: 3,
      researchOrder: ["warfare", "economic", "naval"],
      buildingOrder: [
        "barracks",
        "factory",
        "siege-workshop",
        "blacksmith",
        "city",
        "archery",
        "stables",
        "port",
      ],
      diplomacy: {
        maximumAllies: 1,
        minimumPartnerLandRatio: 0.9,
        offerIntervalTicks: 0,
      },
    },
  ),
  personality(
    "diplomat",
    "Coalition Builder",
    "Welcomes more viable allies, renews treaties and fields a mixed army behind a wider consolidated homeland.",
    {
      raidSlots: 1,
      homeRadiusPercent: 110,
      diplomacy: {
        maximumAllies: 3,
        minimumPartnerLandRatio: 0.4,
        offerIntervalTicks: 1200,
      },
    },
  ),
];
export const AI_PERSONALITY = new Map(AI_PERSONALITIES.map((p) => [p.id, p]));
export function personalityOf(
  player: Pick<Player, "personalityId">,
): AiPersonality {
  return AI_PERSONALITY.get(player.personalityId ?? "balanced") ?? base;
}
