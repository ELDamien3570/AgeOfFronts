import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import type { Building } from "../../src/skirmish/Protocol";
import { AiCityRecords } from "../../src/skirmish/domain/AiCityRecords";

function fixture() {
  const data = new Uint8Array(100 * 60).fill(133),
    map = new GameMapImpl(100, 60, data, data.length),
    owners = new Uint8Array(data.length).fill(1),
    buildings: Building[] = [];
  const add = (type: Building["type"], x: number, y: number) =>
    buildings.push({
      id: buildings.length + 1,
      type,
      tile: map.ref(x, y),
      playerId: 1,
      remainingTicks: 0,
    });
  const cities = new AiCityRecords(map, owners, () => buildings);
  return { map, owners, buildings, add, cities };
}
function finish(cities: AiCityRecords, start = 0) {
  let tick = start;
  do {
    expect(cities.step(tick++, 37, 3)).toBeLessThanOrEqual(37);
    expect(cities.diagnostics.facts).toBeLessThanOrEqual(3);
    expect(tick - start).toBeLessThan(10000);
  } while (cities.diagnostics.pending);
  return tick;
}
describe("owned productive city records", () => {
  it("deduplicates stacks, excludes towers and prevents a thin chain merging distant cities", () => {
    const { map, add, cities } = fixture();
    add("city", 10, 25);
    add("city", 10, 25);
    add("factory", 18, 25);
    add("mine", 28, 25);
    add("mine", 38, 25);
    add("mine", 48, 25);
    add("mine", 58, 25);
    add("city", 75, 25);
    add("factory", 67, 25);
    add("tower", 90, 25);
    finish(cities);
    const first = cities.records.get(`1:${map.ref(10, 25)}`)!,
      last = cities.records.get(`1:${map.ref(75, 25)}`)!;
    expect(first.sites.filter((t) => t === map.ref(10, 25))).toHaveLength(1);
    expect(first.buildings).toContain(1);
    expect(first.buildings).toContain(2);
    expect(first.bounds.right).toBeLessThanOrEqual(34);
    expect(last.bounds.left).toBeGreaterThanOrEqual(51);
    expect([...cities.records.values()].flatMap((r) => r.sites)).not.toContain(
      map.ref(90, 25),
    );
    expect(cities.valid(first)).toBe(true);
  });
  it("keeps a site across an allied or enemy strip out of the owned city and resumes deterministically", () => {
    const { map, add, cities, owners, buildings } = fixture();
    add("city", 10, 25);
    add("mine", 20, 25);
    for (let y = 0; y < 60; y++) owners[map.ref(15, y)] = 2;
    cities.step(0, 7, 1);
    const restored = new AiCityRecords(map, owners, () => buildings);
    restored.restore(cities.checkpoint());
    for (let tick = 1; tick < 10000; tick++) {
      expect(cities.step(tick, 37, 3)).toBe(restored.step(tick, 37, 3));
      if (!cities.diagnostics.pending) break;
    }
    expect(restored.checkpoint()).toEqual(cities.checkpoint());
    const city = cities.records.get(`1:${map.ref(10, 25)}`)!;
    expect(city.sites).not.toContain(map.ref(20, 25));
    owners[map.ref(10, 25)] = 2;
    expect(cities.valid(city)).toBe(false);
  });
});
