import { hasInfiniteGold } from "../domain/Gold";
import { applyDragSelection, limitSquadSelection } from "./SquadSelectionViewModel";
import { BrowserLobbyPreviewStore } from "./lobby/LobbyPreviewStore";
import { validFactionColor } from "../lobby/FactionPalette";
import { DEFAULT_AI_POLICIES } from "../content/AiPolicies";
let localPlayerId = 1;
let diagnosticSeed: number | undefined;
import { OnlineMatchSession } from "./OnlineMatchSession";
import { RuntimeDiagnostics } from "../RuntimeDiagnostics";
const browserDiagnostics = new RuntimeDiagnostics();
const onlineQuery = new URLSearchParams(window.location.search);
const savedLobbyProfile = new BrowserLobbyPreviewStore().read() as { profile?: { colorIndex?: unknown } } | undefined;
const preferredFactionColor = onlineQuery.has("color") ? Number(onlineQuery.get("color")) : savedLobbyProfile?.profile?.colorIndex;

const onlineMatchId = onlineQuery.get("match");
const onlineSeat = onlineQuery.has("seat") ? Number(onlineQuery.get("seat")) : undefined;

import { squadCap } from "../FactionRules";

import type {
  BuildingType,
  Command,
  ShipType,
  Snapshot,
  SquadType,
  WorkerRequest,
  WorkerResponse,
} from "../Protocol";

import { MAX_AI_OPPONENTS } from "../FactionRules";
import { FIXED, TICKS_PER_SECOND } from "../Protocol";

import { BUILDING_RULES } from "../Rules";

import { SnapshotDecoder } from "../SnapshotCodec";

import { loadMap, MAPS } from "../Terrain";

import type { GroundStyle } from "./GroundLayer";

import { empireMarkup, EmpireView } from "./EmpireView";

import { EmpireViewModel } from "./EmpireViewModel";
import { FactionViewModel } from "./FactionViewModel";

import { UNIT } from "../content/Units";

import {
  AGE_NAMES,
  STARTING_AGES,
  startingAgeName,
  type StartingAge,
  AGES,
  type Age,
  type TechnologySpeed,
} from "../domain/Definitions";

import { ControlGroups } from "./ControlGroups";

import { CampLossPresentation } from "./CampLossPresentation";
import { CameraPanViewModel } from "./CameraPanViewModel";
import { BrowserControlPreferences } from "./ControlPreferences";

import {
  CONSTRUCTION,
  hotkeyAction,
  LAND_RECRUITMENT,
  NAVAL_RECRUITMENT,
  shipMoveCommand,
  sortieCommand,
} from "./Controls";

import { hudMarkup, HudView } from "./HudView";

import { RecruitmentControlsViewModel } from "./RecruitmentControlsViewModel";
import { RecruitmentQueueView } from "./RecruitmentQueueView";
import { RecruitmentQueueViewModel } from "./RecruitmentQueueViewModel";

import { ArmyView } from "./ArmyView";
import { ArmyViewModel } from "./ArmyViewModel";
import { HudViewModel } from "./HudViewModel";
import { OrderGesture } from "./OrderGesture";

import { COLORS, Renderer } from "./Renderer";

import { SkirmishViewModel } from "./SkirmishViewModel";
import { SpawnSelectionViewModel } from "./SpawnSelectionViewModel";
import type { MatchOptions, SpawnState } from "../Protocol";

import { TerrainViewModel } from "./TerrainViewModel";

import "./style.css";
import "./age-theme.css";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `

  <header id="match-topbar" class="topbar">

    <div class="brand"><a class="brand-mark" href="/" aria-label="Return to main lobby"><img src="/images/age-of-fronts-stone-logo.png" alt="Age of Fronts"></a><div><h1>Age of Fronts</h1><p>Local AI skirmish</p></div></div>

    <div id="skirmish-settings" class="match-settings"><label>Battlefield<select id="map">${MAPS.map((m) => `<option value="${m.id}">${m.name}</option>`).join("")}</select></label><label>Opponents<select id="opponents">${Array.from(
      { length: MAX_AI_OPPONENTS },

      (_, i) => i + 1,
    )

      .map(
        (n) =>
          `<option value="${n}" ${n === 3 ? "selected" : ""}>${n} AI</option>`,
      )

      .join(
        "",
      )}</select></label><label>Map size<select id="world-size"><option value="250">250 cells · longest edge</option><option value="500" selected>500 cells · longest edge</option><option value="1000">1000 cells · longest edge</option></select></label><label>Starting age<select id="starting-age">${STARTING_AGES.map(a => `<option value="${a}" ${a === "StoneAge" ? "selected" : ""}>${startingAgeName(a)}</option>`).join("")}</select></label><label>Victory<select id="victory-mode"><option value="solo">Solo conquest</option><option value="allied">Allied conquest</option></select></label><label title="New skirmishes divide all research and age-advancement costs and times by this setting, for every faction.">Tech speed<select id="technology-speed" aria-label="Technology speed"><option value="1">1×</option><option value="2">2×</option><option value="3">3×</option></select></label><label><input type="checkbox" id="infinite-gold" />Infinite Gold for Players</label><button id="restart" class="primary">New skirmish</button></div>

    <div class="time-controls"><button id="wasd-mode" type="button" aria-pressed="false" title="WASD pans the map; Shift for building/single recruitment shortcuts, Space for five recruits.">WASD</button><select id="speed" aria-label="Game speed"><option value="1">1× speed</option><option value="2">2× speed</option><option value="4">4× speed</option></select><button id="pause" aria-label="Pause game">Pause</button></div>

  </header>

  ${empireMarkup()}

  <div id="toast" role="status" class="toast" hidden></div>
  <main class="battlefield" aria-label="Battlefield">

    <canvas id="battlefield" aria-label="Map with selectable troop squads" tabindex="0"></canvas>
    <div id="spawn-selection" class="spawn-selection" role="status" aria-live="polite" hidden><strong>Choose your starting camp</strong><p id="spawn-hint"></p></div>

    <div id="recruitment-feed" class="recruitment-feed" aria-label="Recruitment queues" hidden></div>

    <div id="loading" class="loading"><span class="spinner"></span><h2>Preparing the battlefield</h2><p>Loading terrain and deploying your squads.</p></div>

    <div id="result" class="result" hidden><div><span class="eyebrow">SKIRMISH COMPLETE</span><h2 id="result-title"></h2><p id="result-description"></p><button id="play-again" class="primary">Play again</button></div></div>

    <div id="placement-hint" class="placement-hint" hidden></div>

    <div class="map-context"><div class="map-badge"><span class="live-dot"></span><span id="map-name">Loading battlefield…</span></div><div class="terrain-legend"><span><i class="plains"></i>Plains · fast</span><span><i class="hills"></i>Highlands · slower</span><span><i class="mountains"></i>Mountains · slowest</span><span id="hover-terrain"></span></div></div>

    ${hudMarkup()}

  </main>

  <footer><span>© OpenFront and Contributors · Modified Age of Fronts prototype</span><a id="corresponding-source" href="/age-of-fronts-source.zip" download>Corresponding source</a><span id="map-attribution">OpenFront maps · CC BY-SA 4.0</span></footer>

`;

// Render builds link to their exact public revision; local builds retain the ZIP.
const sourceUrl = import.meta.env.VITE_SKIRMISH_SOURCE_URL;
if (sourceUrl) {
  const sourceLink = document.querySelector<HTMLAnchorElement>(
    "#corresponding-source",
  )!;
  sourceLink.href = sourceUrl;
  sourceLink.removeAttribute("download");
}

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id)! as T;

element("empire-age").addEventListener("click", () => {
  const topbar = element("match-topbar");
  topbar.hidden = !topbar.hidden;
  element("empire-age").setAttribute("aria-expanded", String(!topbar.hidden));
});

const canvas = element<HTMLCanvasElement>("battlefield");

const campLoss = new CampLossPresentation();

const renderer = new Renderer(canvas, campLoss);

// Ground style is a per-browser preference: animated or still water on the
// WebGL ground, or the classic painted ground.
const GROUND_KEY = "skirmish.groundStyle";
let groundStyle: GroundStyle = "animated";
try {
  const saved = localStorage.getItem(GROUND_KEY);
  if (saved === "animated" || saved === "still" || saved === "classic")
    groundStyle = saved;
} catch {
  // Storage can be blocked; the default style applies.
}
// Retain saved styles and Renderer.setGroundStyle for the later settings panel.
renderer.setGroundStyle(groundStyle);

let campLossLabels: { playerId: number; label: HTMLElement }[] = [];

const groups = new ControlGroups();

const hud = new HudView(element("app"), (height) =>
  renderer.setHudBottomInset(height),
  command => post({type: "command", command}),
);
const cameraPan = new CameraPanViewModel(new BrowserControlPreferences(() => localStorage));
element("wasd-mode").setAttribute("aria-pressed", String(cameraPan.enabled));
hud.setWasdMode(cameraPan.enabled);
const recruitmentControls = new RecruitmentControlsViewModel();
element("wasd-mode").addEventListener("click", () => {
  recruitmentControls.clear();
  cameraPan.setEnabled(!cameraPan.enabled);
  element("wasd-mode").setAttribute("aria-pressed", String(cameraPan.enabled));
  hud.setWasdMode(cameraPan.enabled);
});

const recruitmentFeed = new RecruitmentQueueView(element("recruitment-feed"), element("app"), entry => {
  command({
    type: "cancel-recruitment", playerId: localPlayerId,
    category: entry.category, definitionId: entry.definitionId, kind: entry.kind,
    buildingIds: renderer.selectedBuildings.size ? [...renderer.selectedBuildings] : undefined,
  });
});
const empire = new EmpireView(element("app"), {
  recruitmentBatch: (shift) => recruitmentControls.batch(shift, cameraPan.enabled),
  refresh: updateHud,
  command,
  build: placeBuilding,
  notify,
  focusedRef: () => hud.inspectedRef,
  target: beginTarget,
});
const armyView = new ArmyView(element("app"), {
  command,
  select: selectArmy,
  target: (armyId, type) =>
    beginTarget(
      (x, y) => {
        if (!snapshot || !currentMap) return;
        if (type === "deploy" || type === "regroup" || type === "move") {
          if (
            !currentMap.map.isValidCoord(
              Math.floor(x / FIXED),
              Math.floor(y / FIXED),
            )
          )
            return;
          command({
            type: "army-order",
            playerId: localPlayerId,
            armyId,
            order: {
              type,
              tile: currentMap.map.ref(
                Math.floor(x / FIXED),
                Math.floor(y / FIXED),
              ),
            },
          });
        } else if (type !== "hold") {
          const target = snapshot.squads
            .filter((s) => s.playerId !== localPlayerId && s.embarkedOn === null)
            .sort(
              (a, b) =>
                (a.x - x) ** 2 +
                (a.y - y) ** 2 -
                ((b.x - x) ** 2 + (b.y - y) ** 2),
            )[0];
          if (
            !target ||
            (target.x - x) ** 2 + (target.y - y) ** 2 > (4 * FIXED) ** 2
          ) {
            notify("Click a hostile squad for this tactic");
            return;
          }
          command({
            type: "army-order",
            playerId: localPlayerId,
            armyId,
            order: { type, targetId: target.id },
          });
        }
      },
      type === "deploy" || type === "regroup"
        ? "Click passable land for the army"
        : "Click an enemy squad for the army tactic",
    ),
});
function selectArmy(ids: number[]): void {
  renderer.selected = new Set(ids);
  renderer.selectedShips.clear();
  renderer.selectedAircraft.clear();
  renderer.selectedBuilding = null;
  renderer.inspectedSquadId = null;
  renderer.selectedDeposit = null;
  updateHud();
}

let worker: Worker | OnlineMatchSession | undefined;

let snapshot: Snapshot | undefined;

let paused = false;

let speed: 1 | 2 | 4 = 1;

let toastTimer: ReturnType<typeof setTimeout>;

let matchSequence = 0;

let currentMap: Awaited<ReturnType<typeof loadMap>> | undefined;

let terrainView: TerrainViewModel | undefined;

let terrainPointer: { x: number; y: number } | undefined;


let placementType: BuildingType | undefined;

let landingShip: number | undefined;

let placementAge: Age | undefined;

let lastPlacementTime = 0;
let lastPlacementAttempt = 0;

let targetedAction: ((x: number, y: number, gesture?: {shift:boolean; buildingId?:number}) => void) | undefined;

const orderGesture = new OrderGesture();

const empireModel = () =>
  snapshot?.expansion ? new EmpireViewModel(snapshot, renderer) : undefined;

function beginTarget(
  action: (x: number, y: number, gesture?: {shift:boolean; buildingId?:number}) => void,
  hint: string,
): void {
  cancelPlacement();
  empire.close();
  targetedAction = action;
  canvas.style.cursor = "crosshair";

  element("placement-hint").hidden = false;
  element("placement-hint").textContent = hint;
}

const viewModel = () =>
  snapshot
    ? new SkirmishViewModel(
        snapshot,
        renderer,
        empire.choices,
        empire.autoTier,
        empire.tierLimit,
      )
    : undefined;

const format = (value: number) => value.toLocaleString("en-US");

function post(message: WorkerRequest): void {
  worker?.postMessage(message);
}

function command(message: Command): void {
  if (snapshot && "squadIds" in message) {
    const ids = new Set(message.squadIds);
    limitSquadSelection(ids, snapshot.squads, localPlayerId);
    message = { ...message, squadIds: [...ids] };
  }
  orderGesture.cancel();
  post({ type: "command", command: message });
}

function notify(message: string): void {
  const toast = element("toast");

  toast.textContent = message;

  toast.hidden = false;

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => (toast.hidden = true), 3_500);
}

async function start(): Promise<void> {
  if(onlineMatchId) { await startOnlineMatch(); return; }
  recruitmentControls.clear();
  cameraPan.clear();
  orderGesture.cancel();
  const sequence = ++matchSequence;
  renderer.spawn = undefined;
  element("spawn-selection").hidden = true;
  const technologySpeed = Number(
    element<HTMLSelectElement>("technology-speed").value,
  ) as TechnologySpeed;

  worker?.terminate();

  worker = undefined;

  snapshot = undefined;

  campLoss.reset();

  campLossLabels = [];

  paused = false;

  renderer.selected.clear();

  renderer.selectedShips.clear();
  renderer.selectedAircraft.clear();

  renderer.selectedBuilding = null;

  renderer.inspectedSquadId = null;
  renderer.selectedDeposit = null;

  groups.reset();

  hud.reset();

  empire.reset();

  updateGroups();

  cancelPlacement();

  element("loading").hidden = false;

  element("result").hidden = true;

  for (const { kind } of LAND_RECRUITMENT)
    element<HTMLButtonElement>(`recruit-${kind}`).disabled = true;

  for (const { kind } of NAVAL_RECRUITMENT)
    element<HTMLButtonElement>(kind).disabled = true;

  element<HTMLButtonElement>("restart").disabled = true;

  element("loading").innerHTML =
    '<span class="spinner"></span><h2>Preparing the battlefield</h2><p>Loading terrain and deploying your squads.</p>';

  try {
    const mapId = element<HTMLSelectElement>("map").value;

    const loaded = await loadMap(
      mapId,

      Number(element<HTMLSelectElement>("world-size").value),
    );

    if (sequence !== matchSequence) return;

    currentMap = loaded;

    terrainView = new TerrainViewModel(loaded.map);

    terrainPointer = undefined;

    element("hover-terrain").textContent = "";

    const attribution = element("map-attribution");

    attribution.replaceChildren();

    if (loaded.attribution) {
      const link = document.createElement("a");

      link.href = loaded.attribution.url;

      link.textContent = loaded.attribution.label;

      attribution.append(link);
    } else attribution.textContent = "OpenFront maps · CC BY-SA 4.0";


    renderer.setMap(loaded.map, loaded.geography, loaded.environment);

    element("map-name").textContent = `${loaded.name} · land skirmish`;

    const nextWorker = new Worker(new URL("../worker.ts", import.meta.url), {
      type: "module",
    });

    worker = nextWorker;

    const decoder = new SnapshotDecoder();
    let startingCameraPending = true;

    const fail = (message: string) => {
      if (sequence !== matchSequence) return;

      element("loading").hidden = false;

      element("loading").innerHTML =
        '<h2>Unable to start the skirmish</h2><p id="load-error"></p>';

      element("load-error").textContent = message;

      element<HTMLButtonElement>("restart").disabled = false;

      nextWorker.terminate();
    };

    nextWorker.onerror = (event) =>
      fail(event.message || "The game worker could not start");

    nextWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (sequence !== matchSequence) return;

      const message = event.data;

      if (message.type === "error") {
        fail(message.message);

        return;
      }

      if (message.type === "rejected") {
        notify(message.message);

        return;
      }
      if (message.type === "spawn") {
        showSpawn(message.state, spawnOptions);
        return;
      }
      renderer.spawn = undefined;
      element("spawn-selection").hidden = true;
      element<HTMLButtonElement>("pause").disabled = false;

      snapshot = decoder.decode(message.packet);
      snapshot.localPlayerId=localPlayerId;


      paused = message.paused;

      browserDiagnostics.measure("presentation", () => renderer.update(snapshot!));

      groups.prune(snapshot);

      hudPending = true;
      if (startingCameraPending) {
        const player = snapshot.players.find((p) => p.id === localPlayerId);
        if (player) {
          renderer.focusStartingLocation(player.base);
          startingCameraPending = false;
        }
      }

      element("loading").hidden = true;

      element<HTMLButtonElement>("restart").disabled = false;

      if (snapshot.winner !== null) showResult(snapshot.winner);
    };

    const requestedSeed = onlineQuery.has("diagnostics") && onlineQuery.has("seed") ? Number(onlineQuery.get("seed")) : NaN;
    const seed = Number.isSafeInteger(requestedSeed) && requestedSeed >= 0 && requestedSeed <= 0x7fffffff
      ? requestedSeed : Math.floor(Math.random() * 0x7fffffff);
    diagnosticSeed = seed;
    const startingAge =
      (element<HTMLSelectElement>("starting-age")?.value as StartingAge) || "StoneAge";
    const spawnOptions: MatchOptions = {
      ...DEFAULT_AI_POLICIES,
      seed,
      aiCount: Number(element<HTMLSelectElement>("opponents").value),
      tribes: true,
      ruleset: "ages-v1",
      startingAge,
      infiniteGoldForPlayers: element<HTMLInputElement>("infinite-gold").checked,
    };

    post({
      type: "start",

      width: loaded.map.width(),

      height: loaded.map.height(),

      terrain: loaded.terrain,

      elevation: loaded.elevation,

      forest: loaded.forest,
      resourceTerrain: loaded.resourceTerrain,

      options: {
        ...DEFAULT_AI_POLICIES,
        seed,
        ...(validFactionColor(preferredFactionColor)
          ? { humanColors: [preferredFactionColor] } : {}),

        aiCount: Number(element<HTMLSelectElement>("opponents").value),

        tribes: true,

        ruleset: "ages-v1",

        startingAge,
        infiniteGoldForPlayers: element<HTMLInputElement>("infinite-gold").checked,

        victoryMode: element<HTMLSelectElement>("victory-mode").value as
          | "solo"
          | "allied",

        territoryIncomeScale: loaded.territoryIncomeScale,
        technologySpeed,
      },
    });

    post({ type: "speed", speed });
  } catch (error) {
    if (sequence !== matchSequence) return;

    element("loading").innerHTML =
      '<h2>Unable to load this battlefield</h2><p id="load-error"></p>';

    element("load-error").textContent =
      error instanceof Error ? error.message : "Please try again";

    element<HTMLButtonElement>("restart").disabled = false;
  }
}

let onlineSpawnOptions: MatchOptions | undefined;
function showSpawn(state: SpawnState, options: MatchOptions): void {
  if (!currentMap) return;
  if (renderer.spawn) renderer.spawn.update(state, performance.now());
  else
    renderer.spawn = new SpawnSelectionViewModel(
      currentMap.map,
      options,
      state,
      localPlayerId,
      performance.now(),
    );
  paused = true;
  element<HTMLButtonElement>("pause").disabled = true;
  element("loading").hidden = true;
  element("spawn-selection").hidden = false;
  element("spawn-hint").textContent = renderer.spawn.hint(performance.now());
  element<HTMLButtonElement>("restart").disabled = !!onlineMatchId;
}

async function startOnlineMatch(): Promise<void> {
  document.title = "Age of Fronts — Online match";
  if (worker) return;
  const showOnlineLoading = (message: string, failed = false) => {
    const loading = element("loading");
    loading.hidden = false;
    loading.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = failed ? "Unable to join this match" : "Joining the battlefield";
    const detail = document.createElement("p");
    detail.setAttribute("role", failed ? "alert" : "status");
    detail.textContent = message;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = failed ? "Return to lobbies" : "Cancel and return to lobbies";
    cancel.className = "primary";
    cancel.style.marginTop = "16px";
    cancel.addEventListener("click", () => {
      worker?.terminate();
      window.location.assign("/");
    });
    loading.append(title, detail, cancel);
  };
  document.querySelector(".brand p")!.textContent = "Online match · server hosted";
  if (onlineSeat !== undefined && (!Number.isSafeInteger(onlineSeat) || onlineSeat < 1)) {
    showOnlineLoading("This empire link is invalid. Choose an available empire from the lobby.", true);
    return;
  }
  const endpoint =
    // Empty configuration uses the coordinator on this origin.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    (import.meta.env.VITE_MULTIPLAYER_URL as string | undefined) ||
    (typeof window !== "undefined" ? window.location.origin : undefined);
  if (!endpoint) {
    showOnlineLoading("Multiplayer server URL is not configured.", true);
    return;
  }
  showOnlineLoading("Connecting to the match server…");
  const decoder = new SnapshotDecoder();
  let startingCamera = true;
  let failure = false;
  const session = new OnlineMatchSession(
    endpoint,
    onlineMatchId!,
    async (manifest) => {
      onlineSpawnOptions = manifest.options;
      element<HTMLSelectElement>("map").value = manifest.settings.mapId;
      element<HTMLSelectElement>("world-size").value = String(manifest.settings.worldSize);
      element<HTMLSelectElement>("opponents").innerHTML = `<option>${manifest.options.aiCount} AI</option>`;
      element<HTMLSelectElement>("victory-mode").value = manifest.settings.victory;
      element<HTMLSelectElement>("starting-age").value = manifest.settings.startingAge ?? "StoneAge";
      element<HTMLSelectElement>("technology-speed").value = String(manifest.settings.technologySpeed);
      element<HTMLInputElement>("infinite-gold").checked = Boolean(manifest.options.infiniteGoldForPlayers);
      element<HTMLInputElement>("infinite-gold").disabled = true;
      const loaded = await loadMap(manifest.settings.mapId, manifest.settings.worldSize);
      currentMap = loaded;
      terrainView = new TerrainViewModel(loaded.map);
      renderer.setMap(loaded.map, loaded.geography, loaded.environment);
      element("map-name").textContent = loaded.name;
      return loaded;
    },
    (id) => localPlayerId = id,
    (message) => {
      if (failure || (!session.commandsAvailable && !renderer.spawn))
        showOnlineLoading(message, failure);
    },
    onlineSeat,
    browserDiagnostics,
  );
  worker = session;
  for (const control of document.querySelectorAll<HTMLInputElement>(".match-settings select,.match-settings button,#speed,#pause,#play-again")) control.disabled = true;
  const syncControls = (available: boolean) => {
    for (const control of document.querySelectorAll<HTMLElement>(".command-dock,#selection-card,#empire-panel,#recruitment-feed,#refit-actions")) {
      control.inert = !available;
      control.setAttribute("aria-disabled", String(!available));
    }
    if (available) element("loading").hidden = true;
  };
  syncControls(false);
  session.oncommandsavailable = syncControls;
  session.onerror = (event) => {
    failure = true;
    showOnlineLoading(event.message, true);
  };
  session.onmessage = (event) => {
    if (event.data.type === "spawn") { showSpawn(event.data.state, onlineSpawnOptions!); return; }
    if (event.data.type === "rejected") { notify(event.data.message); return; }
    if (event.data.type !== "state") return;
    renderer.spawn = undefined;
    element("spawn-selection").hidden = true;
    snapshot = event.data.snapshot??decoder.decode(event.data.packet, false);
    snapshot.localPlayerId = localPlayerId;
    snapshot.disconnectedPlayerIds = session.disconnectedPlayerIds;
    paused = event.data.paused;
    browserDiagnostics.measure("presentation", () => renderer.update(snapshot!));
    groups.prune(snapshot);
    hudPending = true;
    if (startingCamera) {
      const player = snapshot.players.find((p) => p.id === localPlayerId);
      if (player) { renderer.focusStartingLocation(player.base); startingCamera = false; }
    }
    syncControls(session.commandsAvailable);
    if (snapshot.winner !== null) showResult(snapshot.winner);
  };
  window.addEventListener("pagehide", () => session.terminate(), { once: true });
  session.connect();
}

let recruitmentProjection: RecruitmentQueueViewModel | undefined;
let hudProjection: HudViewModel | undefined;
let armyProjection: ArmyViewModel | undefined;
let hudPending = false;
function hudText(id: string, value: string): void {
  const target = element(id);
  if (target.textContent !== value) target.textContent = value;
}
function hudDisabled(id: string, value: boolean): void {
  const target = element<HTMLButtonElement>(id);
  if (target.disabled !== value) target.disabled = value;
}
function updateHud(): void {
  hudPending = false;
  if (!snapshot) return;
  limitSquadSelection(renderer.selected, snapshot.squads, localPlayerId);
  const started = performance.now();
  try {

  updateTerrainHover();
  if (recruitmentProjection) recruitmentProjection.update(snapshot, localPlayerId, renderer.selectedBuildings);
  else recruitmentProjection = new RecruitmentQueueViewModel(snapshot, localPlayerId, renderer.selectedBuildings);
  recruitmentFeed.update(recruitmentProjection);

  const player = snapshot.players.find(player => player.id === localPlayerId)!;

  let troops = 0, count = 0;
  for (const squad of snapshot.squads) if (squad.playerId === localPlayerId) { troops += squad.troops; count++; }

  hudText("troop-total", format(troops));

  hudText("reserves", format(player.reserves));

  hudText("gold", hasInfiniteGold(player) ? "∞" : format(player.gold));

  hudText("squad-count", `${count} / ${squadCap(player, snapshot.expansion?.progression[player.id]?.age)}`);

  hudText("land", format(player.land));

  hudText("losses", format(player.losses ?? 0));
  hudText("kills", format(player.kills ?? 0));
  hudText("trade-captured", format(snapshot.expansion?.tradeCapturedValue?.[localPlayerId] ?? 0));
  hudText("trade-lost", format(snapshot.expansion?.tradeLostValue?.[localPlayerId] ?? 0));

  const seconds = Math.floor(snapshot.tick / TICKS_PER_SECOND);

  hudText("clock", `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);

  hudText("pause", paused ? "Resume" : "Pause");

  const vm = viewModel()!;

  for (const { kind } of [...LAND_RECRUITMENT, ...NAVAL_RECRUITMENT]) {
    const recruitment = vm.recruitment(kind);

    const naval = kind === "transport" || kind === "warship";

    const id = naval ? kind : `recruit-${kind}`;

    hudDisabled(id, !recruitment.enabled);
  }

  const empireVm = empireModel();
  for (const { kind: type } of CONSTRUCTION)
    hudDisabled(`build-${type}`,
      !!empireVm?.buildChoice(type).reason ||
      player.eliminated ||
      snapshot.winner !== null);

  updateSelection();

  if (empireVm) empire.update(empireVm);
  if (hudProjection) hudProjection.update(vm);
  else hudProjection = new HudViewModel(vm);
  hud.update(hudProjection);
  if (armyProjection) armyProjection.update(snapshot, renderer.selected, localPlayerId);
  else armyProjection = new ArmyViewModel(snapshot, renderer.selected, localPlayerId);
  const armyVm = armyProjection;
  armyView.update(armyVm);
  if (armyVm.selectedArmy) element("selection-card").hidden = true;


  updateRoster();
  } finally { browserDiagnostics.record("hud", performance.now() - started); }
}

// The view consumes current facts when opened, including same-tick command
// publications. Hidden foreign-faction details need no formatting or DOM work.
element("roster-toggle").addEventListener("click", () => updateRoster());
function updateRoster(): void {
  if (!snapshot || element("roster-popover").hidden) return;
  // One pass over squads instead of a filter per faction (O(players x squads)).
  const squadStats = new Map<number, { count: number; troops: number }>();
  for (const s of snapshot.squads) {
    const entry = squadStats.get(s.playerId) ?? { count: 0, troops: 0 };
    entry.count++;
    entry.troops += s.troops;
    squadStats.set(s.playerId, entry);
  }
  const rosterHtml = snapshot.players

    .map((p) => {
      const stats = squadStats.get(p.id) ?? { count: 0, troops: 0 };

      const troops = stats.troops;

      const campOpacity = campLoss.opacity(p.id);

      const campNotice =
        campOpacity > 0
          ? `<span data-camp-loss="${p.id}" style="opacity:${campOpacity}"> · camp lost</span>`
          : "";
      const identity = new FactionViewModel(p);

      return `<div data-player="${p.id}" class="rival ${p.eliminated ? "eliminated" : ""}"><div class="rival-name"><i style="background:${COLORS[p.id]}"></i><strong>${p.name.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!)}</strong><span>${p.kind === "tribe" ? "TRIBE" : p.ai ? "AI" : p.id === localPlayerId ? "YOU" : "PLAYER"}</span></div><div class="rival-stats"><b>${format(troops)}</b> troops · ${stats.count}${p.kind === "tribe" ? `/${squadCap(p)}` : ""} squads</div>${p.ai ? `<div class="rival-land">${identity.personalityName}${identity.originName ? ` · ${identity.originName}` : ""}</div>` : ""}<div class="rival-land">${snapshot!.expansion ? AGE_NAMES[AGES.indexOf(snapshot!.expansion.progression[p.id].age)] + " · " : ""}${format(p.land)} land${p.eliminated ? " · eliminated" : campNotice}</div></div>`;
    })

    .join("");

  // Replacing the roster every packet rebuilds the DOM and drops hover state; it
  // only changes when a faction's stats or camp notice do.
  if (rosterHtml !== lastRosterHtml) {
    lastRosterHtml = rosterHtml;
    element("roster").innerHTML = rosterHtml;
    campLossLabels = Array.from(
      element("roster").querySelectorAll<HTMLElement>("[data-camp-loss]"),
      (label) => ({ playerId: Number(label.dataset.campLoss), label }),
    );
  }
}
let lastRosterHtml = "";

function updateCampLossLabels(now: number): void {
  if (!campLossLabels.length) return;
  campLossLabels = campLossLabels.filter(({ playerId, label }) => {
    const opacity = campLoss.opacity(playerId, now);
    if (opacity === 0) {
      label.remove();
      return false;
    }
    label.style.opacity = String(opacity);
    return true;
  });
}

function updateTerrainHover(): void {
  if (!terrainPointer || !terrainView) return;

  const tile = renderer.tileAt(terrainPointer.x, terrainPointer.y);

  element("hover-terrain").textContent =
    tile === null ? "" : terrainView.describe(tile);
  const bounds = canvas.getBoundingClientRect();
  hud.hoverDeposit(
    drag || placementType || landingShip !== undefined || targetedAction
      ? null
      : renderer.depositAt(terrainPointer.x, terrainPointer.y),
    { x: bounds.left + terrainPointer.x, y: bounds.top + terrainPointer.y },
  );
}

function updateSelection(): void {
  const vm = viewModel();

  const selected =
    snapshot?.squads.filter((s) => renderer.selected.has(s.id)) ?? [];

  element("selected").textContent = selected.length
    ? `${selected.length} squad${selected.length > 1 ? "s" : ""} · ${format(selected.reduce((sum, s) => sum + s.troops, 0))} troops`
    : renderer.selectedShips.size
      ? `${renderer.selectedShips.size} ships selected`
      : vm?.building
        ? `${renderer.selectedBuildings.size || 1} building${renderer.selectedBuildings.size > 1 ? "s" : ""} selected`
        : vm?.inspectedSquad
          ? "Inspecting enemy squad"
          : "No squads selected";

  element("selected-orders").textContent = selected.length
    ? `Right click to move or attack. Shift queues orders. ${Math.max(...selected.map((s) => s.queuedOrders.length))} queued.`
    : renderer.selectedShips.size
      ? "Right click water to sail. Shift queues waypoints."
      : vm?.building
        ? "Recruit into the shortest compatible selected queue. Shift-click adds buildings; double-click selects visible buildings of this type. Press R to repair."
        : vm?.inspectedSquad
          ? "Enemy details are read only. Select your troops to issue orders."
          : "Click your units or drag a selection box.";

  element<HTMLButtonElement>("hold").disabled =
    selected.length === 0 && renderer.selectedShips.size === 0;

  element<HTMLButtonElement>("replenish").disabled =
    !vm?.canReplenish && !vm?.canRepairBuildings;
  const replenishLabel = element<HTMLButtonElement>("replenish").querySelector(".action-name");
  if (replenishLabel) {
    replenishLabel.textContent = (vm?.selectedBuildings.length ?? 0) > 0 ? "Repair" : "Replenish";
  }

  if (selected.some((s) => s.order.type === "replenish"))
    element("selected-orders").textContent +=
      " Replenishing: remains stopped until full, Hold, or a new order.";

  if (selected.some((s) => s.order.type === "board"))
    element("selected-orders").textContent +=
      " Meeting transport at the blue shore marker. Excess squads hold ashore.";

  const ships =
    snapshot?.ships.filter((s) => renderer.selectedShips.has(s.id)) ?? [];

  element("ship-selection").textContent = ships.length
    ? `${ships.length} ship${ships.length === 1 ? "" : "s"}${vm?.transport ? ` · ${vm.cargo.length}/4 squads aboard` : ""}`
    : "No ships selected";

  element<HTMLButtonElement>("load").disabled =
    !vm?.transport || !vm.selectedSquads.length;

  element<HTMLButtonElement>("unload").disabled = !vm?.cargo.length;

  element("naval-orders").hidden = !ships.length;

  updateGroups();
}

function updateGroups(): void {
  for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
    const button = element<HTMLButtonElement>(`group-${digit}`);

    button.querySelector("small")!.textContent = String(groups.count(digit));

    button.title = `Group ${digit}: ${groups.count(digit)} units. Shift adds; Ctrl replaces or clears.`;

    button.disabled = !snapshot;

    const recalled = snapshot ? groups.recall(digit, snapshot) : undefined;

    const active =
      !!recalled &&
      groups.count(digit) > 0 &&
      recalled.selected.size === renderer.selected.size &&
      recalled.selectedShips.size === renderer.selectedShips.size &&
      [...recalled.selected].every((id) => renderer.selected.has(id)) &&
      [...recalled.selectedShips].every((id) => renderer.selectedShips.has(id));

    button.setAttribute("aria-pressed", String(active));
  }
}

function controlGroup(digit: number, mode: "add" | "replace" | "recall"): void {
  if (!snapshot) return;

  if (mode === "recall") {
    const members = groups.recall(digit, snapshot);

    if (!groups.count(digit)) {
      notify(
        `Control group ${digit} is empty. Shift+${digit} adds selected units.`,
      );

      return;
    }

    cancelPlacement();

    renderer.selected = members.selected;

    renderer.selectedShips = members.selectedShips;

    renderer.selectedBuilding = null;

    renderer.inspectedSquadId = null;
    renderer.selectedDeposit = null;
  } else {
    groups.bind(digit, renderer, snapshot, mode === "add");

    notify(
      `Control group ${digit}: ${groups.count(digit)} units${mode === "add" ? " · selection added" : " · replaced"}`,
    );
  }

  updateHud();
}

function selectAll(): void {
  renderer.selected = new Set(
    snapshot?.squads

      .filter((s) => s.playerId === localPlayerId && s.embarkedOn === null)

      .map((s) => s.id),
  );

  renderer.selectedShips.clear();
  renderer.selectedAircraft.clear();

  renderer.selectedBuilding = null;

  renderer.inspectedSquadId = null;
  renderer.selectedDeposit = null;

  updateHud();
}

function hold(): void {
  if (renderer.selectedShips.size)
    command({
      type: "stop-ships",

      playerId: localPlayerId,

      shipIds: [...renderer.selectedShips],
    });

  if (!renderer.selected.size) return;

  command({
    type: "order",

    playerId: localPlayerId,

    squadIds: [...renderer.selected],

    order: { type: "hold" },
  });
}

function recruit(kind: SquadType, count = 1): void {
  const vm = viewModel();

  const choice = vm?.recruitment(kind);

  if (choice?.enabled && choice.building)
    for (let i = 0; i < count; i++) command({
      type: "recruit",
      playerId: localPlayerId,
      buildingId: choice.building.id,
      buildingIds: choice.buildingIds,
      autoRecruit: choice.building.id !== renderer.selectedBuilding,
      definitionId: choice.definitionId,
    });
  else if (choice) notify(choice.reason);
}

function recruitShip(kind: ShipType, count = 1): void {
  const choice = viewModel()?.recruitment(kind);

  if (choice?.enabled && choice.building)
    for (let i = 0; i < count; i++) command({
      type: "recruit-ship",

      playerId: localPlayerId,

      buildingId: choice.building.id,
      buildingIds: choice.buildingIds,
      autoRecruit: choice.building.id !== renderer.selectedBuilding,

      shipType: kind,

      definitionId: choice.definitionId,
    });
  else if (choice) notify(choice.reason);
}

function repairBuildings(): boolean {
  const vm = viewModel();
  if (!vm || !vm.selectedBuildings.length) return false;

  const owned = vm.selectedBuildings.filter((b) => b.playerId === localPlayerId);
  if (!owned.length) {
    command({
      type: "repair",
      playerId: localPlayerId,
      buildingId: vm.selectedBuildings[0].id,
    });
    return true;
  }

  const repairable = vm.repairableBuildings;
  const targets = repairable.length ? repairable : owned;
  command({
    type: "repair",
    playerId: localPlayerId,
    buildingId: targets[0].id,
    buildingIds: targets.map((b) => b.id),
  });
  return true;
}

function replenish(): void {
  if (repairBuildings()) return;
  const vm = viewModel();

  if (vm?.canReplenish)
    command({
      type: "order",

      playerId: localPlayerId,

      squadIds: vm.replenishableSquads.map((s) => s.id),

      order: { type: "replenish" },
    });
  else notify("Select damaged squads on friendly land with reserves available");
}

function cancelPlacement(): void {
  hud.setBuildingPlacement(false);
  placementType = undefined;

  placementAge = undefined;

  targetedAction = undefined;

  landingShip = undefined;

  renderer.placement = undefined;

  renderer.buildSites = [];
  renderer.buildPreview?.cancel();

  element("placement-hint").hidden = true;

  canvas.style.cursor = "";

  for (const { kind } of CONSTRUCTION)
    element(`build-${kind}`).setAttribute("aria-pressed", "false");
}

function togglePause(): void {
  if (snapshot) post({ type: "pause", paused: !paused });
}

function showResult(winner: number): void {
  const player = snapshot!.players.find((p) => p.id === winner);

  element("result-title").textContent =
    winner === localPlayerId
      ? "Victory"
      : winner === 0
        ? "A hard-fought draw"
        : `${player?.name ?? "An opponent"} wins`;

  if (winner === -1)
    element("result-title").textContent =
      `Allied victory · ${snapshot!.expansion!.winners.map((id) => snapshot!.players.find((p) => p.id === id)!.name).join(", ")}`;

  element("result-description").textContent =
    winner === localPlayerId
      ? "All hostile buildings and military forces have fallen."
      : "The remaining enemy buildings and military forces have been defeated.";

  element("result").hidden = false;
}

element("restart").addEventListener("click", () => void start());

element("play-again").addEventListener("click", () => void start());

for (const { kind } of LAND_RECRUITMENT)
  element(`recruit-${kind}`).addEventListener("click", (event) => recruit(kind, recruitmentControls.batch(event.shiftKey, cameraPan.enabled)));

element("replenish").addEventListener("click", replenish);

function placementRejection(type: BuildingType, tile: number): string | null {
  const preview = renderer.buildPreview;
  // A null rejection means the site is valid; only a missing preview has no match.
  return preview ? preview.rejection(type, tile) : "No active match";
}

function placeBuilding(type: BuildingType, age?: Age): void {
  if (!snapshot || snapshot.winner !== null || snapshot.players.find(player => player.id === localPlayerId)!.eliminated)
    return;

  const now = performance.now();
  if (now - lastPlacementAttempt < 80) return;
  lastPlacementAttempt = now;

  const choice = empireModel()?.buildChoice(
    type,
    age ?? empire.buildAges[type],
  );

  if (choice?.reason) {
    notify(choice.reason);
    return;
  }

  cancelPlacement();
  empire.close();
  placementType = type;
  hud.setBuildingPlacement(true);
  placementAge = choice?.age;

  document
    .getElementById(`build-${type}`)
    ?.setAttribute("aria-pressed", "true");

  renderer.buildPreview?.begin(snapshot,localPlayerId,type,placementAge);

  element("placement-hint").hidden = false;

  element("placement-hint").textContent =
    `Place ${BUILDING_RULES[type].name} · ${choice?.cost?.gold ?? BUILDING_RULES[type].cost} gold · Escape cancels`;

  canvas.style.cursor = "crosshair";
}

for (const { kind } of CONSTRUCTION)
  element(`build-${kind}`).addEventListener("click", () => placeBuilding(kind));

for (const { kind } of NAVAL_RECRUITMENT)
  element(kind).addEventListener("click", (event) => recruitShip(kind, recruitmentControls.batch(event.shiftKey, cameraPan.enabled)));

for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0])
  element(`group-${digit}`).addEventListener("click", (event) =>
    controlGroup(
      digit,

      event.ctrlKey || event.metaKey
        ? "replace"
        : event.shiftKey
          ? "add"
          : "recall",
    ),
  );

element("load").addEventListener("click", () => {
  const ship = viewModel()?.transport;

  if (ship)
    command({
      type: "board",

      playerId: localPlayerId,

      shipId: ship.id,

      squadIds: [...renderer.selected],
    });
});

element("unload").addEventListener("click", () => {
  const ship = viewModel()?.transport;

  if (ship) {
    cancelPlacement();

    landingShip = ship.id;

    canvas.style.cursor = "crosshair";

    notify("Click coastal land directly beside the transport to unload");
  }
});

element("hold").addEventListener("click", hold);

element("all").addEventListener("click", selectAll);

element("pause").addEventListener("click", togglePause);


element("speed").addEventListener("change", () => {
  speed = Number(element<HTMLSelectElement>("speed").value) as 1 | 2 | 4;

  post({ type: "speed", speed });
});

let drag:
  | {
      x: number;

      y: number;

      lastX: number;

      lastY: number;

      button: number;

      shift: boolean;

      moved: boolean;
    }
  | undefined;

const localPosition = (event: MouseEvent | PointerEvent) => {
  const rect = canvas.getBoundingClientRect();

  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

document.addEventListener("contextmenu", (event) => {
  if (
    !renderer.selected.size &&
    !renderer.selectedShips.size &&
    !renderer.selectedAircraft.size &&
    empire.closeDiplomacy()
  )
    event.preventDefault();
});

canvas.addEventListener("pointerdown", (event) => {
  if ((!snapshot && !renderer.spawn) || (snapshot !== undefined && snapshot.winner !== null) || event.button > 2) return;

  const p = localPosition(event);

  canvas.focus();

  canvas.setPointerCapture(event.pointerId);

  drag = {
    ...p,

    lastX: p.x,

    lastY: p.y,

    button: event.button,

    shift: event.shiftKey,

    moved: false,
  };
});

canvas.addEventListener("pointermove", (event) => {
  const p = localPosition(event);

  terrainPointer = p;

  const tile = renderer.tileAt(p.x, p.y);
  if (renderer.spawn) renderer.spawn.hoverTile = tile;

  if (placementType && tile !== null && snapshot && currentMap) {
    const rejection = placementRejection(placementType, tile);

    renderer.placement = {
      tile,

      type: placementType,

      friendly: rejection === null,
    };

    const currentCost =
      empireModel()?.buildChoice(placementType, placementAge)?.cost?.gold ??
      BUILDING_RULES[placementType].cost;
    element("placement-hint").textContent =
      rejection ??
      `Place ${BUILDING_RULES[placementType].name} · ${currentCost} gold`;
  }

  updateTerrainHover();

  if (!drag) return;

  if ((p.x - drag.x) ** 2 + (p.y - drag.y) ** 2 > 25) drag.moved = true;

  if (drag.button === 1) renderer.pan(p.x - drag.lastX, p.y - drag.lastY);
  else if (drag.button === 0 && drag.moved)
    renderer.selectionBox = { x1: drag.x, y1: drag.y, x2: p.x, y2: p.y };

  drag.lastX = p.x;

  drag.lastY = p.y;
});

canvas.addEventListener("pointerleave", () => {
  if (renderer.spawn) renderer.spawn.hoverTile = null;
  terrainPointer = undefined;
  element("hover-terrain").textContent = "";
  hud.hoverDeposit(null);
});

canvas.addEventListener("pointerup", (event) => {
  if (renderer.spawn && drag) {
    const start = drag, p = localPosition(event);
    drag = undefined;
    if (start.button === 0 && !start.moved) {
      const tile = renderer.tileAt(p.x, p.y);
      if (tile !== null) {
        const rejection = renderer.spawn.rejection(tile);
        if (rejection) notify(rejection); else post({ type: "select-spawn", tile });
      }
    }
    return;
  }
  if (!drag || !snapshot) return;

  const p = localPosition(event),
    start = drag;

  drag = undefined;

  renderer.selectionBox = undefined;

  if (
    start.button === 2 &&
    (placementType || landingShip !== undefined)
  ) {
    cancelPlacement();

    return;
  }

  if ((start.button === 0 || start.button === 2) && targetedAction) {
    const world = renderer.world(p.x, p.y);
    const action = targetedAction;

    cancelPlacement();
    action(Math.round(world.x * FIXED), Math.round(world.y * FIXED), {
      shift:start.shift,
      buildingId:start.button === 2 ? renderer.buildingAt(p.x,p.y) ?? undefined : undefined,
    });
    return;
  }

  if (
    start.button === 0 &&
    (placementType || landingShip !== undefined || targetedAction)
  ) {
    const tile = renderer.tileAt(p.x, p.y);

    if (tile !== null) {
      if (placementType) {
        const rejection = placementRejection(placementType, tile);
        if (rejection) { notify(rejection); return; }
        const now = performance.now();
        if (now - lastPlacementTime >= 80) {
          lastPlacementTime = now;
          command({
            type: "build",
            playerId: localPlayerId,
            buildingType: placementType,
            age: placementAge,
            tile,
          });
        }
      } else command({ type: "unload", playerId: localPlayerId, shipId: landingShip!, tile });

      cancelPlacement();
    }

    return;
  }

  if (start.button === 0) {
    renderer.inspectedSquadId = null;
    if (!start.shift) {
      orderGesture.cancel();
      renderer.selectedDeposit = null;
      renderer.selected.clear();

      renderer.selectedShips.clear();
      renderer.selectedAircraft.clear();

      renderer.selectedBuilding = null;

      renderer.inspectedSquadId = null;
      renderer.selectedDeposit = null;
    }

    if (start.moved) {
      const candidates = { squads: [] as number[], ships: [] as number[], aircraft: [] as number[] };
      for (const aircraft of snapshot.expansion?.aircraft ?? []) {
        if (aircraft.playerId !== localPlayerId) continue;
        const position = renderer.screen(
          aircraft.x / FIXED,
          aircraft.y / FIXED,
        );
        if (
          position.x >= Math.min(p.x, start.x) &&
          position.x <= Math.max(p.x, start.x) &&
          position.y >= Math.min(p.y, start.y) &&
          position.y <= Math.max(p.y, start.y)
        )
          candidates.aircraft.push(aircraft.id);
      }
      for (const squad of snapshot.squads) {
        if (squad.playerId !== localPlayerId || squad.embarkedOn !== null) continue;

        const position = renderer.screen(squad.x / FIXED, squad.y / FIXED);

        if (
          position.x >= Math.min(p.x, start.x) &&
          position.x <= Math.max(p.x, start.x) &&
          position.y >= Math.min(p.y, start.y) &&
          position.y <= Math.max(p.y, start.y)
        )
          candidates.squads.push(squad.id);
      }

      for (const ship of snapshot.ships) {
        if (ship.playerId !== localPlayerId) continue;

        const position = renderer.shipScreenPosition(ship);

        if (
          position.x >= Math.min(p.x, start.x) &&
          position.x <= Math.max(p.x, start.x) &&
          position.y >= Math.min(p.y, start.y) &&
          position.y <= Math.max(p.y, start.y)
        )
          candidates.ships.push(ship.id);
      }
      applyDragSelection(renderer, candidates, start.shift);
      renderer.selectedBuilding = null;
    } else {
      const army = renderer.armyAt(p.x, p.y);
      const aircraft = renderer.aircraftAt(p.x, p.y);
      const building = renderer.buildingAt(p.x, p.y);

      const ship = renderer.shipAt(p.x, p.y);

      const squad = renderer.squadAt(p.x, p.y, localPlayerId);
      const foreignSquad = renderer.squadAt(p.x, p.y);

      if (army !== null) {
        const selectedArmy = snapshot.expansion?.armies.find(
          (a) => a.id === army,
        );
        if (selectedArmy)
          for (const squad of snapshot.squads)
            if (
              selectedArmy.memberIds.includes(squad.id) &&
              squad.embarkedOn === null &&
              !squad.refit
            )
              renderer.selected.add(squad.id);
      } else if (aircraft !== null) {
        if (start.shift && renderer.selectedAircraft.has(aircraft))
          renderer.selectedAircraft.delete(aircraft);
        else renderer.selectedAircraft.add(aircraft);
      } else if (
        ship !== null &&
        currentMap?.map.isWater(renderer.tileAt(p.x, p.y) ?? -1) &&
        snapshot.ships.some((s) => s.id === ship && s.playerId === localPlayerId)
      ) {
        if (start.shift && renderer.selectedShips.has(ship))
          renderer.selectedShips.delete(ship);
        else renderer.selectedShips.add(ship);
      } else if (squad) {
        if (start.shift && renderer.selected.has(squad.id))
          renderer.selected.delete(squad.id);
        else renderer.selected.add(squad.id);
      } else if (foreignSquad && foreignSquad.playerId !== localPlayerId) {
        renderer.inspectedSquadId = foreignSquad.id;
      } else if (building !== null) renderer.selectBuilding(building, start.shift);
      else if (
        ship !== null &&
        snapshot.ships.some((s) => s.id === ship && s.playerId === localPlayerId)
      ) {
        if (start.shift && renderer.selectedShips.has(ship))
          renderer.selectedShips.delete(ship);
        else renderer.selectedShips.add(ship);
      } else renderer.selectedDeposit = renderer.depositAt(p.x,p.y);
    }

    if (
      !start.moved &&
      !renderer.selected.size &&
      !renderer.selectedShips.size &&
      !renderer.selectedAircraft.size &&
      renderer.selectedDeposit === null &&
      renderer.inspectedSquadId === null &&
      (renderer.selectedBuilding === null ||
        snapshot.buildings.find((b) => b.id === renderer.selectedBuilding)
          ?.playerId !== localPlayerId)
    ) {
      const tile = renderer.tileAt(p.x, p.y),
        clickedSquad = renderer.squadAt(p.x, p.y),
        clickedShip = snapshot.ships.find(
          (s) => s.id === renderer.shipAt(p.x, p.y),
        ),
        clickedBuilding = snapshot.buildings.find(
          (b) => b.id === renderer.selectedBuilding,
        ),
        owner =
          clickedSquad?.playerId ??
          clickedShip?.playerId ??
          clickedBuilding?.playerId ??
          (tile === null ? 0 : snapshot.owners[tile]);

      if (owner && owner !== localPlayerId) empire.inspectPlayer(owner);
    }

    updateHud();
  } else if (start.button === 2) {
    if (renderer.selectedAircraft.size) {
      const position = renderer.world(p.x, p.y);
      const order = sortieCommand(snapshot, localPlayerId,
        Math.round(position.x * FIXED), Math.round(position.y * FIXED),
        start.shift, renderer.selectedAircraft);
      if (order) command(order);
      else notify("No ready selected aircraft at an operational airfield");
      return;
    }
    if (!renderer.selected.size && !renderer.selectedShips.size) {
      notify("Select your squads before giving an order");

      return;
    }

    const target = renderer.squadAt(p.x, p.y);

    const clickedShipId = renderer.shipAt(p.x, p.y);

    const coastal = snapshot.buildings.find(
      (b) => b.id === renderer.buildingAt(p.x, p.y),
    );
    const enemyShip = snapshot.ships.find(
      (s) => s.id === clickedShipId && s.playerId !== localPlayerId,
    );
    const selectedWarships=[...renderer.selectedShips].filter(id=>snapshot!.ships.find(s=>s.id===id)?.kind==="warship");
    if (
      selectedWarships.length &&
      (enemyShip || (coastal && coastal.playerId !== localPlayerId))
    ) {
      command({
        type: "naval-attack",
        playerId: localPlayerId,
        shipIds: selectedWarships,
        targetId: (enemyShip ?? coastal)!.id,
      });
      return;
    }
    const transport = snapshot.ships.find(
      (s) =>
        s.id === clickedShipId && s.playerId === localPlayerId && s.kind === "transport",
    );

    if (transport && renderer.selected.size) {
      command({
        type: "board",

        playerId: localPlayerId,

        shipId: transport.id,

        squadIds: [...renderer.selected],
      });

      renderer.selectedShips = new Set([transport.id]);

      notify(
        "Squads and transport will meet at a reachable coast. Excess squads wait ashore.",
      );

      return;
    }

    const tile = renderer.tileAt(p.x, p.y);

    const shipOrder=tile!==null&&currentMap ? shipMoveCommand(snapshot,renderer.selectedShips,localPlayerId,tile,currentMap.map.isWater(tile),start.shift) : null;
    if (shipOrder) {
      command(shipOrder);
      return;
    }

    if (!renderer.selected.size) {
      notify(
        "Right-click water to sail, or land with a loaded transport to disembark.",
      );

      return;
    }

    const enemy = target && target.playerId !== localPlayerId;

    const position = renderer.world(p.x, p.y);

    const building = snapshot.buildings.find(
      (b) => b.id === renderer.buildingAt(p.x, p.y),
    );

    const barrier = snapshot.expansion?.barriers.find(
      (b) => tile !== null && b.health > 0 && b.tiles.includes(tile),
    );

    const structureOrder =
      !enemy &&
      (Boolean(building && building.playerId !== localPlayerId) ||
        Boolean(barrier && barrier.playerId !== localPlayerId));
    if (!enemy && tile === null) return;
    const ids = [...renderer.selected];
    const ordinary: Command = structureOrder ? {
        type: "attack-structure",
        playerId: localPlayerId,
        squadIds: ids,
        buildingId: building?.id,
        barrierId: barrier?.id,
      } : {
      type: "order",

      playerId: localPlayerId,

      squadIds: ids,

      append: start.shift,

      order: enemy
        ? { type: "attack", targetId: target.id }
        : { type: "move", tile: tile! },
    };
    const context = `${matchSequence}:${ids.sort((a,b)=>a-b).join(",")}`;
    orderGesture.submit({time:performance.now(),...p,context,single:()=>{
      if (snapshot?.winner === null && context === `${matchSequence}:${[...renderer.selected].sort((a,b)=>a-b).join(",")}`)
        command(ordinary);
    }}, !start.shift && !structureOrder ? ()=>command({
      type:"charge",playerId:localPlayerId,squadIds:ids,
      x:Math.round(position.x*FIXED),y:Math.round(position.y*FIXED),targetId:enemy ? target.id : undefined,
      fallbackOrder: enemy ? {type:"attack",targetId:target.id} : {type:"move",tile:tile!},
    }) : undefined);

    const world = renderer.world(p.x, p.y);

    renderer.marker = {
      ...world,

      until: performance.now() + 800,

      attack: !!enemy,
    };
  }
});

canvas.addEventListener("pointercancel", () => {
  drag = undefined;

  renderer.selectionBox = undefined;
});

canvas.addEventListener("dblclick", (event) => {
  if (
    !snapshot ||
    snapshot.winner !== null ||
    placementType ||
    landingShip !== undefined
  )
    return;

  const point = localPosition(event);

  const ship = snapshot.ships.find(
    (s) => s.id === renderer.shipAt(point.x, point.y) && s.playerId === localPlayerId,
  );

  const squad = renderer.squadAt(point.x, point.y, localPlayerId);
  const building = snapshot.buildings.find(b => b.id === renderer.buildingAt(point.x, point.y) && b.playerId === localPlayerId);

  if (!ship && !squad && !building) return;

  if (!event.shiftKey) {
    renderer.selected.clear();

    renderer.selectedShips.clear();
    renderer.selectedAircraft.clear();
    renderer.selectedBuilding = null;
  }

  renderer.inspectedSquadId = null;
  renderer.selectedDeposit = null;

  if (
    ship &&
    (currentMap?.map.isWater(renderer.tileAt(point.x, point.y) ?? -1) || !squad)
  )
    for (const id of renderer.visibleShips(ship.kind))
      renderer.selectedShips.add(id);
  else if (squad)
    for (const id of renderer.visibleSquads(squad.kind))
      renderer.selected.add(id);
  else if (building) {
    const ids = new Set(renderer.visibleBuildings(building.type));
    renderer.buildingSelection.select(snapshot.buildings.filter(b => ids.has(b.id)), true);
    renderer.buildingSelection.focused = building.id;
  }

  updateHud();
});

canvas.addEventListener(
  "wheel",

  (event) => {
    event.preventDefault();

    const p = localPosition(event);

    renderer.zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
  },

  { passive: false },
);

const editingText = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.matches(
    "input:not([type=checkbox]):not([type=radio]),select,textarea",
  ) || target.isContentEditable);
document.addEventListener("keyup", (event) => {
  cameraPan.keyUp(event.code);
  recruitmentControls.keyUp(event.code);
});
window.addEventListener("blur", () => { cameraPan.clear(); recruitmentControls.clear(); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { cameraPan.clear(); recruitmentControls.clear(); }
});
document.addEventListener("focusin", (event) => {
  if (editingText(event.target)) { cameraPan.clear(); recruitmentControls.clear(); }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && empire.close()) {
    event.preventDefault();
    return;
  }
  if (editingText(event.target)) return;

  if (recruitmentControls.keyDown(event.code)) {
    cameraPan.clear();
    event.preventDefault();
    return;
  }
  if (!recruitmentControls.spaceHeld && cameraPan.keyDown(event)) {
    event.preventDefault();
    return;
  }
  const key = event.key.toLowerCase();

  if (
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    ["y", "i", "u"].includes(key)
  ) {
    event.preventDefault();
    if (key === "u") empire.upgrade();
    else empire.toggle(key === "y" ? "technology" : "supplies");
    return;
  }

  const action = hotkeyAction(event, cameraPan.enabled, recruitmentControls.spaceHeld);

  if (!action) return;

  event.preventDefault();

  switch (action.type) {
    case "sortie":
      empire.sortie(event.shiftKey);
      break;
    case "recruit":
      recruit(action.kind, recruitmentControls.batch(event.shiftKey, cameraPan.enabled));

      break;

    case "recruit-ship":
      recruitShip(action.kind, recruitmentControls.batch(event.shiftKey, cameraPan.enabled));

      break;

    case "construct":
      placeBuilding(action.kind);

      break;

    case "replenish":
      replenish();

      break;

    case "hold":
      hold();

      break;

    case "fit":
      renderer.home();

      break;

    case "cancel":
      cancelPlacement();

      hud.closeInspection();

      break;

    case "select-all":
      selectAll();

      break;

    case "group":
      controlGroup(action.digit, action.mode);

      break;
  }
});

let previousFrame: number | undefined;
let nextClientDiagnosticsAt = 0;
function frame(now: number): void {
  const started = performance.now();
  if (hudPending) updateHud();
  if (previousFrame !== undefined) browserDiagnostics.record("frameInterval", now - previousFrame);
  previousFrame = now;
  if (renderer.spawn) {
    const hint = renderer.spawn.hint(now);
    if (element("spawn-hint").textContent !== hint) element("spawn-hint").textContent = hint;
  }
  const pan = cameraPan.step(now);
  if (pan.x || pan.y) renderer.pan(pan.x, pan.y);
  if (renderer.draw(now, speed, paused)) updateCampLossLabels(now);
  browserDiagnostics.record("frame", performance.now() - started);
  if (snapshot && now >= nextClientDiagnosticsAt && (worker instanceof OnlineMatchSession || onlineQuery.has("diagnostics"))) {
    nextClientDiagnosticsAt = now + 30_000;
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    console.info(JSON.stringify({ event: "browser-runtime-diagnostics", tick: snapshot.tick, seed: diagnosticSeed,
      browser: { userAgent: navigator.userAgent, width: window.innerWidth, height: window.innerHeight },
      map: element<HTMLSelectElement>("map").value, timings: browserDiagnostics.snapshot(),
      heap: heap ? { used: heap.usedJSHeapSize, total: heap.totalJSHeapSize } : undefined,
      ...(worker instanceof OnlineMatchSession ? worker.runtimeDiagnostics() : {}),
      clientTimings: browserDiagnostics.snapshot() }));
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// The homepage links to a validated map; the game's full local settings stay available.
const launchMap = new URLSearchParams(window.location.search).get("map");
if (MAPS.some((map) => map.id === launchMap))
  element<HTMLSelectElement>("map").value = launchMap!;

void start();
