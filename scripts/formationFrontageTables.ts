import { readFileSync, writeFileSync } from "node:fs";
import {
  formationDoctrine,
  type FormationShape,
} from "../src/skirmish/domain/FormationGeometry";
import { frontageSummary } from "../src/skirmish/domain/FormationProfiles";
import { FIXED } from "../src/skirmish/Protocol";
const recipes = JSON.parse(
  readFileSync("skirmish/plans/formation-recipes.json", "utf8"),
).recipes;
const lines = [
  "# Phase 6A current frontage tables",
  "",
  "Generated from current active doctrines/recipes. Widths include body dimensions and authored pitch, before cosmetic crowd jitter. Square/wedge/column stay fixed templates. Historical approval tables remain separate.",
  "",
  "Small-count unavailable shapes are shown explicitly. Intervals are a union, not a promise that all intermediate widths are legal. Final authority must select a certified candidate and bound any crowd jitter inside its authored profile.",
  "",
  "| Doctrine | Soldiers | Shape | Narrow files×ranks / tiles | Preferred | Wide |",
  "| --- | ---: | --- | --- | --- | --- |",
];
const fmt = (r: any, key: string) =>
  r.files + "×" + r.ranks + " / " + (r[key] / FIXED).toFixed(2);
const json: any = { recipes: {}, mountedChecks: [] };
for (const [id, recipe] of Object.entries(recipes) as [string, any][]) {
  if (recipe.model !== "soldiers") continue;
  const d = formationDoctrine(id);
  json.recipes[id] = {};
  for (const n of [
    ...new Set([
      12,
      24,
      36,
      48,
      72,
      96,
      144,
      recipe.capacity,
      recipe.enlargedCapacity,
    ]),
  ].sort((a, b) => a - b))
    for (const shape of d.shapes) {
      const row = frontageSummary(n, d, shape as FormationShape);
      if (!["line", "shield-wall", "mass", "modern-loose"].includes(shape))
        continue;
      json.recipes[id][n + ":" + shape] = row ?? null;
      lines.push(
        "| " +
          id +
          " | " +
          n +
          " | " +
          shape +
          " | " +
          (row
            ? fmt(row.narrow, "minWidth") +
              " | " +
              fmt(row.preferred, "preferredWidth") +
              " | " +
              fmt(row.wide, "maxWidth")
            : "unavailable | — | —") +
          " |",
      );
    }
}
for (const [id, r] of Object.entries(recipes) as [string, any][]) {
  const d = formationDoctrine(id);
  if (!d.mounted || r.model !== "soldiers") continue;
  const era = id.split("-")[0];
  for (const variant of ["capacity", "enlargedCapacity"]) {
    const cavalry = frontageSummary(r[variant], d, "line");
    if (!cavalry) continue;
    const infantry = Object.entries(recipes)
      .filter(
        ([other, rr]: any) =>
          other.startsWith(era + "-") &&
          rr.model === "soldiers" &&
          !formationDoctrine(other).mounted,
      )
      .map(
        ([other, rr]: any) =>
          frontageSummary(rr[variant], formationDoctrine(other), "line")?.wide
            .maxWidth ?? 0,
      );
    const widest = Math.max(0, ...infantry);
    json.mountedChecks.push({
      id,
      variant,
      riders: r[variant],
      width: cavalry.wide.maxWidth,
      infantryWidest: widest,
      ratio: widest ? cavalry.wide.maxWidth / widest : null,
      withinProposal: widest > 0 && cavalry.wide.maxWidth / widest <= 1.35,
    });
  }
}
lines.push(
  "",
  "## Mounted comparison",
  "",
  "Same-era widest eligible infantry line versus each mounted recipe; candidate ceiling 1.35×. Missing eligible infantry is explicit, not a silent pass.",
  "",
  "| Mounted doctrine | Variant | Riders | Cavalry / infantry | Within proposal |",
  "| --- | --- | ---: | ---: | --- |",
);
for (const c of json.mountedChecks)
  lines.push(
    "| " +
      c.id +
      " | " +
      c.variant +
      " | " +
      c.riders +
      " | " +
      (c.ratio === null ? "no infantry line" : c.ratio.toFixed(3)) +
      " | " +
      c.withinProposal +
      " |",
  );
const target = process.argv[2] ?? ".phase6a-frontage-tables.md";
writeFileSync(target, lines.join("\n") + "\n");
writeFileSync(
  target.replace(/\.md$/, ".json"),
  JSON.stringify(json, null, 2) + "\n",
);
console.log(
  "Generated " +
    lines.length +
    " table lines; " +
    json.mountedChecks.length +
    " mounted comparisons",
);
