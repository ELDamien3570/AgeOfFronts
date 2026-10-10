/** Disposable presentation resource. Instances have no domain or network identity. */
export const ACTOR_INSTANCE_STRIDE = 16;
const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec4 positionSize;
layout(location=1) in vec4 angleLayerOrigin;
layout(location=2) in vec4 cropPivot;
layout(location=3) in vec4 color;
uniform vec2 viewport;
out vec2 uv;
out vec4 tint;
flat out int layer;
void main() {
  const vec2 corners[6] = vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));
  vec2 corner = corners[gl_VertexID];
  vec2 local = (corner-cropPivot.zw)*positionSize.zw;
  float c=cos(angleLayerOrigin.x),s=sin(angleLayerOrigin.x);
  vec2 point=positionSize.xy+vec2(c*local.x-s*local.y,s*local.x+c*local.y);
  gl_Position=vec4(point.x/viewport.x*2.0-1.0,1.0-point.y/viewport.y*2.0,0,1);
  uv=angleLayerOrigin.zw+corner*cropPivot.xy;
  layer=int(angleLayerOrigin.y);
  tint=color;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 uv;
in vec4 tint;
flat in int layer;
uniform sampler2DArray atlas;
out vec4 result;
void main() { result=texture(atlas,vec3(uv,float(layer)))*tint; }`;

export class InstancedActorSprites {
  private readonly gl: WebGL2RenderingContext | null;
  private program?: WebGLProgram;
  private vao?: WebGLVertexArrayObject;
  private buffer?: WebGLBuffer;
  private texture?: WebGLTexture;
  private viewport?: WebGLUniformLocation | null;
  private pages: readonly HTMLCanvasElement[] = [];
  private capacityBytes = 0;
  private lost = false;
  error = "";
  drawCalls = 0;
  constructor(readonly canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
    });
    if (!this.gl) this.error = "WebGL2 unavailable; using Canvas";
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
      this.error = "WebGL context lost; using Canvas until restored";
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      this.program = this.vao = this.buffer = this.texture = undefined;
      this.capacityBytes = 0;
      this.initialize();
    });
  }
  get available(): boolean {
    return !!this.program && !this.lost;
  }
  setAtlas(pages: readonly HTMLCanvasElement[]): void {
    if (
      !pages.length ||
      pages.some(
        (p) => p.width !== pages[0].width || p.height !== pages[0].height,
      )
    )
      throw new Error("Actor atlas pages must have matching dimensions");
    this.pages = pages;
    this.initialize();
  }
  private release(): void {
    const gl = this.gl;
    if (!gl || this.lost) return;
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.texture) gl.deleteTexture(this.texture);
    this.program = undefined;
    this.capacityBytes = 0;
  }
  private initialize(): void {
    const gl = this.gl;
    if (!gl || this.lost || !this.pages.length) return;
    this.release();
    const shaders: WebGLShader[] = [];
    try {
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type);
        if (!shader) throw new Error("Cannot allocate shader");
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error(
            gl.getShaderInfoLog(shader) ?? "Actor shader compilation failed",
          );
        return shader;
      };
      this.program = gl.createProgram() ?? undefined;
      if (!this.program) throw new Error("Cannot allocate program");
      gl.attachShader(this.program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
        throw new Error(
          gl.getProgramInfoLog(this.program) ?? "Actor program linking failed",
        );
      this.vao = gl.createVertexArray() ?? undefined;
      this.buffer = gl.createBuffer() ?? undefined;
      this.texture = gl.createTexture() ?? undefined;
      if (!this.vao || !this.buffer || !this.texture)
        throw new Error("Cannot allocate actor resources");
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      for (let i = 0; i < 4; i++) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(
          i,
          4,
          gl.FLOAT,
          false,
          ACTOR_INSTANCE_STRIDE * 4,
          i * 16,
        );
        gl.vertexAttribDivisor(i, 1);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
      const page = this.pages[0];
      if (this.pages.length > gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS))
        throw new Error("Actor atlas exceeds texture layer limit");
      gl.texStorage3D(
        gl.TEXTURE_2D_ARRAY,
        1,
        gl.RGBA8,
        page.width,
        page.height,
        this.pages.length,
      );
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      this.pages.forEach((source, layer) =>
        gl.texSubImage3D(
          gl.TEXTURE_2D_ARRAY,
          0,
          0,
          0,
          layer,
          page.width,
          page.height,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          source,
        ),
      );
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
      gl.useProgram(this.program);
      this.viewport = gl.getUniformLocation(this.program, "viewport");
      gl.uniform1i(gl.getUniformLocation(this.program, "atlas"), 0);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      );
      if (gl.getError() !== gl.NO_ERROR)
        throw new Error("Actor atlas upload failed");
      this.error = "";
    } catch (error) {
      this.error = String(error);
      this.release();
    } finally {
      shaders.forEach((shader) => gl.deleteShader(shader));
    }
  }
  draw(data: Float32Array, count: number, width: number, height: number): void {
    this.drawCalls = 0;
    if (!this.available) return;
    if (count < 0 || count * ACTOR_INSTANCE_STRIDE > data.length)
      throw new Error("Actor instance count exceeds buffer");
    const gl = this.gl!;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!count) return;
    gl.useProgram(this.program!);
    gl.uniform2f(this.viewport!, width, height);
    gl.bindVertexArray(this.vao!);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer!);
    const bytes = count * ACTOR_INSTANCE_STRIDE * 4;
    if (bytes > this.capacityBytes) {
      this.capacityBytes = Math.max(65536, 2 ** Math.ceil(Math.log2(bytes)));
      gl.bufferData(gl.ARRAY_BUFFER, this.capacityBytes, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      data.subarray(0, count * ACTOR_INSTANCE_STRIDE),
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture!);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    this.drawCalls = 1;
  }
  /** Explicit test hook: restores automatically; normal rendering falls back meanwhile. */
  testContextLoss(): boolean {
    const extension = this.gl?.getExtension("WEBGL_lose_context");
    if (!extension || this.lost) return false;
    extension.loseContext();
    window.setTimeout(() => extension.restoreContext(), 1500);
    return true;
  }
  dispose(): void {
    this.release();
  }
}
