import { PLAYABLE_MAPS, heightmapDimensions, isProceduralMap } from "../../content/Maps";
import type { LobbyMapId } from "../../lobby/LobbyRules";

export interface LobbyMapCard {
  id: LobbyMapId;
  name: string;
  number: string;
  terrain: string;
  description: string;
  image: string;
  imageCredit: string;
  sourceWidth: number;
  sourceHeight: number;
}

const presentation: Record<
  LobbyMapId,
  { terrain: string; description: string }
> = {
  "heightmap-test1": {
    terrain: "Coasts, highlands & mountain passes",
    description: "Read the terrain. Turn high ground into an advantage.",
  },
  "amazon-river": {
    terrain: "Rainforest, tributaries & Andean highlands",
    description:
      "Follow the Amazon across a wide forest basin. First map review.",
  },
  africa: {
    terrain: "Southern Africa & Madagascar",
    description:
      "Cross dry interiors, wooded uplands and the eastern coast. First terrain review.",
  },
  "old-world": {
    terrain: "Africa, Eurasia & Australia",
    description: "Cross vast deserts, mountain ranges and connected seas.",
  },
  "new-world": {
    terrain: "The Americas, mountain ranges & great river basins",
    description:
      "Cross northern forests, dry plateaus and tropical riverlands.",
  },
  "valles-kairulia": {
    terrain: "Island chains, sheltered seas & rugged coasts",
    description:
      "Sail between islands and cross wooded ridges and dry lowlands.",
  },
  "down-unda": {
    terrain: "Australia, Southeast Asia & island seas",
    description:
      "Cross dry interiors, tropical forests and major river basins.",
  },
  "middle-east": {
    terrain: "Deserts, river valleys & rugged highlands",
    description:
      "Follow the Nile, Tigris and Euphrates through arid landscapes.",
  },
  "black-forest": {
    terrain: "Dense conifers, open glades & winding woodland paths",
    description: "A new seeded forest each match. Advance quickly through clearings or push through slower woodland.",
  },
  migration: {
    terrain: "River-cut mainlands, coastal islands & winding sea channels",
    description: "Choose an island foothold or settle a mainland. Larger maps add more small islands; each seed varies the coasts, rivers and mainland splits.",
  },
};

export const LOBBY_MAPS: readonly LobbyMapCard[] = PLAYABLE_MAPS.map(
  (map, index) => ({
    ...map,
    ...presentation[map.id],
    number: String(index + 1).padStart(2, "0"),
    image: `/maps/${map.assetRoot}/lobby-preview.png`,
    imageCredit: isProceduralMap(map.id) ? "Procedural terrain · AgeOfFronts" : "Elevation · Mapzen / Nextzen and others",
  }),
);

export function lobbyMapDimensions(map: LobbyMapCard, size: number) {
  return heightmapDimensions(size, map.sourceWidth, map.sourceHeight);
}
