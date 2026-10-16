import type { Command, Order } from "../Protocol";
import { FIXED, MAX_SQUADS } from "../Protocol";
import { BUILDING_RULES, MAX_FACTION_SHIPS } from "../Rules";
import { AGES } from "./Definitions";
// Runtime boundary shared by local worker and eventual authenticated transport.
// Authentication is deliberately outside this pure shape validation policy.
export interface CommandBounds { width: number; height: number }
/** Map-bounded positions. Every top-level and nested tile/x/y a command
 * carries must address the authoritative map, so later domain reads such as
 * `GameMap.ref` never see client coordinates outside it. */
function boundsRejection(command: Command, bounds: CommandBounds): string | null {
  const tiles = bounds.width * bounds.height,
    record = command as unknown as Record<string, unknown>,
    tile = (value: unknown) => value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < tiles),
    coord = (value: unknown, cells: number) => value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < cells * FIXED),
    point = (value: { x?: unknown; y?: unknown } | undefined) => !value || (coord(value.x, bounds.width) && coord(value.y, bounds.height));
  if (!tile(record.tile)) return "Invalid command position or identity";
  if (!point(record as { x?: unknown; y?: unknown })) return "Invalid command position or identity";
  if (command.type === "occupy" && Array.isArray(command.frontageTiles) && !command.frontageTiles.every(tile))
    return "Invalid trench frontage";
  if (command.type === "order" && command.order?.type === "move" && (!tile(command.order.tile) || !point(command.order)))
    return "Choose a passable destination";
  if (command.type === "army-order" && ["move", "deploy", "regroup"].includes(command.order?.type as string) &&
    !tile((command.order as { tile?: number }).tile))
    return "Invalid army destination";
  if (command.type === "charge" && command.fallbackOrder?.type === "move" && !tile(command.fallbackOrder.tile))
    return "Choose a passable destination";
  return null;
}
/** The order a blocked charge falls back to. An attack on a vanished target
 * becomes a move to the charge point, or no order when that point is off-map. */
export function chargeFallbackOrder(
  map: { isValidCoord(x: number, y: number): boolean; ref(x: number, y: number): number },
  command: Extract<Command, { type: "charge" }>,
  exists: (id: number) => boolean,
): Order | undefined {
  const order = command.fallbackOrder;
  if (!order) return undefined;
  if (order.type !== "attack" || exists(order.targetId)) return order;
  if (!Number.isSafeInteger(command.x) || !Number.isSafeInteger(command.y)) return undefined;
  const tx = Math.floor(command.x / FIXED), ty = Math.floor(command.y / FIXED);
  return map.isValidCoord(tx, ty) ? { type: "move", tile: map.ref(tx, ty) } : undefined;
}
export function commandRejection(command: Command, bounds?: CommandBounds): string | null {
  if (
    !command ||
    typeof command !== "object" ||
    !Number.isSafeInteger(command.playerId) ||
    command.playerId <= 0
  )
    return "Invalid player command";
  if (
    (command.type === "create-army" || command.type === "army-members") &&
    !Array.isArray(command.squadIds)
  )
    return "Select squad formations";
  if (
    ["army-members", "army-order", "army-auto", "army-posture", "disband-army"].includes(
      command.type,
    ) &&
    (!Number.isSafeInteger((command as { armyId: number }).armyId) ||
      (command as { armyId: number }).armyId <= 0)
  )
    return "Invalid army identity";
  if(command.type==='sortie') {
    if(command.mission!==undefined && !['bombing','patrol','atomic','drone'].includes(command.mission))return 'Invalid air mission';
    for(const id of [command.targetBuildingId,command.targetUnitId]) if(id!==undefined && (!Number.isSafeInteger(id)||id<=0))return 'Invalid drone target';
    if(command.targetBuildingId!==undefined && command.targetUnitId!==undefined)return 'Choose one drone target';
  }
  if(command.type==='occupy'&&command.frontageTiles!==undefined&&(!Array.isArray(command.frontageTiles)||!command.frontageTiles.length||command.frontageTiles.length>64||command.frontageTiles.some(t=>!Number.isSafeInteger(t)||t<0)||new Set(command.frontageTiles).size!==command.frontageTiles.length))return 'Invalid trench frontage';
  if(command.type==='stance'&&! ['default','skirmish'].includes(command.stance))return 'Invalid squad stance';
  if (command.type === "transfer-aircraft" && (!Array.isArray(command.aircraftIds) ||
    !Number.isSafeInteger(command.buildingId) || command.buildingId <= 0)) return "Select planes and a destination airfield";
  if(command.type==='army-posture'&&!['line','defend','skirmish'].includes(command.posture))return 'Invalid army posture';
  if(command.type==='naval-priority'&&!['transports','warships'].includes(command.priority))return 'Invalid naval priority';
  if (command.type === "upgrade-building" && (!Array.isArray(command.buildingIds) || command.buildingIds.length > 200))
    return "Select up to 200 buildings";
  for (const field of ["squadIds", "shipIds", "aircraftIds", "buildingIds"] as const)
    if (field in command) {
      const ids = (command as unknown as Record<string, unknown>)[field],
        cap =
          field === "buildingIds" ? 10_000 : field === "squadIds"
            ? MAX_SQUADS
            : field === "shipIds"
              ? MAX_FACTION_SHIPS
              : 32;
      if (field === "buildingIds" && ids === undefined) continue;
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > cap ||
        ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
      )
        return "Invalid unit selection";
    }
  for (const field of [
    "buildingId",
    "barrierId",
    "shipId",
    "launcherId",
    "otherId",
    "targetId",
    "armyId",
    "tile",
    "x",
    "y",
  ] as const)
    if (field in command) {
      const value = (command as unknown as Record<string, unknown>)[field];
      if (
        value !== undefined &&
        (!Number.isSafeInteger(value) || Number(value) < 0)
      )
        return "Invalid command position or identity";
    }
  if (
    command.type === "build" &&
    (!Object.prototype.hasOwnProperty.call(
      BUILDING_RULES,
      command.buildingType,
    ) ||
      (command.age !== undefined && !AGES.includes(command.age)))
  )
    return "Unknown building tier";
  if (command.type === "cancel-recruitment" &&
      ((command.category !== undefined && !["land", "ship", "aircraft"].includes(command.category)) ||
       [command.definitionId, command.kind].some(value => value !== undefined &&
         (typeof value !== "string" || !value.length || value.length > 100))))
    return "Invalid recruitment filter";
  if (command.type === "order") {
    if (command.deploymentLine !== undefined) {
      const line=command.deploymentLine;
      if (command.order?.type !== "move" || !line || ![line.start,line.end].every(p=>p && Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y) && Math.abs(p.x)<=1000000 && Math.abs(p.y)<=1000000)) return "Invalid deployment line";
    }
    const order = command.order;
    if (
      !order ||
      typeof order !== "object" ||
      !["hold", "replenish", "move", "attack"].includes(order.type)
    )
      return "Invalid order";
    if ((order.type==="hold" || order.type==="move") && order.facing !== undefined && (!Number.isFinite(order.facing) || Math.abs(order.facing)>Math.PI+1e-6)) return "Invalid formation facing";
    if(order.type==='attack'&&order.cavalryMode!==undefined&&order.cavalryMode!=='ranks')return "Invalid cavalry attack mode";
    if (
      order.type === "move" &&
      (!Number.isSafeInteger(order.tile) || order.tile < 0)
    )
      return "Choose a passable destination";
    if (
      order.type === "attack" &&
      (!Number.isSafeInteger(order.targetId) || order.targetId <= 0)
    )
      return "Invalid attack target";
  }
  if (
    command.type === "army-members" &&
    !["add", "remove"].includes(command.action)
  )
    return "Invalid army membership action";
  if (command.type === "army-auto" && typeof command.enabled !== "boolean")
    return "Invalid automatic tactics setting";
  if (command.type === "army-order") {
    const order = command.order;
    if (
      !order ||
      ![
        "move",
        "deploy",
        "regroup",
        "attack",
        "flank-left",
        "flank-right",
        "fire-retreat",
        "hold",
      ].includes(order.type)
    )
      return "Invalid army order";
    if (
      ["move", "deploy", "regroup"].includes(order.type) &&
      (!Number.isSafeInteger((order as { tile: number }).tile) ||
        (order as { tile: number }).tile < 0)
    )
      return "Invalid army destination";
    if (
      ["attack", "flank-left", "flank-right", "fire-retreat"].includes(
        order.type,
      ) &&
      (!Number.isSafeInteger((order as { targetId: number }).targetId) ||
        (order as { targetId: number }).targetId <= 0)
    )
      return "Invalid army target";
  }
  return bounds ? boundsRejection(command, bounds) : null;
}
