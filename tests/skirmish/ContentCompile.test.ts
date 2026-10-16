import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formationDoctrineSchema } from "../../scripts/FormationDoctrineSchema";
import {
  CONTENT_PATHS,
  compileDoctrinesStep,
  compileRecipesStep,
  compileRecruitmentStep,
  compileWeaponsStep,
  compileContent,
  renderContentJson,
} from "../../scripts/content/ContentPipeline";

// Gate for the authored-content build (review S1 / M10): the committed runtime
// content under src/skirmish/content/ must be exactly what the compilers make
// from skirmish/plans/. A plan edit without `npm run compile:content`, or a
// hand edit of a compiled file, fails here. Compilers run in memory; nothing
// is written.

const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** Key-order-insensitive form: object keys sorted, array order kept. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  return value;
}

const expectCompiled = (data: unknown, path: string) =>
  expect(canonical(data)).toEqual(canonical(read(path)));

describe("content compile gate", () => {
  it("packages the saved Rus plan into the committed recruitment content", () => {
    const step = compileRecruitmentStep(read);
    expect(step.path).toBe(CONTENT_PATHS.recruitment);
    expectCompiled(step.data, CONTENT_PATHS.recruitment);
  });

  it("compiles the authored formation recipes into the committed content", () => {
    const recruitment = compileRecruitmentStep(read).data;
    expectCompiled(compileRecipesStep(read, recruitment).data, CONTENT_PATHS.recipes);
  });

  it("compiles the authored soldier weapons into the committed content", () => {
    expectCompiled(compileWeaponsStep(read).data, CONTENT_PATHS.weapons);
  });

  it("passes the authored formation doctrines through to the committed content", () => {
    // The doctrine compiler validates and passes data through unchanged, so
    // the schema parse is its output even while validation rejects the plan.
    expectCompiled(
      formationDoctrineSchema.parse(read(CONTENT_PATHS.doctrinesPlan)),
      CONTENT_PATHS.doctrines,
    );
  });

  // R2-M2: with FRONTAGE.mountedWidthRatioMax at 1.35, 20 of 24 mounted
  // variants were rejected and `npm run compile:content` could not finish.
  it("accepts the authored doctrines in the compiler (R2-M2)", () => {
    const step = compileDoctrinesStep(read);
    expectCompiled(step.data, CONTENT_PATHS.doctrines);
  });

  it("detects a plan that drifts from the committed content", () => {
    const drifted = (path: string) => {
      const data = read(path) as any;
      if (path === CONTENT_PATHS.weaponsPlan)
        data.weapons[Object.keys(data.weapons)[0]].chargeMultiplier += 1;
      return data;
    };
    expect(canonical(compileWeaponsStep(drifted).data)).not.toEqual(
      canonical(read(CONTENT_PATHS.weapons)),
    );
  });
  it("renders every compiled output byte-for-byte as committed (what compile:content writes)", () => {
    // writeContentOutput writes renderContentJson(output.data); a key-order or
    // formatting drift would otherwise surface only as a git diff after a run.
    const outputs = compileContent(read);
    expect(outputs.map((output) => output.path).sort()).toEqual(Object.values(CONTENT_PATHS).filter((path) =>
      outputs.some((output) => output.path === path)).sort());
    for (const output of outputs)
      expect(renderContentJson(output.data), output.path).toBe(readFileSync(output.path, "utf8").replace(/\r\n/g, "\n"));
  });
});
