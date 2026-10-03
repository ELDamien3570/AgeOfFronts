import { retainSquads } from "./UnitFixtures";
import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { shoreTransportCapacity } from "../../src/skirmish/content/ShoreTransport";
import { VESSELS } from "../../src/skirmish/content/Units";

function make(count = 4, rivers = [30], island = false, deferredPlanning = false) {
  const width = 96,
    height = 64,
    data = new Uint8Array(width * height).fill(133);
  for (const x of rivers)
    for (let y = 0; y < height; y++)
      for (let dx = 0; dx < 3; dx++) data[y * width + x + dx] = 0;
  if (island) {
    for (let y = 0; y < height; y++)
      for (let x = 30; x < width; x++) data[y * width + x] = 0;
    for (let y = 25; y < 27; y++)
      for (let x = 75; x < 77; x++) data[y * width + x] = 133;
  }
  const match = new Skirmish(
    new GameMapImpl(width, height, data, data.filter((t) => t & 128).length),
    { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning },
  );
  const original = match.squads.find((s) => s.playerId === 1)!;
  let own = Array.from(
    { length: count },
    (_, i): Squad => ({
      ...original,
      id: 100 + i,
      x: (15 + (i % 4)) * FIXED + FIXED / 2,
      y: (25 + Math.floor(i / 4)) * FIXED + FIXED / 2,
      order: { type: "hold" },
      path: [],
      queuedOrders: [],
    }),
  );
  own = retainSquads(match, [...match.squads.filter((s) => s.playerId !== 1), ...own]).filter(s => s.playerId === 1);
  for (const s of match.squads.filter((s) => s.playerId !== 1)) {
    match.updateSquad(s.id, { x: 85 * FIXED });
    match.updateSquad(s.id, { y: 55 * FIXED });
  }
  match.owners.fill(0); // Shore embarkation must also work from neutral territory.
  return { match, own, target: match.map.ref(75, 25) };
}
function move(m: ReturnType<typeof make>, append = false) {
  return m.match.applyCommand({
    type: "order",
    playerId: 1,
    squadIds: m.own.map((s) => s.id),
    order: { type: "move", tile: m.target },
    append,
  });
}
function unlock(m: ReturnType<typeof make>) {
  m.match.expansion!.progression.states[1].completed.push(
    "stoneage-cargo-canoes",
  );
}
function run(m: ReturnType<typeof make>, ticks = 2500) {
  for (let i = 0; i < ticks; i++) m.match.step();
}

describe("automatic researched shore transport", () => {
  it("returns real cargo to departure after landing permission is withdrawn during passage",()=>{
    const m=make(4,[30],false,true);unlock(m);m.match.options.aiWarPolicy=true;m.match.setAiController(1,true);
    let withdrawn=false;
    vi.spyOn(m.match.expansion!.operations,"canEnter").mockImplementation((_id,_rival,tile)=>!withdrawn || m.match.map.x(tile)<30);
    expect(move(m)).toBeNull();let embarked=false,returned=false;
    for(let i=0;i<3000;i++){
      m.match.step();
      if(m.own.every(s=>s.embarkedOn!==null)){embarked=true;withdrawn=true;}
      if(embarked && m.own.every(s=>s.embarkedOn===null && m.match.map.x(m.match.tileOf(s))<30)){returned=true;break;}
    }
    expect(embarked).toBe(true);expect(returned).toBe(true);expect(m.match.ships).toHaveLength(0);
  });
  it.each([false, true])("embarks to open water, retains cargo afloat, then sails and manually lands (deferred=%s)", deferred => {
    const m = make(4, [30], false, deferred); unlock(m);
    m.target = m.match.map.ref(31, 45);
    const troops = m.own.reduce((sum,s) => sum+s.troops,0);
    expect(move(m)).toBeNull();
    for(let i=0;i<3000 && !m.match.ships.some(s=>s.shoreTransfer?.phase === "afloat");i++) m.match.step();
    const ship = m.match.ships.find(s=>s.shoreTransfer?.phase === "afloat")!;
    expect(ship).toBeDefined();
    expect(m.match.tileOf(ship)).toBe(m.target);
    expect(m.own.every(s=>s.embarkedOn === ship.id)).toBe(true);
    const restored = new Skirmish(m.match.map, m.match.options); restored.restore(m.match.checkpoint());
    expect(restored.ship(ship.id)?.shoreTransfer?.phase).toBe("afloat");
    const beforeInvalid = m.match.checkpoint();
    expect(m.match.applyCommand({type:"unload",playerId:1,shipId:ship.id,tile:m.target}))
      .toBe("Choose passable coastal land directly beside the transport");
    expect(m.match.checkpoint()).toEqual(beforeInvalid);
    const end = m.match.map.ref(30,25);
    expect(m.match.applyCommand({type:"sail",playerId:1,shipIds:[ship.id],tile:end})).toBeNull();
    for(let i=0;i<100 && ship.destination===null;i++)m.match.step();
    expect(ship.destination).not.toBeNull();
    expect(m.match.applyCommand({type:"unload",playerId:1,shipId:ship.id,tile:m.match.map.ref(29,25)}))
      .toBe("Stop beside the landing coast before unloading");
    for(let i=0;i<1200 && m.match.tileOf(ship)!==end;i++)m.match.step();
    expect(m.match.tileOf(ship)).toBe(end);
    // Sail completes at the tile center before unloading from an adjacent shore.
    for(let i=0;i<20;i++)m.match.step();
    expect(m.match.applyCommand({type:"unload",playerId:1,shipId:ship.id,tile:m.match.map.ref(29,25)})).toBeNull();
    for(let i=0;i<500 && m.own.some(s=>s.embarkedOn!==null);i++)m.match.step();
    expect(m.own.every(s=>s.embarkedOn===null && m.match.map.x(m.match.tileOf(s))<30)).toBe(true);
    expect(m.own.reduce((sum,s)=>sum+s.troops,0)).toBe(troops);
    expect(m.match.ships).toHaveLength(0);
  });
  it("preserves an unchanged pending shore query through repeated AI orders and completes the crossing", () => {
    const m = make(4,[30],false,true); unlock(m); m.match.setAiController(1,true);
    expect(move(m)).toBeNull(); const id=m.match.checkpoint().shorePlanning.pending[0][0];
    for(let i=0;i<30 && m.match.checkpoint().shorePlanning.pending.length;i++){
      expect(m.match.checkpoint().shorePlanning.pending[0][0]).toBe(id);
      expect(move(m)).toBeNull();m.match.step();
    }
    run(m,3000);
    expect(m.own.every(s=>s.embarkedOn===null && m.match.map.x(m.match.tileOf(s))>65)).toBe(true);
  });
  it("lands another waiting squad when a previously occupied island slot clears", () => {
    const m = make(10, [], true);
    unlock(m);
    expect(move(m)).toBeNull();
    const ship = m.match.ships[0];
    run(m, 2500);
    const evacuated = m.own.find((s) => s.embarkedOn === null)!;
    // Fixture evacuation: free one footprint without changing waiting cargo.
    m.match.updateSquad(evacuated.id, { x: 15 * FIXED + FIXED / 2 });
    m.match.updateSquad(evacuated.id, { y: 15 * FIXED + FIXED / 2 });
    m.match.updateSquad(evacuated.id, { order: { type: "hold" } });
    m.match.updateSquad(evacuated.id, { path: [] });
    m.match.updateSquad(evacuated.id, { queuedOrders: [] });
    run(m, 100);
    expect(m.own.filter((s) => s.embarkedOn === ship.id)).toHaveLength(5);
    expect(
      m.own.filter(
        (s) => s.embarkedOn === null && m.match.map.x(m.match.tileOf(s)) >= 75,
      ),
    ).toHaveLength(4);
  });
  it("partially lands on a four-tile island and lets remaining cargo return safely", () => {
    const m = make(10, [], true);
    unlock(m);
    const troops = m.own.reduce((sum, s) => sum + s.troops, 0);
    expect(move(m)).toBeNull();
    const ship = m.match.ships[0];
    run(m, 2500);
    const landed = m.own.filter((s) => s.embarkedOn === null);
    const aboard = m.own.filter((s) => s.embarkedOn === ship.id);
    expect(landed).toHaveLength(4);
    expect(aboard).toHaveLength(6);
    expect(m.match.ships).toContain(ship);
    expect(m.own.reduce((sum, s) => sum + s.troops, 0)).toBe(troops);
    expect(new Set(landed.map((s) => m.match.tileOf(s))).size).toBe(4);
    expect(
      m.match.applyCommand({
        type: "load",
        playerId: 1,
        shipId: ship.id,
        squadIds: landed.map((s) => s.id),
      }),
    ).toContain("automatically");
    expect(
      m.match.applyCommand({
        type: "sail",
        playerId: 1,
        shipIds: [ship.id],
        tile: m.match.map.ref(30, 25),
      }),
    ).toBeNull();
    run(m, 2000);
    expect(aboard.every((s) => s.embarkedOn === ship.id)).toBe(true);
    expect(
      m.match.applyCommand({
        type: "unload",
        playerId: 1,
        shipId: ship.id,
        tile: m.match.map.ref(29, 25),
      }),
    ).toBeNull();
    expect(aboard.every((s) => s.embarkedOn === null)).toBe(true);
    expect(m.match.ships).not.toContain(ship);
    expect(m.own.reduce((sum, s) => sum + s.troops, 0)).toBe(troops);
    expect(landed.every((s) => m.match.map.x(m.match.tileOf(s)) >= 75)).toBe(
      true,
    );
  });
  it("gates embarkation and capacity by hull research, not age", () => {
    const m = make();
    // A restored/custom state may lack the normal starting branch grant.
    m.match.expansion!.progression.states[1].completed = [];
    expect(move(m)).toContain("Research Cargo Canoes");
    expect(m.match.ships).toHaveLength(0);
    expect(m.own.every((s) => s.order.type === "hold")).toBe(true);
    expect(shoreTransportCapacity([])).toBe(0);
    const completed: string[] = [];
    const capacities = [10, 12, 14, 16, 18, 20, 25];
    VESSELS.filter((v) => v.kind === "transport").forEach((v, i) => {
      completed.push(v.technologyId);
      expect(shoreTransportCapacity(completed)).toBe(capacities[i]);
    });
  });
  it("embarks, physically sails, lands and continues without a port or payment", () => {
    const m = make();
    unlock(m);
    const gold = m.match.players[0].gold,
      reserves = m.match.players[0].reserves;
    const troops = m.own.reduce((n, s) => n + s.troops, 0);
    expect(move(m)).toBeNull();
    expect(m.match.ships).toHaveLength(1);
    expect(m.match.players[0].gold).toBe(gold);
    expect(m.match.players[0].reserves).toBe(reserves);
    let sailed = false;
    for (let i = 0; i < 2500; i++) {
      m.match.step();
      for (const s of m.own)
        if (s.embarkedOn !== null) {
          sailed = true;
          expect(m.match.map.isWater(m.match.tileOf(s))).toBe(true);
        }
    }
    expect(sailed).toBe(true);
    expect(m.match.ships).toHaveLength(0);
    expect(
      m.own.every(
        (s) => s.embarkedOn === null && m.match.map.x(m.match.tileOf(s)) > 65,
      ),
    ).toBe(true);
    expect(m.own.reduce((n, s) => n + s.troops, 0)).toBe(troops);
  });
  it("splits eleven squads into capacity-safe groups and leaves no free permanent vessels", () => {
    const m = make(11);
    unlock(m);
    expect(move(m)).toBeNull();
    expect(m.match.ships).toHaveLength(2);
    expect(m.match.ships.map((s) => s.boarding!.squadIds.length)).toEqual([
      10, 1,
    ]);
    expect(
      m.match.applyCommand({
        type: "stop-ships",
        playerId: 1,
        shipIds: [m.match.ships[0].id],
      }),
    ).toContain("automatically");
    run(m, 3500);
    expect(m.match.ships).toHaveLength(0);
    expect(
      m.own.every(
        (s) => s.embarkedOn === null && m.match.map.x(m.match.tileOf(s)) > 65,
      ),
    ).toBe(true);
  });
  it("chains two isolated river crossings rather than inventing a land path through water", () => {
    const m = make(2, [30, 55]);
    unlock(m);
    expect(m.match.paths.find(m.match.tileOf(m.own[0]), m.target)).toBeNull();
    expect(move(m)).toBeNull();
    run(m, 3500);
    expect(
      m.own.every(
        (s) => s.embarkedOn === null && m.match.map.x(m.match.tileOf(s)) > 65,
      ),
    ).toBe(true);
    expect(m.match.ships).toHaveLength(0);
  });
  it("uses a quicker river crossing even when both banks connect around the headwaters", () => {
    const m = make(2, []); // Build a finite river with a real land detour.
    const width = 96,
      height = 64,
      data = new Uint8Array(width * height).fill(133);
    for (let y = 4; y < height; y++)
      for (let x = 30; x < 33; x++) data[y * width + x] = 0;
    const match = new Skirmish(
      new GameMapImpl(width, height, data, data.filter((t) => t & 128).length),
      { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" },
    );
    m.match = match;
    m.own = match.squads.filter((s) => s.playerId === 1).slice(0, 2);
    retainSquads(match, [...match.squads.filter((s) => s.playerId !== 1), ...m.own]);
    m.own.forEach((s, i) => {
      match.updateSquad(s.id, { x: (20 + i) * FIXED + FIXED / 2, y: 40 * FIXED + FIXED / 2 });
    });
    m.target = match.map.ref(42, 40);
    unlock(m);
    expect(match.paths.connected(match.tileOf(m.own[0]), m.target)).toBe(true);
    expect(move(m)).toBeNull();
    expect(match.ships).toHaveLength(1);
    run(m, 1800);
    expect(
      m.own.every(
        (s) => s.embarkedOn === null && match.map.x(match.tileOf(s)) > 33,
      ),
    ).toBe(true);
  });
  it("cancels a shore approach without stealing or losing troops", () => {
    const m = make();
    unlock(m);
    expect(move(m)).toBeNull();
    expect(
      m.match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: m.own.map((s) => s.id),
        order: { type: "hold" },
      }),
    ).toBeNull();
    run(m, 10);
    expect(m.match.ships).toHaveLength(0);
    expect(
      m.own.every((s) => s.embarkedOn === null && s.order.type === "hold"),
    ).toBe(true);
  });
  it("preserves queued moves through two voyages and keeps army membership", () => {
    const m = make(4, [30, 55]);
    unlock(m);
    m.match.expansion!.progression.states[1].completed.push("bronzeage-armies");
    expect(
      m.match.applyCommand({
        type: "create-army",
        playerId: 1,
        squadIds: m.own.map((s) => s.id),
      }),
    ).toBeNull();
    const army = m.match.expansion!.armies.armies[0];
    expect(
      m.match.applyCommand({
        type: "army-order",
        playerId: 1,
        armyId: army.id,
        order: { type: "move", tile: m.target },
      }),
    ).toBeNull();
    const onward = m.match.map.ref(78, 12);
    // Ordinary shift-clicks while approaching shore are preserved on the voyage.
    expect(
      m.match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: m.own.map((s) => s.id),
        order: { type: "move", tile: onward },
        append: true,
      }),
    ).toBeNull();
    run(m, 4000);
    expect(army.memberIds).toEqual(m.own.map((s) => s.id));
    expect(
      m.own.every(
        (s) => m.match.map.y(m.match.tileOf(s)) < 17 && s.embarkedOn === null,
      ),
    ).toBe(true);
  });
  it("keeps troops aboard a blocked landing until the bank becomes safe", () => {
    const m = make(2);
    unlock(m);
    expect(move(m)).toBeNull();
    const ship = m.match.ships[0],
      landing = ship.shoreTransfer!.landingTile;
    const original = m.match.expansion!.fortifications.blocked.bind(
      m.match.expansion!.fortifications,
    );
    m.match.expansion!.fortifications.blocked = (tile, player) =>
      tile === landing || original(tile, player);
    run(m, 800);
    expect(ship.shoreTransfer!.phase).toBe("landing");
    expect(m.own.every((s) => s.embarkedOn === ship.id)).toBe(true);
    m.match.expansion!.fortifications.blocked = original;
    run(m, 1800);
    expect(m.match.ships).toHaveLength(0);
    expect(m.own.every((s) => s.embarkedOn === null)).toBe(true);
  });
  it("kills embarked cargo when its physical vessel sinks and isolates snapshot state", () => {
    const m = make(2);
    unlock(m);
    expect(move(m)).toBeNull();
    for (let i = 0; i < 800 && m.own.some((s) => s.embarkedOn === null); i++)
      m.match.step();
    const ship = m.match.ships[0];
    expect(m.own.every((s) => s.embarkedOn === ship.id)).toBe(true);
    const view = m.match.snapshot().ships[0];
    expect("waterPath" in view.shoreTransfer!).toBe(false);
    expect("queued" in view.shoreTransfer!).toBe(false);
    // Deliberately mutate the actual DTO to verify its isolation from domain state.
    (view.shoreTransfer as unknown as { capacity: number }).capacity = 999;
    expect(ship.shoreTransfer!.capacity).toBe(10);
    m.match.updateShip(ship.id, { health: 0 });
    m.match.step();
    expect(m.match.ships).toHaveLength(0);
    expect(m.match.squads.some((s) => m.own.includes(s))).toBe(false);
  });
});
