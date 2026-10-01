import { z } from "zod";
import { AGES } from "../domain/Definitions";
import { BUILDING_RULES } from "../Rules";
const id = z.number().int().nonnegative().max(10_000_000);
const ids = z.array(id).min(1).max(200);
const text = z.string().min(1).max(100);
const point = {
  x: z.number().int().min(-1000000).max(1000000),
  y: z.number().int().min(-1000000).max(1000000),
};
const order = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hold") }).strict(),
  z.object({ type: z.literal("replenish") }).strict(),
  z
    .object({
      type: z.literal("move"),
      tile: id,
      x: point.x.optional(),
      y: point.y.optional(),
    })
    .strict(),
  z.object({ type: z.literal("attack"), targetId: id }).strict(),
  z.object({ type: z.literal("board"), shipId: id, tile: id }).strict(),
]);
const command = <T extends string>(
  type: T,
  fields: Record<string, z.ZodType> = {},
) => z.object({ type: z.literal(type), playerId: id, ...fields }).strict();
const armyOrder = z.union([
  z.object({ type: z.enum(["move", "deploy", "regroup"]), tile: id }).strict(),
  z
    .object({
      type: z.enum(["attack", "flank-left", "flank-right", "fire-retreat"]),
      targetId: id,
    })
    .strict(),
  z.object({ type: z.literal("hold") }).strict(),
]);
/** Transport shape validation; domain code still decides ownership, legality and price. */
export const commandSchema = z.discriminatedUnion("type", [
  command("create-army", { squadIds: ids }),
  command("army-members", {
    armyId: id,
    squadIds: ids,
    action: z.enum(["add", "remove"]),
  }),
  command("disband-army", { armyId: id }),
  command("army-auto", { armyId: id, enabled: z.boolean() }),
  command("army-order", {
    armyId: id,
    order: armyOrder,
    append: z.boolean().optional(),
  }),
  command("refit-ships", { shipIds: ids, definitionId: text }),
  command("naval-attack", { shipIds: ids, targetId: id }),
  command("research", { technologyId: text }),
  command("advance-age"),
  command("produce", { buildingId: id, recipeId: text.nullable() }),
  command("refit", { squadIds: ids, definitionId: text }),
  command("charge", { squadIds: ids, ...point, targetId: id.optional() }),
  command("attack-structure", {
    squadIds: ids,
    buildingId: id.optional(),
    barrierId: id.optional(),
  }),
  command("alliance", {
    otherId: id,
    action: z.enum(["offer", "accept", "reject", "renew", "break"]),
  }),
  command("repair", { buildingId: id.optional(), barrierId: id.optional() }),
  command("recruit-aircraft", {
    buildingId: id,
    buildingIds: z.array(id).min(1).max(10_000).optional(),
    autoRecruit: z.boolean().optional(),
    definitionId: z.enum(["fighter", "bomber"]),
  }),
  command("sortie", { aircraftIds: ids, ...point }),
  command("launch", {
    launcherId: id,
    payload: z.enum(["icbm", "hydrogen", "mirv"]),
    ...point,
  }),
  command("recruit", {
    buildingId: id,
    buildingIds: z.array(id).min(1).max(10_000).optional(),
    autoRecruit: z.boolean().optional(),
    definitionId: text.optional(),
  }),
  command("build", {
    buildingType: z.enum(Object.keys(BUILDING_RULES) as [string, ...string[]]),
    tile: id,
    age: z.enum(AGES).optional(),
  }),
  command("recruit-ship", {
    buildingId: id,
    buildingIds: z.array(id).min(1).max(10_000).optional(),
    autoRecruit: z.boolean().optional(),
    shipType: z.enum(["transport", "warship"]),
    definitionId: text.optional(),
  }),
  command("sail", { shipIds: ids, tile: id, append: z.boolean().optional() }),
  command("stop-ships", { shipIds: ids }),
  command("load", { shipId: id, squadIds: ids }),
  command("board", { shipId: id, squadIds: ids }),
  command("unload", { shipId: id, tile: id }),
  command("order", { squadIds: ids, order, append: z.boolean().optional() }),
]);
