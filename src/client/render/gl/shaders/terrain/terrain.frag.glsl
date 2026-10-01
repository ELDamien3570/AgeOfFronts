#version 300 es
precision highp float;

// Terrain colour (NEAREST). Stylized bake: rgb = base colour, a = tile kind
// (1.0 water, ~0.5 land, 0.0 impassable). Legacy bake: a is always 1.0.
uniform sampler2D uTerrain;

// #include coast

uniform float uTime;     // seconds, wrapped to [0, 1000)
uniform float uZoom;     // screen px per tile
uniform float uStylized; // 0 = legacy flat look
uniform float uAnimate;  // 0 = no time-based motion

uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uSand;
uniform vec3 uWetSand;
uniform float uRipple;
uniform float uFoamStrength;
uniform float uZoomFadeStart;
uniform float uZoomFadeEnd;

in vec2 vUV;
out vec4 fragColor;

void main() {
  vec4 tex = texture(uTerrain, vUV);
  if (uStylized < 0.5) {
    fragColor = vec4(tex.rgb, 1.0);
    return;
  }
  // Impassable renders as the background colour, untouched.
  if (tex.a < 0.25) {
    fragColor = vec4(tex.rgb, 1.0);
    return;
  }

  vec2 w = vUV * uMapSize;
  vec4 nFine = coastNoise(w);
  float d = coastWobble(coastRawDistance(w), nFine);
  float t = uAnimate > 0.5 ? uTime : 0.0;
  float zf = smoothstep(uZoomFadeStart, uZoomFadeEnd, uZoom);
  bool landTexel = tex.a < 0.75;

  vec3 col = tex.rgb;

  if (d >= 0.0) {
    // Turquoise shallows -> deep over 6 tiles; beyond that keep the
    // magnitude-based darkening baked into the colour texture.
    float depthT = smoothstep(0.0, 6.0, d);
    vec3 darken = landTexel ? vec3(0.0) : min(vec3(0.0), tex.rgb - uDeep);
    col = mix(uShallow, uDeep, depthT) + darken;

    // Large-scale colour patches (not zoom-gated).
    vec4 nMacro = texture(uNoise, w / 160.0 + vec2(0.31, 0.17));
    col *= 1.0 + (nMacro.b - 0.5) * 0.12;

    // Ripples: two noise samples scrolling in different directions.
    vec4 n1 = texture(uNoise, w * 0.020 + t * vec2(0.010, 0.006));
    vec4 n2 = texture(uNoise, w * 0.035 + t * vec2(-0.008, 0.012));
    col *= 1.0 + (n1.g + n2.r - 1.0) * 2.0 * uRipple * zf;

    // Foam: broken-up line at the waterline plus waves rolling to shore.
    if (d < 3.0) {
      float line = 1.0 - smoothstep(0.05, 0.3 + (nFine.g - 0.5) * 0.25, d);
      float band = fract(t * 0.25 - d * 0.6);
      float wave = smoothstep(0.82, 0.97, band) * (1.0 - smoothstep(0.0, 3.0, d));
      wave *= smoothstep(0.35, 0.65, n2.a);
      float foam = clamp(line + wave * zf * 0.6, 0.0, 1.0) * uFoamStrength;
      col = mix(col, uFoam, foam);
    }
  } else {
    // Land. A wobbled coast can pull land pixels over a water texel; treat
    // those as sand.
    vec3 land = landTexel ? tex.rgb : uSand;
    if (d > -1.6) {
      // Beach bands: wet sand at the waterline, dry sand inland, blending
      // into the land colour.
      vec3 sand = mix(uSand, uWetSand, smoothstep(-0.7, -0.05, d));
      col = mix(sand, land, smoothstep(-1.6, -1.0, d));
    } else {
      col = land;
    }
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
