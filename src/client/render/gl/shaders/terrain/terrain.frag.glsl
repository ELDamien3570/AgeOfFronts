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
uniform vec3 uPlains;
uniform vec3 uHighland;
uniform vec3 uMountain;
uniform vec3 uDirt;
uniform float uHillshade;
uniform float uGrain;
uniform float uMacro;
uniform vec3 uWetSand;
uniform float uRipple;
uniform float uFoamStrength;
uniform float uZoomFadeStart;
uniform float uZoomFadeEnd;

in vec2 vUV;
out vec4 fragColor;

// Painted land: soft biome ramp from the LINEAR elevation field, hillshade,
// macro variation, dirt patches and fine grain. Only runs for land pixels.
vec3 landColor(vec2 w, float e, vec4 nFine, vec4 nMacro, float zf) {
  // Biome ramp (plains -> highland -> mountain), with the legacy per-height
  // tinting folded in (magnitude = elevation * 30).
  float mag = e * 30.0;
  vec3 plains = uPlains - vec3(0.0, 2.0 * mag / 255.0, 0.0);
  vec3 highland = uHighland + (2.0 * max(mag - 10.0, 0.0)) / 255.0;
  vec3 mountain = uMountain + floor(mag * 0.5) / 255.0;
  vec3 c = mix(plains, highland, smoothstep(0.28, 0.42, e));
  c = mix(c, mountain, smoothstep(0.60, 0.74, e));

  // Macro variation: big soft light/warm patches.
  float m = (nMacro.b - 0.5) * 2.0;
  c *= 1.0 + m * uMacro;
  c.r += m * uMacro * 0.25;
  c.b -= m * uMacro * 0.25;

  // Dirt patches in the lowlands (AoE2-style brown grass patches).
  float dirt = smoothstep(0.52, 0.64, nMacro.r) * (1.0 - smoothstep(0.18, 0.34, e));
  c = mix(c, uDirt, dirt * 0.4);

  // Hillshade: light from the upper-left; one sample each side along the
  // light axis (0.75 tile) gives the slope toward the light.
  if (uHillshade > 0.0 && e > 0.02) {
    vec2 L = vec2(-0.7071, -0.7071) * 0.75;
    float hi = textureLod(uFields, (w + L) / uMapSize, 0.0).g;
    float lo = textureLod(uFields, (w - L) / uMapSize, 0.0).g;
    float shade = clamp(-(hi - lo) * 6.0, -1.0, 1.0);
    c *= 1.0 + shade * uHillshade;
  }

  // Micro grain, faded out when tiles are only a few pixels wide.
  c *= 1.0 + (nFine.a - 0.5) * 2.0 * uGrain * zf;
  return c;
}

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
  vec2 fields = coastFields(w);
  float d = coastWobble(coastDecode(fields.r), nFine);
  float t = uAnimate > 0.5 ? uTime : 0.0;
  float zf = smoothstep(uZoomFadeStart, uZoomFadeEnd, uZoom);
  bool landTexel = tex.a < 0.75;

  vec3 col = tex.rgb;
  // Low-frequency sample shared by water patches and land macro variation /
  // dirt patches (B = brightness, R = ~10 tile blobs).
  vec4 nMacro = texture(uNoise, w / 160.0 + vec2(0.31, 0.17));

  if (d >= 0.0) {
    // Turquoise shallows -> deep over 6 tiles; beyond that keep the
    // magnitude-based darkening baked into the colour texture.
    float depthT = smoothstep(0.0, 6.0, d);
    vec3 darken = landTexel ? vec3(0.0) : min(vec3(0.0), tex.rgb - uDeep);
    col = mix(uShallow, uDeep, depthT) + darken;

    // Large-scale colour patches (not zoom-gated).
    col *= 1.0 + (nMacro.b - 0.5) * 0.09;

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
    if (d > -1.6 || !landTexel) {
      // Beach bands: wet sand at the waterline, dry sand inland, blending
      // into the land colour. (A wobbled coast can pull land pixels over a
      // water texel; those are all sand.)
      vec3 sand = mix(uSand, uWetSand, smoothstep(-0.7, -0.05, d));
      sand *= 1.0 + (nFine.a - 0.5) * 2.0 * uGrain * zf;
      col = mix(sand, landColor(w, fields.g, nFine, nMacro, zf), smoothstep(-1.6, -1.0, d));
    } else {
      col = landColor(w, fields.g, nFine, nMacro, zf);
    }
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
