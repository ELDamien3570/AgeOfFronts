/** Stable palette keys shared by lobby validation and client presentation. */
export const FACTION_PALETTE = [
  { name: "Teal", hex: "#62d5cc" },
  { name: "Coral", hex: "#ee776b" },
  { name: "Gold", hex: "#edbb62" },
  { name: "Lavender", hex: "#b39aeb" },
  { name: "Lime", hex: "#96c776" },
  { name: "Rose", hex: "#e39abd" },
  { name: "Blue", hex: "#6599e8" },
  { name: "Copper", hex: "#b5805e" },
  { name: "Silver", hex: "#bec5df" },
  { name: "Sky", hex: "#59b9f0" },
  { name: "Crimson", hex: "#c94452" },
  { name: "Olive", hex: "#b8bf59" },
  { name: "Ivory", hex: "#e7dbc1" },
  { name: "Ocean", hex: "#3f7ea8" },
  { name: "Peach", hex: "#e89c7c" },
  { name: "Amber", hex: "#caa52f" },
  { name: "Orchid", hex: "#cd73dc" },
  { name: "Slate", hex: "#a3b5bd" },
  { name: "Orange", hex: "#ef8e36" },
  { name: "Forest", hex: "#4b9664" },
] as const;

export function validFactionColor(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    Number(value) >= 0 &&
    Number(value) < FACTION_PALETTE.length
  );
}
