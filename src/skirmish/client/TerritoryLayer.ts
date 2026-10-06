import type { Snapshot } from "../Protocol";
import { CAPTURE_TICKS } from "../Protocol";
import { Diplomacy } from "../domain/Diplomacy";
import { roundedBorderEdge } from "./RoundedTerritoryBorders";
import {
  TERRITORY_ALPHA,
  TERRITORY_BORDER_INK,
  TERRITORY_BORDER_LIGHT,
  TERRITORY_RELATION_COLORS,
  TERRITORY_OFFENSIVE_COLOR,
  territoryStyle,
} from "./TerritoryStyle";

const CHUNK = 64;
// Inward normals for country accents along unowned land and water edges.
const NORMALS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;
interface Accent {
  path: Path2D;
  color: string;
  normal: (typeof NORMALS)[number];
}
interface Chunk {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  x: number;
  y: number;
  width: number;
  height: number;
  accents: Accent[];
  fronts: { a: number; b: number; path: Path2D }[];
  warFronts: Path2D[];
  warPath: Path2D;
  offensivePath: Path2D;
  offensiveFronts: number;
  outerPath: Path2D;
  peacePath: Path2D;
  neutralPath: Path2D;
  alliedPath: Path2D;
  borderDirty: boolean;
}

// Dynamic ownership is independent of painted ground. Only changed chunks
// upload their small overlay image; border geometry is rebuilt locally.
export class TerritoryLayer {
  private readonly chunks = new Map<number, Chunk>();
  private readonly columns: number;
  private readonly owners: Uint8Array;
  private readonly claims: Uint8Array;
  private readonly progress: Uint8Array;
  private readonly borderColors: string[];
  private initialized = false;
  // Snapshot-derived diplomacy only; never writes simulation state.
  private readonly diplomacy = new Diplomacy();
  private relationKey = "";
  private readonly activeOffensives = new Set<string>();
  private readonly pairRelations = new Map<string,string>();
  constructor(
    private readonly width: number,
    private readonly height: number,
    private colors: number[][],
  ) {
    this.columns = Math.ceil(width / CHUNK);
    this.owners = new Uint8Array(width * height).fill(255);
    this.claims = new Uint8Array(width * height);
    this.progress = new Uint8Array(width * height);
    this.colors = colors.map(color => [...color]);
    this.borderColors = colors.map(
      (color) =>
        `rgb(${color.map((c) => Math.round(c + (255 - c) * 0.18)).join(",")})`,
    );
  }
  /** Own a palette copy so in-place global changes can be detected. Palette
   * changes repaint all ownership pixels, including incremental snapshots. */
  setColors(colors: number[][]): void {
    if (colors.length === this.colors.length && colors.every((color, i) =>
      color.every((channel, j) => channel === this.colors[i][j]))) return;
    this.colors = colors.map(color => [...color]);
    this.borderColors.splice(0, this.borderColors.length, ...colors.map(color =>
      `rgb(${color.map(c => Math.round(c + (255 - c) * 0.18)).join(",")})`));
    this.initialized = false;
    this.owners.fill(255);
    for (const chunk of this.chunks.values()) chunk.borderDirty = true;
  }
  private key(tile: number) {
    return (
      Math.floor((tile % this.width) / CHUNK) +
      Math.floor(Math.floor(tile / this.width) / CHUNK) * this.columns
    );
  }
  private chunk(key: number): Chunk {
    let chunk = this.chunks.get(key);
    if (chunk) return chunk;
    const x = (key % this.columns) * CHUNK,
      y = Math.floor(key / this.columns) * CHUNK,
      width = Math.min(CHUNK, this.width - x),
      height = Math.min(CHUNK, this.height - y);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    chunk = {
      canvas,
      ctx,
      image: ctx.createImageData(width, height),
      x,
      y,
      width,
      height,
      accents: [],
      fronts: [],
      warFronts: [],
      warPath: new Path2D(),
      offensivePath: new Path2D(),
      offensiveFronts: 0,
      outerPath: new Path2D(),
      peacePath: new Path2D(),
      neutralPath: new Path2D(),
      alliedPath: new Path2D(),
      borderDirty: true,
    };
    this.chunks.set(key, chunk);
    return chunk;
  }
  update(snapshot: Snapshot): void {
    this.diplomacy.state.alliances =
      snapshot.expansion?.diplomacy.alliances ?? [];
    this.diplomacy.state.wars = snapshot.expansion?.diplomacy.wars ?? [];
    const pairs = (rows: readonly { a: number; b: number }[]) =>
      rows
        .map(t => `${Math.min(t.a, t.b)}:${Math.max(t.a, t.b)}`)
        .sort()
        .join(",");
    const offensives = snapshot.expansion?.activeOffensives ?? [];
    const relations=snapshot.expansion?.pairRelations??[];
    const relationKey = `${pairs(this.diplomacy.state.alliances)}|${pairs(this.diplomacy.state.wars)}|${pairs(offensives)}|`+
      relations.map(r=>`${Math.min(r.a,r.b)}:${Math.max(r.a,r.b)}:${r.state}`).sort().join(",");
    if (relationKey !== this.relationKey) {
      this.relationKey = relationKey;
      this.activeOffensives.clear();
      this.pairRelations.clear();for(const r of relations)this.pairRelations.set(`${Math.min(r.a,r.b)}:${Math.max(r.a,r.b)}`,r.state);
      for (const { a, b } of offensives)
        this.activeOffensives.add(`${Math.min(a, b)}:${Math.max(a, b)}`);
      for (const c of this.chunks.values()) this.updateRelations(c);
    }
    const dirty = new Set<number>();
    const update = (tile: number) => {
      const owner = snapshot.owners[tile],
        claim = snapshot.claims[tile],
        progress = snapshot.progress[tile];
      if (
        this.owners[tile] === owner &&
        this.claims[tile] === claim &&
        this.progress[tile] === progress
      )
        return;
      const key = this.key(tile),
        chunk = this.chunk(key),
        pixel =
          ((tile % this.width) -
            chunk.x +
            (Math.floor(tile / this.width) - chunk.y) * chunk.width) *
          4;
      const capture = claim ? Math.min(1, progress / CAPTURE_TICKS) : 0,
        a = owner ? TERRITORY_ALPHA * (1 - capture) : 0,
        b = TERRITORY_ALPHA * capture,
        total = a + b;
      for (let channel = 0; channel < 3; channel++)
        chunk.image.data[pixel + channel] = total
          ? Math.round(
              ((owner ? this.colors[owner][channel] * a : 0) +
                (claim ? this.colors[claim][channel] * b : 0)) /
                total,
            )
          : 0;
      chunk.image.data[pixel + 3] = Math.round(total * 255);
      dirty.add(key);
      if (this.owners[tile] !== owner) {
        // Corner curves read all four incident owners, including diagonal
        // neighbors across chunk seams. Claim progress does not affect geometry.
        const x = tile % this.width,
          y = Math.floor(tile / this.width);
        for (
          let ty = Math.max(0, y - 1);
          ty <= Math.min(this.height - 1, y + 1);
          ty++
        )
          for (
            let tx = Math.max(0, x - 1);
            tx <= Math.min(this.width - 1, x + 1);
            tx++
          )
            this.chunk(this.key(ty * this.width + tx)).borderDirty = true;
      }
      this.owners[tile] = owner;
      this.claims[tile] = claim;
      this.progress[tile] = progress;
    };
    // Reconnects/first publications may include changedTiles; initialize all
    // owners once so unseen neighbors never become phantom borders.
    if (this.initialized && snapshot.changedTiles)
      for (const tile of snapshot.changedTiles) update(tile);
    else for (let tile = 0; tile < snapshot.owners.length; tile++) update(tile);
    this.initialized = true;
    for (const key of dirty) {
      const c = this.chunks.get(key)!;
      c.ctx.putImageData(c.image, 0, 0);
    }
  }
  private border(c: Chunk) {
    const outerPath = new Path2D();
    const accents = new Map<number, Accent>();
    const fronts = new Map<string, { a: number; b: number; path: Path2D }>();
    const at = (x: number, y: number) =>
      x < 0 || y < 0 || x >= this.width || y >= this.height
        ? 0
        : this.owners[y * this.width + x];
    const segment = (
      p: Path2D,
      x: number,
      y: number,
      dx: number,
      dy: number,
    ) => {
      roundedBorderEdge(p, { x1: x, y1: y, x2: x + dx, y2: y + dy }, at);
    };
    const line = (
      x: number,
      y: number,
      horizontal: boolean,
      a: number,
      b: number,
    ) => {
      if (a === b) return;
      const dx = Number(horizontal),
        dy = Number(!horizontal);
      if (a && b) {
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        let front = fronts.get(key);
        if (!front) {
          front = { a, b, path: new Path2D() };
          fronts.set(key, front);
        }
        segment(front.path, x, y, dx, dy);
        // Shared borders communicate diplomacy; faction accents belong outside.
        return;
      } else segment(outerPath, x, y, dx, dy);
      // a is the north/west owner; b is the south/east owner.
      for (const [owner, direction] of [
        [a, horizontal ? 0 : 3],
        [b, horizontal ? 2 : 1],
      ]) {
        if (!owner) continue;
        const key = owner * 4 + direction;
        let accent = accents.get(key);
        if (!accent) {
          accent = {
            path: new Path2D(),
            color: this.borderColors[owner],
            normal: NORMALS[direction],
          };
          accents.set(key, accent);
        }
        segment(accent.path, x, y, dx, dy);
      }
    };
    for (let y = c.y; y < c.y + c.height; y++)
      for (let x = c.x; x < c.x + c.width; x++) {
        const owner = at(x, y);
        line(x + 1, y, false, owner, at(x + 1, y));
        line(x, y + 1, true, owner, at(x, y + 1));
        if (x === 0) line(x, y, false, 0, owner);
        if (y === 0) line(x, y, true, 0, owner);
      }
    c.accents = [...accents.values()];
    c.fronts = [...fronts.values()];
    c.outerPath = outerPath;
    this.updateRelations(c);
    c.borderDirty = false;
  }
  private updateRelations(c: Chunk): void {
    c.warFronts = [];
    c.warPath = new Path2D();
    c.offensivePath = new Path2D();
    c.offensiveFronts = 0;
    c.neutralPath = new Path2D();
    c.alliedPath = new Path2D();
    c.peacePath = new Path2D(c.outerPath);
    for (const front of c.fronts) {
      if (this.diplomacy.allied(front.a, front.b)) {
        c.alliedPath.addPath(front.path);
        c.peacePath.addPath(front.path);
      } else if (this.pairRelations.get(`${Math.min(front.a,front.b)}:${Math.max(front.a,front.b)}`)==="conflict" ||
        this.activeOffensives.has(`${Math.min(front.a, front.b)}:${Math.max(front.a, front.b)}`)) {
        c.offensivePath.addPath(front.path);
        c.offensiveFronts++;
      } else if (this.diplomacy.declaredWar(front.a, front.b)) {
        c.warFronts.push(front.path);
        c.warPath.addPath(front.path);
      } else {
        c.neutralPath.addPath(front.path);
        c.peacePath.addPath(front.path);
      }
    }
  }
  draw(
    ctx: CanvasRenderingContext2D,
    scale: number,
    offsetX: number,
    offsetY: number,
    width: number,
    height: number,
  ): void {
    const style = territoryStyle(scale);
    const visible: Chunk[] = [];
    // Include the screen-space stroke fringe when a chunk is just offscreen.
    const fringe = 5;
    for (const c of this.chunks.values())
      if (
        offsetX + (c.x + c.width) * scale >= -fringe &&
        offsetY + (c.y + c.height) * scale >= -fringe &&
        offsetX + c.x * scale <= width + fringe &&
        offsetY + c.y * scale <= height + fringe
      )
        visible.push(c);
    ctx.save();
    const alpha = ctx.globalAlpha;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = (alpha * style.fillAlpha) / TERRITORY_ALPHA;
    for (const c of visible)
      ctx.drawImage(
        c.canvas,
        offsetX + c.x * scale,
        offsetY + c.y * scale,
        c.width * scale,
        c.height * scale,
      );
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = alpha * 0.72;
    ctx.strokeStyle = TERRITORY_BORDER_INK;
    ctx.lineWidth = style.casingWidth / scale;
    for (const c of visible) {
      if (c.borderDirty) this.border(c);
      ctx.stroke(c.peacePath);
    }
    ctx.strokeStyle = TERRITORY_RELATION_COLORS.war;
    ctx.globalAlpha = alpha * 0.32;
    ctx.lineWidth = (style.casingWidth + 1.2) / scale;
    for (const c of visible) if (c.warFronts.length) ctx.stroke(c.warPath);
    if (style.accentAlpha > 0) {
      ctx.globalAlpha = alpha * style.accentAlpha;
      ctx.lineWidth = style.accentWidth / scale;
      for (const c of visible)
        for (const accent of c.accents) {
          const x = (accent.normal[0] * style.accentInset) / scale,
            y = (accent.normal[1] * style.accentInset) / scale;
          ctx.save();
          ctx.translate(x, y);
          ctx.strokeStyle = accent.color;
          ctx.stroke(accent.path);
          ctx.restore();
        }
    }
    // Two bounded screen-space halo strokes; cached paths avoid per-frame
    // geometry work and canvas shadow blur on large multiplayer maps.
    ctx.strokeStyle = TERRITORY_RELATION_COLORS.war;
    for (const [width, opacity] of [[7, 0.10], [4, 0.22]]) {
      ctx.lineWidth = width / scale;
      ctx.globalAlpha = alpha * opacity;
      for (const c of visible) if (c.offensiveFronts) ctx.stroke(c.offensivePath);
    }
    // Final pass across all chunks keeps shared boundaries crisp at seams.
    ctx.globalAlpha = alpha * 0.72;
    ctx.strokeStyle = TERRITORY_BORDER_LIGHT;
    ctx.lineWidth = style.lineWidth / scale;
    for (const c of visible) ctx.stroke(c.outerPath);
    ctx.globalAlpha = alpha * 0.88;
    ctx.lineWidth = 1.6 / scale;
    ctx.strokeStyle = TERRITORY_RELATION_COLORS.neutral;
    for (const c of visible) ctx.stroke(c.neutralPath);
    ctx.strokeStyle = TERRITORY_RELATION_COLORS.allied;
    for (const c of visible) ctx.stroke(c.alliedPath);
    // Replace the ordinary casing and light strokes at declared-war fronts rather
    // than adding glow passes. All geometry and treaty classification is cached.
    ctx.strokeStyle = TERRITORY_RELATION_COLORS.war;
    ctx.globalAlpha = alpha * 0.88;
    ctx.lineWidth = 1.6 / scale;
    for (const c of visible) if (c.warFronts.length) ctx.stroke(c.warPath);
    ctx.strokeStyle = TERRITORY_OFFENSIVE_COLOR;
    ctx.globalAlpha = alpha * 0.96;
    ctx.lineWidth = 2 / scale;
    for (const c of visible) if (c.offensiveFronts) ctx.stroke(c.offensivePath);
    ctx.restore();
  }
}
