import type { BuildingType, Player, SquadType } from "../Protocol";
import type { Tree } from "./Definitions";

export type AiPersonalityId =
  | "balanced"
  | "conqueror"
  | "warden"
  | "builder"
  | "merchant"
  | "scholar"
  | "rider"
  | "skirmisher"
  | "engineer"
  | "admiral"
  | "diplomat";

export interface AiPersonality {
  readonly id: AiPersonalityId;
  readonly name: string;
  readonly description: string;
  readonly recruitment: readonly [number, number, number];
  readonly raidSlots: number; // Out of eight squads; local consolidation wins.
  readonly raidAfterTicks: number;
  readonly minimumRaidSquads: number;
  readonly homeRadiusPercent: number;
  readonly interceptRange: number;
  readonly replenishBelow: number;
  readonly researchOrder: readonly Tree[];
  readonly buildingOrder: readonly BuildingType[];
  readonly economicCopies: number;
  readonly squadsPerWarship: number;
  readonly siegeCopies: number;
  readonly diplomacy: {
    readonly maximumAllies: number;
    readonly minimumPartnerLandRatio: number;
    readonly offerIntervalTicks: number;
  };
}

const LINES: readonly SquadType[] = ["infantry", "archer", "cavalry"];

// Compare deficits rather than rolling each recruit. Unavailable lines still
// fall through to legal producers; preferences never bypass the command rules.
export function recruitmentOrder(
  profile: AiPersonality,
  counts: Readonly<Record<SquadType, number>>,
): SquadType[] {
  return [...LINES].sort(
    (a, b) =>
      (counts[a] + 1) * profile.recruitment[LINES.indexOf(b)] -
        (counts[b] + 1) * profile.recruitment[LINES.indexOf(a)] ||
      LINES.indexOf(a) - LINES.indexOf(b),
  );
}

export function buildingPriority(
  profile: AiPersonality,
  types: readonly BuildingType[],
): BuildingType[] {
  return [
    ...profile.buildingOrder.filter((type) => types.includes(type)),
    ...types.filter((type) => !profile.buildingOrder.includes(type)),
  ];
}

export function economicBuildingTarget(
  profile: AiPersonality,
  type: BuildingType,
  squads: number,
): number {
  if (["factory", "blacksmith", "armory", "arms-factory"].includes(type))
    return Math.min(8, Math.max(2, Math.ceil(squads / 12)));
  return type === "city" || type === "port" ? profile.economicCopies : 1;
}

export function acceptsAlliance(
  profile: AiPersonality,
  player: Pick<Player, "land">,
  proposer: Pick<Player, "land" | "kind" | "eliminated">,
  existingAllies: number,
  proposerUnderPenalty: boolean,
): boolean {
  return (
    proposer.kind === "regular" &&
    !proposer.eliminated &&
    !proposerUnderPenalty &&
    existingAllies < profile.diplomacy.maximumAllies &&
    proposer.land >=
      Math.max(1, player.land) * profile.diplomacy.minimumPartnerLandRatio
  );
}
