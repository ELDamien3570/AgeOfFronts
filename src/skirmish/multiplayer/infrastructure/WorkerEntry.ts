/** A worker entry beside the calling module. In development the module is
 * TypeScript run through tsx, so the worker loads its .ts source with the tsx
 * loader; in the bundled server (scripts/buildMultiplayer.ts) every entry is a
 * plain .mjs sibling and needs no loader. */
export function workerEntry(name: string, from: string): { url: URL; execArgv: string[] } {
  const bundled = new URL(from).pathname.endsWith(".mjs");
  return {
    url: new URL(`./${name}${bundled ? ".mjs" : ".ts"}`, from),
    execArgv: bundled ? [] : ["--import", "tsx"],
  };
}
