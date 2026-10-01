import type { Command } from "../Protocol";
import { MAX_SQUADS } from "../Protocol";
import { BUILDING_RULES, MAX_SHIPS } from "../Rules";
import { AGES } from "./Definitions";
// Runtime boundary shared by local worker and eventual authenticated transport.
// Authentication is deliberately outside this pure shape validation policy.
export function commandRejection(command: Command): string | null {
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
    ["army-members", "army-order", "army-auto", "disband-army"].includes(
      command.type,
    ) &&
    (!Number.isSafeInteger((command as { armyId: number }).armyId) ||
      (command as { armyId: number }).armyId <= 0)
  )
    return "Invalid army identity";
  for (const field of ["squadIds", "shipIds", "aircraftIds", "buildingIds"] as const)
    if (field in command) {
      const ids = (command as unknown as Record<string, unknown>)[field],
        cap =
          field === "buildingIds" ? 10_000 : field === "squadIds"
            ? MAX_SQUADS
            : field === "shipIds"
              ? MAX_SHIPS
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
  if (command.type === "order") {
    const order = command.order;
    if (
      !order ||
      typeof order !== "object" ||
      !["hold", "replenish", "board", "move", "attack"].includes(order.type)
    )
      return "Invalid order";
    if (
      (order.type === "move" || order.type === "board") &&
      (!Number.isSafeInteger(order.tile) || order.tile < 0)
    )
      return "Choose a passable destination";
    if (
      order.type === "attack" &&
      (!Number.isSafeInteger(order.targetId) || order.targetId <= 0)
    )
      return "Invalid attack target";
    if (
      order.type === "board" &&
      (!Number.isSafeInteger(order.shipId) || order.shipId <= 0)
    )
      return "Invalid boarding target";
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
  return null;
}
