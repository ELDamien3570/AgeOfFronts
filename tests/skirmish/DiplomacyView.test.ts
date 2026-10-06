// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { EmpireView, empireMarkup } from "../../src/skirmish/client/EmpireView";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { hudMarkup } from "../../src/skirmish/client/HudView";

afterEach(() => vi.restoreAllMocks());
it("shows mutual long-term terms, the notice countdown, and immediate war's 120-second penalty", () => {
  const cells = new Uint8Array(48 * 48).fill(133);
  const game = new Skirmish(new GameMapImpl(48, 48, cells, cells.length), { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", aiWarPolicy: true });
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const root = document.createElement("div");
  root.innerHTML = `${empireMarkup()}<main class="battlefield">${hudMarkup()}</main>`;
  document.body.replaceChildren(root);
  const command = vi.fn(c => expect(game.applyCommand(c)).toBeNull());
  const view = new EmpireView(root, { refresh: () => {}, command, build: () => {}, notify: () => {}, focusedRef: () => null, target: () => {} });
  const update = () => {
    now += 501;
    view.update(new EmpireViewModel(game.snapshot(), { selected: new Set(), selectedShips: new Set(), selectedBuilding: null }));
  };
  const button = (action: string) => root.querySelector<HTMLButtonElement>(`[data-diplomacy="${action}"]`);
  update(); view.inspectPlayer(2); update();
  expect(root.textContent).toContain(`${game.squads.filter(s=>s.playerId===2).length} squads · 0 warships · 0 plane squadrons`);
  expect(button("declare")!.textContent).toBe("Declare War");
  expect(button("end-long-term")).toBeNull();
  button("offer-long-term")!.click(); update();
  expect(game.expansion!.diplomacy.allied(1, 2)).toBe(false);
  expect(root.textContent).toContain("awaiting acceptance");
  expect(game.applyCommand({type: "alliance", playerId: 2, otherId: 1, action: "accept"})).toBeNull(); update();
  expect(root.textContent).toContain("renews automatically");
  expect(button("renew")).toBeNull();
  expect(button("break")!.textContent).toContain("60s");
  expect(button("declare")!.textContent).toContain("120s");
  expect(new EmpireViewModel(game.snapshot(), {selected: new Set(), selectedShips: new Set(), selectedBuilding: null}).allianceRenewals).toEqual([]);
  button("end-long-term")!.click(); update();
  expect(root.textContent).toContain("Alliance ends in 180s");
  expect(button("end-long-term")).toBeNull();
  button("declare")!.click(); update();
  expect(root.textContent).toContain("At war");
  expect(button("declare")).toBeNull();
  expect(game.expansion!.diplomacy.state.betrayal[1]).toBe(game.tick + 2400);
  expect(command).toHaveBeenLastCalledWith({type: "alliance", playerId: 1, otherId: 2, action: "declare"});
});
it("counts afloat land squads, living warships only, and ready plus deployed planes",()=>{
  const cells=new Uint8Array(48*48).fill(133);
  const game=new Skirmish(new GameMapImpl(48,48,cells,cells.length),{seed:42,aiCount:1,tribes:false,runAi:false,ruleset:"ages-v1"});
  const state=game.snapshot(),template=state.squads.find(s=>s.playerId===2)!;
  state.squads=[{...template,afloat:{hull:50,maxHull:100,vesselId:"stoneage-transport"}},{...template,id:999,troops:0}];
  const ship={id:123,playerId:2,x:0,y:0,health:1000,destination:null,waypoints:[],fighting:false};
  state.ships=[{...ship,kind:"warship"},{...ship,id:124,kind:"warship",health:0}];
  const plane={id:125,playerId:2,definitionId:"bomber" as const,airfieldId:1,x:0,y:0,health:100,target:null,reloadTick:0,fuelTicks:100};
  state.expansion!.aircraft=[{...plane,state:"ready"},{...plane,id:126,state:"outbound"}];
  const vm=new EmpireViewModel(state,{selected:new Set(),selectedShips:new Set(),selectedBuilding:null});
  expect(vm.militaryCounts(2)).toEqual({squads:1,boats:1,planes:2});
});
