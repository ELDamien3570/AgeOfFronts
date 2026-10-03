import { describe, expect, it } from "vitest";
import {
  BUILDING_PAD_COLORS,
  COLORS,
  RGB,
  assignFactionColors,
  factionColorRevision,
} from "../../src/skirmish/client/FactionColors";
import { FACTION_PALETTE } from "../../src/skirmish/lobby/FactionPalette";

describe("synchronized faction palette", () => {
  it("keeps promoted tribe colors consistent for reconnects and new clients", () => {
    const roster = [
      { id: 1, kind: "regular" as const },
      { id: 2, kind: "tribe" as const, colorKind: "tribe" as const },
      { id: 3, kind: "regular" as const },
    ];
    assignFactionColors(roster);
    const initial = [COLORS[1], COLORS[2], COLORS[3]];
    const promoted = roster.map((p) => ({ ...p, kind: "regular" as const }));
    assignFactionColors(promoted);
    expect([COLORS[1], COLORS[2], COLORS[3]]).toEqual(initial);
    assignFactionColors([{ id: 1, kind: "tribe" }]); // An unrelated match changes the module registry.
    assignFactionColors(promoted); // A freshly joined client needs no initial snapshot history.
    expect([COLORS[1], COLORS[2], COLORS[3]]).toEqual(initial);
    assignFactionColors(
      roster.map((p) => ({ ...p, kind: "regular", colorKind: "regular" })),
    );
    expect(COLORS[2]).toBe(FACTION_PALETTE[1].hex);
  });
  it("reassigns identical IDs with changed kinds and updates numeric colors and pads", () => {
    assignFactionColors([
      { id: 1, kind: "regular" },
      { id: 2, kind: "regular" },
    ]);
    const regular = COLORS[2];
    assignFactionColors([
      { id: 1, kind: "regular" },
      { id: 2, kind: "tribe" },
    ]);
    expect(COLORS[2]).not.toBe(regular);
    expect(RGB[2]).toEqual(
      [1, 3, 5].map((offset) =>
        parseInt(COLORS[2].slice(offset, offset + 2), 16),
      ),
    );
    expect(BUILDING_PAD_COLORS.get(COLORS[2])).toBe(
      `rgb(${RGB[2].map((c) => Math.round(c + (255 - c) * 0.22)).join(",")})`,
    );
  });
  it("reserves explicit colors before automatic factions and is stable under roster reorder", () => {
    const roster = [
      { id: 1, kind: "regular" as const },
      { id: 2, kind: "regular" as const, colorIndex: 0 },
      { id: 3, kind: "tribe" as const },
    ];
    assignFactionColors(roster);
    expect(COLORS[2]).toBe(FACTION_PALETTE[0].hex);
    expect(COLORS[1]).not.toBe(COLORS[2]);
    expect(new Set(roster.map((p) => COLORS[p.id])).size).toBe(3);
    const revision = factionColorRevision;
    assignFactionColors([...roster].reverse());
    expect(factionColorRevision).toBe(revision);
    assignFactionColors(roster.map((p) => ({ ...p, colorIndex: undefined })));
    expect(COLORS[1]).toBe(FACTION_PALETTE[0].hex);
  });
});
