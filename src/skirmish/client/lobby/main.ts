import type { LobbySettings } from "../../lobby/LobbyDirectory";
import { isLobbyMapId } from "../../lobby/LobbyRules";
import { AGE_UI_THEMES } from "../AgeUiTheme";
import "./lobby.css";
import { BrowserLobbyPreviewStore } from "./LobbyPreviewStore";
import { LobbyView } from "./LobbyView";
import { LobbyViewModel } from "./LobbyViewModel";
import "./stone-lobby.css";

const lobbyRoot = document.querySelector<HTMLElement>("#lobby-app")!;
const theme = AGE_UI_THEMES.StoneAge;
for (const [name, value] of Object.entries(theme.palette))
  lobbyRoot.style.setProperty(`--age-${name}`, value);
lobbyRoot.style.setProperty("--age-texture", `url("${theme.texture}")`);

const vm = new LobbyViewModel(
  new BrowserLobbyPreviewStore(),
  performance.now(),
);
const view = new LobbyView(
  lobbyRoot,
  {
    preview: (mapId) => {
      if (isLobbyMapId(mapId)) window.location.hash = `lobby=${mapId}`;
    },
    customPreview: (id) => {
      window.location.hash = `room=${id}`;
    },
    home: () => {
      vm.dialog = null;
      history.pushState(null, "", window.location.pathname);
      route();
    },
    addSample: () => {
      if (vm.addSample(performance.now())) view.refreshPreview(vm);
    },
    removeSample: () => {
      if (vm.removeSample()) view.refreshPreview(vm);
    },
    reset: () => {
      vm.resetPreview(performance.now());
      view.refreshPreview(vm);
    },
    openCreate: () => {
      vm.dialog = "create";
      view.renderDialog(vm);
    },
    openFlags: () => {
      vm.dialog = "flags";
      vm.flagSearch = "";
      vm.flagLimit = 48;
      view.renderDialog(vm);
    },
    closeDialog: () => {
      vm.dialog = null;
      view.closeDialog();
    },
    chooseFlag: (code) => {
      if (vm.saveProfile(vm.draftEmpireName, code)) {
        vm.dialog = null;
        view.closeDialog();
        view.render(vm);
      } else view.showDialogError(vm.message);
    },
    searchFlags: (search) => {
      vm.flagSearch = search;
      vm.flagLimit = 48;
      view.refreshFlagResults(vm);
    },
    moreFlags: () => {
      vm.flagLimit += 48;
      view.refreshFlagResults(vm);
    },
    draftName: (name) => {
      vm.draftEmpireName = name;
    },
    saveProfile: (name) => {
      vm.saveProfile(name);
      view.render(vm);
    },
    createRoom: (data) => {
      const settings = {
        mapId: String(data.get("mapId")),
        mode: "free-for-all",
        slots: Number(data.get("slots")),
        minimumHumans: Number(data.get("minimumHumans")),
        countdownSeconds: Number(data.get("countdownSeconds")),
        fillVacanciesWithAi: data.has("fillVacanciesWithAi"),
        worldSize: Number(data.get("worldSize")),
        technologySpeed: Number(data.get("technologySpeed")),
        resourceDensity: Number(data.get("resourceDensity")),
        resourceOutput: Number(data.get("resourceOutput")),
        alliances: data.get("alliances") === "allowed",
        victory: String(data.get("victory")),
      } as LobbySettings;
      if (
        vm.createRoom(
          crypto.randomUUID(),
          String(data.get("title") ?? ""),
          settings,
          data.has("willingToWait"),
        )
      ) {
        view.closeDialog();
        view.render(vm);
      } else view.showDialogError(vm.message);
    },
    removeRoom: (id) => {
      vm.removeRoom(id);
      view.render(vm);
    },
  },
  import.meta.env.VITE_SKIRMISH_SOURCE_URL,
);

function route(): void {
  vm.dialog = null;
  const hash = window.location.hash;
  const lobby = hash.startsWith("#lobby=")
    ? vm.showLobby(hash.slice(7))
    : hash.startsWith("#room=")
      ? vm.showCustomRoom(hash.slice(6), performance.now())
      : false;
  if (!lobby) vm.showHome();
  vm.tickDirectory(performance.now());
  document.title = lobby
    ? `${vm.roomTitle} — Preview · Age of Fronts`
    : "Age of Fronts — Lobbies";
  view.render(vm);
  window.scrollTo(0, 0);
  const heading = document.querySelector<HTMLElement>("main h1");
  heading?.setAttribute("tabindex", "-1");
  heading?.focus({ preventScroll: true });
}

window.addEventListener("hashchange", route);
window.addEventListener("popstate", route);
window.setInterval(() => {
  const now = performance.now();
  if (vm.tick(now)) view.refreshPreview(vm);
  if (vm.tickDirectory(now)) view.refreshDirectory(vm);
}, 250);
route();
