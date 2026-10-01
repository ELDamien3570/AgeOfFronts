import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  ARTWORK_CATALOG,
  buildingArtworkId,
} from "../../src/skirmish/client/ArtworkCatalog";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture(port = false) {
  const terrain = new Uint8Array(80 * 50).fill(133);
  if (port)
    for (let y = 20; y < 30; y++)
      for (let x = 0; x < 80; x++) terrain[y * 80 + x] = 0;
  const m = new Skirmish(new GameMapImpl(80, 50, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  for (const s of m.squads) {
    s.x = 70 * FIXED;
    s.y = 40 * FIXED;
  }
  const factory = {
    id: m.allocateId(),
    type: "factory" as const,
    tile: m.map.ref(10, 15),
    playerId: 1,
    remainingTicks: 0,
    age: "StoneAge" as const,
  };
  m.buildings.push(factory);
  if (port)
    m.buildings.push(
      { ...factory, id: m.allocateId(), type: "port", tile: m.map.ref(10, 19) },
      { ...factory, id: m.allocateId(), type: "port", tile: m.map.ref(30, 19) },
    );
  m.expansion!.supply.goods.set(factory.id, 100);
  const dispatch = () => {
    m.tick += 20;
    m.expansion!.trade.step();
  };
  return {
    m,
    dispatch,
    research: m.expansion!.progression.states[1].completed,
  };
}

describe("independent trade unlocks", () => {
  it("keeps workshop production separate from land dispatch, then unlocks a visible trader with Goods Handling", () => {
    const { m, dispatch, research } = fixture();
    research.push("stoneage-craft-workshops");
    dispatch();
    expect(m.expansion!.trade.actors).toHaveLength(0);
    research.push("stoneage-goods-handling");
    dispatch();
    expect(m.expansion!.trade.actors).toHaveLength(1);
    expect(m.expansion!.trade.actors[0]).toMatchObject({
      naval: false,
      definitionId: "stoneage-trader",
    });
    expect(ARTWORK_CATALOG["stoneage-trader"].clips?.travel).toBeDefined();
  });
  it("unlocks a water trader with Cargo Canoes without Goods Handling", () => {
    const { m, dispatch, research } = fixture(true);
    research.push("stoneage-craft-workshops");
    dispatch();
    expect(m.expansion!.trade.actors).toHaveLength(0);
    research.push("stoneage-cargo-canoes");
    dispatch();
    expect(m.expansion!.trade.actors).toHaveLength(1);
    expect(m.expansion!.trade.actors[0]).toMatchObject({
      naval: true,
      definitionId: "stoneage-trade",
    });
  });
  it("does not substitute land traders for water research when there is no reachable port", () => {
    const { m, dispatch, research } = fixture();
    research.push("stoneage-cargo-canoes");
    dispatch();
    expect(m.expansion!.trade.actors).toHaveLength(0);
  });
  it("uses the approved supplied workshop art for the actual Stone Age building", () => {
    const id = buildingArtworkId("siege-workshop", "StoneAge")!;
    expect(ARTWORK_CATALOG[id].file).toBe(
      "building-bronzeage-siege-workshop.png",
    );
  });
});
