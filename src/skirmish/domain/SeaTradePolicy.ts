import type { LaneUse } from "./SeaTradeTypes";
export interface SeaCandidate {
  portTile: number; receiverId: number; owner: number; berth: number; distanceSquared: number;
}
export interface ReadySeaCandidate extends SeaCandidate { use: LaneUse; steps: number; allied: boolean }
export function ceilingDistance(squared: number): number {
  if (!Number.isSafeInteger(squared) || squared < 0) throw Error("Invalid sea distance");
  const floor = Math.floor(Math.sqrt(squared)); return floor * floor === squared ? floor : floor + 1;
}
const compare = (a: SeaCandidate, b: SeaCandidate) => a.portTile - b.portTile || a.receiverId - b.receiverId;
/** At most eight live-filtered inputs. A far cached ally cannot dominate. */
export function chooseReadySeaPort(rows: readonly ReadySeaCandidate[], after?: number): ReadySeaCandidate | undefined {
  if (!rows.length) return undefined;
  if (rows.length > 8) throw Error("Unbounded sea policy input");
  const shortest = Math.min(...rows.map(row => row.steps)), threshold = Math.max(shortest + 16, Math.ceil(shortest * 1.5));
  let nearby = rows.filter(row => row.steps <= threshold);
  if (nearby.some(row => row.allied)) nearby = nearby.filter(row => row.allied);
  nearby.sort(compare);
  return nearby.find(row => after === undefined || row.portTile > after) ?? nearby[0];
}
export function chooseSeaDiscovery(rows: readonly (SeaCandidate & { allied: boolean })[], after?: number): SeaCandidate | undefined {
  return chooseReadySeaPort(rows.map(row => ({ ...row, steps: ceilingDistance(row.distanceSquared), use: { laneId: 0, reverse: false } })), after);
}
