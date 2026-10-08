import { BuildingGunPresentation } from "./BuildingGunPresentation";
import { buildingFootprint, buildingGroundBounds } from "../BuildingFootprint";
import type { GameMap } from "../../core/game/GameMap";
import { PlacementPreview } from "./PlacementPreview";
import { PlacementCoverage } from "./PlacementCoverage";
import { portShoreRotation } from "./PortOrientation";
import { BuildingFacts } from "./BuildingFacts";
import { UNIT, VESSEL } from "../content/Units";
import { promotionLevel } from "../domain/Combat";
import type { Age } from "../domain/Definitions";
import { unitEffects } from "../domain/ResearchEffects";
import type { EnvironmentProfile } from "../Environment";
import type { MapGeography } from "../Geography";
import type { ArcherVolley, BuildingType, ShipType, Snapshot, SquadType } from "../Protocol";
import { CAPTURE_RADIUS, FIXED } from "../Protocol";
import { BUILDING_RULES, SHIP_RULES, SQUAD_RULES } from "../Rules";
import { buildingTicks } from "../content/Buildings";
import { ownerUiAge } from "./AgeUiTheme";
import { AircraftLayer } from "./AircraftLayer";
import { AircraftPresentation } from "./AircraftPresentation";
import { AircraftView } from "./AircraftView";
import { buildingArtworkId, buildingPreviewArtworkId } from "./ArtworkCatalog";
import { BoatPresentation } from "./BoatPresentation";
import { BuildingArtwork } from "./BuildingArtwork";
import { BuildingMarkers } from "./BuildingMarkers";
import { BuildingSpriteLayout, fittedBuildingSprite } from "./BuildingSpriteLayout";
import { BuildingSelectionViewModel } from "./BuildingSelectionViewModel";
import { CampLossPresentation } from "./CampLossPresentation";
import { CombatEffectsView } from "./CombatEffectsView";
import {
  combatTargets,
  impactSize,
  shellVisual,
  squadArtworkPose,
  volleyVisual,
  type TargetMarker,
} from "./CombatEffectsViewModel";
import { EraArtwork } from "./EraArtwork";
import type { LineDeployment } from "../FormationLine";
import { COLORS, RGB, BUILDING_PAD_COLORS, assignFactionColors, factionColorRevision } from "./FactionColors";
import { FormationArtwork, squadFormationType } from "./FormationArtwork";
import {
  bakeGroundColors,
  rebakeGroundColors,
  type BakeSource,
} from "./GroundBake";
import { GroundLayer, type GroundStyle } from "./GroundLayer";
import { ImpactPresentation } from "./ImpactPresentation";
import { NuclearWastelandView } from "./NuclearWastelandView";
import {
  buildingSymbol,
  shipSpriteSize,
  shipSymbol,
  shipViewRadius,
  squadSymbol,
  squadViewRadius,
  traderSymbol,
} from "./MapSymbols";
import { PaintedTerrain } from "./PaintedTerrain";
import { PromotionArtwork } from "./PromotionArtwork";
import { ResourceViewModel } from "./ResourceViewModel";
import { RoadLayer } from "./RoadLayer";
import { RenderSamples } from "./RenderSamples";
import { clampMapScale, mapFitScale, mapStartingScale } from "./MapCameraScale";
import { chargeReadiness } from "./ChargeReadiness";
import type { SpawnSelectionViewModel } from "./SpawnSelectionViewModel";
import { StrategicSprites } from "./StrategicSprites";
import { bakeTerrainFields } from "./TerrainFields";
import { TerritoryLabelViewModel } from "./TerritoryLabelViewModel";
import { TerritoryLayer } from "./TerritoryLayer";
import { TraderPresentation, traderActivity } from "./TraderPresentation";
import { TradePayoutPresentation } from "./TradePayoutPresentation";
import { PresentationClock, squadSpriteSize } from "./UnitAnimation";
import { UnitArtwork } from "./UnitArtwork";
import { UnitPresentation, visibleInViewport } from "./UnitPresentation";
import { WallArtwork, type WallFrame } from "./WallArtwork";
import { WallPresentation } from "./WallPresentation";
export { COLORS } from "./FactionColors";

const SELECTED_UNIT_COLOR = "#c4ff36";

export class Renderer {
  /** Optional client artwork pass; returning true replaces only this squad's artwork. */
  squadArtworkOverride?: (ctx: CanvasRenderingContext2D, squad: Snapshot["squads"][number], position: { x: number; y: number }, angle: number, tileSize: number, visualTick: number, worldPosition: { x: number; y: number }) => boolean;
  /** True: individual art, false: formation icon, undefined: normal unit artwork. */
  squadArtworkDetailed?: (squad: Snapshot["squads"][number], tileSize: number) => boolean | undefined;
  squadArtworkHitTest?: (squad: Snapshot["squads"][number], world: {x:number;y:number}, tileSize: number) => number | undefined;
  squadArtworkIntersectsBox?: (squad: Snapshot["squads"][number], box: {x1:number;y1:number;x2:number;y2:number}) => boolean;
  squadArtworkViewRadius?: (squad: Snapshot["squads"][number], tileSize: number) => number;
  /** When set, collect all squad overrides before flushing globally sorted sprites. */
  squadArtworkFlush?: (ctx: CanvasRenderingContext2D) => void;
  private readonly deferredSquadArtwork = new Set<number>();
  /** Optional individual-soldier volley pass; true suppresses the legacy emitters. */
  squadVolleyArtwork?: (ctx: CanvasRenderingContext2D, volley: ArcherVolley, tick: number, tileSize: number,
    project: (x: number, y: number) => { x: number; y: number }, width: number, height: number) => boolean;
  /** Optional world-space remains pass, below every living squad. */
  squadRemainsArtwork?: (ctx: CanvasRenderingContext2D, tileSize: number,
    project: (x: number, y: number) => { x: number; y: number }, width: number, height: number) => void;
  private get playerId(): number {
    return this.snapshot?.localPlayerId ?? 1;
  }

  private readonly eraArtwork = new EraArtwork();
  private roads?: RoadLayer;
  private readonly wallArtwork = new WallArtwork();
  private readonly walls = new WallPresentation();
  private readonly trenches = new WallPresentation("trench");
  private readonly promotionArtwork = new PromotionArtwork();
  private readonly impacts = new ImpactPresentation();
  private wastelandView?: NuclearWastelandView;
  private readonly combatEffects = new CombatEffectsView();
  private combatMarkers: TargetMarker[] = [];
  private legacyArtwork?: UnitArtwork;
  private get artwork(): UnitArtwork {
    return (this.legacyArtwork ??= new UnitArtwork());
  }
  private readonly buildingArtwork = new BuildingArtwork();
  private readonly buildingGuns = new BuildingGunPresentation();
  private readonly aircraftArtworkIds = new Map<number, string>();
  private readonly buildingMarkers = new BuildingMarkers();
  private readonly formationArtwork = new FormationArtwork();
  private readonly presentation = new UnitPresentation();
  private readonly boats = new BoatPresentation();
  private readonly traderPresentation = new TraderPresentation();
  private readonly tradePayouts = new TradePayoutPresentation();
  private readonly aircraftPresentation = new AircraftPresentation();
  private readonly aircraftView = new AircraftView();
  private readonly aircraftLayer: AircraftLayer;
  private aircraftBlend = 1;
  private readonly animationClock = new PresentationClock();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly strategic: StrategicSprites;
  private readonly groundLayer: GroundLayer;
  private groundStyle: GroundStyle = "animated";
  private groundActive?: boolean;
  private groundSource?: BakeSource;
  private groundColors?: Uint8Array;
  private ground?: PaintedTerrain;
  private territory?: TerritoryLayer;
  private colorRevision = -1;
  private territoryLabels?: TerritoryLabelViewModel;
  private readonly territoryText = new Map<string, { letters: string[]; advances: number[]; width: number }>();
  private cacheTerritoryText(snapshot: Snapshot): void {
    const names = new Set(snapshot.players.map(player => player.name));
    for (const name of this.territoryText.keys()) if (!names.has(name)) this.territoryText.delete(name);
    this.ctx.save();
    this.ctx.font = "600 64px Georgia, Cambria, serif";
    for (const name of names) if (!this.territoryText.has(name)) {
      const letters = Array.from(name.toLocaleUpperCase());
      const advances = letters.map(letter => this.ctx.measureText(letter).width / 64);
      this.territoryText.set(name, { letters, advances, width: advances.reduce((sum, value) => sum + value, 0) });
    }
    this.ctx.restore();
  }
  private buildingStacks: {
    building: Snapshot["buildings"][number];
    count: number;
    remainingTicks: number;
    buildTicks: number;
    health: number;
    maxHealth: number;
  }[] = [];
  private snapshot?: Snapshot;
  private resources?: ResourceViewModel;
  private occupiedBuildingTiles = new Set<number>();
  private readonly buildingFacts = new BuildingFacts();
  private readonly squadSamples = new RenderSamples<Snapshot["squads"][number]>();
  private receivedAt = 0;
  // Smoothed real time between snapshots. Interpolating over this, not over the
  // game-time gap, keeps movement continuous at 2x/4x and when commit cycles in
  // online matches arrive slower or more irregularly than 200 ms.
  /** Game speed of the latest frame, timing glides in single-player. */
  private drawSpeed = 1;
  private nextFrame = 0;
  private map?: GameMap;
  private scale = 1;
  get pixelsPerCell(): number { return this.scale; }
  private fitScale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private width = 0;
  private height = 0;
  private hudBottomInset = 0;
  private resizeObserver: ResizeObserver;
  selected = new Set<number>();
  selectedShips = new Set<number>();
  selectedAircraft = new Set<number>();
  armyAt(x: number, y: number): number | null {
    for (const army of this.snapshot?.expansion?.armies ?? []) {
      if (army.playerId !== this.playerId) continue;
      const p = this.screen(army.x / FIXED, army.y / FIXED);
      if (Math.abs(x - p.x) <= 14 && Math.abs(y - (p.y - 32)) <= 13)
        return army.id;
    }
    return null;
  }
  aircraftAt(x: number, y: number): number | null {
    let best: number | null = null,
      distance = Infinity;
    for (const a of this.snapshot?.expansion?.aircraft ?? []) {
      if (a.playerId !== this.playerId) continue;
      const pose = this.aircraftPresentation.pose(a.id, this.aircraftBlend);
      if (!pose) continue;
      const p = this.screen(pose.x / FIXED, pose.y / FIXED),
        d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d <= pose.radius ** 2 && d < distance) {
        distance = d;
        best = a.id;
      }
    }
    return best;
  }
  readonly buildingSelection = new BuildingSelectionViewModel();
  spawn?: SpawnSelectionViewModel;
  get selectedBuildings(): Set<number> {
    return this.buildingSelection.ids;
  }
  get selectedBuilding(): number | null {
    return this.buildingSelection.focused;
  }
  set selectedBuilding(id: number | null) {
    this.buildingSelection.clear();
    if (id !== null) this.selectBuilding(id);
  }
  selectBuilding(id: number, additive = false): void {
    const building = this.snapshot?.buildings.find((b) => b.id === id);
    if (!building) return;
    if (building.playerId !== this.playerId) {
      this.buildingSelection.clear();
      this.buildingSelection.focused = id;
      return;
    }
    this.buildingSelection.select(
      this.snapshot!.buildings.filter(
        (b) =>
          b.playerId === this.playerId &&
          b.tile === building.tile &&
          b.type === building.type,
      ),
      additive,
      additive,
    );
  }
  inspectedSquadId: number | null = null;
  selectedDeposit: number | null = null;
  placement?: { tile: number; type: BuildingType; friendly: boolean };
  buildSites: number[] = [];
  private readonly placementCoverage = new PlacementCoverage();
  buildPreview?:PlacementPreview;
  squadDeploymentPreview?: (squad: Snapshot["squads"][number], root: {x:number;y:number}, facing:number) => readonly {x:number;y:number;radius:number}[] | undefined;
  deploymentPreview?: {line:LineDeployment; color:string; valid:boolean};
  selectionBox?: { x1: number; y1: number; x2: number; y2: number };
  marker?: { x: number; y: number; until: number; attack: boolean };

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly campLoss = new CampLossPresentation(),
  ) {
    this.ctx = canvas.getContext("2d")!;
    document.fonts?.addEventListener("loadingdone", () => {
      this.territoryText.clear();
      if (this.snapshot) this.cacheTerritoryText(this.snapshot);
    });
    this.groundLayer = new GroundLayer(canvas);
    this.strategic = new StrategicSprites(canvas);
    this.aircraftLayer = new AircraftLayer(canvas);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement!);
    this.resize();
  }

  setMap(
    map: GameMap,
    geography?: MapGeography,
    environment?: EnvironmentProfile,
  ): void {
    this.map = map;
    this.buildPreview=new PlacementPreview(map);
    this.roads = new RoadLayer(map);
    this.ground = new PaintedTerrain(map, geography, environment);
    this.groundActive = undefined;
    this.groundSource = undefined;
    this.groundColors = undefined;
    if (this.groundLayer.supported) {
      const source = this.ground.groundColorSource(),
        fields = this.ground.groundFieldInputs(source),
        colors = bakeGroundColors(source);
      this.groundSource = source;
      this.groundColors = colors;
      this.groundLayer.setMap({
        width: source.width,
        height: source.height,
        colors,
        fields: bakeTerrainFields(fields),
        hasDepth: !!fields.elevation,
      });
    }
    this.territory = new TerritoryLayer(map.width(), map.height(), RGB);
    this.territoryLabels = new TerritoryLabelViewModel(
      map.width(),
      map.height(),
    );
    this.buildingStacks = [];
    this.buildingFacts.reset();
    this.occupiedBuildingTiles.clear();
    this.walls.reset();
    this.trenches.reset();
    this.snapshot = undefined;
    this.spawn = undefined;
    this.resources = undefined;
    this.receivedAt = 0;
    this.squadSamples.clear();
    this.presentation.reset();
    this.boats.reset();
    this.impacts.reset();
    this.buildingGuns.reset();
    this.aircraftArtworkIds.clear();
    this.combatMarkers = [];
    this.traderPresentation.reset();
    this.tradePayouts.reset();
    this.aircraftPresentation.reset();
    this.aircraftBlend = 1;
    this.aircraftLayer.clear();
    this.campLoss.reset();
    this.animationClock.reset();
    this.selected.clear();
    this.selectedShips.clear();
    this.selectedAircraft.clear();
    this.selectedBuilding = null;
    this.inspectedSquadId = null;
    this.selectedDeposit = null;
    this.placement = undefined;
    this.buildSites = [];
    this.strategic.begin();
    this.strategic.flush();
    this.home();
  }

  update(snapshot: Snapshot): void {
    if (!this.map) return;
    assignFactionColors(snapshot.players);
    if (this.colorRevision !== factionColorRevision) {
      this.territory!.setColors(RGB);
      this.colorRevision = factionColorRevision;
    }
    this.buildPreview?.update(snapshot);
    // Each glide covers the server time its tick span represents.
    const arrivedAt = performance.now(),
      spanTicks = this.snapshot ? Math.max(1, snapshot.tick - this.snapshot.tick) : 1;
    this.squadSamples.update(snapshot.squads, snapshot.tick, arrivedAt,
      Math.min(600, Math.max(50, (spanTicks * 50) / Math.max(1, this.drawSpeed))));
    this.combatMarkers = combatTargets(snapshot);
    this.snapshot = snapshot;
    this.buildingGuns.update(snapshot.buildings, snapshot.volleys, snapshot.tick);
    this.aircraftArtworkIds.clear();
    if (snapshot.expansion?.aircraft.length) {
      const bases = new Map(snapshot.buildings.filter(b => b.type === "airstrip").map(b => [b.id, b]));
      for (const plane of snapshot.expansion.aircraft) {
        const age = bases.get(plane.airfieldId)?.age ?? snapshot.expansion.progression[plane.playerId]?.age ?? "Modern";
        this.aircraftArtworkIds.set(plane.id, `${age.toLowerCase()}-${plane.definitionId}`);
      }
    }
    this.tradePayouts.update(snapshot.expansion?.tradeReceipts??[],this.playerId,performance.now());
    this.cacheTerritoryText(snapshot);
    this.buildingSelection.reconcile(snapshot.buildings, this.playerId);
    this.roads!.update(snapshot);
    this.walls.update(snapshot);
    this.trenches.update(snapshot);
    this.impacts.update(snapshot.expansion?.projectiles ?? [], snapshot.tick);
    this.resources = snapshot.expansion
      ? new ResourceViewModel(
          snapshot.expansion.progression[this.playerId].age,
          snapshot.expansion.inventories[this.playerId],
        )
      : undefined;
    for (const id of this.selectedAircraft)
      if (
        !snapshot.expansion?.aircraft.some(
          (a) => a.id === id && a.playerId === this.playerId,
        )
      )
        this.selectedAircraft.delete(id);
    this.presentation.update(snapshot);
    this.traderPresentation.update(snapshot);
    this.aircraftPresentation.update(snapshot);
    const arrived = performance.now();
    this.boats.update(snapshot, arrived);
    this.receivedAt = arrived;
    this.campLoss.update(snapshot, this.receivedAt);
    this.animationClock.update(snapshot.tick, this.receivedAt);
    for (const id of this.selected)
      if (
        this.squadSamples.get(id)?.current.playerId !== this.playerId ||
        this.squadSamples.get(id)?.current.embarkedOn !== null
      )
        this.selected.delete(id);
    for (const id of this.selectedShips)
      if (
        !snapshot.ships.some((s) => s.id === id && s.playerId === this.playerId)
      )
        this.selectedShips.delete(id);
    this.territory!.update(snapshot);
    this.territoryLabels!.update(snapshot);
    if (this.buildingFacts.changed(snapshot.buildings)) {
      this.occupiedBuildingTiles = new Set<number>();
      for (const b of snapshot.buildings) {
        const bounds = buildingGroundBounds(this.map!, b.tile, b.type);
        for (let y=bounds.top; y<Math.min(this.map!.height(),bounds.bottom); y++)
          for (let x=bounds.left; x<Math.min(this.map!.width(),bounds.right); x++) this.occupiedBuildingTiles.add(this.map!.ref(x,y));
      }
      const stacks = new Map<
        string,
        {
          building: Snapshot["buildings"][number];
          count: number;
          remainingTicks: number;
          buildTicks: number;
          health: number;
          maxHealth: number;
        }
      >();
      for (const building of snapshot.buildings) {
        const key = `${building.tile}:${building.type}`;
        let stack = stacks.get(key);
        if (!stack) {
          stack = {
            building,
            count: 0,
            remainingTicks: 0,
            buildTicks:
              building.buildTicks ?? BUILDING_RULES[building.type].ticks,
            health: 0,
            maxHealth: 0,
          };
          stacks.set(key, stack);
        }
        stack.count++;
        stack.health += building.health ?? 0;
        stack.maxHealth += building.maxHealth ?? 0;
        if (building.remainingTicks > 0 && stack.remainingTicks === 0) {
          stack.remainingTicks = building.remainingTicks;
          stack.buildTicks =
            building.buildTicks ??
            buildingTicks(building.type, stack.count - 1);
        }
      }
      this.buildingStacks = Array.from(stacks.values());
      const cleared = this.ground!.updateBuildings(
        this.buildingStacks.map((stack) => stack.building),
      );
      if (cleared.length && this.groundSource && this.groundColors)
        this.groundLayer.updateColors(
          rebakeGroundColors(this.groundSource, this.groundColors, cleared),
        );
    }
  }

  // Animated and still water use the WebGL2 ground; classic keeps the
  // Canvas2D painted ground (also the automatic fallback without WebGL2).
  setGroundStyle(style: GroundStyle): void {
    this.groundStyle = style;
    this.groundLayer.setAnimated(style === "animated");
    this.nextFrame = 0;
  }

  private resize(): void {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const initialized=!!this.map&&this.width>0&&this.height>0;
    if(initialized&&Math.abs(rect.width-this.width)<1&&Math.abs(rect.height-this.height)<1&&
      this.canvas.width===Math.round(rect.width*ratio)&&this.canvas.height===Math.round(rect.height*ratio))return;
    const centerX=(this.width/2-this.offsetX)/this.scale,centerY=(Math.max(100,this.height-this.hudBottomInset)/2-this.offsetY)/this.scale;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.nextFrame = 0;
    this.strategic.resize(this.width, this.height, ratio);
    this.groundLayer.resize(this.width, this.height, ratio);
    this.aircraftLayer.resize(this.width, this.height, ratio);
    if(!initialized)this.home();else {this.updateFitScale();this.scale=clampMapScale(this.scale,this.fitScale);this.offsetX=this.width/2-centerX*this.scale;this.offsetY=Math.max(100,this.height-this.hudBottomInset)/2-centerY*this.scale;}
  }

  setHudBottomInset(pixels: number): void {
    if (this.hudBottomInset === pixels) return;
    this.hudBottomInset = Math.max(0, pixels);
    if (this.map) this.updateFitScale();
  }

  private updateFitScale(): void {
    this.fitScale = mapFitScale(this.width, this.height, this.map!.width(), this.map!.height(), this.hudBottomInset);
  }

  home(): void {
    if (!this.map) return;
    const usableHeight = Math.max(100, this.height - this.hudBottomInset);
    this.updateFitScale();
    this.scale = this.fitScale;
    this.offsetX = (this.width - this.map.width() * this.scale) / 2;
    this.offsetY = (usableHeight - this.map.height() * this.scale) / 2;
  }

  focusStartingLocation(tile: number): void {
    if (!this.map) return;
    const usableHeight = Math.max(100, this.height - this.hudBottomInset);
    // Keep roughly 48 cells across the shorter usable axis: starting land and
    // squads stay readable at the same tactical scale on every world size.
    this.updateFitScale();
    this.scale = mapStartingScale(this.width, this.height, this.fitScale, this.hudBottomInset);
    this.offsetX = this.width / 2 - (this.map.x(tile) + 0.5) * this.scale;
    this.offsetY = usableHeight / 2 - (this.map.y(tile) + 0.5) * this.scale;
    this.nextFrame = 0;
  }

  zoom(amount: number, x: number, y: number): void {
    const tileX = (x - this.offsetX) / this.scale,
      tileY = (y - this.offsetY) / this.scale;
    this.scale = clampMapScale(this.scale * amount, this.fitScale);
    this.offsetX = x - tileX * this.scale;
    this.offsetY = y - tileY * this.scale;
  }

  pan(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
  }
  screen(x: number, y: number): { x: number; y: number } {
    return {
      x: x * this.scale + this.offsetX,
      y: y * this.scale + this.offsetY,
    };
  }
  world(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - this.offsetX) / this.scale,
      y: (y - this.offsetY) / this.scale,
    };
  }
  tileAt(x: number, y: number): number | null {
    if (!this.map) return null;
    const world = this.world(x, y),
      tx = Math.floor(world.x),
      ty = Math.floor(world.y);
    return this.map.isValidCoord(tx, ty) ? this.map.ref(tx, ty) : null;
  }
  squadAt(
    x: number,
    y: number,
    owner?: number,
  ): Snapshot["squads"][number] | undefined {
    let best: Snapshot["squads"][number] | undefined,
      distance = Infinity;
    let soldierBest: Snapshot["squads"][number] | undefined, soldierDistance = Infinity;
    const world = this.world(x, y);
    for (const squad of this.snapshot?.squads ?? []) {
      if (squad.embarkedOn !== null) continue;
      if (owner !== undefined && squad.playerId !== owner) continue;
      const hit = this.squadArtworkHitTest?.(squad, world, this.scale);
      if (hit !== undefined && (hit < soldierDistance || (hit === soldierDistance && squad.id > (soldierBest?.id ?? -1)))) {
        soldierBest = squad; soldierDistance = hit;
      }
      const p = this.screen(squad.x / FIXED, squad.y / FIXED);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      const { hitRadius } = squadSymbol(
        this.scale,
        squad.troops,
        this.squadArtworkDetailed?.(squad, this.scale) === false ? false : !!(squad.definitionId
          ? this.eraArtwork.get(squad.definitionId)
          : this.artwork.get(squad.kind)),
        squadFormationType(squad),
      );
      if (d <= hitRadius ** 2 && d < distance) {
        distance = d;
        best = squad;
      }
    }
    return soldierBest ?? best;
  }

  squadIntersectsBox(squad: Snapshot["squads"][number], x1: number, y1: number, x2: number, y2: number): boolean {
    const a = this.world(Math.min(x1,x2), Math.min(y1,y2));
    const b = this.world(Math.max(x1,x2), Math.max(y1,y2));
    if (this.squadArtworkIntersectsBox?.(squad, {x1:a.x,y1:a.y,x2:b.x,y2:b.y})) return true;
    const p = this.screen(squad.x / FIXED, squad.y / FIXED);
    return p.x >= Math.min(x1,x2) && p.x <= Math.max(x1,x2) && p.y >= Math.min(y1,y2) && p.y <= Math.max(y1,y2);
  }

  private spriteSize(troops: number): number {
    return squadSpriteSize(this.scale, troops);
  }

  visibleSquads(kind: SquadType): number[] {
    return (this.snapshot?.squads ?? [])
      .filter(
        (s) =>
          s.playerId === this.playerId &&
          s.embarkedOn === null &&
          s.kind === kind &&
          visibleInViewport(
            this.screen(s.x / FIXED, s.y / FIXED),
            squadSymbol(
              this.scale,
              s.troops,
              !!(s.definitionId
                ? this.eraArtwork.get(s.definitionId)
                : this.artwork.get(s.kind)),
              squadFormationType(s),
            ).viewRadius,
            this.width,
            this.height,
          ),
      )
      .map((s) => s.id);
  }

  visibleShips(kind: ShipType): number[] {
    return (this.snapshot?.ships ?? [])
      .filter(
        (s) =>
          s.playerId === this.playerId &&
          s.kind === kind &&
          visibleInViewport(
            this.shipScreenPosition(s),
            shipSymbol(
              this.scale,
              !!this.formationArtwork.get(s.kind, COLORS[s.playerId]),
              s.kind,
              Boolean(s.definitionId && this.scale >= 12),
            ).viewRadius,
            this.width,
            this.height,
          ),
      )
      .map((s) => s.id);
  }

  visibleBuildings(type: BuildingType): number[] {
    return (this.snapshot?.buildings ?? [])
      .filter(
        (b) =>
          b.playerId === this.playerId &&
          b.type === type &&
          (b.health ?? 1) > 0 &&
          visibleInViewport(
            this.buildingCenter(b.tile, b.type),
            this.buildingHalfSize(b),
            this.width,
            this.height,
          ),
      )
      .map((b) => b.id);
  }

  private buildingHalfSize(building: Snapshot["buildings"][number]): number {
    const shape = buildingFootprint(building.type);
    return Math.max(9, Math.hypot(shape.width, shape.height) * this.scale / 2);
  }

  private buildingCenter(tile: number, type: BuildingType) {
    const shape = buildingFootprint(type);
    return this.screen(this.map!.x(tile) + shape.width/2, this.map!.y(tile) + shape.height/2);
  }

  buildingAt(x: number, y: number): number | null {
    let nearest: number | null = null;
    let distance = Infinity;
    for (const { building } of this.buildingStacks) {
      const p = this.buildingCenter(building.tile, building.type);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      const shape = buildingFootprint(building.type);
      if (
        Math.abs(p.x - x) <= Math.max(9, shape.width * this.scale/2) &&
        Math.abs(p.y - y) <= Math.max(9, shape.height * this.scale/2) &&
        d < distance
      ) {
        nearest = building.id;
        distance = d;
      }
    }
    return nearest;
  }
  depositAt(x: number, y: number): number | null {
    let nearest: number | null = null,
      distance = Math.max(7, this.scale / 2) ** 2;
    for (const d of this.snapshot?.expansion?.deposits ?? []) {
      if (
        !this.resources?.depositVisible(d.resource) ||
        this.occupiedBuildingTiles.has(d.tile)
      )
        continue;
      const p = this.screen(
          this.map!.x(d.tile) + 0.5,
          this.map!.y(d.tile) + 0.5,
        ),
        delta = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (delta < distance) {
        distance = delta;
        nearest = d.id;
      }
    }
    return nearest;
  }

  private drawTerritoryNames(): void {
    const ctx = this.ctx;
    for (const label of this.territoryLabels!.labels) {
      const p = this.screen(label.x, label.y);
      const width = label.width * this.scale * 0.86;
      const height = label.height * this.scale;
      const radius = Math.hypot(width, height) / 2;
      if (!visibleInViewport(p, radius, this.width, this.height)) continue;
      const metrics = this.territoryText.get(label.name)!;
      const { letters, advances } = metrics;
      let font = Math.min(64, height * 0.42, width / (letters.length * 0.9));
      if (font < 7) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(label.angle);
      if (this.snapshot?.disconnectedPlayerIds?.includes(label.playerId)) {
        ctx.font = "bold 16px Georgia";
        ctx.textAlign = "center";
        ctx.fillStyle = "#f4e6b7";
        ctx.strokeStyle = "#20332b";
        ctx.lineWidth = 3;
        ctx.strokeText("zzz", 0, -Math.max(16, font));
        ctx.fillText("zzz", 0, -Math.max(16, font));
      }
      let inkWidth = metrics.width * font;
      if (inkWidth > width) {
        font *= width / inkWidth;
        inkWidth = metrics.width * font;
      }
      ctx.font = `600 ${font}px Georgia, Cambria, serif`;
      // Track letters across the available interior, without distorting glyphs.
      const spacing =
        letters.length > 1
          ? Math.min(font * 0.7, (width - inkWidth) / (letters.length - 1))
          : 0;
      let x = -(inkWidth + spacing * (letters.length - 1)) / 2;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(1.2, font * 0.05);
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = "#eee9ce";
      ctx.fillStyle = "#20332b";
      for (let i = 0; i < letters.length; i++) {
        ctx.strokeText(letters[i], x, 0);
        ctx.fillText(letters[i], x, 0);
        x += advances[i] * font + spacing;
      }
      ctx.restore();
    }
  }

  private readonly buildingSpriteLayout = new BuildingSpriteLayout();

  private drawBuilding(
    type: BuildingType,
    p: { x: number; y: number },
    color: string,
    selected: boolean,
    remainingTicks: number,
    ghost = false,
    definitionId?: string,
    elapsedTicks = 0,
    ownerAge?: Age,
    buildTicks = BUILDING_RULES[type].ticks,
    tile?: number,
    buildingId?: number,
  ): number {
    const ctx = this.ctx;
    const shot = buildingId === undefined ? undefined : this.buildingGuns.firing(buildingId, elapsedTicks);
    if (type === "gun-nest" && definitionId && this.scale >= 12) {
      for (const facing of ["n", "e", "s", "w"])
        this.eraArtwork.preload(`${definitionId}-firing-${facing}`, "firing");
    }
    const facing = shot?.facing ?? (buildingId === undefined ? undefined : this.buildingGuns.idleFacing(buildingId));
    const firing = facing && definitionId
      ? this.eraArtwork.get(`${definitionId}-firing-${facing}`, "firing", shot?.elapsed ?? 0)
      : undefined;
    const era = firing ?? (definitionId
      ? this.eraArtwork.get(definitionId, "idle", elapsedTicks)
      : undefined);
    const image = definitionId ? era?.source : this.buildingArtwork.get(type);
    const { artwork, size, footprintWidth, footprintHeight, inset, backdropAlpha } = buildingSymbol(
      this.scale,
      !!image,
      type,
      selected,
    );
    const marker = artwork
      ? undefined
      : this.buildingMarkers.get(
          type,
          color,
          size,
          window.devicePixelRatio,
          ownerAge,
        );
    ctx.save();
    ctx.strokeStyle = selected ? "#fff" : color;
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.setLineDash(remainingTicks || ghost ? [3, 2] : []);
    if (backdropAlpha && (!marker || selected || ghost)) {
      ctx.globalAlpha = backdropAlpha;
      ctx.fillStyle = artwork
        ? (BUILDING_PAD_COLORS.get(color) ?? color)
        : "#142c37";
      ctx.fillRect(p.x - footprintWidth / 2, p.y - footprintHeight / 2, footprintWidth, footprintHeight);
      ctx.globalAlpha = 1;
    }
    if (artwork && image) {
      const bounds = era?.groundBounds ? { x: era.x, y: era.y, width: era.width, height: era.height } : era?.visibleBounds ?? this.buildingSpriteLayout.visibleBounds(image, {
        x: era?.x ?? 0, y: era?.y ?? 0,
        width: era?.width ?? (image as HTMLImageElement).naturalWidth,
        height: era?.height ?? (image as HTMLImageElement).naturalHeight,
      });
      const anchor = era?.groundBounds;
      const ratio = anchor ? Math.min((footprintWidth - inset*2)/anchor.width, (footprintHeight - inset*2)/anchor.height) : 1;
      const destination = anchor ? {
        x: p.x - (anchor.x + anchor.width/2)*ratio,
        y: p.y - (anchor.y + anchor.height/2)*ratio,
        width: bounds.width*ratio, height: bounds.height*ratio,
      } : fittedBuildingSprite(bounds, p.x, p.y, footprintWidth - inset * 2, footprintHeight - inset * 2);
      ctx.globalAlpha = ghost ? 0.65 : remainingTicks ? 0.55 : 1;
      ctx.imageSmoothingEnabled = true;
      const rotation = type === "port" && tile !== undefined && this.map
        ? portShoreRotation(this.map, tile) : 0;
      if (rotation) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(rotation);
      }
      ctx.drawImage(
        image,
        bounds.x, bounds.y, bounds.width, bounds.height,
        destination.x - (rotation ? p.x : 0), destination.y - (rotation ? p.y : 0), destination.width, destination.height,
      );
      if (rotation) ctx.restore();
      ctx.globalAlpha = 1;
    } else if (marker) {
      ctx.globalAlpha = ghost ? 0.65 : remainingTicks ? 0.55 : 1;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        marker.source,
        marker.x,
        marker.y,
        marker.width,
        marker.height,
        p.x - size / 2,
        p.y - size / 2,
        size,
        size,
      );
      ctx.globalAlpha = 1;
    }
    if (selected || ghost || (!artwork && !marker))
      ctx.strokeRect(p.x - footprintWidth / 2, p.y - footprintHeight / 2, footprintWidth, footprintHeight);
    if (selected) {
      ctx.setLineDash([3, 3]);
      ctx.globalAlpha = 0.45;
      ctx.strokeRect(p.x-footprintWidth/2-this.scale, p.y-footprintHeight/2-this.scale,
        footprintWidth+2*this.scale, footprintHeight+2*this.scale);
      ctx.globalAlpha = 1;
    }
    if (remainingTicks) {
      const totalTicks = Math.max(1, buildTicks);
      const fraction = Math.max(
        0,
        Math.min(1, 1 - remainingTicks / totalTicks),
      );
      ctx.fillStyle = "#10212b";
      ctx.fillRect(p.x - size / 2, p.y + size / 2 + 2, size, 3);
      ctx.fillStyle = color;
      ctx.fillRect(p.x - size / 2, p.y + size / 2 + 2, size * fraction, 3);
    }
    ctx.restore();
    return size;
  }

  private drawWallFrame(frame: WallFrame, tile: number): void {
    const x = this.map!.x(tile),
      y = this.map!.y(tile),
      start = this.screen(x, y),
      end = this.screen(x + 1, y + 1),
      left = Math.round(start.x),
      top = Math.round(start.y);
    this.ctx.drawImage(
      frame.source,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      left,
      top,
      Math.max(1, Math.round(end.x) - left),
      Math.max(1, Math.round(end.y) - top),
    );
  }
  private drawTower(
    tile: number,
    age: Age,
    color: string,
    selected: boolean,
    remainingTicks: number,
    ghost = false,
    buildTicks = BUILDING_RULES.tower.ticks,
  ): number {
    const p = this.buildingCenter(tile, "tower"),
      size = this.scale * 2,
      ctx = this.ctx;
    ctx.save();
    if (selected || ghost) {
      ctx.fillStyle = BUILDING_PAD_COLORS.get(color) ?? color;
      ctx.globalAlpha = 0.2;
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      ctx.globalAlpha = 1;
    }
    const towerId = buildingArtworkId("tower", age);
    const frame = (towerId && this.eraArtwork.get(towerId)) || this.wallArtwork.tower(age);
    if (frame) {
      ctx.globalAlpha = ghost ? 0.65 : remainingTicks ? 0.55 : 1;
      ctx.imageSmoothingEnabled = true;
      const bounds = this.buildingSpriteLayout.visibleBounds(frame.source, frame);
      const destination = fittedBuildingSprite(bounds, p.x, p.y, size * 0.85);
      ctx.drawImage(frame.source, bounds.x, bounds.y, bounds.width, bounds.height,
        destination.x, destination.y, destination.width, destination.height);
      ctx.globalAlpha = 1;
    }
    if (selected || ghost) {
      ctx.strokeStyle = selected ? "#fff" : color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(ghost ? [3, 2] : []);
      ctx.strokeRect(p.x - size / 2, p.y - size / 2, size, size);
    }
    if (remainingTicks) {
      const totalTicks = Math.max(1, buildTicks);
      const fraction = Math.max(
        0,
        Math.min(1, 1 - remainingTicks / totalTicks),
      );
      ctx.fillStyle = "#10212b";
      ctx.fillRect(p.x - size / 2, p.y + size / 2 + 2, size, 3);
      ctx.fillStyle = color;
      ctx.fillRect(p.x - size / 2, p.y + size / 2 + 2, size * fraction, 3);
    }
    ctx.restore();
    return size;
  }

  shipScreenPosition(ship: Snapshot["ships"][number]): {
    x: number;
    y: number;
  } {
    const pose = this.boats.shipPose(ship.id) ?? ship;
    return this.screen(pose.x / FIXED, pose.y / FIXED);
  }

  shipAt(x: number, y: number): number | null {
    for (const ship of this.snapshot?.ships ?? []) {
      const pose = this.boats.shipPose(ship.id) ?? ship;
      const p = this.screen(pose.x / FIXED, pose.y / FIXED);
      const radius = shipSymbol(
        this.scale,
        !!this.formationArtwork.get(ship.kind, COLORS[ship.playerId]),
        ship.kind,
        Boolean(ship.definitionId && this.scale >= 12),
      ).hitRadius;
      if ((p.x - x) ** 2 + (p.y - y) ** 2 <= radius ** 2) return ship.id;
    }
    return null;
  }

  /** Charge readiness, drawn in blue beneath the health bar. */
  private chargeBar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fraction: number): void {
    ctx.fillStyle = "#10212bdd";
    ctx.fillRect(x - width / 2, y, width, height);
    ctx.fillStyle = fraction >= 1 ? "#4fb3ff" : "#2c6fae";
    ctx.fillRect(x - width / 2, y, width * fraction, height);
  }
  draw(now: number, speed: number, paused: boolean): boolean {
    this.drawSpeed = speed;
    this.tradePayouts.prune(now);
    if (now < this.nextFrame) return false;
    const frameInterval = 1000 / 60;
    this.nextFrame =
      now + frameInterval - ((now - this.nextFrame) % frameInterval);
    this.strategic.begin();
    this.aircraftLayer.clear();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    const gpuGround = this.groundStyle !== "classic" && this.groundLayer.ready;
    if (gpuGround !== this.groundActive) {
      this.groundActive = gpuGround;
      this.groundLayer.setVisible(gpuGround);
      this.ground?.setDecorationsOnly(gpuGround);
    }
    if (!gpuGround) {
      ctx.fillStyle = "#102331";
      ctx.fillRect(0, 0, this.width, this.height);
    }
    if (!this.map || (!this.snapshot && !this.spawn)) {
      if (gpuGround) this.groundLayer.clear();
      this.strategic.flush();
      return true;
    }
    const snapshot = this.snapshot!;
    if (gpuGround)
      this.groundLayer.draw(this.scale, this.offsetX, this.offsetY, now);
    this.ground!.draw(
      ctx,
      this.scale,
      this.offsetX,
      this.offsetY,
      this.width,
      this.height,
    );
    if (this.spawn) {
      const reservations = this.spawn.state.reservations;
      for (const { playerId, tile } of reservations) {
        const p = this.screen(this.map.x(tile) + 0.5, this.map.y(tile) + 0.5);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(9, 6 * this.scale), 0, Math.PI * 2);
        ctx.fillStyle = `${COLORS[playerId]}55`;
        ctx.fill();
        ctx.strokeStyle = COLORS[playerId];
        ctx.lineWidth = playerId === this.playerId ? 3 : 2;
        ctx.stroke();
        ctx.font = "bold 14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#15252e";
        ctx.lineWidth = 4;
        const label =
          playerId === this.playerId ? "Your spawn" : `Player ${playerId}`;
        ctx.strokeText(label, p.x, p.y - Math.max(15, 6 * this.scale));
        ctx.fillText(label, p.x, p.y - Math.max(15, 6 * this.scale));
      }
      const tile = this.spawn.hoverTile;
      if (tile !== null) {
        const p = this.screen(this.map.x(tile) + 0.5, this.map.y(tile) + 0.5);
        ctx.strokeStyle = this.spawn.rejection(tile) ? "#ff7777" : "#a7f2be";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(7, 6 * this.scale), 0, Math.PI * 2);
        ctx.stroke();
      }
      this.strategic.flush();
      return true;
    }
    this.roads!.draw(
      ctx,
      this.scale,
      this.offsetX,
      this.offsetY,
      this.width,
      this.height,
    );
    this.territory!.draw(
      ctx,
      this.scale,
      this.offsetX,
      this.offsetY,
      this.width,
      this.height,
    );
    (this.wastelandView??=new NuclearWastelandView()).draw(ctx,this.snapshot?.expansion?.fallout,this.map.width(),this.map.height(),this.scale,this.offsetX,this.offsetY);
    this.squadRemainsArtwork?.(ctx, this.scale, (x, y) => this.screen(x, y), this.width, this.height);
    this.territoryLabels!.advance(now);
    this.drawTerritoryNames();
    ctx.strokeStyle = "#b4c6cf26";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      this.offsetX - 1,
      this.offsetY - 1,
      this.map.width() * this.scale + 2,
      this.map.height() * this.scale + 2,
    );
    const viewport = {
      left: Math.floor(-this.offsetX / this.scale),
      top: Math.floor(-this.offsetY / this.scale),
      right: Math.ceil((this.width - this.offsetX) / this.scale),
      bottom: Math.ceil((this.height - this.offsetY) / this.scale),
    };
    const placementType = this.buildPreview?.activeType ?? this.placement?.type;
    if (placementType) {
      const shape = buildingFootprint(placementType);
      // Anchors just outside the viewport can still occupy visible cells.
      const sites = this.buildPreview?.sites({
        ...viewport,
        left: viewport.left - shape.width + 1,
        top: viewport.top - shape.height + 1,
      }, undefined, this.placement?.tile) ?? this.buildSites;
      const coverage = this.placementCoverage.runs(this.map, sites, placementType, viewport);
      ctx.fillStyle = "#9bffe066";
      ctx.strokeStyle = "#baffebbb";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const run of coverage) {
        const p = this.screen(run.left, run.y);
        ctx.fillRect(p.x, p.y, (run.right - run.left) * this.scale, this.scale);
        for (let x = run.left; x < run.right; x++)
          ctx.rect(p.x + (x - run.left) * this.scale + 0.5, p.y + 0.5, this.scale - 1, this.scale - 1);
      }
      ctx.stroke();
    }

    for (const player of snapshot.players) {
      if (player.eliminated) continue;
      const p = this.screen(
        this.map.x(player.base) + 0.5,
        this.map.y(player.base) + 0.5,
      );
      if (snapshot.disconnectedPlayerIds?.includes(player.id)) {
        ctx.save();
        ctx.font = "bold 14px Georgia";
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#10212b";
        ctx.fillStyle = "#f4e6b7";
        ctx.strokeText("zzz", p.x, p.y - 18);
        ctx.fillText("zzz", p.x, p.y - 18);
        ctx.restore();
      }
      const campOpacity = this.campLoss.opacity(player.id, now);
      if (campOpacity > 0) {
        ctx.save();
        ctx.globalAlpha *= campOpacity;
        ctx.font = "600 11px system-ui";
        ctx.textAlign = "center";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#10212bcc";
        ctx.fillStyle = "#eaf0ec";
        ctx.strokeText(`${player.name} · camp lost`, p.x, p.y - 16);
        ctx.fillText(`${player.name} · camp lost`, p.x, p.y - 16);
        ctx.restore();
      }
    }

    // Walls share a one-cell footprint with their towers, below buildings and
    // mobile units. Padded atlas rectangles preserve adjoining edge pixels.
    ctx.save();
    for (const wall of this.walls.tiles) {
      const p = this.screen(
        this.map.x(wall.tile) + 0.5,
        this.map.y(wall.tile) + 0.5,
      );
      if (!visibleInViewport(p, this.scale, this.width, this.height)) continue;
      const frame = this.wallArtwork.frame(wall.age, wall.mask, wall.gate);
      if (!frame) continue;
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = wall.constructing ? 0.55 : 1;
      this.drawWallFrame(frame, wall.tile);
    }
    ctx.restore();

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const trench of this.trenches.tiles) {
      const p = this.screen(this.map.x(trench.tile)+0.5, this.map.y(trench.tile)+0.5);
      if (!visibleInViewport(p,this.scale,this.width,this.height)) continue;
      ctx.globalAlpha = trench.constructing ? 0.55 : 1;
      for (const [width,color] of [[0.46,"#ad9270"],[0.28,"#302b25"]] as const) {
        ctx.strokeStyle = color; ctx.lineWidth = this.scale*width;
        ctx.beginPath();
        for (const [bit,dx,dy] of [[1,0,-0.5],[2,0.5,0],[4,0,0.5],[8,-0.5,0]]) {
          if (!(trench.mask & bit)) continue;
          const end = this.screen(this.map.x(trench.tile)+0.5+dx,this.map.y(trench.tile)+0.5+dy);
          ctx.moveTo(p.x,p.y); ctx.lineTo(end.x,end.y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();

    // Buildings, including placement ghosts, are a layer beneath mobile units.
    const selectedBuilding =
      this.selectedBuilding === null
        ? undefined
        : snapshot.buildings.find((b) => b.id === this.selectedBuilding);
    const visualTick = this.animationClock.sample(
      now,
      speed,
      paused || snapshot.winner !== null,
    );
    for (const {
      building,
      count,
      remainingTicks,
      buildTicks,
      health,
      maxHealth,
    } of this.buildingStacks) {
      const p = this.buildingCenter(building.tile, building.type);
      const rules = BUILDING_RULES[building.type];
      if (!visibleInViewport(p, Math.max(70, this.buildingHalfSize(building)), this.width, this.height)) continue;
      const selected =
        this.selectedBuildings.has(building.id) ||
        (selectedBuilding?.tile === building.tile &&
          selectedBuilding?.type === building.type);
      const size =
        building.type === "tower"
          ? this.drawTower(
              building.tile,
              building.age ?? "StoneAge",
              COLORS[building.playerId],
              selected,
              remainingTicks,
              false,
              buildTicks,
            )
          : this.drawBuilding(
              building.type,
              p,
              COLORS[building.playerId],
              selected,
              remainingTicks,
              false,
              building.age
                ? buildingArtworkId(building.type, building.age)
                : undefined,
              visualTick,
              ownerUiAge(snapshot, building.playerId),
              buildTicks,
              building.tile,
              building.id,
            );
      if (count > 1) {
        ctx.font = "bold 10px system-ui";
        ctx.textAlign = "center";
        const badge = `×${count}`,
          width = ctx.measureText(badge).width + 8;
        ctx.fillStyle = "#10212bea";
        ctx.fillRect(p.x + size / 3 - width / 2, p.y - size / 2 - 6, width, 14);
        ctx.fillStyle = COLORS[building.playerId];
        ctx.fillText(badge, p.x + size / 3, p.y - size / 2 + 5);
      }
      const payout=this.tradePayouts.amount(building.tile,now);
      if(payout!==undefined && (building.type==="city" || building.type==="port")) {
        ctx.save();ctx.font="bold 13px system-ui";ctx.textAlign="center";ctx.textBaseline="bottom";
        ctx.lineWidth=3;ctx.strokeStyle="#10212bd9";ctx.fillStyle="#ffe28a";
        const text=`+$${payout.toLocaleString("en-US")}`,y=p.y-size/2-18;
        ctx.strokeText(text,p.x,y);ctx.fillText(text,p.x,y);ctx.restore();
      }
      if (maxHealth > 0 && (selected || health < maxHealth)) {
        const width = Math.max(18, Math.min(48, size));
        const fraction = Math.max(0, Math.min(1, health / maxHealth));
        const y = p.y - size / 2 - 7;
        ctx.fillStyle = "#10212bea";
        ctx.fillRect(p.x - width / 2 - 1, y - 1, width + 2, 5);
        ctx.fillStyle =
          fraction > 0.5 ? "#8ed081" : fraction > 0.25 ? "#e2bd66" : "#e77966";
        ctx.fillRect(p.x - width / 2, y, width * fraction, 3);
      }
      if (selected || this.scale >= 14) {
        const label =
          rules.name +
          (count > 1 ? ` ×${count}` : "") +
          (remainingTicks ? ` · ${Math.ceil(remainingTicks / 20)}s` : "");
        ctx.font = "600 10px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#10212bd9";
        const labelY = p.y + size / 2 + 3 + (remainingTicks ? 6 : 0);
        ctx.strokeText(label, p.x, labelY);
        ctx.fillStyle = "#f0f6ef";
        ctx.fillText(label, p.x, labelY);
        ctx.textBaseline = "alphabetic";
      }
    }
    if (this.placement) {
      const p = this.buildingCenter(this.placement.tile, this.placement.type);
      if (this.placement.type === "tower")
        this.drawTower(
          this.placement.tile,
          ownerUiAge(snapshot, snapshot.localPlayerId ?? 1) ?? "StoneAge",
          this.placement.friendly ? "#a0ffe0" : "#ff8f84",
          false,
          0,
          true,
        );
      else
        this.drawBuilding(
          this.placement.type,
          p,
          this.placement.friendly ? "#a0ffe0" : "#ff8f84",
          false,
          0,
          true,
          buildingPreviewArtworkId(this.placement.type, ownerUiAge(snapshot, snapshot.localPlayerId ?? 1) ?? "StoneAge"),
          0,
          ownerUiAge(snapshot, snapshot.localPlayerId ?? 1),
          undefined,
          this.placement.tile,
        );
      const bounds = buildingGroundBounds(this.map, this.placement.tile, this.placement.type);
      const corner = this.screen(bounds.left, bounds.top);
      const width = (bounds.right - bounds.left) * this.scale;
      const height = (bounds.bottom - bounds.top) * this.scale;
      ctx.save();
      ctx.strokeStyle = this.placement.friendly ? "#a0ffe0" : "#ff8f84";
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(corner.x, corner.y, width, height);
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(corner.x - this.scale, corner.y - this.scale,
        width + 2 * this.scale, height + 2 * this.scale);
      ctx.restore();
    }

    // One presentation clock: aircraft and traders share the squads' segment.
    const blend = paused ? 1 : this.squadSamples.progress(now);
    this.aircraftBlend = blend;
    const boatTick = this.boats.frame(
      now,
      speed,
      paused || snapshot.winner !== null,
    );
    for (const target of this.combatMarkers) {
      const p = this.screen(target.x / FIXED, target.y / FIXED);
      if (visibleInViewport(p, 24, this.width, this.height))
        this.combatEffects.target(ctx, target, p, visualTick);
    }
    const renderedSquads = snapshot.squads
      .filter((squad) => squad.embarkedOn === null)
      .map((squad) => {
        const sample = this.squadSamples.get(squad.id)!;
        const p = this.screen(
          (sample.previousX + (squad.x - sample.previousX) * blend) / FIXED,
          (sample.previousY + (squad.y - sample.previousY) * blend) / FIXED,
        );
        const selected =
          this.selected.has(squad.id) || this.inspectedSquadId === squad.id;
        const viewRadius = Math.max(squadViewRadius(this.scale, squad.troops, selected),
          this.squadArtworkViewRadius?.(squad, this.scale) ?? 0);
        if (!visibleInViewport(p, viewRadius, this.width, this.height))
          return undefined;
        // Afloat, a squad is drawn as its faction's transport for this age.
        const formationType = squad.afloat ? "transport" : squadFormationType(squad);
        const pose = squadArtworkPose(squad, visualTick);
        const customArtwork = squad.afloat ? undefined : this.squadArtworkDetailed?.(squad, this.scale);
        const activeImage = customArtwork !== undefined ? undefined : squad.afloat
          ? this.eraArtwork.get(squad.afloat.vesselId, squad.moved ? "running" : "idle", visualTick)
          : squad.definitionId
          ? this.eraArtwork.get(squad.definitionId, pose.clip, pose.elapsed)
          : this.artwork.get(
              squad.kind,
              this.presentation.animation(squad.id, visualTick),
            );
        const symbol = squadSymbol(
          this.scale,
          squad.troops,
          !!activeImage || customArtwork === true,
          formationType,
        );
        if (
          !visibleInViewport(
            p,
            Math.max(
              symbol.viewRadius,
              viewRadius,
              selected ? CAPTURE_RADIUS * this.scale : 0,
            ),
            this.width,
            this.height,
          )
        )
          return undefined;
        const definition = squad.definitionId
          ? UNIT.get(squad.definitionId)
          : undefined;
        const image = symbol.artwork ? activeImage : undefined;
        return { squad, p, selected, symbol, image, definition, formationType, customArtwork };
      })
      .filter(
        (entry): entry is NonNullable<typeof entry> => entry !== undefined,
      );
    // All ground indicators precede every soldier, regardless of unit order.
    for (const { squad, p, selected, symbol, image, customArtwork } of renderedSquads) {
      if (
        !squad.afloat &&
        (squad.definitionId
          ? UNIT.get(squad.definitionId)!.attack.channel === "ranged"
          : squad.kind === "archer") &&
        (selected || (squad.fighting && symbol.artwork))
      ) {
        const unit = squad.definitionId
          ? unitEffects(
              UNIT.get(squad.definitionId)!,
              snapshot.expansion!.progression[squad.playerId].completed,
            )
          : undefined;
        const range =
          ((unit?.attack.range ?? SQUAD_RULES.archer.range) / FIXED) *
          this.scale;
        ctx.beginPath();
        ctx.arc(p.x, p.y, range, 0, Math.PI * 2);
        ctx.fillStyle = selected ? "#ffd47705" : "#ffd47702";
        ctx.fill();
        ctx.strokeStyle = selected ? "#ffdc884d" : "#ffdc881f";
        ctx.lineWidth = selected ? 1.5 : 1;
        ctx.setLineDash([7, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (selected) {
        if (!customArtwork) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, CAPTURE_RADIUS * this.scale, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff08";
        ctx.fill();
        ctx.strokeStyle = "#ffffff20";
        ctx.lineWidth = 1;
        ctx.stroke();
        }
        let from = p;
        const route = [squad.order, ...squad.queuedOrders];
        for (let index = 0; index < route.length; index++) {
          const order = route[index];
          let goal: { x: number; y: number } | undefined;
          if (order.type === "move")
            goal = this.screen(
              order.type === "move" && order.x !== undefined
                ? order.x / FIXED
                : this.map.x(order.tile) + 0.5,
              order.type === "move" && order.y !== undefined
                ? order.y / FIXED
                : this.map.y(order.tile) + 0.5,
            );
          if (order.type === "attack") {
            const target = this.squadSamples.get(order.targetId)?.current;
            if (target) goal = this.screen(target.x / FIXED, target.y / FIXED);
          }
          if (!goal) continue;
          ctx.setLineDash([4, 5]);
          ctx.strokeStyle =
            order.type === "attack"
              ? "#ef9c8e99"
              : "#dffbf66e";
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(goal.x, goal.y);
          ctx.stroke();
          ctx.setLineDash([]);
          if (route.length > 1) {
            ctx.beginPath();
            ctx.arc(goal.x, goal.y, 8, 0, Math.PI * 2);
            ctx.fillStyle = "#143a40";
            ctx.fill();
            ctx.font = "600 10px system-ui";
            ctx.textAlign = "center";
            ctx.fillStyle = "#e2fff9";
            ctx.fillText(String(index + 1), goal.x, goal.y + 3);
          }
          from = goal;
        }
      }
      if (image && !customArtwork) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, symbol.underlayRadius, 0, Math.PI * 2);
        ctx.fillStyle = COLORS[squad.playerId] + "33";
        ctx.fill();
        ctx.strokeStyle = selected
          ? SELECTED_UNIT_COLOR
          : COLORS[squad.playerId] + "88";
        ctx.lineWidth = selected ? 2 : 1.5;
        ctx.stroke();
      }
    }
    let deferredArtwork: Set<number> | undefined;
    if (this.squadArtworkFlush && this.squadArtworkOverride) {
      deferredArtwork = this.deferredSquadArtwork;
      deferredArtwork.clear();
      for (const { squad, p } of renderedSquads) {
        if (!squad.afloat && this.squadArtworkOverride(
          ctx, squad, p, this.presentation.angle(squad.id), this.scale, visualTick, this.world(p.x, p.y),
        )) deferredArtwork.add(squad.id);
      }
      this.squadArtworkFlush(ctx);
    }
    for (const {
      squad,
      p,
      selected,
      symbol,
      image,
      definition,
      formationType,
    } of renderedSquads) {
      if (
        definition &&
        !["frontline", "ranged", "mounted"].includes(definition.role)
      ) {
        ctx.font = "bold 9px system-ui";
        ctx.textAlign = "center";
        ctx.fillStyle = COLORS[squad.playerId];
        ctx.fillText(
          definition.role === "anti-air"
            ? "AA"
            : definition.role === "launcher"
              ? "M"
              : definition.role === "siege"
                ? "S"
                : "A",
          p.x,
          p.y - symbol.height / 2 - 4,
        );
      }
      if (selected && (squad.xp ?? 0) > 0) {
        const level = promotionLevel(squad.xp ?? 0),
          rank = this.promotionArtwork.get(level);
        if (rank) {
          const width =
              level > 5 ? 16 : Math.min(40, Math.max(24, symbol.width)),
            height = level > 5 ? 16 : width / 4;
          ctx.drawImage(
            rank,
            p.x - width / 2,
            p.y - symbol.height / 2 - height - 4,
            width,
            height,
          );
        }
      }
      const radius = 4 + (2 * squad.troops) / 1_000;
      const spriteSize = squad.afloat ? shipSpriteSize(this.scale, "transport") : this.spriteSize(squad.troops);
      // Afloat, the bar is the hull: every hit lands there until it sinks.
      const strength = squad.afloat ? squad.afloat.hull / squad.afloat.maxHull : squad.troops / 1_000;
      // Recovered charge cooldown (full = ready); undefined hides the bar for
      // units without a charge attack, and while afloat.
      const charge = squad.afloat ? undefined : chargeReadiness(squad, snapshot.tick);
      const individualArtwork = deferredArtwork ? deferredArtwork.has(squad.id) : !squad.afloat && this.squadArtworkOverride?.(
        ctx, squad, p, this.presentation.angle(squad.id), this.scale, visualTick, this.world(p.x, p.y),
      );
      if (image || individualArtwork) {
        if (!individualArtwork && image) {
          const lunge =
            !squad.afloat && definition &&
            (definition.attack.channel !== "melee" ||
              visualTick - (squad.lastAttackTick ?? 0) > 20)
              ? { x: 0, y: 0 }
              : this.presentation.meleeLunge(
                  squad.id,
                  visualTick,
                  this.scale,
                  spriteSize,
                );
          ctx.imageSmoothingEnabled = true;
          ctx.save();
          ctx.translate(p.x + lunge.x, p.y + lunge.y);
          ctx.rotate(
            (!squad.afloat && squadArtworkPose(squad, visualTick).clip === "attack"
              ? this.presentation.firingAngle(squad.id, visualTick)
              : this.presentation.angle(squad.id)) +
              (squad.afloat
                ? this.eraArtwork.facing(squad.afloat.vesselId)
                : squad.definitionId
                ? this.eraArtwork.facing(squad.definitionId)
                : 0),
          );
          const extent = spriteSize * image.extent;
          ctx.drawImage(
            image.source,
            image.x,
            image.y,
            image.width,
            image.height,
            -extent * image.pivotX,
            -extent * image.pivotY,
            extent,
            extent,
          );
          ctx.restore();
          ctx.imageSmoothingEnabled = false;
        }
        const barWidth = spriteSize * 0.72,
          barY = p.y + spriteSize / 2 + 3;
        ctx.fillStyle = "#10212bdd";
        ctx.fillRect(p.x - barWidth / 2, barY, barWidth, 3);
        ctx.fillStyle = COLORS[squad.playerId];
        ctx.fillRect(
          p.x - barWidth / 2,
          barY,
          barWidth * strength,
          3,
        );
        if (charge !== undefined) this.chargeBar(ctx, p.x, barY + 4, barWidth, 2, charge);
      } else {
        const formation = this.formationArtwork.get(
          formationType,
          this.strategic.available ? "#ffffff" : COLORS[squad.playerId],
        );
        const angle =
          (squadArtworkPose(squad, visualTick).clip === "attack"
            ? this.presentation.firingAngle(squad.id, visualTick)
            : this.presentation.angle(squad.id)) + (formation ? Math.PI : 0);
        const batched =
          formation &&
          this.strategic.add(
            formationType,
            formation,
            p.x,
            p.y,
            symbol.width,
            symbol.height,
            angle,
            RGB[squad.playerId],
            paused ? 0.67 : 1,
          );
        if (formation && !selected && !batched) {
          const marker = this.formationArtwork.heading(
            formationType,
            COLORS[squad.playerId],
            angle,
            symbol.width,
            window.devicePixelRatio || 1,
          )!;
          const extent = marker.extent;
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(
            marker.source,
            p.x - extent / 2,
            p.y - extent / 2,
            extent,
            extent,
          );
        } else if (!batched || selected) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(angle);
          if (formation) {
            const x = -symbol.width * formation.pivotX,
              y = -symbol.height * formation.pivotY;
            ctx.imageSmoothingEnabled = true;
            if (!batched)
              ctx.drawImage(
                formation.source,
                formation.x,
                formation.y,
                formation.width,
                formation.height,
                x,
                y,
                symbol.width,
                symbol.height,
              );
            if (selected) {
              ctx.strokeStyle = SELECTED_UNIT_COLOR;
              ctx.lineWidth = 2;
              ctx.strokeRect(x - 1, y - 1, symbol.width + 2, symbol.height + 2);
            }
          } else {
            ctx.fillStyle = COLORS[squad.playerId];
            ctx.fillRect(
              -symbol.width / 2,
              -symbol.height / 2,
              symbol.width,
              symbol.height,
            );
            ctx.strokeStyle = selected ? SELECTED_UNIT_COLOR : "#10212b";
            ctx.lineWidth = selected ? 2 : 1.5;
            ctx.strokeRect(
              -symbol.width / 2,
              -symbol.height / 2,
              symbol.width,
              symbol.height,
            );
          }
          ctx.restore();
        }
        ctx.imageSmoothingEnabled = false;
        if (!formation) {
          ctx.fillStyle = "#10212b";
          ctx.font = `bold ${Math.max(8, Math.min(12, symbol.height - 2))}px system-ui`;
          ctx.textAlign = "center";
          ctx.fillText(
            formationType === "siege" ? "S" : SQUAD_RULES[squad.kind].glyph,
            p.x,
            p.y + 3,
          );
        }
        // Distant formations retain a strength cue without thousands of text
        // labels competing for space at strategic zoom.
        const barWidth = symbol.width,
          barY = p.y + symbol.height / 2 + 3;
        if (strength < 1) {
          ctx.fillStyle = "#10212bdd";
          ctx.fillRect(p.x - barWidth / 2, barY, barWidth, 2);
          ctx.fillStyle = COLORS[squad.playerId];
          ctx.fillRect(
            p.x - barWidth / 2,
            barY,
            barWidth * strength,
            2,
          );
        }
        if (charge !== undefined)
          this.chargeBar(ctx, p.x, strength < 1 ? barY + 3 : barY, barWidth, 2, charge);
      }
      if (
        squad.fighting &&
        (definition
          ? definition.attack.channel === "melee"
          : squad.kind !== "archer")
      ) {
        const target = this.squadSamples.get(squad.combatTargetId ?? -1)?.current;
        if (target) {
          const contact = this.screen(
            (squad.x + target.x) / (2 * FIXED),
            (squad.y + target.y) / (2 * FIXED),
          );
          this.combatEffects.melee(
            ctx,
            contact,
            visualTick - (squad.lastAttackTick ?? -Infinity),
            squad.id,
          );
        }
      }
      if (image || selected || this.scale >= 14) {
        ctx.font = "600 10px system-ui";
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#10212bd9";
        // Leave room for the charge bar under the health bar.
        const labelY = p.y + (image ? spriteSize / 2 + 16 : radius + 12) + (charge !== undefined ? 4 : 0);
        ctx.strokeText(String(squad.troops), p.x, labelY);
        ctx.fillStyle = "#f2f5ed";
        ctx.fillText(String(squad.troops), p.x, labelY);
      }
    }
    for (const ship of snapshot.ships) {
      const pose = this.boats.shipPose(ship.id) ?? ship;
      const p = this.screen(pose.x / FIXED, pose.y / FIXED);
      if (!visibleInViewport(p, shipViewRadius(this.scale, ship.kind), this.width, this.height)) continue;
      const formation = this.formationArtwork.get(
        ship.kind,
        this.strategic.available ? "#ffffff" : COLORS[ship.playerId],
      );
      const symbol = shipSymbol(
        this.scale,
        !!formation,
        ship.kind,
        Boolean(ship.definitionId && this.scale >= 12),
      );
      if (
        !visibleInViewport(
          p,
          Math.max(60, symbol.viewRadius),
          this.width,
          this.height,
        )
      )
        continue;
      const vessel = VESSEL.get(ship.definitionId ?? "");
      const rules = vessel
        ? {
            ...SHIP_RULES[ship.kind],
            health: vessel.health,
            capacity: vessel.capacity,
          }
        : SHIP_RULES[ship.kind];
      const selected = this.selectedShips.has(ship.id);
      if (selected) {
        let from = p;
        for (const tile of [
          ...(ship.destination === null ? [] : [ship.destination]),
          ...ship.waypoints,
        ]) {
          const goal = this.screen(
            this.map.x(tile) + 0.5,
            this.map.y(tile) + 0.5,
          );
          ctx.strokeStyle = "#cbeaffaa";
          ctx.setLineDash([4, 5]);
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(goal.x, goal.y);
          ctx.stroke();
          ctx.setLineDash([]);
          from = goal;
        }
      }
      const shipArt =
        ship.definitionId && this.scale >= 12
          ? this.eraArtwork.get(
              ship.definitionId,
              ship.fighting
                ? "attack"
                : ("moving" in pose ? pose.moving : ship.destination !== null)
                  ? "running"
                  : "idle",
              ship.fighting ? visualTick : boatTick,
            )
          : undefined;
      let drawnShipSize = 0;
      if (shipArt) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(
          "angle" in pose ? pose.angle : this.presentation.shipAngle(ship.id),
        );
        const size = shipSpriteSize(this.scale, ship.kind) * shipArt.extent;
        drawnShipSize = size;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(
          shipArt.source,
          shipArt.x,
          shipArt.y,
          shipArt.width,
          shipArt.height,
          -size / 2,
          -size / 2,
          size,
          size,
        );
        if (selected) {
          ctx.strokeStyle = SELECTED_UNIT_COLOR;
          ctx.beginPath();
          ctx.arc(0, 0, size * 0.38, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      } else if (symbol.formation && formation) {
        const batched = this.strategic.add(
          ship.kind,
          formation,
          p.x,
          p.y,
          symbol.width,
          symbol.height,
          "angle" in pose ? pose.angle : this.presentation.shipAngle(ship.id),
          RGB[ship.playerId],
          paused ? 0.67 : 1,
        );
        if (!batched || selected) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(
            "angle" in pose ? pose.angle : this.presentation.shipAngle(ship.id),
          );
          ctx.imageSmoothingEnabled = true;
          const x = -symbol.width * formation.pivotX;
          const y = -symbol.height * formation.pivotY;
          if (!batched)
            ctx.drawImage(
              formation.source,
              formation.x,
              formation.y,
              formation.width,
              formation.height,
              x,
              y,
              symbol.width,
              symbol.height,
            );
          if (selected) {
            ctx.strokeStyle = SELECTED_UNIT_COLOR;
            ctx.lineWidth = 2;
            ctx.strokeRect(x - 1, y - 1, symbol.width + 2, symbol.height + 2);
          }
          ctx.restore();
        }
        ctx.imageSmoothingEnabled = false;
      } else {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 11);
        ctx.lineTo(p.x + 8, p.y - 3);
        ctx.lineTo(p.x + 6, p.y + 9);
        ctx.lineTo(p.x - 6, p.y + 9);
        ctx.lineTo(p.x - 8, p.y - 3);
        ctx.closePath();
        ctx.fillStyle = COLORS[ship.playerId];
        ctx.fill();
        ctx.strokeStyle = selected ? SELECTED_UNIT_COLOR : "#10212b";
        ctx.lineWidth = selected ? 2.5 : 1.5;
        ctx.stroke();
        ctx.fillStyle = "#10212b";
        ctx.font = "bold 9px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(rules.glyph, p.x, p.y + 3);
      }
      if (!selected && this.scale < 14) {
        if (ship.health < rules.health) {
          const width = symbol.width;
          ctx.fillStyle = "#10212bdd";
          ctx.fillRect(p.x - width / 2, p.y + symbol.height / 2 + 2, width, 2);
          ctx.fillStyle = COLORS[ship.playerId];
          ctx.fillRect(
            p.x - width / 2,
            p.y + symbol.height / 2 + 2,
            (width * ship.health) / rules.health,
            2,
          );
        }
        continue;
      }
      ctx.font = "600 9px system-ui";
      ctx.textAlign = "center";
      ctx.strokeStyle = "#10212b";
      const repairInfo =
        ship.repairState === "repairing"
          ? " · repairing"
          : ship.repairState === "returning-to-dock"
            ? " · docking"
            : ship.repairState === "waiting-for-dock"
              ? " · dock full"
              : "";
      const label = `${ship.health} HP${repairInfo}${ship.fighting ? " ⚔" : ""}`;
      const labelY = p.y + (drawnShipSize ? drawnShipSize * 0.42 + 10 : 22);
      ctx.strokeText(label, p.x, labelY);
      ctx.fillStyle = "#eaf3ef";
      ctx.fillText(label, p.x, labelY);
    }
    if (snapshot.expansion) {
      for (const deposit of snapshot.expansion.deposits)
        if (
          this.scale >= 3 &&
          this.resources?.depositVisible(deposit.resource) &&
          !this.occupiedBuildingTiles.has(deposit.tile)
        ) {
          const p = this.screen(
            this.map.x(deposit.tile) + 0.5,
            this.map.y(deposit.tile) + 0.5,
          );
          if (!visibleInViewport(p, 8, this.width, this.height)) continue;
          ctx.fillStyle = "#18272dbb";
          ctx.fillRect(p.x - 5, p.y - 5, 10, 10);
          ctx.fillStyle =
            deposit.resource === "horses"
              ? "#e5cca6"
              : deposit.resource === "oil"
                ? "#121319"
                : "#8da2af";
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fill();
          if (this.scale >= 10) {
            ctx.font = "9px system-ui";
            ctx.fillStyle = "#e4ebdf";
            ctx.textAlign = "center";
            ctx.fillText(deposit.resource, p.x, p.y - 8);
          }
        }
      for (const actor of snapshot.expansion.traders) {
        const activity = traderActivity(actor);
        if (activity === "hidden") continue;
        const boat = actor.naval ? this.boats.traderPose(actor.id) : undefined;
        const pose =
          boat ?? this.traderPresentation.pose(actor.id, visualTick, blend);
        if (!pose) continue;
        const p = this.screen(pose.x / FIXED, pose.y / FIXED);
        const projected = traderSymbol(this.scale, true, actor.naval);
        if (
          !visibleInViewport(p, projected.viewRadius, this.width, this.height)
        )
          continue;
        const art = projected.artwork
          ? (this.eraArtwork.get(
              actor.definitionId,
              "moving" in pose ? (pose.moving ? "running" : "idle") : pose.clip,
              "elapsedTicks" in pose ? pose.elapsedTicks : boatTick,
            ) ??
            this.eraArtwork.get(
              actor.definitionId,
              "idle",
              "elapsedTicks" in pose ? pose.elapsedTicks : boatTick,
            ))
          : undefined;
        const symbol = traderSymbol(this.scale, !!art, actor.naval);
        ctx.save();
        ctx.globalAlpha = 0.85;
        if (art) {
          const size = symbol.size * art.extent;
          ctx.imageSmoothingEnabled = true;
          ctx.translate(p.x, p.y);
          ctx.rotate(
            pose.angle -
              (boat ? Math.PI : 0) +
              this.eraArtwork.facing(actor.definitionId),
          );
          ctx.drawImage(
            art.source,
            art.x,
            art.y,
            art.width,
            art.height,
            -size * art.pivotX,
            -size * art.pivotY,
            size,
            size,
          );
        } else {
          ctx.fillStyle = COLORS[actor.playerId];
          ctx.fillRect(
            p.x - symbol.size / 2,
            p.y - symbol.size / 2,
            symbol.size,
            symbol.size,
          );
          ctx.fillStyle = "#10212b";
          ctx.font = "8px system-ui";
          ctx.textAlign = "center";
          ctx.fillText("$", p.x, p.y + 3);
        }
        ctx.restore();
        const loading = this.traderPresentation.loadingProgress(actor, this.scale);
        if (loading !== undefined) {
          // Unlabelled screen-space cargo bar, visible only at building-art zoom.
          ctx.save();
          const width = Math.min(32, symbol.size), left = p.x-width/2,
            top = p.y-symbol.size/2-7;
          ctx.fillStyle = "#10212be8";
          ctx.fillRect(left,top,width,3);
          ctx.fillStyle = "#f1d68a";
          ctx.fillRect(left,top,width*loading,3);
          ctx.restore();
        }
      }
      const impactTick = this.impacts.clock(
          visualTick,
          now,
          snapshot.winner !== null,
        ),
        impactVisuals = this.impacts.frames(impactTick),
        impactIds = new Set(impactVisuals.map((e) => e.id));
      for (const projectile of snapshot.expansion.projectiles) {
        const interception = projectile.interception;
        if (interception && !projectile.impacted && visualTick >= interception.tick && visualTick < interception.impactTick) {
          const fraction = Math.max(0,Math.min(1,(visualTick-interception.tick)/(interception.impactTick-interception.tick)));
          const rocket = this.screen((interception.fromX+(interception.toX-interception.fromX)*fraction)/FIXED,(interception.fromY+(interception.toY-interception.fromY)*fraction)/FIXED);
          if (visibleInViewport(rocket,16,this.width,this.height)) this.combatEffects.projectile(ctx,"rocket",rocket,Math.atan2(interception.toY-interception.fromY,interception.toX-interception.fromX),4,0.5);
        }
        if (
          (projectile.kind === "mirv" || projectile.damage === 0) &&
          projectile.impacted
        )
          continue;
        const pose = shellVisual(
          projectile,
          visualTick,
          this.screen(projectile.fromX / FIXED, projectile.fromY / FIXED),
          this.screen(projectile.toX / FIXED, projectile.toY / FIXED),
          this.spriteSize(1000),
        );
        const p = projectile.impacted
          ? this.screen(projectile.x / FIXED, projectile.y / FIXED)
          : pose;
        if (!visibleInViewport(p, 32, this.width, this.height)) continue;
        const artworkId =
          projectile.kind === "mirv"
            ? "mirv"
            : projectile.kind === "warhead"
              ? "mirv-warhead"
              : projectile.kind === "icbm"
                ? "icbm"
                : undefined;
        const frame =
          artworkId && !projectile.impacted
            ? this.eraArtwork.get(
                artworkId,
                "flight",
                visualTick - projectile.tick,
              )
            : undefined;
        if (frame) {
          this.combatEffects.projectile(ctx, "rocket", p, pose.angle, 4, 0.5);
          const size = Math.max(
            12,
            (projectile.diameter / FIXED) * this.scale * 2,
          );
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(
            Math.atan2(
              projectile.toY - projectile.fromY,
              projectile.toX - projectile.fromX,
            ) -
              Math.PI / 2 +
              this.eraArtwork.facing(artworkId!),
          );
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(
            frame.source,
            frame.x,
            frame.y,
            frame.width,
            frame.height,
            -size / 2,
            -size / 2,
            size,
            size,
          );
          ctx.restore();
          continue;
        }
        if (projectile.impacted && impactIds.has(projectile.id)) continue;
        if (!projectile.impacted) {
          this.combatEffects.projectile(
            ctx,
            pose.style,
            p,
            pose.angle,
            Math.max(3, ((projectile.diameter / FIXED) * this.scale) / 2),
          );
        } else {
          ctx.beginPath();
          ctx.arc(
            p.x,
            p.y,
            Math.max(3, (projectile.blastRadius / FIXED) * this.scale),
            0,
            Math.PI * 2,
          );
          ctx.fillStyle = "#ffb45544";
          ctx.fill();
        }
      }
      for (const impact of impactVisuals) {
        const p = this.screen(impact.x / FIXED, impact.y / FIXED),
          size = impactSize(impact.artworkId, impact.radius, this.scale);
        if (!visibleInViewport(p, size / 2, this.width, this.height)) continue;
        const frame = this.eraArtwork.get(
          impact.artworkId,
          impact.clip,
          impactTick - impact.start,
        );
        if (!frame) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
          ctx.fillStyle = "#ffb45544";
          ctx.fill();
          continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        if (impact.clip === "separation")
          ctx.rotate(impact.angle + this.eraArtwork.facing(impact.artworkId));
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(
          frame.source,
          frame.x,
          frame.y,
          frame.width,
          frame.height,
          -size / 2,
          -size / 2,
          size,
          size,
        );
        ctx.restore();
      }
    }
    for (const army of snapshot.expansion?.armies ?? []) {
      const p = this.screen(army.x / FIXED, army.y / FIXED);
      p.y -= 32;
      if (!visibleInViewport(p, 26, this.width, this.height)) continue;
      const selected = army.memberIds.some((id) => this.selected.has(id));
      ctx.fillStyle = "#132932ee";
      ctx.strokeStyle = selected
        ? SELECTED_UNIT_COLOR
        : COLORS[army.playerId % COLORS.length];
      ctx.lineWidth = selected ? 2 : 1;
      ctx.fillRect(p.x - 13, p.y - 12, 26, 24);
      ctx.strokeRect(p.x - 13, p.y - 12, 26, 24);
      ctx.fillStyle = COLORS[army.playerId % COLORS.length];
      ctx.fillRect(p.x - 7, p.y - 7, 2, 14);
      ctx.fillRect(p.x - 5, p.y - 7, 12, 6);
      ctx.fillStyle = "#f4eee0";
      ctx.font = "bold 8px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(String(army.memberIds.length), p.x + 2, p.y + 10);
    }
    // Released visual volleys never calculate or apply casualties.
    for (const volley of snapshot.volleys) {
      if (this.squadVolleyArtwork?.(ctx, volley, visualTick, this.scale, (x, y) => this.screen(x, y), this.width, this.height)) continue;
      const from = this.screen(volley.fromX / FIXED, volley.fromY / FIXED),
        to = this.screen(volley.toX / FIXED, volley.toY / FIXED);
      if (
        !visibleInViewport(from, 80, this.width, this.height) &&
        !visibleInViewport(to, 80, this.width, this.height)
      )
        continue;
      const visual = volleyVisual(
        volley,
        visualTick,
        from,
        to,
        this.spriteSize(1000),
      );
      if (!visual) continue;
      for (const point of visual.points)
        this.combatEffects.projectile(
          ctx,
          visual.style,
          point,
          point.angle,
          4,
          visual.style === "bullet" ? 1 - visual.progress * 0.5 : 1,
        );
      if (visual.style === "bullet")
        for (const emitter of visual.emitters)
          this.combatEffects.muzzle(
            ctx,
            emitter,
            visual.progress,
            Math.atan2(to.y - from.y, to.x - from.x),
          );
    }
    if (this.marker && now < this.marker.until) {
      const p = this.screen(this.marker.x, this.marker.y);
      ctx.strokeStyle = this.marker.attack ? "#ffc5b3" : "#e2fff9";
      ctx.lineWidth = 2;
      const size = 5 + (this.marker.until - now) / 80;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.deploymentPreview) {
      const {line,color,valid}=this.deploymentPreview;
      ctx.save();
      const tint=valid?color:"#ff716b";
      ctx.strokeStyle=tint+"b3";
      ctx.fillStyle=tint+"40";
      ctx.lineWidth=1.25;
      for(const [id,slot] of line.slots) {
        const squad=snapshot.squads.find(s=>s.id===id);
        if(!squad) continue;
        const circles=this.squadDeploymentPreview?.(squad,slot,line.facing) ?? [{x:slot.x/FIXED,y:slot.y/FIXED,radius:.35}];
        for(const circle of circles) {
          const p=this.screen(circle.x,circle.y);
          ctx.beginPath();
          ctx.arc(p.x,p.y,Math.max(3,circle.radius*this.scale),0,Math.PI*2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    if (this.selectionBox) {
      const b = this.selectionBox;
      ctx.fillStyle = "#84ded21f";
      ctx.strokeStyle = "#abf1e4";
      ctx.lineWidth = 1;
      ctx.fillRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
      ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
    }
    if (paused) {
      ctx.fillStyle = "#07151e55";
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.fillStyle = "#f0f6ef";
      ctx.font = "600 22px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Paused", this.width / 2, 40);
    }
    this.strategic.flush();
    const aircraftCtx = this.aircraftLayer.context;
    aircraftCtx.globalAlpha = paused ? 0.67 : 1;
    for (const aircraft of snapshot.expansion?.aircraft ?? []) {
      const pose = this.aircraftPresentation.pose(aircraft.id, blend);
      if (!pose) continue;
      const p = this.screen(pose.x / FIXED, pose.y / FIXED);
      if (!visibleInViewport(p, pose.radius, this.width, this.height)) continue;
      this.aircraftView.draw(
        aircraftCtx,
        p,
        pose,
        this.eraArtwork.get(
          this.aircraftArtworkIds.get(aircraft.id) ?? aircraft.definitionId,
          aircraft.state === "ready" ? "idle" : "flight",
          visualTick,
        ) ?? this.eraArtwork.get(aircraft.definitionId),
        COLORS[aircraft.playerId],
        this.selectedAircraft.has(aircraft.id),
      );
      aircraftCtx.font = "8px system-ui";
      aircraftCtx.fillStyle = "#fff";
      aircraftCtx.textAlign = "center";
      aircraftCtx.fillText(
        aircraft.definitionId === "fighter" ? "F" : "B",
        p.x,
        p.y + pose.size / 2 + 8,
      );
    }
    return true;
  }
}
