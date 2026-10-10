import { flightReachable, missionKind, type AirMission } from "../content/FlightOperations";
import type { BuildingType, Command, ShipType, Snapshot, SquadType } from "../Protocol";

/** Selection and cursor quotes share the same ordered candidates. Authority validates the submitted IDs again. */
export function airMissionCandidates(snapshot:Snapshot,playerId:number,x:number,y:number,selected:ReadonlySet<number>,mission:AirMission) {
 const fields=new Set(snapshot.buildings.filter(b=>b.playerId===playerId&&b.type===(mission==="drone"?"drone-facility":"airstrip")&&!b.remainingTicks&&(b.health??1)>0).map(b=>b.id));
 return (snapshot.expansion?.aircraft??[]).filter(a=>a.playerId===playerId&&a.health>0&&a.state==="ready"&&fields.has(a.airfieldId)&&a.definitionId===missionKind(mission)&&(!selected.size||selected.has(a.id)))
  .sort((a,b)=>(a.x-x)**2+(a.y-y)**2-((b.x-x)**2+(b.y-y)**2)||a.airfieldId-b.airfieldId||a.id-b.id);
}
export function sortieCommand(snapshot:Snapshot,playerId:number,x:number,y:number,shift=false,selected:ReadonlySet<number>=new Set(),mission:AirMission="bombing"):Extract<Command,{type:"sortie"}>|null {
 const ready=airMissionCandidates(snapshot,playerId,x,y,selected,mission).slice(0,shift?5:1);
 if(!ready.length||ready.some(a=>!flightReachable(a,x,y)))return null;
 return {type:"sortie",mission,playerId,aircraftIds:ready.map(a=>a.id),x,y};
}

/** Translate selection intent only; the match chooses and admits the landing coast. */
export function shipMoveCommand(snapshot:Pick<Snapshot,"ships"|"squads">,selected:ReadonlySet<number>,playerId:number,tile:number,water:boolean,append:boolean):Extract<Command,{type:"sail"}>|null {
  const shipIds=water ? snapshot.ships.filter(s=>selected.has(s.id)&&s.playerId===playerId).map(s=>s.id) : [];
  return shipIds.length ? {type:"sail",playerId,shipIds,tile,append} : null;
}

export const LAND_RECRUITMENT: {
  kind: SquadType;
  label: string;
  key: string;
}[] = [
  { kind: "infantry", label: "Infantry", key: "Q" },
  { kind: "archer", label: "Ranged", key: "W" },
  { kind: "cavalry", label: "Cavalry", key: "E" },
];
export const NAVAL_RECRUITMENT: { kind: ShipType; key: string }[] = [
  { kind: "warship", key: "B" },
];

export function recruitmentBatch(
  shift: boolean,
  wasdMode: boolean,
  spaceHeld = false,
): number {
  return (wasdMode ? spaceHeld : shift) ? 5 : 1;
}
export const CONSTRUCTION: { kind: BuildingType; key: string }[] = [
  { kind: "city", key: "A" },
  { kind: "factory", key: "S" },
  { kind: "port", key: "D" },
  { kind: "barracks", key: "F" },
  { kind: "archery", key: "G" },
  { kind: "stables", key: "H" },
];
export const CONSTRUCTION_SHORTCUTS: { kind: BuildingType; key: string }[] = [
  ...CONSTRUCTION,
  { kind: "mine", key: "Z" },
  { kind: "oil-well", key: "X" },
  { kind: "blacksmith", key: "C" },
  { kind: "armory", key: "V" },
  { kind: "arms-factory", key: "N" },
];

export type HotkeyAction =
  | { type: "recruit"; kind: SquadType }
  | { type: "recruit-ship"; kind: ShipType }
  | { type: "construct"; kind: BuildingType }
  | { type: "replenish" | "hold" | "fit" | "cancel" | "select-all" | "sortie" | "dispatch" | "atomic-run" | "drone-strike" }
  | { type: "group"; digit: number; mode: "add" | "replace" | "recall" };

// Physical key codes also identify Shift+digits, whose key value is punctuation.
export function hotkeyAction(
  event: Pick<
    KeyboardEvent,
    "code" | "repeat" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey"
  >,
  wasdMode = false,
  spaceHeld = false,
): HotkeyAction | null {
  if (event.repeat || event.altKey) return null;
  const modified = event.ctrlKey || event.metaKey;
  if (modified && event.code === "KeyA") return { type: "select-all" };
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code);
  if (digit)
    return {
      type: "group",
      digit: Number(digit[1]),
      mode: modified ? "replace" : event.shiftKey ? "add" : "recall",
    };
  if (modified) return null;
  const commandsAllowed = !wasdMode || event.shiftKey;
  const land = LAND_RECRUITMENT.find(
    (action) => event.code === `Key${action.key}`,
  );
  if (land)
    return commandsAllowed || spaceHeld
      ? { type: "recruit", kind: land.kind }
      : null;
  const navy = NAVAL_RECRUITMENT.find(
    (action) => event.code === `Key${action.key}`,
  );
  if (navy)
    return commandsAllowed || spaceHeld
      ? { type: "recruit-ship", kind: navy.kind }
      : null;
  const building = CONSTRUCTION_SHORTCUTS.find(
    (action) => event.code === `Key${action.key}`,
  );
  if (building)
    return commandsAllowed ? { type: "construct", kind: building.kind } : null;
  switch (event.code) {
    case "KeyI": return {type:"dispatch"};
    case "KeyO": return {type:"atomic-run"};
    case "KeyU": return {type:"drone-strike"};
    case "KeyP":
      return {type:"sortie"};
    case "KeyR":
      return { type: "replenish" };
    case "KeyT":
      return { type: "hold" };
    case "Home":
      return { type: "fit" };
    case "Escape":
      return { type: "cancel" };
    default:
      return null;
  }
}
