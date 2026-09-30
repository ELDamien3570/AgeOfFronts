import type { BuildingType, ShipType, SquadType } from "../Protocol";

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
  { kind: "transport", key: "T" },
  { kind: "warship", key: "B" },
];
export const CONSTRUCTION: { kind: BuildingType; key: string }[] = [
  { kind: "city", key: "A" },
  { kind: "factory", key: "S" },
  { kind: "port", key: "D" },
  { kind: "barracks", key: "F" },
  { kind: "archery", key: "G" },
  { kind: "stables", key: "H" },
];

export type HotkeyAction =
  | { type: "recruit"; kind: SquadType }
  | { type: "recruit-ship"; kind: ShipType }
  | { type: "construct"; kind: BuildingType }
  | { type: "replenish" | "hold" | "pause" | "fit" | "cancel" | "select-all" }
  | { type: "group"; digit: number; mode: "add" | "replace" | "recall" };

// Physical key codes also identify Shift+digits, whose key value is punctuation.
export function hotkeyAction(
  event: Pick<
    KeyboardEvent,
    "code" | "repeat" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey"
  >,
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
  const land = LAND_RECRUITMENT.find(
    (action) => event.code === `Key${action.key}`,
  );
  if (land) return { type: "recruit", kind: land.kind };
  const navy = NAVAL_RECRUITMENT.find(
    (action) => event.code === `Key${action.key}`,
  );
  if (navy) return { type: "recruit-ship", kind: navy.kind };
  const building = CONSTRUCTION.find(
    (action) => event.code === `Key${action.key}`,
  );
  if (building) return { type: "construct", kind: building.kind };
  switch (event.code) {
    case "KeyR":
      return { type: "replenish" };
    case "KeyX":
      return { type: "hold" };
    case "Space":
      return { type: "pause" };
    case "Home":
      return { type: "fit" };
    case "Escape":
      return { type: "cancel" };
    default:
      return null;
  }
}
