import { secondsToTicks } from '../Protocol';
import type { AiPersonalityId } from "../domain/AiPersonality";
import type { UnitDefinition } from "../domain/Definitions";
import type { BuildingType } from "../Protocol";
export interface AiDoctrine {
  contract: string;
  reservePercent: number;
  assemblyTicks: number;
  commitmentTicks: number;
  /** Local advantage at which the engaged army advances (T-b; ENGAGEMENT.advanceAbove for humans). */
  advanceAbove: number;
  preferredRoles: readonly UnitDefinition["role"][];
  engagement: "attack" | "fire-retreat" | "flank-left" | "flank-right";
  economy: Partial<Record<BuildingType, number>>;
  navalWeight: number;
  minimumHealth: number;
}
/** T-b (owner default): conqueror and rider advance at even odds (others 1.15). */
const AGGRESSIVE_ADVANCE_ABOVE = 1.0;
const balanced: AiDoctrine = {
  contract: "Mixed supported force with a mobile reserve",
  reservePercent: 25,
  assemblyTicks: secondsToTicks(8),
  commitmentTicks: secondsToTicks(60),
  advanceAbove: 1.15,
  preferredRoles: ["frontline", "ranged", "mounted"],
  engagement: "attack",
  economy: { city: 100, factory: 100 },
  navalWeight: 100,
  minimumHealth: 700,
};
function doctrine(changes: Partial<AiDoctrine>): AiDoctrine {
  return Object.freeze({ ...balanced, ...changes });
}
/** Policy choices only: each profile pays and executes through the same commands. */
export const AI_DOCTRINES: Readonly<Record<AiPersonalityId, AiDoctrine>> =
  Object.freeze({
    balanced: doctrine({}),
    conqueror: doctrine({
      contract:
        "Earlier concentrated offensives while retaining a small reserve",
      reservePercent: 15,
      assemblyTicks: secondsToTicks(4),
      commitmentTicks: secondsToTicks(80),
      advanceAbove: AGGRESSIVE_ADVANCE_ABOVE,
      economy: { barracks: 125, depot: 125 },
    }),
    warden: doctrine({
      contract:
        "Staff connected defensive regions before measured counterattack",
      reservePercent: 45,
      assemblyTicks: secondsToTicks(12),
      economy: { city: 125, trench: 150, tower: 150 },
    }),
    builder: doctrine({
      contract:
        "Protect infrastructure and expand productive capacity before commitment",
      reservePercent: 40,
      assemblyTicks: secondsToTicks(13),
      economy: { city: 145, factory: 140, blacksmith: 125 },
    }),
    merchant: doctrine({
      contract:
        "Protect viable production and existing markets with reserve forces",
      reservePercent: 40,
      assemblyTicks: secondsToTicks(11),
      economy: { factory: 155, port: 140 },
      navalWeight: 125,
    }),
    scholar: doctrine({
      contract:
        "Wait for a healthy supported force and use researched capabilities",
      reservePercent: 35,
      assemblyTicks: secondsToTicks(13),
      minimumHealth: 850,
      economy: { city: 120, armory: 130 },
    }),
    rider: doctrine({
      contract: "Stage reachable mounted wings with infantry support",
      reservePercent: 20,
      assemblyTicks: secondsToTicks(5),
      preferredRoles: ["mounted", "frontline", "ranged"],
      engagement: "flank-left",
      advanceAbove: AGGRESSIVE_ADVANCE_ABOVE,
      economy: { stables: 150 },
    }),
    skirmisher: doctrine({
      contract: "Concentrate ranged squads and use authored fire-and-retreat",
      reservePercent: 30,
      assemblyTicks: secondsToTicks(6),
      preferredRoles: ["ranged", "frontline", "mounted"],
      engagement: "fire-retreat",
      economy: { archery: 145 },
    }),
    engineer: doctrine({
      contract: "Support siege and artillery through a viable equipment chain",
      reservePercent: 30,
      assemblyTicks: secondsToTicks(10),
      preferredRoles: ["siege", "artillery", "frontline", "ranged"],
      economy: { "siege-workshop": 150, blacksmith: 140, factory: 130 },
    }),
    admiral: doctrine({
      contract:
        "Fund reachable seas; retain a normal land fallback when landlocked",
      reservePercent: 35,
      assemblyTicks: secondsToTicks(9),
      economy: { port: 150 },
      navalWeight: 165,
    }),
    diplomat: doctrine({
      contract:
        "Maintain a strong reserve and commit only to selected hostile objectives",
      reservePercent: 45,
      assemblyTicks: secondsToTicks(14),
      economy: { city: 125, port: 110 },
      navalWeight: 100,
    }),
  });
