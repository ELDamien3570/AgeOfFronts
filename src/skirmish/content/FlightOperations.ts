import { TICKS_PER_SECOND } from "../Protocol";
import type { Aircraft, Age } from "../domain/Definitions";
export type AirMission = "bombing" | "patrol" | "atomic" | "drone";
export type AircraftKind = "fighter" | "bomber" | "drone";
export const FLIGHT_RULES = {
 fighter: {preModernSeconds:180, modernSeconds:240, speed:180, gold:5000},
 bomber: {preModernSeconds:120, modernSeconds:180, speed:180, gold:5000},
 drone: {preModernSeconds:120, modernSeconds:120, speed:90, gold:3000},
} as const;
export function flightTicks(kind:AircraftKind, age:Age):number {
 const rule=FLIGHT_RULES[kind];return (age==="Modern"?rule.modernSeconds:rule.preModernSeconds)*TICKS_PER_SECOND;
}
export const flightSpeed=(kind:AircraftKind)=>FLIGHT_RULES[kind].speed;
export function flightReachable(aircraft:Pick<Aircraft,"x"|"y"|"fuelTicks"|"definitionId">, x:number,y:number):boolean {
 const distance=aircraft.fuelTicks*flightSpeed(aircraft.definitionId);
 return (aircraft.x-x)**2+(aircraft.y-y)**2<=distance**2;
}
export function flightPercent(aircraft:Pick<Aircraft,"x"|"y"|"fuelTicks"|"definitionId">,x:number,y:number):number {
 return Math.hypot(aircraft.x-x,aircraft.y-y)/Math.max(1,aircraft.fuelTicks*flightSpeed(aircraft.definitionId))*100;
}
export const aircraftTechnology=(kind:AircraftKind,age:Age)=>`rus-${(kind==="drone"?"Modern":age==="Modern"?"Modern":"EarlyModern").toLowerCase()}-${kind==="fighter"?"airfields":kind==="bomber"?"bombers":"mirvs-drones"}`;
export const missionKind=(mission:AirMission):AircraftKind=>mission==="patrol"?"fighter":mission==="drone"?"drone":"bomber";
