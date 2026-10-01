import { generateNoiseData, NOISE_SIZE } from "./NoiseGen";

// WebGL2 ground layer: one full-map quad behind the Canvas2D battlefield. It
// paints the terrain colour, a procedural water surface and soft beaches from
// three small textures, and nothing else. A disposable view resource with no
// authority over the simulation; the Canvas2D chunks remain the fallback when
// WebGL2 is unavailable or its context is lost.
//
// Texture budget per pixel: colour (land only), fields, one noise fetch for
// wobble/ripples/grain plus a second ripple layer and a very low frequency
// ocean tint on water. No extra passes or framebuffers.

const VERTEX = `#version 300 es
precision highp float;
uniform vec2 uMap;
uniform vec2 uOrigin;
uniform float uScale;
uniform vec2 uViewport;
out vec2 vTile;
void main() {
  const vec2 corners[6] = vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));
  vec2 corner = corners[gl_VertexID];
  vTile = corner * uMap;
  vec2 px = uOrigin + vTile * uScale;
  gl_Position = vec4(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uColor;
uniform sampler2D uFields;
uniform sampler2D uNoise;
uniform vec2 uMap;
uniform float uScale;
uniform float uTime;
uniform float uAnimate;
uniform float uHasDepth;
in vec2 vTile;
out vec4 result;

// Existing painted-ground water colours, plus a lighter shore tint.
const vec3 DEEP = vec3(48.0, 91.0, 116.0) / 255.0;
const vec3 MID = vec3(77.0, 128.0, 143.0) / 255.0;
const vec3 SHORE = vec3(116.0, 172.0, 176.0) / 255.0;
const vec3 FOAM = vec3(0.86, 0.94, 0.94);
const vec3 SAND = vec3(194.0, 178.0, 130.0) / 255.0;

void main() {
  vec2 w = vTile;
  // Derivatives are taken here, in uniform control flow, so noise fetched
  // inside branches below still selects a proper mip level.
  vec2 dx = dFdx(w);
  vec2 dy = dFdy(w);
  float px = 1.0 / uScale;                      // tiles per screen pixel
  float fine = smoothstep(2.5, 7.0, uScale);    // sub-tile detail fades with zoom
  vec4 f = texture(uFields, w / uMap);
  float sd = f.r * 16.0 - 8.0;                  // signed coast distance, tiles
  // One noise fetch: R wobble, G ripples, B broad tint, A grain. Period 20 tiles.
  vec4 n = textureGrad(uNoise, w / 20.0, dx / 20.0, dy / 20.0);
  // Coastline wobble, never more than 0.35 tile so territory still lines up.
  float wobble = clamp((n.r - 0.5) * 0.9, -0.35, 0.35) * smoothstep(1.2, 3.0, uScale);
  float sdw = sd + wobble;
  float aa = max(px * 0.8, 0.015);
  float land = 1.0 - smoothstep(-aa, aa, sdw);

  vec3 landColor = vec3(0.0);
  if (land > 0.0) {
    // Linear sampling softened to about one pixel: crisp tile edges when
    // zoomed in, smooth blends when tiles are only a few pixels wide.
    vec2 q = w - 0.5;
    vec2 k = floor(q);
    float soft = clamp(px * 1.2, 0.0, 1.0);
    vec2 s = clamp((q - k - 0.5) / soft + 0.5, 0.0, 1.0);
    landColor = texture(uColor, (k + 0.5 + s) / uMap).rgb;
    float shade = (f.g - 0.5) * 2.0;
    landColor += shade * 0.05;
    landColor *= 1.0 + (n.b - 0.5) * 0.05 + (n.a - 0.5) * 0.08 * fine;
    // Narrow, soft beach: dry sand blends in, then a thin wet strip.
    float inland = max(-sdw, 0.0);
    landColor = mix(landColor, SAND, 0.22 * (1.0 - smoothstep(0.0, 0.8, inland)));
    landColor *= 1.0 - 0.16 * (1.0 - smoothstep(0.0, 0.18, inland));
  }

  vec3 waterColor = vec3(0.0);
  if (land < 1.0) {
    float d = max(sdw, 0.0);
    float tDist = smoothstep(0.0, 5.5, d);
    float tDepth = smoothstep(0.04, 0.85, f.b);
    float t = mix(tDist, tDepth, 0.6 * uHasDepth);
    waterColor = mix(mix(SHORE, MID, smoothstep(0.0, 0.35, t)), DEEP, smoothstep(0.25, 1.0, t));
    // Very low amplitude, very low frequency tint; no mid-scale clouds.
    float broad = textureGrad(uNoise, w / 233.0, dx / 233.0, dy / 233.0).b;
    waterColor *= 1.0 + (broad - 0.5) * 0.05;
    float time = uTime * uAnimate;
    // Ripples: lattice cells of about 0.3 to 0.4 tile (features of 0.6 to
    // 0.8 tile), two layers drifting
    // in different directions, low amplitude, gone when zoomed out.
    if (fine > 0.0) {
      float r1 = textureGrad(uNoise, w / 12.0 + vec2(time * 0.02, time * 0.012), dx / 12.0, dy / 12.0).g;
      vec2 w2 = vec2(w.x * 0.8 - w.y * 0.6, w.x * 0.6 + w.y * 0.8);
      float r2 = textureGrad(uNoise, w2 / 9.0 + vec2(-time * 0.015, time * 0.022), dx / 9.0, dy / 9.0).g;
      waterColor *= 1.0 + (r1 + r2 - 1.0) * 0.13 * fine;
    }
    // Wave bands rolling toward the shore, broken up by noise.
    float phase = fract(d * 0.55 + time * 0.1);
    float band = smoothstep(0.0, 0.06, phase) * (1.0 - smoothstep(0.06, 0.2, phase));
    float reach = 1.0 - smoothstep(0.6, 3.6, d);
    waterColor += FOAM * band * reach * (0.4 + 0.6 * n.g) * 0.22 * smoothstep(3.5, 8.0, uScale);
    // Foam line on the water side of the coast.
    float line = (1.0 - smoothstep(0.08, 0.38, d)) * (0.55 + 0.45 * n.g);
    waterColor = mix(waterColor, FOAM, line * (0.3 + 0.3 * smoothstep(1.5, 4.0, uScale)));
  }
  result = vec4(mix(waterColor, landColor, land), 1.0);
}`;

export type GroundStyle = "animated" | "still" | "classic";

const BACKGROUND = [0x10 / 255, 0x23 / 255, 0x31 / 255] as const;

export interface GroundTextures {
  width: number;
  height: number;
  /** RGBA8, width*height texels. Kept by the layer to survive context loss. */
  colors: Uint8Array;
  /** RGBA8 fields from `bakeTerrainFields`. */
  fields: Uint8Array;
  hasDepth: boolean;
}

export class GroundLayer {
  private readonly canvas = document.createElement("canvas");
  private readonly gl: WebGL2RenderingContext | null;
  private program?: WebGLProgram;
  private vao?: WebGLVertexArrayObject;
  private colorTexture?: WebGLTexture;
  private fieldsTexture?: WebGLTexture;
  private noiseTexture?: WebGLTexture;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private textures?: GroundTextures;
  private lost = false;
  private failed = false;
  private animated = true;
  private width = 1;
  private height = 1;
  constructor(base: HTMLCanvasElement) {
    this.canvas.className = "ground-layer";
    this.canvas.setAttribute("aria-hidden", "true");
    this.gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!this.gl) return;
    base.before(this.canvas);
    this.initialize();
    this.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      this.initialize();
      if (this.textures) this.upload(this.textures);
    });
  }
  /** True when the layer can paint the ground this frame. */
  get available(): boolean {
    return !!this.gl && !!this.program && !this.lost && !this.failed;
  }
  /** True once a map is uploaded; the Canvas2D chunks cover the gap until then. */
  get ready(): boolean {
    return this.available && !!this.textures;
  }
  setAnimated(value: boolean): void {
    this.animated = value;
  }
  setVisible(value: boolean): void {
    this.canvas.style.display = value ? "" : "none";
  }
  private initialize(): void {
    const gl = this.gl!;
    const shader = (type: number, source: string) => {
      const value = gl.createShader(type)!;
      gl.shaderSource(value, source);
      gl.compileShader(value);
      if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(value);
        gl.deleteShader(value);
        throw new Error(message ?? "Ground shader failed");
      }
      return value;
    };
    try {
      const vertex = shader(gl.VERTEX_SHADER, VERTEX),
        fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT),
        program = gl.createProgram()!;
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program) ?? "Ground link failed");
      this.program = program;
      this.uniforms.clear();
      for (const name of [
        "uColor",
        "uFields",
        "uNoise",
        "uMap",
        "uOrigin",
        "uScale",
        "uViewport",
        "uTime",
        "uAnimate",
        "uHasDepth",
      ])
        this.uniforms.set(name, gl.getUniformLocation(program, name));
      this.vao = gl.createVertexArray()!;
      this.noiseTexture = this.createTexture(
        NOISE_SIZE,
        NOISE_SIZE,
        generateNoiseData(0x5eed),
        true,
      );
      gl.bindTexture(gl.TEXTURE_2D, this.noiseTexture);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        gl.LINEAR_MIPMAP_LINEAR,
      );
      this.failed = false;
    } catch (error) {
      this.program = undefined;
      this.canvas.style.display = "none";
      console.warn("Using canvas ground rendering", error);
    }
  }
  private createTexture(
    width: number,
    height: number,
    data: Uint8Array | null,
    repeat: boolean,
  ): WebGLTexture {
    const gl = this.gl!,
      texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return texture;
  }
  /** Upload (or replace) the map textures. */
  setMap(textures: GroundTextures): void {
    this.textures = textures;
    if (this.available) this.upload(textures);
  }
  private upload(textures: GroundTextures): void {
    const gl = this.gl!;
    for (const old of [this.colorTexture, this.fieldsTexture])
      if (old) gl.deleteTexture(old);
    this.colorTexture = this.createTexture(
      textures.width,
      textures.height,
      textures.colors,
      false,
    );
    this.fieldsTexture = this.createTexture(
      textures.width,
      textures.height,
      textures.fields,
      false,
    );
  }
  /** Replace texels (already written into `textures.colors` by the caller). */
  updateColors(
    rects: readonly {
      x: number;
      y: number;
      w: number;
      h: number;
      data: Uint8Array;
    }[],
  ): void {
    if (!this.available || !this.colorTexture) return;
    const gl = this.gl!;
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    for (const r of rects)
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        r.x,
        r.y,
        r.w,
        r.h,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        r.data,
      );
  }
  resize(width: number, height: number, ratio: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    if (this.gl && !this.lost)
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }
  clear(): void {
    if (!this.available) return;
    const gl = this.gl!;
    gl.clearColor(BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  /**
   * Paint the ground for the Renderer's camera. `now` is wall-clock
   * milliseconds; water motion never depends on game ticks.
   */
  draw(scale: number, offsetX: number, offsetY: number, now: number): void {
    this.clear();
    const textures = this.textures;
    if (!this.available || !textures || !this.colorTexture) return;
    const gl = this.gl!,
      u = (name: string) => this.uniforms.get(name)!;
    gl.useProgram(this.program!);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldsTexture!);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTexture!);
    gl.uniform1i(u("uColor"), 0);
    gl.uniform1i(u("uFields"), 1);
    gl.uniform1i(u("uNoise"), 2);
    gl.uniform2f(u("uMap"), textures.width, textures.height);
    gl.uniform2f(u("uOrigin"), offsetX, offsetY);
    gl.uniform1f(u("uScale"), scale);
    gl.uniform2f(u("uViewport"), this.width, this.height);
    gl.uniform1f(u("uTime"), (now / 1000) % 1000);
    gl.uniform1f(u("uAnimate"), this.animated ? 1 : 0);
    gl.uniform1f(u("uHasDepth"), textures.hasDepth ? 1 : 0);
    gl.bindVertexArray(this.vao!);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
