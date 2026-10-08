import type { PlannedUnit } from "./TechnologyPlan";

type ArtMetadata = {
  sheetSize: { width: number; height: number };
  animations: {
    id: string;
    file: string;
    frames: { x: number; y: number; width: number; height: number }[];
  }[];
};
const root = "../../../Art/Cultures/Russians/Units/";
const metadata = import.meta.glob<ArtMetadata>(
  "../../../Art/Cultures/Russians/Units/*/*/animations.json",
  { eager: true, import: "default" },
);
const sheets = import.meta.glob<string>(
  "../../../Art/Cultures/Russians/Units/*/*/Idle*.png",
  { eager: true, query: "?url", import: "default" },
);
/** Explicit age/class matches prevent unrelated scout or base-culture art from
 * becoming a silent fallback. Metadata selects the current authored idle clip. */
const matches: Record<string, string> = {
  "StoneAge:frontline": "StoneAge/Clubman",
  "StoneAge:rangedInfantry": "StoneAge/Javelinist",
  "StoneAge:lightCavalry": "StoneAge/MountedSpearman",
  "BronzeAge:frontline": "BronzeAge/BronzeAxeman",
  "BronzeAge:antiCavalry": "BronzeAge/BronzeSpearman",
  "BronzeAge:rangedInfantry": "BronzeAge/RiverArcher",
  "BronzeAge:lightCavalry": "BronzeAge/LightCavalry",
  "ClassicalAge:lightCavalry": "ClassicalAge/LightCavalry",
  "ClassicalAge:frontline": "ClassicalAge/ShieldWarrior",
  "ClassicalAge:rangedInfantry": "ClassicalAge/RecurveArcher",
  "ClassicalAge:rangedCavalry": "ClassicalAge/HorseArcher",
  "EarlyMedieval:rangedInfantry": "EarlyMedieval/RusBowMan",
  "LateMedieval:rangedInfantry": "LateMedieval/RusCrossbowman",
};
export function troopArtwork(unit: PlannedUnit) {
  const folder = matches[`${unit.age}:${unit.role}`];
  if (!folder) return undefined;
  const data = metadata[`${root}${folder}/animations.json`];
  const idle = data?.animations.find((a) => a.id === "idle");
  const frame = idle?.frames[0];
  const url = idle ? sheets[`${root}${folder}/${idle.file}`] : undefined;
  if (!url || !frame) return undefined;
  return {
    url,
    width: (data.sheetSize.width / frame.width) * 76,
    height: (data.sheetSize.height / frame.height) * 76,
    left: (-frame.x / frame.width) * 76,
    top: (-frame.y / frame.height) * 76,
  };
}
