import type { Squad } from "./Protocol";

/** Stage-local facts, rebuilt once after boarding and before fleet movement.
 * Rebuilding from live identities avoids stale embark/capture/restore caches. */
export function cargoByShip(squads: readonly Squad[]): ReadonlyMap<number, readonly Squad[]> {
  const result = new Map<number, Squad[]>();
  for (const squad of squads) {
    if (squad.embarkedOn === null) continue;
    let cargo = result.get(squad.embarkedOn);
    if (!cargo) result.set(squad.embarkedOn, cargo = []);
    cargo.push(squad);
  }
  return result;
}
