import { describe, expect, it } from "vitest";
import {
  LAB_ENTITIES,
  makeDraft,
  validateDraft,
} from "../../src/skirmish/client/lab/UnitLabModel";
import {
  SHEET_GROUPS,
  readSheetStat,
  unitSheetColumns,
  visibleSheetColumns,
  writeSheetStat,
} from "../../src/skirmish/client/lab/UnitLabSheet";
import type { AttackProfile } from "../../src/skirmish/domain/Definitions";

const drafts = () => LAB_ENTITIES.map(makeDraft);
describe("unit spreadsheet groups", () => {
  it("keeps all numeric stats in contiguous ordered groups, with derived costs last", () => {
    const rows = drafts(),
      columns = unitSheetColumns(rows, "all");
    expect([...new Set(columns.map((c) => c.group))]).toEqual([
      ...SHEET_GROUPS,
    ]);
    expect(
      columns.slice(-4).every((c) => c.group === "Derived costs" && c.readonly),
    ).toBe(true);
    expect(columns.some((c) => c.path.startsWith("estimated."))).toBe(false);
    expect(columns.some((c) => c.path.startsWith("attack."))).toBe(false);
    expect(
      columns.some((c) =>
        [
          "cost.reserves",
          "cost.items.horses",
          "formationRecipe.reserveCost",
        ].includes(c.path),
      ),
    ).toBe(false);
    expect(
      unitSheetColumns([...rows].reverse(), "all").map((c) => c.path),
    ).toEqual(columns.map((c) => c.path));
    expect(
      columns
        .filter((c) => c.group === "Melee weapons")
        .slice(0, 3)
        .map((c) => c.path),
    ).toEqual(["meleeAttack.damage", "meleeAttack.rpm", "meleeAttack.range"]);
    expect(
      columns
        .filter((c) => c.group === "Bonuses")
        .some((c) => c.title === "Melee vs infantry"),
    ).toBe(true);
    expect(
      columns
        .filter((c) => c.group === "Bonuses")
        .some((c) => c.title === "Ranged vs infantry"),
    ).toBe(true);
  });
  it.each(["core", "melee", "ranged", "bonuses"])(
    "preserves the %s filter with costs at the end",
    (mode) => {
      const columns = unitSheetColumns(drafts(), mode);
      expect(columns.slice(-4).every((c) => c.group === "Derived costs")).toBe(
        true,
      );
      const groups = [...new Set(columns.slice(0, -4).map((c) => c.group))];
      expect(groups).toEqual(
        mode === "core"
          ? ["Squad", "Defence", "Movement", "Recruitment"]
          : [
              mode === "melee"
                ? "Melee weapons"
                : mode === "ranged"
                  ? "Ranged weapons"
                  : "Bonuses",
            ],
      );
    },
  );
  it("collapses only the requested columns into read-only placeholders and restores their original positions", () => {
    const rows = drafts(),
      before = structuredClone(rows);
    const all = unitSheetColumns(rows, "all");
    const visible = visibleSheetColumns(all, new Set(["Squad", "Defence"]));
    expect(visible[0]).toMatchObject({
      group: "Squad",
      readonly: true,
      collapsedCount: all.filter((c) => c.group === "Squad").length,
    });
    expect(visible[1]).toMatchObject({ group: "Defence", readonly: true });
    expect(visible.filter((c) => !c.collapsedCount)).toEqual(
      all.filter((c) => c.group !== "Squad" && c.group !== "Defence"),
    );
    expect(visibleSheetColumns(all, new Set())).toEqual(all);
    expect(rows).toEqual(before);
  });
  it("reads and edits a primary-only weapon through its channel without creating a second weapon", () => {
    const rows = drafts().filter(
      (d) =>
        !d.definition.meleeAttack &&
        !d.definition.rangedAttack &&
        d.definition.attack,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const original = (row.definition.attack as AttackProfile).damage;
      const channel = (row.definition.attack as AttackProfile).channel;
      const path = `${channel}Attack.damage`;
      expect(readSheetStat(row, path)).toBe(original);
      writeSheetStat(row, path, original + 1);
      validateDraft(row.definition);
      expect((row.definition.attack as AttackProfile).damage).toBe(
        original + 1,
      );
      expect(row.definition.meleeAttack).toBeUndefined();
      expect(row.definition.rangedAttack).toBeUndefined();
      expect(row.entity.definition.attack).not.toEqual(row.definition.attack);
    }
  });
});
