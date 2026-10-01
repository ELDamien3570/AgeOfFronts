// Shared coastline helper. Included (via `// #include coast`) by BOTH the
// terrain and territory fragment shaders so territory clipping follows the
// exact coastline the terrain draws. Do not fork this logic.
//
// Declares its own inputs; including shaders must not redeclare them.
//   uFields  RG8 LINEAR: R = signed coast distance (tiles), G = elevation
//   uNoise   RGBA8 REPEAT tileable noise
//   uMapSize map size in tiles

uniform sampler2D uFields;
uniform sampler2D uNoise;
uniform vec2 uMapSize;

// Tile period of the fine noise sample shared by coast wobble, land grain and
// dirt patches (R = wobble, B = dirt, A = grain).
const float COAST_NOISE_PERIOD = 32.0;

vec4 coastNoise(vec2 worldTile) {
  return texture(uNoise, worldTile / COAST_NOISE_PERIOD);
}

float coastRawDistance(vec2 worldTile) {
  return texture(uFields, worldTile / uMapSize).r * 16.0 - 8.0;
}

// Signed coast distance in tiles (negative = land, positive = water) with a
// noise wobble so the shoreline is organic instead of a smooth iso-curve.
// `nFine` is coastNoise(worldTile), passed in so callers that already fetched
// it do not pay for a second sample.
float coastWobble(float rawDistance, vec4 nFine) {
  float fade = 1.0 - smoothstep(2.0, 3.5, abs(rawDistance));
  return rawDistance + (nFine.r - 0.5) * 0.8 * fade;
}

float coastDistance(vec2 worldTile) {
  return coastWobble(coastRawDistance(worldTile), coastNoise(worldTile));
}
