import type { GameMap } from "../../core/game/GameMap";
import type { BuildingType, ShipType, Snapshot, SquadType } from "../Protocol";
import { CAPTURE_RADIUS, FIXED } from "../Protocol";
import {
  ARCHER_ARROW_TICKS,
  BUILDING_RULES,
  SHIP_RULES,
  SQUAD_RULES,
} from "../Rules";
import { BuildingArtwork } from "./BuildingArtwork";
import { FormationArtwork } from "./FormationArtwork";
import { buildingSymbol, shipSymbol, squadSymbol } from "./MapSymbols";
import { PaintedTerrain } from "./PaintedTerrain";
import { StrategicSprites } from "./StrategicSprites";
import { TerritoryLayer } from "./TerritoryLayer";
import { PresentationClock, squadSpriteSize } from "./UnitAnimation";
import { UnitArtwork } from "./UnitArtwork";
import { UnitPresentation, visibleInViewport } from "./UnitPresentation";

export const COLORS = [
  "#667e77",
  "#62d5cc",
  "#ee776b",
  "#edbb62",
  "#b39aeb",
  "#96c776",
  "#e39abd",
  "#6599e8",
  "#b5805e",
  "#bec5df",
  "#59b9f0",
  "#c94452",
  "#b8bf59",
  "#e7dbc1",
  "#3f7ea8",
  "#e89c7c",
  "#caa52f",
  "#cd73dc",
  "#a3b5bd",
  "#ef8e36",
  "#4b9664",
];
const RGB = COLORS.map((color) => [
  parseInt(color.slice(1, 3), 16),
  parseInt(color.slice(3, 5), 16),
  parseInt(color.slice(5, 7), 16),
]);
const BUILDING_PAD_COLORS = new Map(
  COLORS.map((color, index) => [
    color,
    `rgb(${RGB[index].map((channel) => Math.round(channel + (255 - channel) * 0.22)).join(",")})`,
  ]),
);
const SELECTED_UNIT_COLOR = "#c4ff36";

export class Renderer {
  private readonly artwork = new UnitArtwork();
  private readonly buildingArtwork = new BuildingArtwork();
  private readonly formationArtwork = new FormationArtwork();
  private readonly presentation = new UnitPresentation();
  private readonly animationClock = new PresentationClock();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly strategic: StrategicSprites;
  private ground?: PaintedTerrain;
  private territory?: TerritoryLayer;
  private buildingStacks: {
    building: Snapshot["buildings"][number];
    count: number;
    remainingTicks: number;
  }[] = [];
  private snapshot?: Snapshot;
  private previous?: Snapshot;
  private previousSquads = new Map<number, Snapshot["squads"][number]>();
  private currentSquads = new Map<number, Snapshot["squads"][number]>();
  private readonly cargoCounts = new Map<number, number>();
  private receivedAt = 0;
  private nextFrame = 0;
  private map?: GameMap;
  private scale = 1;
  private fitScale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private width = 0;
  private height = 0;
  private hudBottomInset = 0;
  private resizeObserver: ResizeObserver;
  selected = new Set<number>();
  selectedShips = new Set<number>();
  selectedBuilding: number | null = null;
  placement?: { tile: number; type: BuildingType; friendly: boolean };
  buildSites: number[] = [];
  selectionBox?: { x1: number; y1: number; x2: number; y2: number };
  marker?: { x: number; y: number; until: number; attack: boolean };

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.strategic = new StrategicSprites(canvas);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement!);
    this.resize();
  }

  setMap(map: GameMap): void {
    this.map = map;
    this.ground = new PaintedTerrain(map);
    this.territory = new TerritoryLayer(map.width(), map.height(), RGB);
    this.buildingStacks = [];
    this.snapshot = undefined;
    this.previous = undefined;
    this.previousSquads.clear();
    this.currentSquads.clear();
    this.presentation.reset();
    this.animationClock.reset();
    this.selected.clear();
    this.selectedShips.clear();
    this.selectedBuilding = null;
    this.placement = undefined;
    this.buildSites = [];
    this.strategic.begin();
    this.strategic.flush();
    this.home();
  }

  update(snapshot: Snapshot): void {
    if (!this.map) return;
    this.previous = this.snapshot;
    this.previousSquads = this.currentSquads;
    this.currentSquads = new Map(snapshot.squads.map((s) => [s.id, s]));
    this.cargoCounts.clear();
    for (const squad of snapshot.squads)
      if (squad.embarkedOn !== null)
        this.cargoCounts.set(
          squad.embarkedOn,
          (this.cargoCounts.get(squad.embarkedOn) ?? 0) + 1,
        );
    this.snapshot = snapshot;
    this.presentation.update(snapshot);
    this.receivedAt = performance.now();
    this.animationClock.update(snapshot.tick, this.receivedAt);
    for (const id of this.selected)
      if (
        this.currentSquads.get(id)?.playerId !== 1 ||
        this.currentSquads.get(id)?.embarkedOn !== null
      )
        this.selected.delete(id);
    for (const id of this.selectedShips)
      if (!snapshot.ships.some((s) => s.id === id && s.playerId === 1))
        this.selectedShips.delete(id);
    this.territory!.update(snapshot);
    const stacks = new Map<
      string,
      {
        building: Snapshot["buildings"][number];
        count: number;
        remainingTicks: number;
      }
    >();
    for (const building of snapshot.buildings) {
      const key = `${building.tile}:${building.type}`;
      let stack = stacks.get(key);
      if (!stack)
        stacks.set(key, (stack = { building, count: 0, remainingTicks: 0 }));
      stack.count++;
      stack.remainingTicks = Math.max(
        stack.remainingTicks,
        building.remainingTicks,
      );
    }
    this.buildingStacks = Array.from(stacks.values());
  }

  private resize(): void {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.nextFrame = 0;
    this.strategic.resize(this.width, this.height, ratio);
    this.home();
  }

  setHudBottomInset(pixels: number): void {
    if (this.hudBottomInset === pixels) return;
    this.hudBottomInset = Math.max(0, pixels);
    this.home();
  }

  home(): void {
    if (!this.map) return;
    const usableHeight = Math.max(100, this.height - this.hudBottomInset);
    this.fitScale = Math.min(
      (this.width - 52) / this.map.width(),
      (usableHeight - 52) / this.map.height(),
    );
    this.scale = this.fitScale;
    this.offsetX = (this.width - this.map.width() * this.scale) / 2;
    this.offsetY = (usableHeight - this.map.height() * this.scale) / 2;
  }

  zoom(amount: number, x: number, y: number): void {
    const tileX = (x - this.offsetX) / this.scale,
      tileY = (y - this.offsetY) / this.scale;
    this.scale = Math.max(this.fitScale, Math.min(48, this.scale * amount));
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
    for (const squad of this.snapshot?.squads ?? []) {
      if (squad.embarkedOn !== null) continue;
      if (owner !== undefined && squad.playerId !== owner) continue;
      const p = this.screen(squad.x / FIXED, squad.y / FIXED);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      const { hitRadius } = squadSymbol(
        this.scale,
        squad.troops,
        !!this.artwork.get(squad.kind),
      );
      if (d <= hitRadius ** 2 && d < distance) {
        distance = d;
        best = squad;
      }
    }
    return best;
  }

  private spriteSize(troops: number): number {
    return squadSpriteSize(this.scale, troops);
  }

  visibleSquads(kind: SquadType): number[] {
    return (this.snapshot?.squads ?? [])
      .filter(
        (s) =>
          s.playerId === 1 &&
          s.embarkedOn === null &&
          s.kind === kind &&
          visibleInViewport(
            this.screen(s.x / FIXED, s.y / FIXED),
            squadSymbol(this.scale, s.troops, !!this.artwork.get(s.kind))
              .viewRadius,
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
          s.playerId === 1 &&
          s.kind === kind &&
          visibleInViewport(
            this.screen(s.x / FIXED, s.y / FIXED),
            shipSymbol(
              this.scale,
              !!this.formationArtwork.get(s.kind, COLORS[s.playerId]),
            ).viewRadius,
            this.width,
            this.height,
          ),
      )
      .map((s) => s.id);
  }

  buildingAt(x: number, y: number): number | null {
    let nearest: number | null = null;
    let distance = Infinity;
    for (const { building } of this.buildingStacks) {
      const p = this.screen(
        this.map!.x(building.tile) + 0.5,
        this.map!.y(building.tile) + 0.5,
      );
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      const half =
        buildingSymbol(
          this.scale,
          !!this.buildingArtwork.get(building.type),
          building.type,
        ).size / 2;
      if (
        Math.abs(p.x - x) <= half &&
        Math.abs(p.y - y) <= half &&
        d < distance
      ) {
        nearest = building.id;
        distance = d;
      }
    }
    return nearest;
  }

  private drawBuilding(
    type: BuildingType,
    p: { x: number; y: number },
    color: string,
    selected: boolean,
    remainingTicks: number,
    ghost = false,
  ): number {
    const ctx = this.ctx;
    const image = this.buildingArtwork.get(type);
    const { artwork, size, inset, backdropAlpha } = buildingSymbol(
      this.scale,
      !!image,
      type,
      selected,
    );
    ctx.save();
    ctx.strokeStyle = selected ? "#fff" : color;
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.setLineDash(remainingTicks || ghost ? [3, 2] : []);
    if (backdropAlpha) {
      ctx.globalAlpha = backdropAlpha;
      ctx.fillStyle = artwork
        ? (BUILDING_PAD_COLORS.get(color) ?? color)
        : "#142c37";
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      ctx.globalAlpha = 1;
    }
    // Distant glyphs need a solid pad; detailed art only adds one on selection.
    if (selected || ghost || !artwork)
      ctx.strokeRect(p.x - size / 2, p.y - size / 2, size, size);
    if (artwork && image) {
      ctx.globalAlpha = ghost ? 0.65 : remainingTicks ? 0.55 : 1;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        image,
        p.x - size / 2 + inset,
        p.y - size / 2 + inset,
        size - inset * 2,
        size - inset * 2,
      );
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = color;
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "center";
      ctx.strokeStyle = "#10212b";
      ctx.lineWidth = 3;
      ctx.strokeText(BUILDING_RULES[type].glyph, p.x, p.y + 4);
      ctx.fillText(BUILDING_RULES[type].glyph, p.x, p.y + 4);
    }
    if (remainingTicks) {
      const fraction = 1 - remainingTicks / BUILDING_RULES[type].ticks;
      ctx.fillStyle = "#10212b";
      ctx.fillRect(p.x - size / 2, p.y + size / 2 + 2, size, 3);
      ctx.fillStyle = color;
      ctx.fillRect(p.x - size / 2, p.y + size / 2 + 2, size * fraction, 3);
    }
    ctx.restore();
    return size;
  }

  shipAt(x: number, y: number): number | null {
    for (const ship of this.snapshot?.ships ?? []) {
      const p = this.screen(ship.x / FIXED, ship.y / FIXED);
      const radius = shipSymbol(
        this.scale,
        !!this.formationArtwork.get(ship.kind, COLORS[ship.playerId]),
      ).hitRadius;
      if ((p.x - x) ** 2 + (p.y - y) ** 2 <= radius ** 2) return ship.id;
    }
    return null;
  }

  draw(now: number, speed: number, paused: boolean): boolean {
    if (now < this.nextFrame) return false;
    // Preserve CPU time for the fixed-step worker when armies are large. The
    // presentation target is 30 FPS at high population, 60 FPS in small matches.
    const frameInterval =
      1000 /
      ((this.snapshot?.squads.length ?? 0) +
        (this.snapshot?.ships.length ?? 0) >
      1000
        ? 30
        : 60);
    this.nextFrame =
      now + frameInterval - ((now - this.nextFrame) % frameInterval);
    this.strategic.begin();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = "#102331";
    ctx.fillRect(0, 0, this.width, this.height);
    if (!this.map || !this.snapshot) {
      this.strategic.flush();
      return true;
    }
    const snapshot = this.snapshot;
    this.ground!.draw(
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
    ctx.strokeStyle = "#b4c6cf26";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      this.offsetX - 1,
      this.offsetY - 1,
      this.map.width() * this.scale + 2,
      this.map.height() * this.scale + 2,
    );
    for (const tile of this.buildSites) {
      const p = this.screen(this.map.x(tile), this.map.y(tile));
      ctx.fillStyle = "#9bffe066";
      ctx.fillRect(p.x, p.y, this.scale, this.scale);
      ctx.strokeStyle = "#baffebbb";
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x + 0.5, p.y + 0.5, this.scale - 1, this.scale - 1);
    }

    for (const player of snapshot.players) {
      const p = this.screen(
        this.map.x(player.base) + 0.5,
        this.map.y(player.base) + 0.5,
      );
      const owner = snapshot.owners[player.base];
      ctx.fillStyle = COLORS[owner || player.id];
      ctx.strokeStyle = "#10212b";
      ctx.lineWidth = 2;
      ctx.fillRect(p.x - 6, p.y - 6, 12, 12);
      ctx.strokeRect(p.x - 6, p.y - 6, 12, 12);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 10);
      ctx.lineTo(p.x + 4, p.y - 6);
      ctx.lineTo(p.x - 4, p.y - 6);
      ctx.closePath();
      ctx.fill();
      ctx.font = "600 11px system-ui";
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#10212bcc";
      const name = `${player.name}${owner !== player.id ? " · camp lost" : ""}`;
      ctx.strokeText(name, p.x, p.y - 16);
      ctx.fillStyle = "#eaf0ec";
      ctx.fillText(name, p.x, p.y - 16);
    }

    // Buildings, including placement ghosts, are a layer beneath mobile units.
    const selectedBuilding =
      this.selectedBuilding === null
        ? undefined
        : snapshot.buildings.find((b) => b.id === this.selectedBuilding);
    for (const { building, count, remainingTicks } of this.buildingStacks) {
      const p = this.screen(
        this.map.x(building.tile) + 0.5,
        this.map.y(building.tile) + 0.5,
      );
      const rules = BUILDING_RULES[building.type];
      if (!visibleInViewport(p, 70, this.width, this.height)) continue;
      const selected =
        selectedBuilding?.tile === building.tile &&
        selectedBuilding?.type === building.type;
      const size = this.drawBuilding(
        building.type,
        p,
        COLORS[building.playerId],
        selected,
        remainingTicks,
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
      if (selected || this.scale >= 14) {
        const label =
          rules.name +
          (count > 1 ? ` ×${count}` : "") +
          (remainingTicks ? ` · ${Math.ceil(remainingTicks / 20)}s` : "");
        ctx.font = "600 10px system-ui";
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#10212bd9";
        ctx.strokeText(label, p.x, p.y + size / 2 + 17);
        ctx.fillStyle = "#f0f6ef";
        ctx.fillText(label, p.x, p.y + size / 2 + 17);
      }
    }
    if (this.placement) {
      const p = this.screen(
        this.map.x(this.placement.tile) + 0.5,
        this.map.y(this.placement.tile) + 0.5,
      );
      this.drawBuilding(
        this.placement.type,
        p,
        this.placement.friendly ? "#a0ffe0" : "#ff8f84",
        false,
        0,
        true,
      );
    }

    const previousById = this.previousSquads;
    const interval = Math.max(
      50,
      (snapshot.tick - (this.previous?.tick ?? snapshot.tick - 1)) * 50,
    );
    const blend = paused ? 1 : Math.min(1, (now - this.receivedAt) / interval);
    const visualTick = this.animationClock.sample(
      now,
      speed,
      paused || snapshot.winner !== null,
    );
    const renderedSquads = snapshot.squads
      .filter((squad) => squad.embarkedOn === null)
      .map((squad) => {
        const old = previousById.get(squad.id) ?? squad;
        const p = this.screen(
          (old.x + (squad.x - old.x) * blend) / FIXED,
          (old.y + (squad.y - old.y) * blend) / FIXED,
        );
        const selected = this.selected.has(squad.id);
        const symbol = squadSymbol(
          this.scale,
          squad.troops,
          !!this.artwork.get(squad.kind),
        );
        if (
          !visibleInViewport(
            p,
            Math.max(
              symbol.viewRadius,
              selected ? CAPTURE_RADIUS * this.scale : 0,
            ),
            this.width,
            this.height,
          )
        )
          return undefined;
        const image = symbol.artwork
          ? this.artwork.get(
              squad.kind,
              this.presentation.animation(squad.id, visualTick),
            )
          : undefined;
        return { squad, p, selected, symbol, image };
      })
      .filter(
        (entry): entry is NonNullable<typeof entry> => entry !== undefined,
      );
    // All ground indicators precede every soldier, regardless of unit order.
    for (const { squad, p, selected, symbol, image } of renderedSquads) {
      if (
        squad.kind === "archer" &&
        (selected || (squad.fighting && symbol.artwork))
      ) {
        const range = (SQUAD_RULES.archer.range / FIXED) * this.scale;
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
        ctx.beginPath();
        ctx.arc(p.x, p.y, CAPTURE_RADIUS * this.scale, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff08";
        ctx.fill();
        ctx.strokeStyle = "#ffffff20";
        ctx.lineWidth = 1;
        ctx.stroke();
        let from = p;
        const route = [squad.order, ...squad.queuedOrders];
        for (let index = 0; index < route.length; index++) {
          const order = route[index];
          let goal: { x: number; y: number } | undefined;
          if (order.type === "move" || order.type === "board")
            goal = this.screen(
              order.type === "move" && order.x !== undefined
                ? order.x / FIXED
                : this.map.x(order.tile) + 0.5,
              order.type === "move" && order.y !== undefined
                ? order.y / FIXED
                : this.map.y(order.tile) + 0.5,
            );
          if (order.type === "attack") {
            const target = this.currentSquads.get(order.targetId);
            if (target) goal = this.screen(target.x / FIXED, target.y / FIXED);
          }
          if (!goal) continue;
          ctx.setLineDash([4, 5]);
          ctx.strokeStyle =
            order.type === "attack"
              ? "#ef9c8e99"
              : order.type === "board"
                ? "#8ed5ffcc"
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
      if (image) {
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
    for (const { squad, p, selected, symbol, image } of renderedSquads) {
      const radius = 4 + (2 * squad.troops) / 1_000;
      const spriteSize = this.spriteSize(squad.troops);
      if (image) {
        const lunge = this.presentation.meleeLunge(
          squad.id,
          visualTick,
          this.scale,
          spriteSize,
        );
        ctx.imageSmoothingEnabled = true;
        ctx.save();
        ctx.translate(p.x + lunge.x, p.y + lunge.y);
        ctx.rotate(this.presentation.angle(squad.id));
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
        const barWidth = spriteSize * 0.72,
          barY = p.y + spriteSize / 2 + 3;
        ctx.fillStyle = "#10212bdd";
        ctx.fillRect(p.x - barWidth / 2, barY, barWidth, 3);
        ctx.fillStyle = COLORS[squad.playerId];
        ctx.fillRect(
          p.x - barWidth / 2,
          barY,
          (barWidth * squad.troops) / 1_000,
          3,
        );
      } else {
        const formation = this.formationArtwork.get(
          squad.kind,
          this.strategic.available ? "#ffffff" : COLORS[squad.playerId],
        );
        const angle =
          this.presentation.angle(squad.id) + (formation ? Math.PI : 0);
        const batched =
          formation &&
          this.strategic.add(
            squad.kind,
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
            squad.kind,
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
          ctx.fillText(SQUAD_RULES[squad.kind].glyph, p.x, p.y + 3);
        }
        // Distant formations retain a strength cue without thousands of text
        // labels competing for space at strategic zoom.
        if (squad.troops < 1_000) {
          const barWidth = symbol.width,
            barY = p.y + symbol.height / 2 + 3;
          ctx.fillStyle = "#10212bdd";
          ctx.fillRect(p.x - barWidth / 2, barY, barWidth, 2);
          ctx.fillStyle = COLORS[squad.playerId];
          ctx.fillRect(
            p.x - barWidth / 2,
            barY,
            (barWidth * squad.troops) / 1_000,
            2,
          );
        }
      }
      if (squad.fighting && squad.kind !== "archer") {
        ctx.strokeStyle = "#ffdeb0";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x - 3, p.y - 3);
        ctx.lineTo(p.x + 3, p.y + 3);
        ctx.moveTo(p.x + 3, p.y - 3);
        ctx.lineTo(p.x - 3, p.y + 3);
        ctx.stroke();
      }
      if (image || selected || this.scale >= 14) {
        ctx.font = "600 10px system-ui";
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#10212bd9";
        const labelY = p.y + (image ? spriteSize / 2 + 16 : radius + 12);
        ctx.strokeText(String(squad.troops), p.x, labelY);
        ctx.fillStyle = "#f2f5ed";
        ctx.fillText(String(squad.troops), p.x, labelY);
      }
    }
    for (const ship of snapshot.ships) {
      const p = this.screen(ship.x / FIXED, ship.y / FIXED);
      if (!visibleInViewport(p, 60, this.width, this.height)) continue;
      const rules = SHIP_RULES[ship.kind];
      const selected = this.selectedShips.has(ship.id);
      const formation = this.formationArtwork.get(
        ship.kind,
        this.strategic.available ? "#ffffff" : COLORS[ship.playerId],
      );
      const symbol = shipSymbol(this.scale, !!formation);
      if (selected) {
        if (ship.boarding) {
          const shore = this.screen(
            this.map.x(ship.boarding.landTile) + 0.5,
            this.map.y(ship.boarding.landTile) + 0.5,
          );
          ctx.beginPath();
          ctx.arc(shore.x, shore.y, 10, 0, Math.PI * 2);
          ctx.strokeStyle = "#8ed5ff";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.font = "600 10px system-ui";
          ctx.textAlign = "center";
          ctx.fillStyle = "#d2edff";
          ctx.fillText("Board here", shore.x, shore.y - 15);
        }
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
      if (symbol.formation && formation) {
        const batched = this.strategic.add(
          ship.kind,
          formation,
          p.x,
          p.y,
          symbol.width,
          symbol.height,
          this.presentation.shipAngle(ship.id),
          RGB[ship.playerId],
          paused ? 0.67 : 1,
        );
        if (!batched || selected) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(this.presentation.shipAngle(ship.id));
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
      const cargo = this.cargoCounts.get(ship.id) ?? 0;
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
      ctx.lineWidth = 3;
      const label = `${ship.health} HP${ship.kind === "transport" ? ` · ${cargo}/4` : ""}${ship.boarding ? " · meeting" : ""}${ship.fighting ? " ⚔" : ""}`;
      ctx.strokeText(label, p.x, p.y + 22);
      ctx.fillStyle = "#eaf3ef";
      ctx.fillText(label, p.x, p.y + 22);
    }
    // These are simulation-issued volleys, not a second damage calculation.
    for (const volley of snapshot.volleys) {
      const age = visualTick - volley.tick;
      if (age < 0 || age >= ARCHER_ARROW_TICKS) continue;
      const progress = age / ARCHER_ARROW_TICKS;
      const from = this.screen(volley.fromX / FIXED, volley.fromY / FIXED);
      const to = this.screen(volley.toX / FIXED, volley.toY / FIXED);
      const lift = Math.min(14, Math.hypot(to.x - from.x, to.y - from.y) / 5);
      const distance = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      const normalX = -(to.y - from.y) / distance,
        normalY = (to.x - from.x) / distance;
      const angle = Math.atan2(
        to.y - from.y - Math.cos(progress * Math.PI) * Math.PI * lift,
        to.x - from.x,
      );
      // Five simultaneous visual projectiles share this one domain volley.
      for (let index = -2; index <= 2; index++) {
        const spread = index * 4;
        const x = from.x + (to.x - from.x) * progress + normalX * spread;
        const y =
          from.y +
          (to.y - from.y) * progress +
          normalY * spread -
          Math.sin(progress * Math.PI) * lift;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.strokeStyle = "#fff0bd";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-9, 0);
        ctx.lineTo(3, 0);
        ctx.moveTo(-1, -2);
        ctx.lineTo(3, 0);
        ctx.lineTo(-1, 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(from.x, from.y, 9 * (1 - progress), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,220,136,${1 - progress})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
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
    return true;
  }
}
