/** Ground elevation only: sprite position, size, faction and unit class never
 * imply height. Equal elevations keep one permanent individual overlap order. */
export interface SoldierDrawOrder {
  elevation: number;
  drawKey: number;
  squadId: number;
  soldierId: number;
}
export function soldierDrawKey(squadId: number, soldierId: number): number {
  let key = (Math.imul(squadId, 0x9e3779b1) ^ Math.imul(soldierId + 1, 0x85ebca6b)) >>> 0;
  key = Math.imul(key ^ (key >>> 16), 0x7feb352d);
  key = Math.imul(key ^ (key >>> 15), 0x846ca68b);
  return (key ^ (key >>> 16)) >>> 0;
}
export function compareSoldierDrawOrder(a: SoldierDrawOrder, b: SoldierDrawOrder): number {
  return a.elevation - b.elevation || a.drawKey - b.drawKey ||
    a.squadId - b.squadId || a.soldierId - b.soldierId;
}
