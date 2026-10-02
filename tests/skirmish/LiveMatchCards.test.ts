// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { liveMatchHref } from "../../src/skirmish/client/lobby/LiveMatchCards";
import {
  LobbyView,
  type LobbyActions,
} from "../../src/skirmish/client/lobby/LobbyView";
import { LobbyViewModel } from "../../src/skirmish/client/lobby/LobbyViewModel";
import type { LiveMatchSummary } from "../../src/skirmish/multiplayer/Protocol";

const match = (extra: Partial<LiveMatchSummary> = {}): LiveMatchSummary => ({
  id: "match-one",
  title: "The old frontier",
  mapId: "africa",
  elapsedSeconds: 723,
  connectedHumans: 2,
  humanSeats: 3,
  claimedHumanSeats: 3,
  freeAiSeats: [{ playerId: 4, name: "Northern Empire" }],
  publicTakeover: true,
  status: "running",
  ...extra,
});
let root: HTMLElement;
let vm: LobbyViewModel;
let view: LobbyView;
beforeEach(() => {
  document.body.innerHTML = '<div id="lobby-app"></div>';
  root = document.getElementById("lobby-app")!;
  vm = new LobbyViewModel();
  vm.online = true;
  vm.connected = true;
  view = new LobbyView(root, {} as LobbyActions);
});

describe("live match directory", () => {
  it("keeps the name editor mounted with its caret and selection across live publications", () => {
    view.render(vm);
    const input = root.querySelector<HTMLInputElement>("#empire-name")!;
    vm.draftEmpireName = input.value = "Northern Empire";
    input.focus();
    input.setSelectionRange(3, 8, "backward");
    input.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    for (let tick = 0; tick < 3; tick++) {
      vm.activeMatches = [match({ elapsedSeconds: tick })];
      view.render(vm);
      expect(root.querySelector("#empire-name")).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("Northern Empire");
      expect(input.selectionStart).toBe(3);
      expect(input.selectionEnd).toBe(8);
      expect(input.selectionDirection).toBe("backward");
      expect(root.querySelectorAll("[data-live-match]")).toHaveLength(1);
    }
    input.setSelectionRange(5, 5);
    view.render(vm);
    expect(input.selectionStart).toBe(5);
    expect(input.selectionEnd).toBe(5);
    input.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
  });

  it("refreshes saved identity and connection messages without recreating the editor", () => {
    view.render(vm);
    const input = root.querySelector<HTMLInputElement>("#empire-name")!;
    vm.draftEmpireName = "New Empire";
    vm.message = "Disconnected from the lobby server";
    vm.connected = false;
    view.render(vm);
    expect(root.querySelector("#empire-name")).toBe(input);
    expect(input.value).toBe("New Empire");
    expect(root.querySelector("#directory-message")!.textContent).toBe(
      vm.message,
    );
    vm.showLobby("africa");
    view.render(vm);
    expect(root.querySelector("#empire-name")).toBeNull();
    vm.showHome();
    view.render(vm);
    expect(root.querySelector("#empire-name")).not.toBe(input);
  });

  it("has an honest empty/loading state without invented matches", () => {
    view.render(vm);
    expect(root.querySelectorAll("[data-live-match]")).toHaveLength(0);
    expect(root.textContent).toContain("No active matches right now");
    vm.connected = false;
    view.render(vm);
    expect(root.textContent).toContain(
      "Connecting to the live match directory",
    );
    vm.online = false;
    view.render(vm);
    expect(root.querySelector(".live-match-section")).toBeNull();
  });
  it("shows real matches above waiting lobbies and only their eligible AI choices", () => {
    vm.activeMatches = [match()];
    view.render(vm);
    expect(
      root.querySelector("main")!.textContent!.indexOf("Live matches"),
    ).toBeLessThan(
      root.querySelector("main")!.textContent!.indexOf("Default lobbies"),
    );
    const card = root.querySelector("[data-live-match]")!;
    expect(card.textContent).toContain("12:03 elapsed");
    expect(card.textContent).toContain("2 connected humans");
    expect(card.textContent).toContain("1 away / reserved");
    const links = card.querySelectorAll(".live-seat-link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe(
      "/skirmish/index.html?match=match-one&seat=4",
    );
    expect(root.textContent).toContain("never an empire name");
    expect(root.textContent).toContain("Tribes cannot be taken over");
  });
  it("offers a browser-identity rejoin instead of a stranger takeover", () => {
    vm.profile = { name: "Same as someone else", flagCode: null };
    vm.activeMatches = [
      match({ rejoinPlayerId: 2, publicTakeover: false, status: "paused" }),
    ];
    view.render(vm);
    const link = root.querySelector<HTMLAnchorElement>(
      '[id="rejoin-match-one"]',
    )!;
    expect(link.textContent).toContain("Rejoin your empire");
    expect(link.getAttribute("href")).toBe(
      "/skirmish/index.html?match=match-one",
    );
    expect(root.querySelectorAll(".live-seat-link")).toHaveLength(0);
    expect(root.textContent).toContain("this browser’s guest identity");
  });
  it("keeps paused matches joinable and blocks stale sync/disconnected controls", () => {
    vm.activeMatches = [match({ status: "paused" })];
    view.render(vm);
    expect(root.querySelector(".live-seat-link")).not.toBeNull();
    vm.activeMatches = [match({ status: "syncing" })];
    view.render(vm);
    expect(root.querySelector(".live-seat-link")).toBeNull();
    expect(root.textContent).toContain("A player is syncing");
    vm.activeMatches = [match()];
    vm.connected = false;
    view.render(vm);
    expect(root.querySelector(".live-seat-link")).toBeNull();
    expect(root.textContent).toContain("Reconnect to the lobby server to join");
  });
  it("does not label unused lobby capacity as reserved and shows the paused return window", () => {
    vm.activeMatches = [
      match({ humanSeats: 20, claimedHumanSeats: undefined }),
    ];
    view.render(vm);
    expect(root.querySelector(".live-match-count")!.textContent).not.toContain(
      "away / reserved",
    );
    vm.activeMatches = [
      match({
        humanSeats: 20,
        claimedHumanSeats: 3,
        connectedHumans: 0,
        status: "paused",
        graceRemainingMs: 89_001,
      }),
    ];
    view.render(vm);
    expect(root.querySelector(".live-match-count")!.textContent).toContain(
      "3 away / reserved",
    );
    expect(root.textContent).toContain(
      "Resume within 1:30 to keep this match open",
    );
    expect(root.querySelector(".live-seat-link")).not.toBeNull();
  });
  it("does not offer private or unavailable empires", () => {
    vm.activeMatches = [match({ publicTakeover: false })];
    view.render(vm);
    expect(root.querySelector(".live-seat-link")).toBeNull();
    expect(root.textContent).toContain(
      "Private match · returning players only",
    );
    vm.activeMatches = [match({ freeAiSeats: [] })];
    view.render(vm);
    expect(root.textContent).toContain("No eligible AI empires");
  });
  it("preserves an open chooser and focus on directory refresh, and cancels without navigation", () => {
    vm.activeMatches = [match()];
    view.render(vm);
    root.querySelector<HTMLDetailsElement>("details")!.open = true;
    root.querySelector<HTMLAnchorElement>(".live-seat-link")!.focus();
    view.render(vm);
    expect(root.querySelector<HTMLDetailsElement>("details")!.open).toBe(true);
    expect(document.activeElement?.id).toBe("takeover-match-one-4");
    root.querySelector<HTMLButtonElement>("[data-cancel-seat]")!.click();
    expect(root.querySelector<HTMLDetailsElement>("details")!.open).toBe(false);
    expect(document.activeElement?.id).toBe("choose-match-one");
    expect(location.hash).toBe("");
  });
  it("escapes remote titles and AI names and encodes match links", () => {
    vm.activeMatches = [
      match({
        title: "<img src=x onerror=alert(1)>",
        freeAiSeats: [{ playerId: 4, name: "<b>Empire</b>" }],
      }),
    ];
    view.render(vm);
    expect(root.querySelector(".live-match-copy h3")!.textContent).toContain(
      "<img",
    );
    expect(root.querySelector(".live-match-copy h3 img")).toBeNull();
    expect(root.querySelector(".live-seat-link b")).toBeNull();
    expect(liveMatchHref("a&seat=8", 3)).toBe(
      "/skirmish/index.html?match=a%26seat%3D8&seat=3",
    );
  });
  it("enables custom-room public takeovers on by default and explains reserved seats", () => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: vi.fn(),
    });
    view.render(vm);
    vm.dialog = "create";
    view.renderDialog(vm);
    const input = root.querySelector<HTMLInputElement>(
      '[name="publicAiTakeover"]',
    )!;
    expect(input.checked).toBe(true);
    expect(root.querySelector("#live-join-hint")!.textContent).toContain(
      "never offered to strangers",
    );
  });
});
