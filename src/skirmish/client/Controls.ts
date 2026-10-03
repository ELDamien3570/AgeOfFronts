import type { BuildingType, Command, ShipType, Snapshot, SquadType } from "../Protocol";

/** Translate selection intent only; the match chooses and admits the landing coast. */
export function shipMoveCommand(snapshot:Pick<Snapshot,"ships"|"squads">,selected:ReadonlySet<number>,playerId:number,tile:number,water:boolean,append:boolean):Extract<Command,{type:"sail"}>|null {
  const loaded=new Set(snapshot.squads.filter(s=>s.playerId===playerId&&s.embarkedOn!==null).map(s=>s.embarkedOn));
  const shipIds=snapshot.ships.filter(s=>selected.has(s.id)&&s.playerId===playerId && (water || (s.kind==="transport"&&loaded.has(s.id)))).map(s=>s.id);
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
  | { type: "replenish" | "hold" | "fit" | "cancel" | "select-all" }
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
