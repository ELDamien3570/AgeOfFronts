import { RoomCoordinator } from "../../src/skirmish/multiplayer/domain/RoomCoordinator";
import { LOBBY_MAP_IDS } from "../../src/skirmish/lobby/LobbyRules";
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { LobbyView } from "../../src/skirmish/client/lobby/LobbyView";
import { LobbyViewModel } from "../../src/skirmish/client/lobby/LobbyViewModel";

function fixture() {
  document.body.innerHTML = '<div id="lobby-app"></div>';
  const root = document.getElementById("lobby-app")!;
  const actions = {
    preview: vi.fn(),
    home: vi.fn(),
    addSample: vi.fn(),
    removeSample: vi.fn(),
    reset: vi.fn(),
    voteStart: vi.fn(),
    voteMap: vi.fn(),
    customPreview: vi.fn(),
    openCreate: vi.fn(),
    openFlags: vi.fn(),
    closeDialog: vi.fn(),
    chooseFlag: vi.fn(),
    searchFlags: vi.fn(),
    moreFlags: vi.fn(),
    draftName: vi.fn(),
    saveProfile: vi.fn(),
    chooseColor: vi.fn(),
    createRoom: vi.fn(),
    removeRoom: vi.fn(),
  };
  const view = new LobbyView(
    root,
    actions,
    "https://github.com/ELDamien3570/AgeOfFronts/tree/example",
  );
  const vm = new LobbyViewModel();
  view.render(vm);
  return { root, actions, view, vm };
}

describe("lobby page", () => {
  it("offers the Post-Modern starting preset with its opening rules", () => {
    const { root, view, vm } = fixture();
    vm.dialog = "create";
    // jsdom does not provide the native modal-dialog API.
    const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: vi.fn() });
    try {
      view.renderDialog(vm);
    } finally {
      if (original) Object.defineProperty(HTMLDialogElement.prototype, "showModal", original);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    }
    expect(root.querySelector('select[name="startingAge"] option[value="PostModern"]')?.textContent).toBe("Post-Modern");
    expect(root.querySelector("#lobby-dialog")?.textContent).toContain("all technologies and 1,000,000 gold");
  });
  it("offers no 2000 map size and warns only for procedural maps at 1000 (R2-P1)", () => {
    const { root, view, vm } = fixture();
    vm.dialog = "create";
    const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: vi.fn() });
    try {
      view.renderDialog(vm);
    } finally {
      if (original) Object.defineProperty(HTMLDialogElement.prototype, "showModal", original);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    }
    const sizes = Array.from(root.querySelectorAll<HTMLOptionElement>('select[name="worldSize"] option'));
    expect(sizes.map((option) => option.value)).toEqual(["250", "500", "1000"]);
    expect(root.querySelector('option[value="2000"]')).toBeNull();
    const form = root.querySelector<HTMLFormElement>("#create-room")!;
    const hint = root.querySelector<HTMLElement>("#world-size-hint")!;
    const map = form.elements.namedItem("mapId") as HTMLSelectElement;
    const size = form.elements.namedItem("worldSize") as HTMLSelectElement;
    const choose = (field: HTMLSelectElement, value: string) => {
      field.value = value;
      field.dispatchEvent(new Event("change", { bubbles: true }));
    };
    expect(hint.hidden).toBe(true);
    choose(map, "black-forest");
    choose(size, "1000");
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain("1000 cells");
    choose(size, "500");
    expect(hint.hidden).toBe(true);
    choose(size, "1000");
    choose(map, "africa");
    expect(hint.hidden).toBe(true);
  });
  it.each(["home", "room"])("retains the connected native color selector and options during %s publications", page => {
    const {root,view,vm,actions}=fixture();
    if (page === "room") { vm.showLobby("africa"); view.render(vm); }
    const select=root.querySelector<HTMLSelectElement>("#faction-color")!;
    const options=Array.from(select.options);
    const ancestors: Element[]=[];
    for(let parent:Element|null=select;parent&&parent!==root;parent=parent.parentElement) ancestors.push(parent);
    const removed:Node[]=[];
    const observer=new MutationObserver(()=>{});
    observer.observe(root,{childList:true,subtree:true});
    select.focus();
    for(let i=0;i<5;i++) view.render(vm);
    for(const record of observer.takeRecords()) removed.push(...record.removedNodes);
    observer.disconnect();
    expect(root.querySelector("#faction-color")).toBe(select);
    expect(Array.from(select.options)).toEqual(options);
    expect(document.activeElement).toBe(select);
    for(const ancestor of ancestors) expect(removed).not.toContain(ancestor);
    vm.chooseColor(3);view.render(vm);
    expect(select.value).toBe("3");
    select.value="5";select.dispatchEvent(new Event("change",{bubbles:true}));
    expect(actions.chooseColor).toHaveBeenCalledExactlyOnceWith(5);
  });

  it("keeps colors other guests chose selectable, marks them in use, and keeps the live selector mounted", () => {
    const { root, view, vm } = fixture();
    const rooms = new RoomCoordinator(0, 1);
    const publicLobby = `default-${LOBBY_MAP_IDS[0]}`;
    rooms.join(publicLobby, "a", { name: "A", flagCode: null, colorIndex: 1 }, 0);
    rooms.join(publicLobby, "b", { name: "B", flagCode: null, colorIndex: 3 }, 0);
    vm.online = true; vm.connected = true; vm.showLobby(LOBBY_MAP_IDS[0]);
    vm.applyOnlineState(rooms.snapshot(), "a", Date.now());
    view.render(vm);
    const select = root.querySelector<HTMLSelectElement>("#faction-color")!;
    expect(select.value).toBe("1");
    const shared = select.querySelector<HTMLOptionElement>('[value="3"]')!;
    expect(shared.disabled).toBe(false);
    expect(shared.textContent).toContain("in use");
    rooms.leave("b", Date.now());
    vm.applyOnlineState(rooms.snapshot(), "a", Date.now());
    view.render(vm);
    expect(root.querySelector("#faction-color")).toBe(select);
    expect(select.querySelector('[value="3"]')).toBe(shared);
    expect(shared.textContent).not.toContain("in use");
    rooms.join(publicLobby, "b", { name: "B", flagCode: null, colorIndex: 3 }, Date.now());
    vm.applyOnlineState(rooms.snapshot(), "a", Date.now());
    expect(vm.chooseColor(3)).toBe(true);
    view.render(vm);
    expect(root.querySelector(".faction-color-error")).toBeNull();
  });
  it("provides an accessible color selector on both lobby pages and routes changes through actions", () => {
    const { root, view, vm, actions } = fixture();
    let select = root.querySelector<HTMLSelectElement>("#faction-color")!;
    expect(select.options.length).toBe(21);
    select.value = "3";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(actions.chooseColor).toHaveBeenCalledWith(3);
    vm.draftEmpireName = "Unsaved name";
    vm.chooseColor(3);
    expect(vm.draftEmpireName).toBe("Unsaved name");
    view.render(vm);
    expect(root.querySelector<HTMLSelectElement>("#faction-color")!.value).toBe("3");
    expect(vm.skirmishHref).toContain("color=3");
    vm.showLobby("africa");
    view.render(vm);
    select = root.querySelector<HTMLSelectElement>("#faction-color")!;
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(actions.chooseColor).toHaveBeenCalledWith(null);
  });

  it("shows one public lobby beside a scrollable list of every custom room", () => {
    const { root, view, vm } = fixture();
    const ids = ["one", "two", "three", "four", "five"];
    for (const id of ids)
      vm.createRoom(id, id, { ...vm.rules, mapId: "heightmap-test1" });
    view.render(vm);
    expect(root.querySelectorAll("[data-default]")).toHaveLength(1);
    const list = root.querySelector(".custom-room-scroll")!;
    expect(Array.from(list.querySelectorAll("[data-custom-id]"), (card) => card.getAttribute("data-custom-id"))).toEqual(ids);
    expect(root.querySelector(".queue-list")).toBeNull();
    expect(root.textContent).not.toContain("DISPLAY SPACES");
    expect(root.textContent).toContain("5 OPEN");
  });
  it("counts down the public lobby in place without stealing focus", () => {
    const { root, view, vm } = fixture();
    const rooms = new RoomCoordinator(0, 1);
    const publicLobby = `default-${LOBBY_MAP_IDS[0]}`;
    const now = Date.now();
    rooms.join(publicLobby, "a", { name: "A", flagCode: null }, now);
    rooms.join(publicLobby, "b", { name: "B", flagCode: null }, now);
    vm.online = true; vm.connected = true;
    vm.applyOnlineState(rooms.snapshot(), "a", now);
    view.render(vm);
    const clock = root.querySelector("[data-public-countdown]")!;
    expect(clock.textContent).toBe("1:00");
    const link = root.querySelector<HTMLAnchorElement>("[data-public-holder] [data-preview]")!;
    link.focus();
    // Two seconds later on the server clock.
    vm.applyOnlineState(rooms.snapshot(), "a", now + 2_000);
    expect(vm.tickDirectory()).toBe(true);
    view.refreshDirectory(vm);
    expect(root.querySelector("[data-public-countdown]")).toBe(clock);
    expect(clock.textContent).toBe("0:58");
    expect(document.activeElement).toBe(link);
  });
  it("turns the public lobby into a three-map vote while a public match runs", () => {
    const { root, view, vm, actions } = fixture();
    const rooms = new RoomCoordinator(0, 1);
    const publicLobby = `default-${LOBBY_MAP_IDS[0]}`;
    rooms.join(publicLobby, "a", { name: "A", flagCode: null }, 0);
    rooms.voteToStart(publicLobby, "a");
    expect(rooms.advance(1)).toHaveLength(1);
    const [first, second] = rooms.snapshot().mapVote!.candidates;
    rooms.voteMap("c", second);
    rooms.voteMap("d", second);
    rooms.voteMap("me", first);
    vm.online = true; vm.connected = true;
    vm.applyOnlineState(rooms.snapshot(), "me", Date.now());
    view.render(vm);
    const holder = root.querySelector("[data-public-holder]")!;
    expect(holder.querySelector("[data-default]")).toBeNull(); // No lobby that cannot start.
    expect(holder.textContent).toContain("MATCH IN PROGRESS");
    const choices = holder.querySelectorAll<HTMLElement>(".map-vote-choice");
    expect(choices).toHaveLength(3);
    expect(choices[0].dataset.selected).toBe("true");
    expect(choices[0].textContent).toContain("1 vote");
    expect(choices[1].textContent).toContain("2 votes");
    holder.querySelector<HTMLButtonElement>(`[data-vote-map="${second}"]`)!.click();
    expect(actions.voteMap).toHaveBeenCalledWith(second);
  });
  it("renders empire and lobby names as text instead of allowing injected markup", () => {
    const { root, view, vm } = fixture();
    vm.saveProfile("<i>Empire</i>", "us");
    vm.createRoom("custom", "<b>Friends</b>", vm.rules);
    view.render(vm);
    expect(root.querySelector(".custom-room-holder h3")?.textContent).toBe(
      "<b>Friends</b>",
    );
    expect(root.querySelector(".custom-room-holder b")).toBeNull();
    expect(root.querySelector(".room-owner i")).toBeNull();
    expect(
      root.querySelector<HTMLImageElement>(".owner-flag")?.getAttribute("src"),
    ).toBe("/flags/us.svg");
  });
  it("separates map previews from the playable AI links", () => {
    const { root, actions, vm } = fixture();
    const map = vm.maps[0];
    const preview = root.querySelector<HTMLAnchorElement>(
      `.directory-card-actions [data-preview="${map.id}"]`,
    )!;
    preview.click();
    expect(actions.preview).toHaveBeenCalledWith(map.id);
    const play = root.querySelector<HTMLAnchorElement>(
      `[aria-label="Play ${map.name} vs AI"]`,
    )!;
    expect(play.getAttribute("href")).toBe(`/skirmish/index.html?map=${map.id}`);
    expect(root.textContent).toContain(
      "Online joining will be connected next.",
    );
    expect(root.querySelector("canvas")).toBeNull();
  });

  it("keeps timer updates from stealing keyboard focus and locks the finished preview", () => {
    const { root, view, vm } = fixture();
    vm.showLobby("heightmap-test1");
    view.render(vm);
    const add = root.querySelector<HTMLButtonElement>("[data-add]")!;
    add.focus();
    vm.addSample(0);
    vm.tick(30_000);
    view.refreshPreview(vm);
    expect(document.activeElement).toBe(add);
    expect(root.querySelector("[data-countdown]")?.textContent).toBe("0:30");
    vm.tick(60_000);
    view.refreshPreview(vm);
    expect(add.disabled).toBe(true);
    expect(root.querySelectorAll('[data-kind="ai"]')).toHaveLength(10);
    expect(root.textContent).toContain("No online match has started.");
  });

  it("leaves modified preview links available for normal new-tab navigation", () => {
    const { root, actions } = fixture();
    const link = root.querySelector<HTMLAnchorElement>(
      '[data-preview="heightmap-test1"]',
    )!;
    link.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      }),
    );
    expect(actions.preview).not.toHaveBeenCalled();
    expect(link.getAttribute("href")).toBe("#lobby=heightmap-test1");
  });
});
