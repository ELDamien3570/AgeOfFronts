/**
 * TerrainPass — renders the terrain map as a textured quad.
 *
 * Initial upload happens once; incremental updates flow through
 * applyTerrainRects() so water-nuke conversions (land → water) are reflected
 * live. Vertex shader transforms the map quad by the camera mat3; fragment
 * shader samples the RGBA8 terrain texture with nearest-neighbour filtering
 * so each terrain cell stays pixel-crisp at every zoom level.
 */

import type { TerrainRect } from "../../types";
import coastSrc from "../shaders/terrain/coast.glsl?raw";
import terrainFragSrc from "../shaders/terrain/terrain.frag.glsl?raw";
import terrainVertSrc from "../shaders/terrain/terrain.vert.glsl?raw";
import {
  buildTerrainRGBA,
  encodeTerrainTile,
  TerrainColorOverrides,
} from "../utils/ColorUtils";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderInclude,
  shaderSrc,
} from "../utils/GlUtils";
import { generateNoiseData, NOISE_SIZE } from "../utils/NoiseGen";
import {
  bakeTerrainFields,
  bakeTerrainFieldsRect,
} from "../utils/TerrainFields";
import { LEGACY_TERRAIN_STYLE, TerrainStyle } from "../utils/TerrainStyle";

const UNIFORMS = [
  "uTerrain",
  "uFields",
  "uNoise",
  "uMapSize",
  "uTime",
  "uZoom",
  "uStylized",
  "uAnimate",
  "uShallow",
  "uDeep",
  "uFoam",
  "uSand",
  "uPlains",
  "uHighland",
  "uMountain",
  "uDirt",
  "uHillshade",
  "uGrain",
  "uMacro",
  "uWetSand",
  "uRipple",
  "uFoamStrength",
  "uZoomFadeStart",
  "uZoomFadeEnd",
];

/**
 * 256x256 RGBA8 tileable value-noise texture (REPEAT, mipmapped). Four
 * independent channels, generated procedurally with a fixed seed.
 */
export function createNoiseTexture(
  gl: WebGL2RenderingContext,
  seed = 0x5eed,
): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    NOISE_SIZE,
    NOISE_SIZE,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    generateNoiseData(seed),
  );
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}

// ---------------------------------------------------------------------------
// TerrainPass
// ---------------------------------------------------------------------------

export class TerrainPass {
  private program: WebGLProgram;
  private tex: WebGLTexture;
  // RG8 LINEAR "fields" texture: R = signed coast distance, G = elevation.
  private fieldsTex: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private uCamera: WebGLUniformLocation;
  private noiseTex: WebGLTexture;
  private style: TerrainStyle;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private mapW: number;
  private mapH: number;
  // Base ocean (deep water) color; reused by applyTerrainRects and rebuilds.
  private terrainColors: TerrainColorOverrides | undefined;
  // Scratch RGBA buffer for rect sub-uploads; grown as needed and reused
  // across applyTerrainRects calls.
  private rgbaScratch = new Uint8Array(0);

  constructor(
    private gl: WebGL2RenderingContext,
    // Regenerates current per-tile terrain bytes (reflecting water-nuke
    // conversions) for the rare full re-bake in setTerrainColors. A provider
    // instead of a retained buffer: terrain bytes are map-sized (8 MB on the
    // giant map).
    private terrainSource: () => Uint8Array,
    terrainBytes: Uint8Array,
    mapW: number,
    mapH: number,
    terrainColors?: TerrainColorOverrides,
    style: TerrainStyle = LEGACY_TERRAIN_STYLE,
  ) {
    this.style = style;
    this.mapW = mapW;
    this.mapH = mapH;
    this.terrainColors = terrainColors;
    this.program = createProgram(
      gl,
      shaderSrc(terrainVertSrc, { MAP_W: mapW, MAP_H: mapH }),
      shaderInclude(terrainFragSrc, "coast", coastSrc),
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    for (const name of UNIFORMS) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }
    this.noiseTex = createNoiseTexture(gl);

    this.tex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      data: buildTerrainRGBA(terrainBytes, mapW, mapH, terrainColors),
      filter: gl.NEAREST, // pixel-crisp at all zoom levels
    });

    this.fieldsTex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.RG8,
      format: gl.RG,
      type: gl.UNSIGNED_BYTE,
      data: bakeTerrainFields(terrainBytes, mapW, mapH),
      filter: gl.LINEAR,
    });

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  /** The tileable noise texture shared with other terrain-aware shaders. */
  get noise(): WebGLTexture {
    return this.noiseTex;
  }

  /** Replace the uniform-only style (live, no re-bake). */
  setStyle(style: TerrainStyle): void {
    this.style = style;
  }

  /** The RG8 fields texture (R coast distance, G elevation), LINEAR. */
  get fields(): WebGLTexture {
    return this.fieldsTex;
  }

  /**
   * Replace the base terrain colors and re-upload the whole terrain texture.
   * Called when the user changes the terrain colors in graphics settings.
   */
  setTerrainColors(terrainColors?: TerrainColorOverrides): void {
    this.terrainColors = terrainColors;
    const gl = this.gl;
    const terrain = this.terrainSource();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.mapW,
      this.mapH,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      buildTerrainRGBA(terrain, this.mapW, this.mapH, terrainColors),
    );
    gl.bindTexture(gl.TEXTURE_2D, this.fieldsTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.mapW,
      this.mapH,
      gl.RG,
      gl.UNSIGNED_BYTE,
      bakeTerrainFields(terrain, this.mapW, this.mapH),
    );
  }

  /**
   * Update terrain regions in-place (e.g. land→water from a water nuke).
   * Each rect's terrain bytes are stored row-major, concatenated in `bytes`
   * in rect order. One texSubImage2D per rect — a massive bomb changes tens
   * of thousands of tiles, so per-tile 1×1 uploads are too slow. A later full
   * re-upload (setTerrainColors) regenerates from terrainSource, whose
   * backing game map already reflects these conversions.
   */
  applyTerrainRects(rects: readonly TerrainRect[], bytes: Uint8Array): void {
    if (rects.length === 0) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    let offset = 0;
    for (const r of rects) {
      const count = r.w * r.h;
      if (this.rgbaScratch.length < count * 4) {
        this.rgbaScratch = new Uint8Array(count * 4);
      }
      for (let i = 0; i < count; i++) {
        encodeTerrainTile(
          bytes[offset + i],
          this.rgbaScratch,
          i * 4,
          this.terrainColors,
        );
      }
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        r.x,
        r.y,
        r.w,
        r.h,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.rgbaScratch,
        0,
      );
      offset += count;
    }
    this.updateFields(rects, bytes);
  }

  /**
   * Recompute the fields texture around each changed rect (padded by
   * FIELD_PAD) from the current terrain and re-upload just that region.
   */
  private updateFields(rects: readonly TerrainRect[], bytes: Uint8Array): void {
    const gl = this.gl;
    // Current full-map terrain (already reflects the conversions in `bytes`
    // in the live game; the overlay below makes that independent of the
    // provider so padded neighbours of one rect see another rect's change).
    const terrain = this.terrainSource();
    let offset = 0;
    for (const r of rects) {
      for (let y = 0; y < r.h; y++) {
        const dst = (r.y + y) * this.mapW + r.x;
        for (let x = 0; x < r.w; x++) {
          const b = bytes[offset + y * r.w + x];
          if (terrain[dst + x] !== b) terrain[dst + x] = b;
        }
      }
      offset += r.w * r.h;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.fieldsTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (const r of rects) {
      const upd = bakeTerrainFieldsRect(terrain, this.mapW, this.mapH, r);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        upd.x,
        upd.y,
        upd.w,
        upd.h,
        gl.RG,
        gl.UNSIGNED_BYTE,
        upd.data,
      );
    }
  }

  /** Render the terrain. Call with depth test disabled, no blending. */
  draw(cameraMatrix: Float32Array, zoom = 1): void {
    const gl = this.gl;
    const s = this.style;
    const u = this.u;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldsTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
    gl.uniform1i(u.uTerrain, 0);
    gl.uniform1i(u.uFields, 1);
    gl.uniform1i(u.uNoise, 2);

    gl.uniform2f(u.uMapSize, this.mapW, this.mapH);
    // Wall-clock seconds (frameTick advances per game tick, not per frame).
    // Wrapped at 1000 s; motion speeds are chosen so the wrap is seamless.
    gl.uniform1f(u.uTime, (performance.now() / 1000) % 1000);
    gl.uniform1f(u.uZoom, zoom);
    gl.uniform1f(u.uStylized, s.stylized ? 1 : 0);
    gl.uniform1f(u.uAnimate, s.animate ? 1 : 0);
    gl.uniform3fv(u.uShallow, s.shallow);
    gl.uniform3fv(u.uDeep, s.deep);
    gl.uniform3fv(u.uFoam, s.foam);
    gl.uniform3fv(u.uSand, s.sand);
    gl.uniform3fv(u.uPlains, s.plains);
    gl.uniform3fv(u.uHighland, s.highland);
    gl.uniform3fv(u.uMountain, s.mountain);
    gl.uniform3fv(u.uDirt, s.dirt);
    gl.uniform1f(u.uHillshade, s.hillshadeStrength);
    gl.uniform1f(u.uGrain, s.grainStrength);
    gl.uniform1f(u.uMacro, s.macroVariation);
    gl.uniform3fv(u.uWetSand, s.wetSand);
    gl.uniform1f(u.uRipple, s.rippleStrength);
    gl.uniform1f(u.uFoamStrength, s.foamStrength);
    gl.uniform1f(u.uZoomFadeStart, s.zoomFadeStart);
    gl.uniform1f(u.uZoomFadeEnd, s.zoomFadeEnd);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.tex);
    gl.deleteTexture(this.fieldsTex);
    gl.deleteTexture(this.noiseTex);
    // VAO + buffer leak is acceptable on dispose (context is being destroyed)
  }
}
