import matches from "../content/RussianTroopArtwork.json";
import type { PlannedUnit } from "./TechnologyPlan";

type ArtMetadata = {
  sheetSize: { width: number; height: number };
  animations: {
    id: string;
    file: string;
    sheetSize?: { width: number; height: number };
    frames: { x: number; y: number; width: number; height: number }[];
  }[];
};
const root = "../../../Art/Cultures/Russians/Units/";
const metadata = import.meta.glob<ArtMetadata>(
  [
    "../../../Art/Cultures/Russians/Units/*/*/animations.json",
    "../../../Art/Cultures/Russians/Units/*/*/TopDownReview/animations.json",
  ],
  { eager: true, import: "default" },
);
const sheets = import.meta.glob<string>(
  [
    "../../../Art/Cultures/Russians/Units/*/*/Idle*.png",
    "../../../Art/Cultures/Russians/Units/*/*/idle*.png",
    "../../../Art/Cultures/Russians/Units/*/*/TopDownReview/Idle*.png",
    "../../../Art/Cultures/Russians/Units/*/*/TopDownReview/idle*.png",
  ],
  { eager: true, query: "?url", import: "default" },
);
/** Explicit age/class matches prevent unrelated scout or base-culture art from
 * becoming a silent fallback. Metadata selects the current authored idle clip. */

// Planning previews can select revised art while runtime bindings remain separate.
const previewMatches: Record<string, string> = {
  ...matches,
  "EarlyModern:rangedCavalry": "PreModern/T34-85",
  "Modern:heavyCavalry": "Modern/T14",
  "Modern:lightCavalry": "Modern/Bumerang",
  "Modern:frontline": "Modern/SovietAK47Rifleman",
  "Modern:antiCavalry": "Modern/KornetOperator",
  "BronzeAge:antiCavalry": "BronzeAge/BronzeSpearman/TopDownReview",
  "Napoleonic:frontline": "EarlyModern/RusGrenadier",
  "EarlyModern:frontline": "EarlyModern/MosinNagant",
  "EarlyModern:antiCavalry": "Modern/PTRDRifleman",
  "EarlyModern:heavyCavalry": "Modern/TsarTank",
  "LateMedieval:lightCavalry": "LateMedieval/CossackRider",
  "Napoleonic:lightCavalry": "Napoleonic/CossackLancer",
  "StoneAge:rangedInfantry": "StoneAge/Javelinist/TopDownReview",
  "BronzeAge:rangedInfantry": "BronzeAge/RiverArcher/TopDownReview",
  "ClassicalAge:rangedInfantry": "ClassicalAge/RecurveArcher/TopDownReview",
};
export function troopArtwork(unit: PlannedUnit, iconSize = 76) {
  const folder = previewMatches[`${unit.age}:${unit.role}`];
  if (!folder) return undefined;
  const data = metadata[`${root}${folder}/animations.json`];
  // This selected still is ready before its animation metadata is authored.
  if (!data && folder === "Modern/Bumerang") {
    const url = sheets[`${root}${folder}/Idle-v1.png`];
    if (!url) return undefined;
    const width = (iconSize * 1024) / 1536;
    return {
      url,
      width,
      height: iconSize,
      left: (iconSize - width) / 2,
      top: 0,
    };
  }
  const idle = data?.animations.find((a) => a.id === "idle");
  const frame = idle?.frames[0];
  const url = idle ? sheets[`${root}${folder}/${idle.file}`] : undefined;
  if (!url || !frame) return undefined;
  const sheetSize = idle.sheetSize ?? data.sheetSize;
  const scale = iconSize / Math.max(frame.width, frame.height);
  return {
    url,
    width: sheetSize.width * scale,
    height: sheetSize.height * scale,
    left: (iconSize - frame.width * scale) / 2 - frame.x * scale,
    top: (iconSize - frame.height * scale) / 2 - frame.y * scale,
  };
}
