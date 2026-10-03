import { MAX_PLAYER_ID, MAX_TRIBES } from "../FactionRules";
import { FACTION_PALETTE, validFactionColor } from "../lobby/FactionPalette";
import type { Player } from "../Protocol";

function tribeColor(index: number): string {
  return paletteColor(index, 35, 0.3, 0.35);
}
// Regular factions past the 20 hand-picked colors: brighter, distinct hues.
function regularColor(index: number): string {
  return paletteColor(index, 10, 0.55, 0.25);
}
function paletteColor(
  index: number,
  hueOffset: number,
  chroma: number,
  lift: number,
): string {
  const hue = ((index * 137.508 + hueOffset) % 360) / 60,
    intermediate = chroma * (1 - Math.abs((hue % 2) - 1)),
    channels =
      hue < 1
        ? [chroma, intermediate, 0]
        : hue < 2
          ? [intermediate, chroma, 0]
          : hue < 3
            ? [0, chroma, intermediate]
            : hue < 4
              ? [0, intermediate, chroma]
              : hue < 5
                ? [intermediate, 0, chroma]
                : [chroma, 0, intermediate];
  return `#${channels
    .map((channel) =>
      Math.round((channel + lift) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// Existing regular factions retain their colors. Minor tribes use a separate,
// subdued palette, covering every owner ID without renderer-specific rules.
export const COLORS = [
  "#667e77",
  ...FACTION_PALETTE.map((entry) => entry.hex),
  ...Array.from({ length: MAX_PLAYER_ID - 20 }, (_, index) =>
    tribeColor(index % MAX_TRIBES),
  ),
];
export const RGB = COLORS.map(hexRgb);
export const BUILDING_PAD_COLORS = new Map<string, string>();
export let factionColorRevision = 0;
let assignedRoster = "";
function hexRgb(color: string): number[] {
  return [1, 3, 5].map((offset) =>
    parseInt(color.slice(offset, offset + 2), 16),
  );
}
function updateDerivedColors(): void {
  BUILDING_PAD_COLORS.clear();
  for (const [index, color] of COLORS.entries()) {
    RGB[index] = hexRgb(color);
    BUILDING_PAD_COLORS.set(
      color,
      `rgb(${RGB[index].map((channel) => Math.round(channel + (255 - channel) * 0.22)).join(",")})`,
    );
  }
}
updateDerivedColors();

/** Assign once per roster/composition/reservation change; all derived colors
 * update together. Explicit human choices reserve palette entries before AI. */
export function assignFactionColors(
  players: readonly Pick<Player, "id" | "kind" | "colorKind" | "colorIndex">[],
): void {
  const ordered = [...players].sort((a, b) => a.id - b.id);
  const roster = ordered
    .map((p) => `${p.id}:${p.colorKind ?? p.kind}:${p.colorIndex ?? "auto"}`)
    .join(",");
  if (roster === assignedRoster) return;
  assignedRoster = roster;
  const reserved = new Set(
    ordered
      .filter((p) => validFactionColor(p.colorIndex))
      .map((p) => p.colorIndex!),
  );
  let regular = 0,
    tribe = 0;
  const used = new Set(
    [...reserved].map((index) => FACTION_PALETTE[index].hex as string),
  );
  for (const player of ordered) {
    if (validFactionColor(player.colorIndex)) {
      COLORS[player.id] = FACTION_PALETTE[player.colorIndex].hex;
      continue;
    }
    let color: string;
    do {
      if ((player.colorKind ?? player.kind) === "tribe")
        color = tribeColor(tribe++);
      else {
        color =
          regular < FACTION_PALETTE.length
            ? FACTION_PALETTE[regular].hex
            : regularColor(regular - FACTION_PALETTE.length);
        regular++;
      }
    } while (used.has(color));
    used.add(color);
    COLORS[player.id] = color;
  }
  updateDerivedColors();
  factionColorRevision++;
}
