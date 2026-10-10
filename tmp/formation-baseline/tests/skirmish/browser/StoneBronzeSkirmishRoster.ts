import { demoActorMemberScale } from "./DemoActorCalibration";
import type { TroopActorDefinition } from "./StoneAgeDemoActors";

/** Artwork mapping only: recruitment prices, equipment, and combat remain the normal roster. */
export const STONE_BRONZE_ACTORS: readonly TroopActorDefinition[] = [
  {
    name: "Clubman",
    age: "StoneAge",
    mounted: false,
    ranged: false,
    memberScale: demoActorMemberScale("Clubman"),
  },
  {
    name: "Javelinist",
    age: "StoneAge",
    mounted: false,
    ranged: true,
    memberScale: demoActorMemberScale("Javelinist"),
  },
  {
    name: "Scout",
    age: "StoneAge",
    mounted: true,
    ranged: false,
    memberScale: demoActorMemberScale("Scout"),
  },
  // Approximate first-idle shoulder spans, excluding shields/weapons/mounts.
  {
    name: "BronzeAxeman",
    age: "BronzeAge",
    mounted: false,
    ranged: false,
    memberScale: (0.24 * 340) / 300,
  },
  {
    name: "RiverArcher",
    age: "BronzeAge",
    mounted: false,
    ranged: true,
    memberScale: (0.24 * 340) / 240,
  },
  {
    name: "LightCavalry",
    age: "BronzeAge",
    mounted: true,
    ranged: false,
    memberScale: (0.24 * 340) / 164,
  },
];
export const STONE_BRONZE_ARTWORK = new Map(
  STONE_BRONZE_ACTORS.map((actor) => [
    `${actor.age.toLowerCase()}-${actor.mounted ? "cavalry" : actor.ranged ? "archer" : "infantry"}`,
    actor,
  ]),
);
export const STONE_BRONZE_OPTIONS = {
  maximumAge: "BronzeAge",
  formationLocomotion: true,
  formationReorientation: true,
  formationFreeTravel: true,
} as const;
