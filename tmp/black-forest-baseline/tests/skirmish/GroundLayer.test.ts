import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GroundLayer,
  type GroundTextures,
} from "../../src/skirmish/client/GroundLayer";

afterEach(() => vi.unstubAllGlobals());

function setup(webgl = true) {
  const gl = {
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getUniformLocation: vi.fn(() => ({})),
    createVertexArray: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    generateMipmap: vi.fn(),
    deleteTexture: vi.fn(),
  };
  const listeners = new Map<string, (event: Event) => void>();
  const canvas = {
    style: { display: "" },
    setAttribute: vi.fn(),
    getContext: vi.fn(() => (webgl ? gl : null)),
    addEventListener: (name: string, listener: (event: Event) => void) =>
      listeners.set(name, listener),
  };
  vi.stubGlobal("document", { createElement: () => canvas });
  const base = { before: vi.fn() };
  const layer = new GroundLayer(base as unknown as HTMLCanvasElement);
  return { gl, listeners, base, layer };
}

function textures(width: number, height: number): GroundTextures {
  return {
    width,
    height,
    colors: new Uint8Array(width * height * 4),
    fields: new Uint8Array(width * height * 4),
    hasDepth: false,
  };
}

describe("ground context lifecycle", () => {
  it("keeps the Canvas2D fallback when WebGL2 is unavailable", () => {
    const { layer, base } = setup(false);
    expect(layer.supported).toBe(false);
    expect(layer.ready).toBe(false);
    expect(base.before).not.toHaveBeenCalled();
  });

  it("restores the latest map and CPU colour edits after context loss", () => {
    const { layer, gl, listeners } = setup();
    layer.setMap(textures(4, 4));
    expect(layer.ready).toBe(true);

    const lost = new Event("webglcontextlost", { cancelable: true });
    listeners.get("webglcontextlost")!(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(layer.supported).toBe(true);
    expect(layer.available).toBe(false);

    gl.texImage2D.mockClear();
    const nextMap = textures(8, 2);
    layer.setMap(nextMap);
    nextMap.colors[0] = 200;
    expect(gl.texImage2D).not.toHaveBeenCalled();
    expect(layer.ready).toBe(false);

    listeners.get("webglcontextrestored")!(new Event("webglcontextrestored"));
    expect(layer.ready).toBe(true);
    const uploads = gl.texImage2D.mock.calls as unknown as unknown[][];
    const mapUploads = uploads.slice(-2);
    expect(mapUploads.map((args) => args.slice(3, 5))).toEqual([
      [8, 2],
      [8, 2],
    ]);
    expect(mapUploads[0][8]).toBe(nextMap.colors);
    expect((mapUploads[0][8] as Uint8Array)[0]).toBe(200);
    expect(mapUploads[1][8]).toBe(nextMap.fields);
    expect(gl.deleteTexture).not.toHaveBeenCalled();
  });
});
