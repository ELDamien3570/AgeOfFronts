import { MAX_PLAYER_ID, MAX_TRIBES } from "../FactionRules";
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
  "#62d5cc",
  "#ee776b",
  "#edbb62",
  "#b39aeb",
  "#96c776",
  "#e39abd",
  "#6599e8",
  "#b5805e",
  "#bec5df",
  "#59b9f0",
  "#c94452",
  "#b8bf59",
  "#e7dbc1",
  "#3f7ea8",
  "#e89c7c",
  "#caa52f",
  "#cd73dc",
  "#a3b5bd",
  "#ef8e36",
  "#4b9664",
  ...Array.from({ length: MAX_PLAYER_ID - 20 }, (_, index) =>
    tribeColor(index % MAX_TRIBES),
  ),
];
const HAND_PICKED_REGULAR = COLORS.slice(1, 21);
let assignedRoster = "";

/**
 * Colors by faction kind, by player ID. Regular factions take the hand-picked
 * palette in order, then generated bright colors; tribes take the subdued
 * palette in order. Updates COLORS in place so every renderer lookup by ID
 * stays a plain array read. Cheap to call per snapshot.
 */
export function assignFactionColors(
  players: readonly Pick<Player, "id" | "kind">[],
): void {
  // Keyed by IDs only: a promoted tribe keeps the color it started with.
  const roster = players.map((p) => p.id).join(",");
  if (roster === assignedRoster) return;
  assignedRoster = roster;
  let regular = 0,
    tribe = 0;
  for (const player of [...players].sort((a, b) => a.id - b.id))
    COLORS[player.id] =
      player.kind === "tribe"
        ? tribeColor(tribe++)
        : regular < HAND_PICKED_REGULAR.length
          ? HAND_PICKED_REGULAR[regular++]
          : regularColor(regular++ - HAND_PICKED_REGULAR.length);
}
