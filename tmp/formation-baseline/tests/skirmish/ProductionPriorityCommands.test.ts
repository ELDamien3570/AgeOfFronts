import { describe, expect, it } from "vitest";
import { commandSchema } from "../../src/skirmish/multiplayer/CommandSchema";

describe("production priority transport commands", () => {
  it.each([null, [], ["refine-bronze"], ["refine-bronze", "refine-steel"]])(
    "accepts bounded priorities or automatic reset: %j",
    (recipeIds) => {
      const command = {
        type: "production-priority",
        playerId: 1,
        buildingType: "factory",
        recipeIds,
      };
      expect(commandSchema.parse(command)).toEqual(command);
    },
  );
  it("accepts resetting all priorities", () => {
    const command = { type: "reset-production-priorities", playerId: 1 };
    expect(commandSchema.parse(command)).toEqual(command);
  });
  it.each([
    { buildingType: "unknown", recipeIds: [] },
    { buildingType: "factory", recipeIds: [""] },
    { buildingType: "factory", recipeIds: Array(101).fill("refine-bronze") },
    { buildingType: "factory", recipeIds: "refine-bronze" },
  ])("rejects malformed priority commands: %j", (fields) => {
    expect(
      commandSchema.safeParse({
        type: "production-priority",
        playerId: 1,
        ...fields,
      }).success,
    ).toBe(false);
  });
});
