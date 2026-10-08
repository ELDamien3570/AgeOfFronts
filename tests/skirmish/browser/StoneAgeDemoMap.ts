import { GameMapImpl } from "../../../src/core/game/GameMap";

export function stoneAgeDemoMap(): GameMapImpl {
  const terrain = new Uint8Array(128 * 128).fill(133);
  return new GameMapImpl(128, 128, terrain, terrain.length);
}
