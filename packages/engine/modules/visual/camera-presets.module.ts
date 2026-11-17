/**
 * Effects for camera() visuals: Shadertoy-style shaders that get the
 * webcam as iChannel0 and the music as uniforms (see glsl.module). The
 * picture is mirrored, like a selfie, and fills the screen.
 */

// shared by every effect: the camera at a screen position, and helpers
const Prelude = `
vec3 cam(vec2 uv) {
  vec2 size = max(iChannelResolution[0].xy, vec2(1.0));
  float screen = iResolution.x / iResolution.y;
  float image = size.x / size.y;
  vec2 cover = screen > image ? vec2(1.0, image / screen) : vec2(screen / image, 1.0);
  vec2 p = (uv - 0.5) * cover + 0.5;
  p.x = 1.0 - p.x;
  return texture(iChannel0, clamp(p, 0.0, 1.0)).rgb;
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash1(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// deck A's colour → a bright middle → deck B's, following the crossfader;
// mixed straight, the middle would be grey, so it is lifted back up
vec3 deckColor() {
  vec3 a = uDeckA;
  vec3 b = uDeckB;
  vec3 mid = (a + b) * 0.5;
  mid *= max(max(max(a.r, a.g), a.b), max(max(b.r, b.g), b.b)) / max(max(max(mid.r, mid.g), mid.b), 1e-3);
  return uXfade < 0.5 ? mix(a, mid, uXfade * 2.0) : mix(mid, b, uXfade * 2.0 - 1.0);
}
`;

const Effects: Record<string, { doc: string; code: string }> = {
  raw: {
    doc: "the camera as it is, a little punchier on the kick",
    code: `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec3 c = cam(fragCoord / iResolution.xy);
  c = (c - 0.5) * (1.1 + uKick * 0.3) + 0.5;
  fragColor = vec4(c, 1.0);
}`
  },
  matrix: {
    doc: "green digital rain, brighter where you are",
    code: `// matrix: glyphs raining down the columns, lit by the camera picture
const float COLUMNS = 90.0;
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 cell = vec2(COLUMNS, floor(COLUMNS * iResolution.y / iResolution.x * 1.4));
  vec2 id = floor(uv * cell);
  vec2 f = fract(uv * cell);
  float lum = luma(cam((id + 0.5) / cell));
  // each column falls at its own speed, a little faster on the kick
  float speed = 0.5 + hash1(id.x) * 1.2;
  float t = iTime * speed * (1.0 + uKick * 0.5) + hash1(id.x * 7.13) * 20.0;
  float head = fract(id.y / cell.y * 1.3 + t * 0.3);
  float trail = pow(head, 5.0);
  // a glyph: a 3 × 5 grid of blocks that changes now and then
  vec2 g = floor(f * vec2(3.0, 5.0));
  float glyph = step(0.42, hash2(id * 13.0 + g * 1.7 + floor(t * 4.0 + hash1(id.y) * 8.0)));
  float inside = step(0.12, f.x) * step(f.x, 0.88) * step(0.08, f.y) * step(f.y, 0.92);
  float on = glyph * inside;
  float bright = on * (0.08 + lum * 1.1) * (0.35 + trail * 1.6);
  vec3 color = vec3(0.1, 1.0, 0.35) * bright;
  color += vec3(0.75, 1.0, 0.85) * on * step(0.985, head) * (0.4 + lum);
  fragColor = vec4(color, 1.0);
}`
  },
  silhouette: {
    doc: "your shape against the light, filled with the deck colour (works best against a lighter background)",
    code: `// silhouette: the dark shape against a lighter background, glowing on the kick
// raise THRESHOLD in a bright room, set INVERT to 1 for a light figure on dark
const float THRESHOLD = 0.42;
const float INVERT = 0.0;
float shapeAt(vec2 uv) {
  float s = smoothstep(THRESHOLD + 0.05, THRESHOLD - 0.05, luma(cam(uv)));
  return mix(s, 1.0 - s, INVERT);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 px = 2.0 / iResolution.xy;
  float shape = shapeAt(uv);
  float edge = abs(shapeAt(uv + vec2(px.x, 0.0)) - shapeAt(uv - vec2(px.x, 0.0)))
             + abs(shapeAt(uv + vec2(0.0, px.y)) - shapeAt(uv - vec2(0.0, px.y)));
  // the figure in a gradient between the deck colours that rolls with the bar
  vec3 fill = mix(uDeckA, uDeckB, 0.5 + 0.5 * sin(uv.y * 3.0 + uBar * 1.57));
  vec3 color = fill * shape * (0.6 + uKick * 0.7);
  color += vec3(1.0) * min(1.0, edge) * (0.5 + uFft.z * 1.5);
  // behind: dim bands that roll with the beat
  color += (1.0 - shape) * vec3(0.05, 0.03, 0.09) * (1.0 + sin(uv.y * 40.0 - uBeat * 6.283));
  fragColor = vec4(color, 1.0);
}`
  },
  edges: {
    doc: "neon outlines of everything in the picture, pulsing with the music",
    code: `// edges: a Sobel filter turns outlines into neon, colours turning each bar
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 px = 1.5 / iResolution.xy;
  float tl = luma(cam(uv + px * vec2(-1, 1))), t = luma(cam(uv + px * vec2(0, 1))), tr = luma(cam(uv + px * vec2(1, 1)));
  float l = luma(cam(uv + px * vec2(-1, 0))), r = luma(cam(uv + px * vec2(1, 0)));
  float bl = luma(cam(uv + px * vec2(-1, -1))), b = luma(cam(uv + px * vec2(0, -1))), br = luma(cam(uv + px * vec2(1, -1)));
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
  float edge = smoothstep(0.12, 0.5, length(vec2(gx, gy)));
  vec3 tint = 0.5 + 0.5 * cos(6.283 * (uBar * 0.25 + uv.y * 0.3 + vec3(0.0, 0.33, 0.67)));
  vec3 color = tint * edge * (0.8 + uKick * 1.2);
  fragColor = vec4(color, 1.0);
}`
  },
  thermal: {
    doc: "a heat camera: dark purples to white hot",
    code: `// thermal: brightness through a heat palette, hotter on the kick
// (set INVERT to 1 when you are darker than the room behind you)
const float INVERT = 0.0;
vec3 heat(float x) {
  return clamp(vec3(1.5 * x - 0.2, 2.0 * x * x - 0.3, 0.6 * sin(x * 3.14159) + max(0.0, 3.0 * x - 2.4)), 0.0, 1.0);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float l = luma(cam(uv));
  l = mix(l, 1.0 - l, INVERT);
  l = clamp(l * (1.0 + uKick * 0.35) + uFft.x * 0.1, 0.0, 1.0);
  vec3 color = heat(l);
  color *= 0.9 + 0.1 * sin(fragCoord.y * 1.5);
  fragColor = vec4(color, 1.0);
}`
  },
  halftone: {
    doc: "a print of dots, bigger where it is bright, the grid turning with the bar",
    code: `// halftone: dots sized by brightness, on a grid that turns with the bar
const float CELL = 9.0;
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float angle = uBar * 0.15;
  mat2 turn = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 p = turn * (fragCoord - 0.5 * iResolution.xy);
  vec2 id = floor(p / CELL);
  vec2 centre = transpose(turn) * ((id + 0.5) * CELL) + 0.5 * iResolution.xy;
  float l = luma(cam(centre / iResolution.xy));
  float radius = CELL * 0.55 * sqrt(l) * (1.0 + uKick * 0.25);
  float ink = smoothstep(radius, radius - 1.2, length(p - (id + 0.5) * CELL));
  vec3 color = mix(vec3(0.02, 0.03, 0.05), deckColor(), ink);
  fragColor = vec4(color, 1.0);
}`
  },
  pixel: {
    doc: "big pixels in four shades of the deck colour; blocks grow on the kick",
    code: `// pixel: chunky blocks in four shades, bigger blocks on the kick
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float block = 10.0 + uKick * 14.0;
  vec2 cell = floor(fragCoord / block) * block + block * 0.5;
  float l = luma(cam(cell / iResolution.xy));
  float level = floor(l * 4.0) / 3.0;
  vec3 color = mix(vec3(0.03, 0.04, 0.06), deckColor(), level);
  vec2 f = fract(fragCoord / block);
  color *= step(0.08, f.x) * step(0.08, f.y) * 0.25 + 0.75;
  fragColor = vec4(color, 1.0);
}`
  },
  glitch: {
    doc: "torn, colour-split video that breaks up on the kick",
    code: `// glitch: the colour channels pull apart and lines tear on the kick
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float row = floor(uv.y * 40.0);
  float tear = step(0.92 - uKick * 0.25, hash2(vec2(row, floor(iTime * 12.0)))) * (hash1(row + iTime) - 0.5) * 0.12;
  uv.x += tear;
  float split = 0.004 + uKick * 0.02 + uFft.z * 0.01;
  vec3 color = vec3(cam(uv + vec2(split, 0.0)).r, cam(uv).g, cam(uv - vec2(split, 0.0)).b);
  color *= 0.85 + 0.15 * sin(fragCoord.y * 2.0);
  fragColor = vec4(color, 1.0);
}`
  }
};

export const CameraEffects = Object.keys(Effects);

export const cameraDoc = (name: string) => Effects[name]?.doc;

/** The shader of an effect, with the shared helpers in front */
export const cameraShader = (name: string) => {
  const effect = Effects[name];
  if (!effect) return undefined;
  return `${Prelude}\n${effect.code}`;
};
