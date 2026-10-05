import { describe, expect, it } from "vitest";
import { updateSnapshotBuilding } from "./BuildingFixtures";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { ControlGroups } from "../../src/skirmish/client/ControlGroups";
import { hotkeyAction, shipMoveCommand } from "../../src/skirmish/client/Controls";
import {
  SkirmishViewModel,
  type SelectionState,
} from "../../src/skirmish/client/SkirmishViewModel";
import {
  UnitPresentation,
  visibleInViewport,
} from "../../src/skirmish/client/UnitPresentation";
import {
  FIXED,
  MAX_SQUADS,
  type BuildingType,
} from "../../src/skirmish/Protocol";
import { MAX_SHIPS } from "../../src/skirmish/Rules";
import { Skirmish } from "../../src/skirmish/Simulation";

function match() {
  const terrain = new Uint8Array(80 * 50).fill(133);
  terrain.fill(0, 0, 80 * 6);
  return new Skirmish(new GameMapImpl(80, 50, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    runAi: false,
  });
}
describe("ship right-click intent",()=>{
  it("sends water orders for own ships and land orders only for loaded transports",()=>{
    const m=match(),squad=m.squads.find(s=>s.playerId===1)!;
    const ships=["transport","warship","transport"] as const;
    const owned=ships.map((kind,i)=>m.addShip({id:m.allocateId(),playerId:1,kind,x:(i+10.5)*FIXED,y:3.5*FIXED,
      health:100,destination:null,waypoints:[],path:[],nextPathIndex:0,fighting:false,boarding:null}));
    const rival=m.addShip({...owned[0],id:m.allocateId(),playerId:2});
    m.updateSquad(squad.id,{embarkedOn:owned[0].id});
    const snapshot=m.snapshot(),selected=new Set([...owned,rival].map(s=>s.id));
    expect(shipMoveCommand(snapshot,selected,1,900,false,false)).toEqual({type:"sail",playerId:1,shipIds:[owned[0].id],tile:900,append:false});
    expect(shipMoveCommand(snapshot,selected,1,80,true,true)?.shipIds).toEqual(owned.map(s=>s.id));
    expect(shipMoveCommand(snapshot,new Set([owned[1].id,owned[2].id,rival.id]),1,900,false,false)).toBeNull();
  });
});
function selection(): SelectionState {
  return {
    selected: new Set(),
    selectedShips: new Set(),
    selectedBuilding: null,
  };
}
function own(m: Skirmish, tile: number, id = 1) {
  const old = m.owners[tile];
  if (old === id) return;
  if (old) m.player(old)!.land--;
  m.owners[tile] = id;
  m.player(id)!.land++;
}
function build(m: Skirmish, type: BuildingType, x: number, y: number) {
  const tile = m.map.ref(x, y);
  own(m, tile);
  m.players[0].gold = 10000;
  expect(
    m.applyCommand({ type: "build", playerId: 1, buildingType: type, tile }),
  ).toBeNull();
  const building = m.buildings[m.buildings.length - 1];
  m.updateBuilding((building).id, { remainingTicks: 0 });
  return building;
}

describe("keyboard command mapping", () => {
  const key = (code: string, overrides = {}) =>
    hotkeyAction({
      code,
      repeat: false,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      ...overrides,
    });
  it("routes the requested unit, building, replenishment, and hold keys", () => {
    const expected = {
      Q: { type: "recruit", kind: "infantry" },
      W: { type: "recruit", kind: "archer" },
      E: { type: "recruit", kind: "cavalry" },
      A: { type: "construct", kind: "city" },
      S: { type: "construct", kind: "factory" },
      D: { type: "construct", kind: "port" },
      F: { type: "construct", kind: "barracks" },
      G: { type: "construct", kind: "archery" },
      H: { type: "construct", kind: "stables" },
      T: { type: "hold" },
      B: { type: "recruit-ship", kind: "warship" },
      R: { type: "replenish" },
      P: { type: "sortie" },
      Z: { type: "construct", kind: "mine" },
      X: { type: "construct", kind: "oil-well" },
      C: { type: "construct", kind: "blacksmith" },
      V: { type: "construct", kind: "armory" },
      N: { type: "construct", kind: "arms-factory" },
    };
    for (const [letter, action] of Object.entries(expected))
      expect(key(`Key${letter}`)).toEqual(action);
    expect(key("KeyA", { ctrlKey: true })).toEqual({ type: "select-all" });
    expect(key("KeyA", { metaKey: true })).toEqual({ type: "select-all" });
  });
  it("handles all ten Shift+digits by physical code and preserves browser shortcuts and key-repeat safety", () => {
    for (let digit = 0; digit <= 9; digit++) {
      expect(key(`Digit${digit}`, { shiftKey: true })).toEqual({
        type: "group",
        digit,
        mode: "add",
      });
      expect(key(`Digit${digit}`, { ctrlKey: true })).toEqual({
        type: "group",
        digit,
        mode: "replace",
      });
      expect(key(`Digit${digit}`)).toEqual({
        type: "group",
        digit,
        mode: "recall",
      });
    }
    expect(key("Numpad0", { metaKey: true })).toEqual({
      type: "group",
      digit: 0,
      mode: "replace",
    });
    expect(key("KeyW", { ctrlKey: true })).toBeNull();
    expect(key("KeyH", { altKey: true })).toBeNull();
    expect(key("KeyQ", { repeat: true })).toBeNull();
    expect(key("Space", { repeat: true })).toBeNull();
  });
});

describe("automatic recruitment and selective replenishment", () => {
  it("offers all unit types independently of the inspected building and chooses the nearest ready recruiter", () => {
    const m = match(),
      s = selection();
    const first = build(m, "archery", 20, 20),
      second = build(m, "archery", 45, 20);
    s.selectedBuilding = m.buildings.find((b) => b.playerId === 2)!.id;
    const army = m.squads[0];
    m.updateSquad(army.id, { x: 44 * FIXED });
    m.updateSquad(army.id, { y: 20 * FIXED });
    s.selected.add(army.id);
    let vm = new SkirmishViewModel(m.snapshot(), s);
    expect(vm.recruitment("archer").building?.id).toBe(second.id);
    expect(vm.recruitment("archer").enabled).toBe(true);
    expect(vm.recruitment("infantry").enabled).toBe(true);
    expect(vm.recruitment("cavalry").enabled).toBe(false);
    m.updateBuilding((second).id, { remainingTicks: 1 });
    vm = new SkirmishViewModel(m.snapshot(), s);
    expect(vm.recruitment("archer").building?.id).toBe(first.id);
    m.updateBuilding((first).id, { playerId: 2 });
    expect(
      new SkirmishViewModel(m.snapshot(), s).recruitment("archer").enabled,
    ).toBe(false);
  });
  it("uses the camp with no selection, with stable tie-breaking, and keeps reserve and squad limits", () => {
    const m = match(),
      s = selection(),
      snapshot = m.snapshot();
    const initial = snapshot.buildings.find((b) => b.playerId === 1)!;
    snapshot.buildings.push({ ...initial, id: 999 });
    const vm = new SkirmishViewModel(snapshot, s);
    expect(vm.recruitment("infantry").building?.id).toBe(initial.id);
    snapshot.players[0].reserves = 999;
    expect(vm.recruitment("infantry").reason).toMatch(/1,000/);
    snapshot.players[0].reserves = 10000;
    while (
      snapshot.squads.filter((unit) => unit.playerId === 1).length < MAX_SQUADS
    )
      snapshot.squads.push({
        ...snapshot.squads[0],
        id: 1000 + snapshot.squads.length,
      });
    expect(vm.recruitment("infantry").reason).toMatch(/limit/);
  });
  it("recruits ships from the closest ready port without inspection and respects gold and fleet limits", () => {
    const m = match(),
      s = selection(),
      first = build(m, "port", 20, 6),
      second = build(m, "port", 50, 6);
    const army = m.squads[0];
    m.updateSquad(army.id, { x: 49 * FIXED });
    m.updateSquad(army.id, { y: 7 * FIXED });
    s.selected.add(army.id);
    const snapshot = m.snapshot(),
      vm = new SkirmishViewModel(snapshot, s);
    expect(vm.recruitment("transport").building?.id).toBe(second.id);
    expect(vm.recruitment("warship").enabled).toBe(true);
    snapshot.players[0].gold = 300;
    expect(vm.recruitment("transport").enabled).toBe(true);
    expect(vm.recruitment("warship").enabled).toBe(false);
    updateSnapshotBuilding(snapshot, (snapshot.buildings.find((b) => b.id === second.id)!).id, { remainingTicks: 1 });
    expect(vm.recruitment("transport").building?.id).toBe(first.id);
    m.applyCommand({
      type: "recruit-ship",
      playerId: 1,
      buildingId: first.id,
      shipType: "transport",
    });
    snapshot.ships = m.snapshot().ships;
    while (snapshot.ships.length < MAX_SHIPS)
      snapshot.ships.push({
        ...snapshot.ships[0],
        id: 1000 + snapshot.ships.length,
      });
    expect(vm.recruitment("transport").reason).toMatch(/limit/);
  });
  it("R orders only damaged friendly selected land squads, preserving other units' orders", () => {
    const m = match(),
      s = selection(),
      [friendly, hostile, full, aboard] = m.squads.filter(
        (unit) => unit.playerId === 1,
      );
    for (const unit of [friendly, hostile, full, aboard]) {
      m.updateSquad(unit.id, { troops: 800 });
      s.selected.add(unit.id);
    }
    m.updateSquad(full.id, { troops: 1000 });
    m.updateSquad(aboard.id, { embarkedOn: 900 });
    own(m, m.tileOf(friendly));
    own(m, m.tileOf(hostile), 2);
    m.updateSquad(hostile.id, { order: {
      type: "attack",
      targetId: m.squads.find((unit) => unit.playerId === 2)!.id,
    } });
    const vm = new SkirmishViewModel(m.snapshot(), s);
    expect(vm.replenishableSquads.map((unit) => unit.id)).toEqual([
      friendly.id,
    ]);
    expect(vm.canReplenish).toBe(true);
    expect(
      m.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: vm.replenishableSquads.map((unit) => unit.id),
        order: { type: "replenish" },
      }),
    ).toBeNull();
    expect(friendly.order.type).toBe("replenish");
    expect(hostile.order.type).toBe("attack");
    expect(full.order.type).toBe("hold");
    m.players[0].reserves = 0;
    expect(new SkirmishViewModel(m.snapshot(), s).canReplenish).toBe(false);
  });

  it("identifies repairable selected buildings and supports repair commands", () => {
    const terrain = new Uint8Array(80 * 50).fill(133);
    terrain.fill(0, 0, 80 * 6);
    const m = new Skirmish(new GameMapImpl(80, 50, terrain, terrain.length), {
      seed: 42,
      aiCount: 1,
      runAi: false,
      ruleset: "ages-v1",
    });
    const s = selection();
    const barracks = build(m, "barracks", 20, 10);
    const city = build(m, "city", 25, 10);
    m.updateBuilding((barracks).id, { health: 600 });
    m.updateBuilding((city).id, { health: 800 });
    m.players[0].gold = 5000;

    s.selectedBuildings = new Set([barracks.id, city.id]);
    s.selectedBuilding = barracks.id;

    const vm = new SkirmishViewModel(m.snapshot(), s);
    expect(vm.selectedBuildings.map((b) => b.id).sort()).toEqual(
      [barracks.id, city.id].sort(),
    );
    expect(vm.repairableBuildings.map((b) => b.id).sort()).toEqual(
      [barracks.id, city.id].sort(),
    );
    expect(vm.canRepairBuildings).toBe(true);

    expect(
      m.applyCommand({
        type: "repair",
        playerId: 1,
        buildingIds: [barracks.id, city.id],
      }),
    ).toBeNull();

    expect(
      m.applyCommand({
        type: "repair",
        playerId: 1,
        buildingId: barracks.id,
      }),
    ).toBe("No repair needed or repair already in progress");
  });
});

describe("control group selection", () => {
  it("adds and deduplicates squads and ships; recall returns independent sets and replacement can clear", () => {
    const m = match(),
      s = selection(),
      groups = new ControlGroups(),
      port = build(m, "port", 25, 6);
    m.applyCommand({
      type: "recruit-ship",
      playerId: 1,
      buildingId: port.id,
      shipType: "transport",
    });
    const [one, two] = m.squads.filter((unit) => unit.playerId === 1);
    s.selected.add(one.id);
    groups.bind(1, s, m.snapshot(), true);
    s.selected.add(two.id);
    s.selectedShips.add(m.ships[0].id);
    groups.bind(1, s, m.snapshot(), true);
    groups.bind(1, s, m.snapshot(), true);
    expect(groups.count(1)).toBe(3);
    const recalled = groups.recall(1, m.snapshot());
    recalled.selected.clear();
    expect(groups.recall(1, m.snapshot()).selected).toEqual(
      new Set([one.id, two.id]),
    );
    groups.bind(1, selection(), m.snapshot(), false);
    expect(groups.count(1)).toBe(0);
  });
  it("keeps embarked members for landing, prunes losses and enemy IDs, and resets between matches", () => {
    const m = match(),
      s = selection(),
      groups = new ControlGroups();
    const ownUnit = m.squads[0],
      enemy = m.squads.find((unit) => unit.playerId === 2)!;
    s.selected.add(ownUnit.id);
    s.selected.add(enemy.id);
    groups.bind(0, s, m.snapshot(), true);
    expect(groups.count(0)).toBe(1);
    m.updateSquad(ownUnit.id, { embarkedOn: 50 });
    expect(groups.recall(0, m.snapshot()).selected.size).toBe(0);
    expect(groups.count(0)).toBe(1);
    m.updateSquad(ownUnit.id, { embarkedOn: null });
    expect(groups.recall(0, m.snapshot()).selected.has(ownUnit.id)).toBe(true);
    for (const record of m.squads.slice(m.squads.indexOf(ownUnit), (m.squads.indexOf(ownUnit)) + (1))) m.removeSquad(record.id);
    expect(groups.recall(0, m.snapshot()).selected.size).toBe(0);
    expect(groups.count(0)).toBe(0);
    groups.bind(
      2,
      { selected: new Set([m.squads[0].id]), selectedShips: new Set() },
      m.snapshot(),
      true,
    );
    groups.reset();
    expect(groups.count(2)).toBe(0);
  });
});

describe("viewport and travel-facing presentation", () => {
  it("includes partially visible sprites, excludes off-screen sprites, and follows changed zoom bounds", () => {
    expect(visibleInViewport({ x: 50, y: 50 }, 10, 100, 100)).toBe(true);
    expect(visibleInViewport({ x: -9, y: 50 }, 10, 100, 100)).toBe(true);
    expect(visibleInViewport({ x: -11, y: 50 }, 10, 100, 100)).toBe(false);
    expect(visibleInViewport({ x: 150, y: 50 }, 10, 100, 100)).toBe(false);
    expect(visibleInViewport({ x: 75, y: 25 }, 10, 100, 100)).toBe(true);
  });
  it("faces actual travel, retains direction while holding, and ignores transport travel or landing teleports", () => {
    const m = match(),
      unit = m.squads[0],
      presentation = new UnitPresentation();
    presentation.update(m.snapshot());
    expect(presentation.angle(unit.id)).toBe(0);
    m.updateSquad(unit.id, { x: unit.x + (FIXED) });
    presentation.update(m.snapshot());
    expect(presentation.angle(unit.id)).toBeCloseTo(-Math.PI / 2);
    presentation.update(m.snapshot());
    expect(presentation.angle(unit.id)).toBeCloseTo(-Math.PI / 2);
    m.updateSquad(unit.id, { y: unit.y - (FIXED) });
    presentation.update(m.snapshot());
    expect(presentation.angle(unit.id)).toBeCloseTo(-Math.PI);
    m.updateSquad(unit.id, { embarkedOn: 50 });
    m.updateSquad(unit.id, { x: unit.x + (10 * FIXED) });
    presentation.update(m.snapshot());
    m.updateSquad(unit.id, { embarkedOn: null });
    m.updateSquad(unit.id, { y: unit.y + (5 * FIXED) });
    presentation.update(m.snapshot());
    expect(presentation.angle(unit.id)).toBeCloseTo(-Math.PI);
    presentation.reset();
    expect(presentation.angle(unit.id)).toBe(0);
  });
});
