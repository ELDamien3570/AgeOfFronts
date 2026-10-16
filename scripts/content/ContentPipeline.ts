import {
  compileFormationDoctrines,
  compileFormationRecipes,
  compileSoldierWeapons,
} from "./FormationContentCompilers";
import { compileRusPackagedRecruitment } from "./RusPackagedRecruitmentCompiler";

// The authored-content build, in dependency order. `npm run compile:content`
// writes every output; tests/skirmish/ContentCompile.test.ts runs the same
// steps in memory and requires the committed content to match.

export const CONTENT_PATHS = {
  technologyPlan: "skirmish/plans/technology-plan.json",
  recipesPlan: "skirmish/plans/formation-recipes.json",
  weaponsPlan: "skirmish/plans/soldier-weapons.json",
  doctrinesPlan: "skirmish/plans/formation-doctrines.json",
  recruitment: "src/skirmish/content/russian-recruitment.json",
  recipes: "src/skirmish/content/formation-recipes.json",
  weapons: "src/skirmish/content/soldier-weapons.json",
  doctrines: "src/skirmish/content/formation-doctrines.json",
} as const;

export type ReadJson = (path: string) => unknown;

export interface ContentOutput<T = unknown> {
  readonly path: string;
  readonly data: T;
  readonly summary: string;
}

/** Packaged Rus recruitment; the previous output supplies its troop recipes. */
export function compileRecruitmentStep(
  read: ReadJson,
): ContentOutput<ReturnType<typeof compileRusPackagedRecruitment>> {
  const data = compileRusPackagedRecruitment(
    read(CONTENT_PATHS.technologyPlan),
    read(CONTENT_PATHS.recruitment),
  );
  return {
    path: CONTENT_PATHS.recruitment,
    data,
    summary: `${data.technologies.length} packaged technologies; ${data.units.length} troop recipes`,
  };
}

export function compileRecipesStep(
  read: ReadJson,
  recruitment: { technologies: readonly { id: string }[] },
): ContentOutput {
  const data = compileFormationRecipes(read(CONTENT_PATHS.recipesPlan), recruitment);
  return {
    path: CONTENT_PATHS.recipes,
    data,
    summary: `Compiled ${Object.keys(data.recipes).length} formation recipes and ${data.technologies.length} optional capacity technologies`,
  };
}

export function compileWeaponsStep(read: ReadJson): ContentOutput {
  const data = compileSoldierWeapons(
    read(CONTENT_PATHS.weaponsPlan),
    read(CONTENT_PATHS.recipesPlan),
  );
  return {
    path: CONTENT_PATHS.weapons,
    data,
    summary: `Compiled ${Object.keys(data.weapons).length} soldier weapon profiles; hull weapons retained separately`,
  };
}

export function compileDoctrinesStep(read: ReadJson): ContentOutput & {
  readonly warnings: readonly string[];
} {
  const { data, warnings, mountedChecks } = compileFormationDoctrines(
    read(CONTENT_PATHS.doctrinesPlan),
    read(CONTENT_PATHS.recipesPlan),
  );
  return {
    path: CONTENT_PATHS.doctrines,
    data,
    warnings,
    summary: `Compiled ${Object.keys(data.doctrines).length} doctrines; ${mountedChecks.length} mounted comparisons; ${warnings.length} availability warnings`,
  };
}

/** Every content output, in build order. Throws if any compiler rejects its plan. */
export function compileContent(read: ReadJson): ContentOutput[] {
  const recruitment = compileRecruitmentStep(read);
  return [
    recruitment,
    compileRecipesStep(read, recruitment.data),
    compileWeaponsStep(read),
    compileDoctrinesStep(read),
  ];
}

/** The committed on-disk form of a content file. */
export function renderContentJson(data: unknown): string {
  return JSON.stringify(data, null, 2) + "\n";
}
