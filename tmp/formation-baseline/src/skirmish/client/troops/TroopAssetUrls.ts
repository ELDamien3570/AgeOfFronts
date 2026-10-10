// Static discovery makes the same bounded assets available in development and
// hashed production bundles; network decoding remains on demand.
const files = import.meta.glob<string>("../../../../Art/Runtime/Russians/Troops/*/*", {
  eager: true, query: "?url", import: "default",
});
const urls = new Map(Object.entries(files).map(([path, url]) => [path.replace("../../../..", ""), url]));
export function troopAssetUrl(path: string): string {
  return urls.get(path) ?? path;
}
