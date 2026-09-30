import { BuildingIndex } from "../BuildingIndex";

import { constructionRejection } from "../Construction";

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

import { FIXED, MAX_FACTIONS, MAX_SQUADS, TICKS_PER_SECOND } from "../Protocol";

import { BUILDING_RULES } from "../Rules";

import { SnapshotDecoder } from "../SnapshotCodec";

import { loadMap, MAPS } from "../Terrain";

import { empireMarkup, EmpireView } from "./EmpireView";

import { EmpireViewModel } from "./EmpireViewModel";

import { UNIT } from "../content/Units";

import { AGE_NAMES, AGES, type Age } from "../domain/Definitions";

import { ControlGroups } from "./ControlGroups";

import {
  CONSTRUCTION,
  hotkeyAction,
  LAND_RECRUITMENT,
  NAVAL_RECRUITMENT,
} from "./Controls";

import { hudMarkup, HudView } from "./HudView";

import { HudViewModel } from "./HudViewModel";

import { COLORS, Renderer } from "./Renderer";

import { SkirmishViewModel } from "./SkirmishViewModel";

import { TerrainViewModel } from "./TerrainViewModel";

import "./style.css";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `

  <header class="topbar">

    <div class="brand"><span class="brand-mark">AF</span><div><h1>Age of Fronts</h1><p>Local AI skirmish</p></div></div>

    <div class="match-settings"><label>Battlefield<select id="map">${MAPS.map((m) => `<option value="${m.id}">${m.name}</option>`).join("")}</select></label><label>Opponents<select id="opponents">${Array.from(
      { length: MAX_FACTIONS - 1 },

      (_, i) => i + 1,
    )

      .map(
        (n) =>
          `<option value="${n}" ${n === 3 ? "selected" : ""}>${n} AI</option>`,
      )

      .join(
        "",
      )}</select></label><label>World size<select id="world-size"><option value="250">250×125 · classic</option><option value="500" selected>500×250 · expanded</option><option value="1000">1000×500 · large</option></select></label><label>Victory<select id="victory-mode"><option value="solo">Solo conquest</option><option value="allied">Allied conquest</option></select></label><button id="restart" class="primary">New skirmish</button></div>

    <div class="time-controls"><span id="clock">0:00</span><select id="speed" aria-label="Game speed"><option value="1">1× speed</option><option value="2">2× speed</option><option value="4">4× speed</option></select><button id="pause" aria-label="Pause game">Pause <kbd>Space</kbd></button><button id="home" aria-label="Fit battlefield">Fit map <kbd>Home</kbd></button></div>

  </header>

  ${empireMarkup()}

  <main class="battlefield" aria-label="Battlefield">

    <canvas id="battlefield" aria-label="Map with selectable troop squads" tabindex="0"></canvas>

    <div class="map-badge"><span class="live-dot"></span><span id="map-name">Loading battlefield…</span></div>

    <div id="loading" class="loading"><span class="spinner"></span><h2>Preparing the battlefield</h2><p>Loading OpenFront terrain and deploying your squads.</p></div>

    <div id="result" class="result" hidden><div><span class="eyebrow">SKIRMISH COMPLETE</span><h2 id="result-title"></h2><p id="result-description"></p><button id="play-again" class="primary">Play again</button></div></div>

    <div id="toast" role="status" class="toast" hidden></div><div id="placement-hint" class="placement-hint" hidden></div>

    <div class="terrain-legend"><span><i class="plains"></i>Plains · fast</span><span><i class="hills"></i>Highlands · slower</span><span><i class="mountains"></i>Mountains · slowest</span><span id="hover-terrain"></span></div>

    ${hudMarkup()}

  </main>

  <footer><span>© OpenFront and Contributors · Modified Age of Fronts prototype</span><a href="/age-of-fronts-source.zip" download>Corresponding source</a><span id="map-attribution">OpenFront maps · CC BY-SA 4.0</span></footer>

`;

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id)! as T;

const canvas = element<HTMLCanvasElement>("battlefield");

const renderer = new Renderer(canvas);

const groups = new ControlGroups();

const hud = new HudView(element("app"), (height) =>
  renderer.setHudBottomInset(height),
);

const empire = new EmpireView(element("app"), {
  refresh: updateHud,
  command,
  build: placeBuilding,
  notify,
  focusedRef: () => hud.inspectedRef,
  target: beginTarget,
});

let worker: Worker | undefined;

let snapshot: Snapshot | undefined;

let paused = false;

let speed: 1 | 2 | 4 = 1;

let toastTimer: ReturnType<typeof setTimeout>;

let matchSequence = 0;

let currentMap: Awaited<ReturnType<typeof loadMap>> | undefined;

let terrainView: TerrainViewModel | undefined;

let terrainPointer: { x: number; y: number } | undefined;

let placementIndex: BuildingIndex | undefined;

let placementType: BuildingType | undefined;

let landingShip: number | undefined;

let placementAge: Age | undefined;

let targetedAction: ((x: number, y: number) => void) | undefined;

let rightClick: { time: number; x: number; y: number } | undefined;

const empireModel = () =>
  snapshot?.expansion ? new EmpireViewModel(snapshot, renderer) : undefined;

function beginTarget(
  action: (x: number, y: number) => void,
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
  const sequence = ++matchSequence;

  worker?.terminate();

  worker = undefined;

  snapshot = undefined;

  paused = false;

  renderer.selected.clear();

  renderer.selectedShips.clear();
  renderer.selectedAircraft.clear();

  renderer.selectedBuilding = null;

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
    '<span class="spinner"></span><h2>Preparing the battlefield</h2><p>Loading OpenFront terrain and deploying your squads.</p>';

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

    placementIndex = new BuildingIndex(loaded.map);

    renderer.setMap(loaded.map, loaded.geography, loaded.environment);

    element("map-name").textContent = `${loaded.name} · land skirmish`;

    const nextWorker = new Worker(new URL("../worker.ts", import.meta.url), {
      type: "module",
    });

    worker = nextWorker;

    const decoder = new SnapshotDecoder();

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

      snapshot = decoder.decode(message.packet);

      placementIndex!.rebuild(snapshot.buildings);

      paused = message.paused;

      renderer.update(snapshot);

      groups.prune(snapshot);

      updateHud();

      element("loading").hidden = true;

      element<HTMLButtonElement>("restart").disabled = false;

      if (snapshot.winner !== null) showResult(snapshot.winner);
    };

    const seed = Math.floor(Math.random() * 0x7fffffff);

    post({
      type: "start",

      width: loaded.map.width(),

      height: loaded.map.height(),

      terrain: loaded.terrain,

      elevation: loaded.elevation,

      forest: loaded.forest,

      options: {
        seed,

        aiCount: Number(element<HTMLSelectElement>("opponents").value),

        tribes: true,

        ruleset: "ages-v1",

        victoryMode: element<HTMLSelectElement>("victory-mode").value as
          | "solo"
          | "allied",

        territoryIncomeScale: loaded.territoryIncomeScale,
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

function updateHud(): void {
  if (!snapshot) return;

  updateTerrainHover();

  const player = snapshot.players[0];

  const own = snapshot.squads.filter((s) => s.playerId === 1);

  element("troop-total").textContent = format(
    own.reduce((sum, s) => sum + s.troops, 0),
  );

  element("reserves").textContent = format(player.reserves);

  element("gold").textContent = format(player.gold);

  element("squad-count").textContent = `${own.length} / ${MAX_SQUADS}`;

  element("land").textContent = format(player.land);

  element("losses").textContent = format(player.losses);

  const seconds = Math.floor(snapshot.tick / TICKS_PER_SECOND);

  element("clock").textContent =
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  element("pause").innerHTML =
    `${paused ? "Resume" : "Pause"} <kbd>Space</kbd>`;

  const vm = viewModel()!;

  for (const { kind } of [...LAND_RECRUITMENT, ...NAVAL_RECRUITMENT]) {
    const recruitment = vm.recruitment(kind);

    const naval = kind === "transport" || kind === "warship";

    const id = naval ? kind : `recruit-${kind}`;

    element<HTMLButtonElement>(id).disabled = !recruitment.enabled;
  }

  for (const { kind: type } of CONSTRUCTION)
    element<HTMLButtonElement>(`build-${type}`).disabled =
      !!empireModel()?.buildChoice(type).reason ||
      player.eliminated ||
      snapshot.winner !== null;

  updateSelection();

  hud.update(new HudViewModel(vm));

  if (snapshot.expansion) empire.update(empireModel()!);

  element("roster").innerHTML = snapshot.players

    .map((p) => {
      const squads = snapshot!.squads.filter((s) => s.playerId === p.id);

      const troops = squads.reduce((sum, s) => sum + s.troops, 0);

      return `<div data-player="${p.id}" class="rival ${p.eliminated ? "eliminated" : ""}"><div class="rival-name"><i style="background:${COLORS[p.id]}"></i><strong>${p.name}</strong><span>${p.kind === "tribe" ? "TRIBE" : p.ai ? "AI" : "YOU"}</span></div><div class="rival-stats"><b>${format(troops)}</b> troops · ${squads.length}${p.kind === "tribe" ? `/${squadCap(p)}` : ""} squads</div><div class="rival-land">${snapshot!.expansion ? AGE_NAMES[AGES.indexOf(snapshot!.expansion.progression[p.id].age)] + " · " : ""}${format(p.land)} land${p.eliminated ? " · eliminated" : snapshot!.owners[p.base] !== p.id ? " · camp lost" : ""}</div></div>`;
    })

    .join("");
}

function updateTerrainHover(): void {
  if (!terrainPointer || !terrainView) return;

  const tile = renderer.tileAt(terrainPointer.x, terrainPointer.y);

  element("hover-terrain").textContent =
    tile === null ? "" : terrainView.describe(tile);
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
        ? "Building selected"
        : "No squads selected";

  element("selected-orders").textContent = selected.length
    ? `Right click to move or attack. Shift queues orders. ${Math.max(...selected.map((s) => s.queuedOrders.length))} queued.`
    : renderer.selectedShips.size
      ? "Right click water to sail. Shift queues waypoints."
      : vm?.building
        ? "Recruitment stays available in the bottom command bar."
        : "Click your units or drag a selection box.";

  element<HTMLButtonElement>("hold").disabled =
    selected.length === 0 && renderer.selectedShips.size === 0;

  element<HTMLButtonElement>("replenish").disabled = !vm?.canReplenish;

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

      .filter((s) => s.playerId === 1 && s.embarkedOn === null)

      .map((s) => s.id),
  );

  renderer.selectedShips.clear();
  renderer.selectedAircraft.clear();

  renderer.selectedBuilding = null;

  updateHud();
}

function hold(): void {
  if (renderer.selectedShips.size)
    command({
      type: "stop-ships",

      playerId: 1,

      shipIds: [...renderer.selectedShips],
    });

  if (!renderer.selected.size) return;

  command({
    type: "order",

    playerId: 1,

    squadIds: [...renderer.selected],

    order: { type: "hold" },
  });
}

function recruit(kind: SquadType): void {
  const vm = viewModel();

  const choice = vm?.recruitment(kind);

  if (choice?.enabled && choice.building)
    command({
      type: "recruit",
      playerId: 1,
      buildingId: choice.building.id,
      definitionId: choice.definitionId,
    });
  else if (choice) notify(choice.reason);
}

function recruitShip(kind: ShipType): void {
  const choice = viewModel()?.recruitment(kind);

  if (choice?.enabled && choice.building)
    command({
      type: "recruit-ship",

      playerId: 1,

      buildingId: choice.building.id,

      shipType: kind,

      definitionId: choice.definitionId,
    });
  else if (choice) notify(choice.reason);
}

function replenish(): void {
  const vm = viewModel();

  if (vm?.canReplenish)
    command({
      type: "order",

      playerId: 1,

      squadIds: vm.replenishableSquads.map((s) => s.id),

      order: { type: "replenish" },
    });
  else notify("Select damaged squads on friendly land with reserves available");
}

function cancelPlacement(): void {
  placementType = undefined;

  placementAge = undefined;

  targetedAction = undefined;

  landingShip = undefined;

  renderer.placement = undefined;

  renderer.buildSites = [];

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
    winner === 1
      ? "Victory"
      : winner === 0
        ? "A hard-fought draw"
        : `${player?.name ?? "An opponent"} wins`;

  if (winner === -1)
    element("result-title").textContent =
      `Allied victory · ${snapshot!.expansion!.winners.map((id) => snapshot!.players.find((p) => p.id === id)!.name).join(", ")}`;

  element("result-description").textContent =
    winner === 1
      ? "All hostile buildings and military forces have fallen."
      : "The remaining enemy buildings and military forces have been defeated.";

  element("result").hidden = false;
}

element("restart").addEventListener("click", () => void start());

element("play-again").addEventListener("click", () => void start());

for (const { kind } of LAND_RECRUITMENT)
  element(`recruit-${kind}`).addEventListener("click", () => recruit(kind));

element("replenish").addEventListener("click", replenish);

function placementRejection(type: BuildingType, tile: number): string | null {
  if (!snapshot || !currentMap) return "No active match";

  const reason = constructionRejection(
    currentMap.map,
    snapshot.owners,
    placementIndex!,
    snapshot.players[0],
    type,
    tile,
  );

  if (reason) return reason;

  if (snapshot.expansion) {
    const node = snapshot.expansion.deposits.find((d) => d.tile === tile);

    if (type === "mine" && (!node || ["horses", "oil"].includes(node.resource)))
      return "Choose a mineral deposit";

    if (["oil-well", "oil-rig"].includes(type) && node?.resource !== "oil")
      return "Choose an oil deposit";

    if (
      snapshot.expansion.barriers.some(
        (b) => b.health > 0 && b.tiles.includes(tile),
      )
    )
      return "Intact wall occupies this site";
  }

  return null;
}

function placeBuilding(type: BuildingType, age?: Age): void {
  if (!snapshot || snapshot.winner !== null || snapshot.players[0].eliminated)
    return;

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
  placementAge = choice?.age;

  document
    .getElementById(`build-${type}`)
    ?.setAttribute("aria-pressed", "true");

  renderer.buildSites = Array.from(snapshot.owners.keys()).filter(
    (tile) => !placementRejection(type, tile),
  );

  element("placement-hint").hidden = false;

  element("placement-hint").textContent =
    `Place ${BUILDING_RULES[type].name} · ${choice?.cost?.gold ?? BUILDING_RULES[type].cost} gold · Escape cancels`;

  canvas.style.cursor = "crosshair";
}

for (const { kind } of CONSTRUCTION)
  element(`build-${kind}`).addEventListener("click", () => placeBuilding(kind));

for (const kind of ["transport", "warship"] as ShipType[])
  element(kind).addEventListener("click", () => recruitShip(kind));

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

      playerId: 1,

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

element("home").addEventListener("click", () => renderer.home());

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

canvas.addEventListener("pointerdown", (event) => {
  if (!snapshot || snapshot.winner !== null || event.button > 2) return;

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

  if (placementType && tile !== null && snapshot && currentMap) {
    const rejection = placementRejection(placementType, tile);

    renderer.placement = {
      tile,

      type: placementType,

      friendly: rejection === null,
    };

    element("placement-hint").textContent =
      rejection ??
      `Place ${BUILDING_RULES[placementType].name} · ${BUILDING_RULES[placementType].cost} gold`;
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

canvas.addEventListener("pointerup", (event) => {
  if (!drag || !snapshot) return;

  const p = localPosition(event),
    start = drag;

  drag = undefined;

  renderer.selectionBox = undefined;

  if (
    start.button === 2 &&
    (placementType || landingShip !== undefined || targetedAction)
  ) {
    cancelPlacement();

    return;
  }

  if (start.button === 0 && targetedAction) {
    const world = renderer.world(p.x, p.y);
    const action = targetedAction;

    cancelPlacement();
    action(Math.round(world.x * FIXED), Math.round(world.y * FIXED));
    return;
  }

  if (
    start.button === 0 &&
    (placementType || landingShip !== undefined || targetedAction)
  ) {
    const tile = renderer.tileAt(p.x, p.y);

    if (tile !== null) {
      if (placementType)
        command({
          type: "build",

          playerId: 1,

          buildingType: placementType,

          age: placementAge,

          tile,
        });
      else command({ type: "unload", playerId: 1, shipId: landingShip!, tile });

      cancelPlacement();
    }

    return;
  }

  if (start.button === 0) {
    if (!start.shift) {
      renderer.selected.clear();

      renderer.selectedShips.clear();
      renderer.selectedAircraft.clear();

      renderer.selectedBuilding = null;
    }

    if (start.moved) {
      for (const aircraft of snapshot.expansion?.aircraft ?? []) {
        if (aircraft.playerId !== 1) continue;
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
          renderer.selectedAircraft.add(aircraft.id);
      }
      for (const squad of snapshot.squads) {
        if (squad.playerId !== 1 || squad.embarkedOn !== null) continue;

        const position = renderer.screen(squad.x / FIXED, squad.y / FIXED);

        if (
          position.x >= Math.min(p.x, start.x) &&
          position.x <= Math.max(p.x, start.x) &&
          position.y >= Math.min(p.y, start.y) &&
          position.y <= Math.max(p.y, start.y)
        )
          renderer.selected.add(squad.id);
      }

      for (const ship of snapshot.ships) {
        if (ship.playerId !== 1) continue;

        const position = renderer.screen(ship.x / FIXED, ship.y / FIXED);

        if (
          position.x >= Math.min(p.x, start.x) &&
          position.x <= Math.max(p.x, start.x) &&
          position.y >= Math.min(p.y, start.y) &&
          position.y <= Math.max(p.y, start.y)
        )
          renderer.selectedShips.add(ship.id);
      }
    } else {
      const aircraft = renderer.aircraftAt(p.x, p.y);
      const building = renderer.buildingAt(p.x, p.y);

      const ship = renderer.shipAt(p.x, p.y);

      const squad = renderer.squadAt(p.x, p.y, 1);

      if (aircraft !== null) {
        if (start.shift && renderer.selectedAircraft.has(aircraft))
          renderer.selectedAircraft.delete(aircraft);
        else renderer.selectedAircraft.add(aircraft);
      } else if (
        ship !== null &&
        currentMap?.map.isWater(renderer.tileAt(p.x, p.y) ?? -1) &&
        snapshot.ships.some((s) => s.id === ship && s.playerId === 1)
      ) {
        if (start.shift && renderer.selectedShips.has(ship))
          renderer.selectedShips.delete(ship);
        else renderer.selectedShips.add(ship);
      } else if (squad) {
        if (start.shift && renderer.selected.has(squad.id))
          renderer.selected.delete(squad.id);
        else renderer.selected.add(squad.id);
      } else if (building !== null) renderer.selectedBuilding = building;
      else if (
        ship !== null &&
        snapshot.ships.some((s) => s.id === ship && s.playerId === 1)
      ) {
        if (start.shift && renderer.selectedShips.has(ship))
          renderer.selectedShips.delete(ship);
        else renderer.selectedShips.add(ship);
      }
    }

    if (
      !start.moved &&
      !renderer.selected.size &&
      !renderer.selectedShips.size &&
      !renderer.selectedAircraft.size &&
      (renderer.selectedBuilding === null ||
        snapshot.buildings.find((b) => b.id === renderer.selectedBuilding)
          ?.playerId !== 1)
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

      if (owner && owner !== 1) empire.inspectPlayer(owner);
    }

    updateHud();
  } else if (start.button === 2) {
    if (renderer.selectedAircraft.size) {
      const ids =
        snapshot.expansion?.aircraft
          .filter(
            (a) =>
              renderer.selectedAircraft.has(a.id) &&
              a.playerId === 1 &&
              a.state === "ready",
          )
          .map((a) => a.id) ?? [];
      if (ids.length) {
        const position = renderer.world(p.x, p.y);
        command({
          type: "sortie",
          playerId: 1,
          aircraftIds: ids,
          x: Math.round(position.x * FIXED),
          y: Math.round(position.y * FIXED),
        });
      } else notify("Select ready aircraft for a sortie");
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
      (s) => s.id === clickedShipId && s.playerId !== 1,
    );
    if (
      renderer.selectedShips.size &&
      (enemyShip || (coastal && coastal.playerId !== 1))
    ) {
      command({
        type: "naval-attack",
        playerId: 1,
        shipIds: [...renderer.selectedShips].filter(
          (id) => snapshot!.ships.find((s) => s.id === id)?.kind === "warship",
        ),
        targetId: (enemyShip ?? coastal)!.id,
      });
      return;
    }
    const transport = snapshot.ships.find(
      (s) =>
        s.id === clickedShipId && s.playerId === 1 && s.kind === "transport",
    );

    if (transport && renderer.selected.size) {
      command({
        type: "board",

        playerId: 1,

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

    if (
      renderer.selectedShips.size &&
      tile !== null &&
      currentMap?.map.isWater(tile)
    ) {
      command({
        type: "sail",

        playerId: 1,

        shipIds: [...renderer.selectedShips],

        tile,

        append: start.shift,
      });

      return;
    }

    if (!renderer.selected.size) {
      notify(
        "Ships sail on water. Choose a transport’s landing coast to unload.",
      );

      return;
    }

    const enemy = target && target.playerId !== 1;

    const position = renderer.world(p.x, p.y);

    const double =
      rightClick &&
      performance.now() - rightClick.time < 350 &&
      (rightClick.x - p.x) ** 2 + (rightClick.y - p.y) ** 2 < 100;

    rightClick = { time: performance.now(), ...p };

    const chargers = snapshot.squads.filter(
      (s) =>
        renderer.selected.has(s.id) && UNIT.get(s.definitionId ?? "")?.charge,
    );

    if (double && !start.shift && chargers.length) {
      command({
        type: "charge",
        playerId: 1,
        squadIds: chargers.map((s) => s.id),
        x: Math.round(position.x * FIXED),
        y: Math.round(position.y * FIXED),
        targetId: enemy ? target.id : undefined,
      });
      return;
    }

    const building = snapshot.buildings.find(
      (b) => b.id === renderer.buildingAt(p.x, p.y),
    );

    const barrier = snapshot.expansion?.barriers.find(
      (b) => tile !== null && b.health > 0 && b.tiles.includes(tile),
    );

    if (
      !enemy &&
      ((building && building.playerId !== 1) ||
        (barrier && barrier.playerId !== 1))
    ) {
      command({
        type: "attack-structure",
        playerId: 1,
        squadIds: [...renderer.selected],
        buildingId: building?.id,
        barrierId: barrier?.id,
      });
      return;
    }

    if (!enemy && tile === null) return;

    command({
      type: "order",

      playerId: 1,

      squadIds: [...renderer.selected],

      append: start.shift,

      order: enemy
        ? { type: "attack", targetId: target.id }
        : { type: "move", tile: tile! },
    });

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
    (s) => s.id === renderer.shipAt(point.x, point.y) && s.playerId === 1,
  );

  const squad = renderer.squadAt(point.x, point.y, 1);

  if (!ship && !squad) return;

  if (!event.shiftKey) {
    renderer.selected.clear();

    renderer.selectedShips.clear();
    renderer.selectedAircraft.clear();
  }

  renderer.selectedBuilding = null;

  if (
    ship &&
    (currentMap?.map.isWater(renderer.tileAt(point.x, point.y) ?? -1) || !squad)
  )
    for (const id of renderer.visibleShips(ship.kind))
      renderer.selectedShips.add(id);
  else if (squad)
    for (const id of renderer.visibleSquads(squad.kind))
      renderer.selected.add(id);

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

document.addEventListener("keydown", (event) => {
  if (
    (event.target as HTMLElement).matches("input,select,textarea") ||
    (event.target as HTMLElement).isContentEditable
  )
    return;

  const key = event.key.toLowerCase();

  if (event.key === "Escape" && empire.close()) {
    event.preventDefault();
    return;
  }

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

  if (
    empire.open ||
    (event.target as HTMLElement).closest(".empire-panel,.hud-popover")
  )
    return;

  const action = hotkeyAction(event);

  if (!action) return;

  event.preventDefault();

  switch (action.type) {
    case "recruit":
      recruit(action.kind);

      break;

    case "recruit-ship":
      recruitShip(action.kind);

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

    case "pause":
      togglePause();

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

function frame(now: number): void {
  renderer.draw(now, speed, paused);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

void start();
