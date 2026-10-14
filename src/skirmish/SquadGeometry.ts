import type { GameMap } from "../core/game/GameMap";
import { FIXED, type Squad, type SquadType } from "./Protocol";
import type { WorldPoint } from "./SpatialGrid";

// Formation spacing is presentation intent; only hostile squads block passage.
export const FORMATION_SPACING = 1.5 * FIXED;
export const COLLISION_SKIN = 2;
export const ARRIVAL_TOLERANCE = 2;
export function squadRadius(kind: SquadType): number {
  return Math.round(FIXED * (kind === "cavalry" ? 0.48 : 0.45));
}
export type SquadGeometry = Pick<Squad, "kind" | "playerId"> & Partial<Pick<Squad,"formation"|"definitionId"|"afloat">>;
export type FactionHostility = (a: number, b: number) => boolean;
/** Radius used by the root trajectory guard. Formation bodies have their own
 * exact sweep; afloat and legacy carriers still need their root disc. */
export function squadCollisionRadius(s: SquadGeometry): number {
  return s.formation && !s.afloat ? 0 : squadRadius(s.kind);
}
export function squadSeparation(a: SquadGeometry, b: SquadGeometry, hostile?: FactionHostility): number {
  if (a.playerId === b.playerId || (hostile && !hostile(a.playerId, b.playerId))) return 0;
  // Authoritative ground bodies use exact swept formation collision. A second
  // root disc is not an inscribed body (especially for jittered single soldiers
  // or bent columns), and can prevent otherwise legal physical contact.
  const radius = squadCollisionRadius(a) + squadCollisionRadius(b);
  return Math.round(radius) + COLLISION_SKIN;
}
export function meleeContact(a: SquadType, b: SquadType): number {
  // A close resting stance leaves a little room for the visual weapon lunge.
  return squadRadius(a) + squadRadius(b) + FIXED / 4;
}

export function pointTile(map: GameMap, point: WorldPoint): number {
  return map.ref(Math.floor(point.x / FIXED), Math.floor(point.y / FIXED));
}
export function tilePoint(map: GameMap, tile: number): WorldPoint {
  return {
    x: map.x(tile) * FIXED + FIXED / 2,
    y: map.y(tile) * FIXED + FIXED / 2,
  };
}
export function distanceSquared(a: WorldPoint, b: WorldPoint): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/** Natural mountains are scenery for movement. Only the carrier's medium matters. */
export function passableCell(map: GameMap, tile: number, amphibious = false): boolean {
  return amphibious || map.isLand(tile);
}
export function standable(map: GameMap, point: WorldPoint, radius: number, amphibious = false): boolean {
  return point.x>=radius && point.y>=radius && point.x<=map.width()*FIXED-radius &&
    point.y<=map.height()*FIXED-radius && passableCell(map,pointTile(map,point),amphibious);
}
/** Carrier supercover: formation edges may overlap shores, but a land carrier
 * cannot shortcut across water. Constructed obstacles are checked by their owner. */
export function traversable(map: GameMap, from: WorldPoint, to: WorldPoint, radius: number, amphibious = false): boolean {
  if(!standable(map,from,radius,amphibious)||!standable(map,to,radius,amphibious))return false;
  if(amphibious)return true;
  let x=Math.floor(from.x/FIXED),y=Math.floor(from.y/FIXED);
  const endX=Math.floor(to.x/FIXED),endY=Math.floor(to.y/FIXED),dx=to.x-from.x,dy=to.y-from.y;
  const sx=Math.sign(dx),sy=Math.sign(dy),stepX=dx?FIXED/Math.abs(dx):Infinity,stepY=dy?FIXED/Math.abs(dy):Infinity;
  let nextX=dx?((x+(sx>0?1:0))*FIXED-from.x)/dx:Infinity,
      nextY=dy?((y+(sy>0?1:0))*FIXED-from.y)/dy:Infinity;
  const open=(cx:number,cy:number)=>map.isValidCoord(cx,cy)&&map.isLand(map.ref(cx,cy));
  while(x!==endX||y!==endY){
    if(nextX<nextY){x+=sx;nextX+=stepX;}
    else if(nextY<nextX){y+=sy;nextY+=stepY;}
    else {if(!open(x+sx,y)||!open(x,y+sy))return false;x+=sx;y+=sy;nextX+=stepX;nextY+=stepY;}
    if(!open(x,y))return false;
  }
  return true;
}
