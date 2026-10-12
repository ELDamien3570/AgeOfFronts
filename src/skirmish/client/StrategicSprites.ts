import type { FormationType as Kind } from "./FormationArtwork";
import type { FormationMarkerLayout } from "./FormationMarker";
interface Frame {
  source: HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
  pivotX: number;
  pivotY: number;
}
const KINDS: Kind[] = [
  "infantry",
  "archer",
  "cavalry",
  "transport",
  "warship",
  "siege",
];
const STRIDE = 28;
const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec4 positionSize;
layout(location=1) in vec4 angleLayerOrigin;
layout(location=2) in vec4 cropPivot;
layout(location=3) in vec4 color;
layout(location=4) in vec4 badge;
layout(location=5) in vec4 decoration;
layout(location=6) in vec4 outline;
uniform vec2 viewport;
out vec2 uv;
out vec4 tint;
flat out int layer;
out vec2 cornerUv;
flat out vec4 badgeSize;
flat out vec4 textureCrop;
flat out vec2 quadSize;
flat out vec4 facing;
flat out vec4 borderColor;
void main() {
  const vec2 corners[6] = vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));
  vec2 corner = corners[gl_VertexID];
  vec2 local = (corner-cropPivot.zw)*positionSize.zw;
  float c=cos(angleLayerOrigin.x),s=sin(angleLayerOrigin.x);
  vec2 point = positionSize.xy + vec2(c*local.x-s*local.y,s*local.x+c*local.y);
  gl_Position = vec4(point.x/viewport.x*2.0-1.0,1.0-point.y/viewport.y*2.0,0,1);
  uv = angleLayerOrigin.zw + corner*cropPivot.xy;
  layer = int(angleLayerOrigin.y);
  tint = color;
  cornerUv = corner;
  badgeSize = badge;
  textureCrop = vec4(angleLayerOrigin.zw,cropPivot.xy);
  quadSize = positionSize.zw;
  facing = decoration;
  borderColor = outline;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 uv;
in vec4 tint;
flat in int layer;
in vec2 cornerUv;
flat in vec4 badgeSize;
flat in vec4 textureCrop;
flat in vec2 quadSize;
flat in vec4 facing;
flat in vec4 borderColor;
uniform sampler2DArray atlas;
out vec4 result;
void main() {
  if(badgeSize.x <= 0.0) { result = texture(atlas,vec3(uv,float(layer)))*tint; return; }
  vec3 ink = vec3(badgeSize.w);
  vec2 pixel = cornerUv * quadSize;
  vec2 iconUv = (cornerUv - 0.5 - vec2(0.0, facing.w)) / badgeSize.xy + 0.5;
  bool inIcon = all(greaterThanEqual(iconUv, vec2(0.0))) && all(lessThanEqual(iconUv, vec2(1.0)));

  vec4 icon = inIcon ? texture(atlas, vec3(textureCrop.xy + iconUv * textureCrop.zw, float(layer))) : vec4(0.0);
  result = tint;
  result.rgb = mix(tint.rgb, ink, icon.a);
  float y = pixel.y - badgeSize.z;
  if(y >= 0.0 && y <= facing.y && abs(pixel.x - quadSize.x * 0.5) <= facing.x * 0.5 * y / facing.y)
    result.rgb = ink;
  vec2 edge = min(pixel, quadSize - pixel);
  if(min(edge.x, edge.y) <= facing.z)
    result.rgb = borderColor.a > 0.0 ? borderColor.rgb : ink;
  // Antialias inside the footprint instead of expanding its geometry.
  vec2 coverage = smoothstep(vec2(0.0), fwidth(pixel), edge);
  result.a *= min(coverage.x, coverage.y);
}`;

// One instanced draw for strategic markers. A disposable view resource with no
// authority over selection, routing or combat. Detailed art stays in canvas;
// unsupported or lost WebGL contexts use the existing canvas marker path.
export class StrategicSprites {
  private readonly canvas = document.createElement("canvas");
  private readonly gl: WebGL2RenderingContext | null;
  private program?: WebGLProgram;
  private buffer?: WebGLBuffer;
  private texture?: WebGLTexture;
  private vao?: WebGLVertexArrayObject;
  private viewport?: WebGLUniformLocation | null;
  private readonly uploaded = new Set<number>();
  private instances = new Float32Array(8192 * STRIDE);
  private count = 0;
  private lost = false;
  private width = 1;
  private height = 1;
  constructor(base: HTMLCanvasElement) {
    this.canvas.className = "strategic-sprites";
    this.canvas.setAttribute("aria-hidden", "true");
    this.gl = this.canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!this.gl) return;
    base.after(this.canvas);
    this.initialize();
    this.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
      this.canvas.style.display = "none";
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      this.initialize();
    });
  }
  get available(): boolean {
    return !!this.gl && !!this.program && !this.lost;
  }
  private initialize() {
    const gl = this.gl!;
    const shader = (type: number, source: string) => {
      const value = gl.createShader(type)!;
      gl.shaderSource(value, source);
      gl.compileShader(value);
      if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(value);
        gl.deleteShader(value);
        throw new Error(message ?? "Strategic sprite shader failed");
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
        throw new Error(
          gl.getProgramInfoLog(program) ?? "Strategic sprite linking failed",
        );
      this.program = program;
      this.viewport = gl.getUniformLocation(program, "viewport");
      this.vao = gl.createVertexArray()!;
      gl.bindVertexArray(this.vao);
      this.buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      for (let index = 0; index < 7; index++) {
        gl.enableVertexAttribArray(index);
        gl.vertexAttribPointer(
          index,
          4,
          gl.FLOAT,
          false,
          STRIDE * 4,
          index * 16,
        );
        gl.vertexAttribDivisor(index, 1);
      }
      this.texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 128, 128, KINDS.length * 2);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(
        gl.TEXTURE_2D_ARRAY,
        gl.TEXTURE_WRAP_S,
        gl.CLAMP_TO_EDGE,
      );
      gl.texParameteri(
        gl.TEXTURE_2D_ARRAY,
        gl.TEXTURE_WRAP_T,
        gl.CLAMP_TO_EDGE,
      );
      gl.useProgram(program);
      gl.uniform1i(gl.getUniformLocation(program, "atlas"), 0);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      );
      this.uploaded.clear();
      this.canvas.style.display = "";
    } catch (error) {
      this.program = undefined;
      this.canvas.style.display = "none";
      console.warn("Using canvas formation rendering", error);
    }
  }
  resize(width: number, height: number, ratio: number) {
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    if (this.gl && !this.lost)
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }
  begin(): void {
    this.count = 0;
  }
  add(
    kind: Kind,
    frame: Frame,
    x: number,
    y: number,
    width: number,
    height: number,
    angle: number,
    rgb: readonly number[],
    opacity: number,
    marker?: { layout: FormationMarkerLayout; light: boolean; selection?: readonly number[] },
  ): boolean {
    if (!this.available || width <= 0 || height <= 0) return false;
    const gl = this.gl!,
      layer = KINDS.indexOf(kind) + (marker ? KINDS.length : 0);
    if (!this.uploaded.has(layer)) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture!);
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        layer,
        128,
        128,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        frame.source,
      );
      this.uploaded.add(layer);
    }
    if ((this.count + 1) * STRIDE > this.instances.length) {
      const grown = new Float32Array(this.instances.length * 2);
      grown.set(this.instances);
      this.instances = grown;
    }
    this.instances.set(
      [
        x,
        y,
        width,
        height,
        angle,
        layer,
        frame.x / 128,
        frame.y / 128,
        frame.width / 128,
        frame.height / 128,
        frame.pivotX,
        frame.pivotY,
        rgb[0] / 255,
        rgb[1] / 255,
        rgb[2] / 255,
        opacity,
        marker ? marker.layout.symbolWidth / width : 0,
        marker ? marker.layout.symbolHeight / height : 0,
        marker?.layout.border ?? 0,
        marker?.light ? 1 : 0,
        marker?.layout.facingWidth ?? 0,
        marker?.layout.facingHeight ?? 0,
        marker?.selection ? Math.min(1.5, Math.min(width, height) * 0.15) : marker?.layout.border ?? 0,
        marker ? marker.layout.symbolOffsetY / height : 0,
        marker?.selection ? marker.selection[0] / 255 : 0,
        marker?.selection ? marker.selection[1] / 255 : 0,
        marker?.selection ? marker.selection[2] / 255 : 0,
        marker?.selection ? 1 : 0,
      ],
      this.count++ * STRIDE,
    );
    return true;
  }
  flush(): void {
    if (!this.available) return;
    const gl = this.gl!;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.count) return;
    gl.useProgram(this.program!);
    gl.uniform2f(this.viewport!, this.width, this.height);
    gl.bindVertexArray(this.vao!);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer!);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.instances.subarray(0, this.count * STRIDE),
      gl.DYNAMIC_DRAW,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture!);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
  }
}
