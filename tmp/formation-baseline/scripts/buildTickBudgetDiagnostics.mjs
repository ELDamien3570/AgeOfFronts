import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

// Both revisions use today's identical diagnostic fixture. Only simulation
// source changes; the baseline is read from Git without touching the checkout.
const baseline = process.argv[2] ?? "4e3f507";
const output = "out/tick-budget";
await mkdir(output, { recursive: true });
const root = process.cwd();
const common = {
  bundle: true, platform: "node", format: "esm", target: "node24",
  banner: { js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" },
};
const historical = (relative) => execFileSync("git", ["show", `${baseline}:${relative}`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const baselineSources = {
  name: "baseline-source",
  setup(builder) {
    builder.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, ({ path: file }) => ({
      contents: historical(path.relative(root, file).replaceAll("\\", "/")), loader: "ts",
    }));
  },
};
await build({ ...common,
  stdin: { contents: "export {Skirmish} from './src/skirmish/Simulation';export {GameMapImpl} from './src/core/game/GameMap';", resolveDir: root, loader: "ts" },
  outfile: `${output}/baseline-exports.mjs`, plugins: [baselineSources],
});
for (const [name, plugins] of [["baseline-coherent", [baselineSources]], ["candidate-coherent", []]]) {
  await build({ ...common, entryPoints: ["tests/skirmish/multiplayerReleaseProfile.ts"], outfile: `${output}/${name}.mjs`, plugins });
}
const comparison = { ...common, entryPoints: ["tests/skirmish/tickBudgetEquivalence.ts"], external: ["../../out/tick-budget/baseline-exports.mjs"] };
await build({ ...comparison, outfile: `${output}/equivalence.mjs` });
await build({ ...comparison, outfile: `${output}/equivalence-legacy-strategy.mjs`, plugins: [{
  name: "unchanged-strategy-comparison",
  setup(builder) {
    builder.onLoad({ filter: /[\\/]AiOperations\.ts$/ }, () => ({ contents: historical("src/skirmish/domain/AiOperations.ts"), loader: "ts" }));
  },
}] });
console.log(`Built tick-budget diagnostics against ${baseline} in ${output}`);
