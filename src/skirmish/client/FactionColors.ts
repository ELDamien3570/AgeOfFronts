import { MAX_TRIBES } from "../FactionRules";

function tribeColor(index: number): string {
  const hue = ((index * 137.508 + 35) % 360) / 60,
    chroma = 0.3,
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
      Math.round((channel + 0.35) * 255)
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
  ...Array.from({ length: MAX_TRIBES }, (_, index) => tribeColor(index)),
];
