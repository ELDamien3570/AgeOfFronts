import type { LobbySettings } from "../../lobby/LobbyDirectory";
import { isLobbyMapId } from "../../lobby/LobbyRules";
import type { Age } from "../../domain/Definitions";
import { AGE_UI_THEMES } from "../AgeUiTheme";
import "./lobby.css";
import { BrowserLobbyPreviewStore } from "./LobbyPreviewStore";
import { LobbyView } from "./LobbyView";
import { LobbyViewModel } from "./LobbyViewModel";
import { OnlineLobbyConnection } from "./OnlineLobbyConnection";
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
const coordinatorUrl =
  // Empty configuration uses the coordinator on this origin.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  (import.meta.env.VITE_MULTIPLAYER_URL as string | undefined) ||
  (typeof window !== "undefined" ? window.location.origin : undefined);
vm.online = Boolean(coordinatorUrl);
const requestId = () => crypto.randomUUID();
let connection: OnlineLobbyConnection | undefined;
let restoreExplicitRoom = false;
const reportError = (error: unknown) => {
  vm.message = (error as Error).message;
  view.render(vm);
};
const view = new LobbyView(
  lobbyRoot,
  {
    preview: (mapId) => {
      if (!isLobbyMapId(mapId)) return;
      if (connection)
        void connection
          .request({
            type: "join",
            requestId: requestId(),
            roomId: `default-${mapId}`,
          })
          .then(() => {
            window.location.hash = `lobby=${mapId}`;
          })
          .catch(reportError);
      else window.location.hash = `lobby=${mapId}`;
    },
    customPreview: (id) => {
      if (connection)
        void connection
          .request({ type: "join", requestId: requestId(), roomId: id })
          .then(() => {
            window.location.hash = `room=${id}`;
          })
          .catch(reportError);
      else window.location.hash = `room=${id}`;
    },
    home: () => {
      if (connection)
        void connection
          .request({ type: "leave", requestId: requestId() })
          .catch(reportError);
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
    voteStart: () => {
      if (connection && vm.onlineRoom && vm.canVoteToStart)
        void connection
          .request({
            type: "voteStart",
            requestId: requestId(),
            roomId: vm.onlineRoom.id,
          })
          .catch(reportError);
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
        if (connection)
          void connection
            .request({
              type: "profile",
              requestId: requestId(),
              profile: vm.profile,
            })
            .catch(reportError);
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
    chooseColor: (index) => {
      const previous = vm.profile;
      if (!vm.chooseColor(index)) { view.render(vm); return; }
      const submitted = vm.profile;
      if (connection && vm.connected) {
        void connection.request({ type: "profile", requestId: requestId(), profile: submitted })
          .catch(error => {
            if (vm.profile !== submitted) return;
            vm.chooseColor(previous.colorIndex ?? null);
            vm.colorError = (error as Error).message;
            reportError(error);
          });
      }
      view.render(vm);
    },
    saveProfile: (name) => {
      if (vm.saveProfile(name) && connection)
        void connection
          .request({
            type: "profile",
            requestId: requestId(),
            profile: vm.profile,
          })
          .catch(reportError);
      view.render(vm);
    },
    createRoom: (data) => {
      const settings = {
        mapId: String(data.get("mapId")),
        mode: "free-for-all",
        slots: Number(data.get("slots")),
        minimumHumans: Number(data.get("minimumHumans")),
        countdownSeconds: Number(data.get("countdownSeconds")),
        worldSize: Number(data.get("worldSize")),
        aiCount: Number(data.get("aiCount")),
        tribeCount: Number(data.get("tribeCount")),
        startingAge: (data.get("startingAge") as Age) || "StoneAge",
        technologySpeed: Number(data.get("technologySpeed")),
        resourceDensity: Number(data.get("resourceDensity")),
        resourceOutput: Number(data.get("resourceOutput")),
        alliances: data.get("alliances") === "allowed",
        victory: String(data.get("victory")),
        publicAiTakeover: data.has("publicAiTakeover"),
        infiniteGoldForPlayers: data.has("infiniteGoldForPlayers"),
      } as LobbySettings & { publicAiTakeover: boolean };
      if (connection) {
        void connection
          .request({
            type: "create",
            requestId: requestId(),
            title: String(data.get("title") ?? ""),
            settings,
            willingToWait: data.has("willingToWait"),
          })
          .then((id) => {
            vm.dialog = null;
            view.closeDialog();
            window.location.hash = `room=${id}`;
          })
          .catch((error) => view.showDialogError((error as Error).message));
        return;
      }
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
      if (connection) {
        void connection
          .request({ type: "close", requestId: requestId(), roomId: id })
          .catch(reportError);
        return;
      }
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
  if (connection && vm.guestId) {
    const joined = vm.joinedOnlineRoom;
    const desired = lobby ? vm.onlineRoom : undefined;
    if (desired && (desired.id !== joined?.id || !desired.members.some(m=>m.guestId===vm.guestId&&m.connected)))
      void connection
        .request({ type: "join", requestId: requestId(), roomId: desired.id })
        .catch(reportError);
    else if (!lobby && joined)
      void connection
        .request({ type: "leave", requestId: requestId() })
        .catch(reportError);
  }
  vm.tickDirectory(performance.now());
  document.title = lobby
    ? `${vm.roomTitle}${vm.online ? "" : " — Preview"} · Age of Fronts`
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
if (coordinatorUrl) {
  connection = new OnlineLobbyConnection(
    coordinatorUrl,
    (message) => {
      const firstState = !vm.guestId;
      vm.applyOnlineState(
        message.state,
        message.guestId,
        message.now,
        message.activeMatches,
      );
      if (firstState) {
        void connection!
          .request({
            type: "profile",
            requestId: requestId(),
            profile: vm.profile,
          })
          .catch(reportError);
        const hash=window.location.hash;
        const roomId=hash.startsWith("#lobby=")&&isLobbyMapId(hash.slice(7))?`default-${hash.slice(7)}`:
          hash.startsWith("#room=")?hash.slice(6):undefined;
        if(roomId)void connection!.request({type:"join",requestId:requestId(),roomId}).then(()=>route()).catch(reportError);

      }
      if(restoreExplicitRoom&&!firstState){restoreExplicitRoom=false;route();}
      else restoreExplicitRoom=false;
      if (!vm.dialog) view.render(vm);
    },
    (status, connected) => {
      if(connected&&!vm.connected)restoreExplicitRoom=true;
      vm.connected = connected;
      vm.message = status;
      if (!vm.dialog) view.render(vm);
    },
    (message) => {
      if (message.type === "match") { connection?.stop();
        window.location.href = `/skirmish/index.html?match=${encodeURIComponent(message.manifest.id)}`; }
    },
  );
  void connection.connect();
}

window.addEventListener("pagehide",()=>connection?.stop());
window.addEventListener("pageshow",event=>{if(event.persisted)window.location.reload();});
document.addEventListener("click",event=>{
  const anchor=(event.target as Element).closest<HTMLAnchorElement>("a[href]");
  if(!anchor||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||anchor.target==="_blank")return;
  const url=new URL(anchor.href,window.location.href);
  if(url.origin!==window.location.origin||url.pathname!==window.location.pathname)connection?.stop();
},true);
