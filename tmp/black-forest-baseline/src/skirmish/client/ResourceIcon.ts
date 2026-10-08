import type { Resource } from "../domain/Definitions";
const colours: Record<Resource, string> = {
  horses: "#c7a277",
  stone: "#bdc5c2",
  copper: "#d68f64",
  tin: "#bdc7d2",
  ironOre: "#a38371",
  carbon: "#70777d",
  sulphur: "#dbd170",
  nitrate: "#d2e7ed",
  bronze: "#ba8a57",
  iron: "#afbbc3",
  steel: "#d2dde4",
  gunpowder: "#9d9191",
  oil: "#658398",
};
export function resourceIcon(resource: Resource): string {
  const path =
    resource === "horses"
      ? "m5 20 2-8-3-3 7-6 1 3 5 2 3 7-3 5Z M7 12l8-4"
      : resource === "oil"
        ? "M12 2c2 7 8 8 8 14a8 8 0 0 1-16 0c0-5 5-7 8-14Z"
        : ["bronze", "iron", "steel"].includes(resource)
          ? "m3 15 5-7h10l3 7-5 5H7Z M3 15h18 M8 8l-1 12 M18 8l-2 12"
          : "M3 18 7 5l9-2 5 13-7 5Z M7 5l6 8 8 3 M3 18l10-5-1 8";
  return `<svg class="hud-art resource-art" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="${colours[resource]}" stroke="#d1e1dc" stroke-width=".9" stroke-linejoin="round"/></svg>`;
}
