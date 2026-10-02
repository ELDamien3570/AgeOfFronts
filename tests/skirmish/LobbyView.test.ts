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
    customPreview: vi.fn(),
    openCreate: vi.fn(),
    openFlags: vi.fn(),
    closeDialog: vi.fn(),
    chooseFlag: vi.fn(),
    searchFlags: vi.fn(),
    moreFlags: vi.fn(),
    draftName: vi.fn(),
    saveProfile: vi.fn(),
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
  it("rotates only featured cards, preserves draft identity, and defers replacement of a focused link", () => {
    const { root, view, vm } = fixture();
    const holder = root.querySelector<HTMLElement>("[data-featured-maps]")!;
    const link = holder.querySelector<HTMLAnchorElement>("[data-preview]")!;
    const name = root.querySelector<HTMLInputElement>("#empire-name")!;
    name.value = "Unsaved empire";
    link.focus();
    vm.tickDirectory(60_000);
    view.refreshDirectory(vm);
    expect(document.activeElement).toBe(link);
    expect(holder.firstElementChild?.getAttribute("data-default")).toBe(
      "heightmap-test1",
    );
    name.focus();
    view.refreshDirectory(vm);
    expect(holder.firstElementChild?.getAttribute("data-default")).toBe(
      "old-world",
    );
    expect(
      holder
        .querySelector<HTMLAnchorElement>('[aria-label="Play Old World vs AI"]')
        ?.getAttribute("href"),
    ).toBe("/skirmish/index.html?map=old-world");
    expect(name.value).toBe("Unsaved empire");
    expect(document.activeElement).toBe(name);
  });
  it("shows available default rooms beside three custom spaces and queues the overflow", () => {
    const { root, view, vm } = fixture();
    for (const id of ["one", "two", "three", "four"])
      vm.createRoom(id, id, { ...vm.rules, mapId: "heightmap-test1" }, true);
    view.render(vm);
    expect(root.querySelectorAll("[data-default]")).toHaveLength(3);
    expect(root.querySelectorAll("[data-custom-id]")).toHaveLength(3);
    expect(root.querySelectorAll(".queue-list li")).toHaveLength(1);
    expect(root.querySelector(".queue-list")?.textContent).toContain("four");
    expect(root.querySelector('.queue-list [data-room="four"]')).not.toBeNull();
  });

  it("renders empire and lobby names as text instead of allowing injected markup", () => {
    const { root, view, vm } = fixture();
    vm.saveProfile("<i>Empire</i>", "us");
    vm.createRoom("custom", "<b>Friends</b>", vm.rules, false);
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
    const { root, actions } = fixture();
    const preview = root.querySelector<HTMLAnchorElement>(
      '.directory-card-actions [data-preview="africa"]',
    )!;
    preview.click();
    expect(actions.preview).toHaveBeenCalledWith("africa");
    const play = root.querySelector<HTMLAnchorElement>(
      '[aria-label="Play Africa vs AI"]',
    )!;
    expect(play.getAttribute("href")).toBe("/skirmish/index.html?map=africa");
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
