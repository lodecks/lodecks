/**
 * Built-in GLSL effects, Shadertoy style (see glsl.module for the
 * uniforms). Loading one puts its code in the code tab; saving an edit
 * makes the user's own copy.
 */
import { DefaultFit, GifFit, GifFits } from "./gif.module";
import type { Effect } from "./library.module";

type ShaderPreset = Pick<Effect, "id" | "name" | "description" | "code">;

/**
 * Used by every gif effect: the gif, fitted, flashing on the kick.
 * `fit` sets FIT in the code, which can be changed there afterwards.
 */
export const gifShader = (fit: GifFit = DefaultFit) => `// gif — the gif fills the screen, zooms and flashes on the kick,
// tinted by the deck the crossfader leans to
const int FIT = ${GifFits.indexOf(fit)};     // 0 cover, 1 contain, 2 fill
const float FLASH = 0.35;  // flash on the kick
const float ZOOM = 0.05;   // zoom on the kick
const float TINT = 0.2;    // deck colour

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 size = max(iChannelResolution[0].xy, vec2(1.0));
  float screen = iResolution.x / iResolution.y;
  float image = size.x / size.y;
  vec2 cover = screen > image ? vec2(1.0, image / screen) : vec2(screen / image, 1.0);
  vec2 contain = screen > image ? vec2(screen / image, 1.0) : vec2(1.0, image / screen);
  vec2 scale = FIT == 0 ? cover : FIT == 1 ? contain : vec2(1.0);
  vec2 p = (uv - 0.5) * scale / (1.0 + uKick * ZOOM) + 0.5;

  vec3 color = texture(iChannel0, p).rgb;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) color = vec3(0.0);

  vec3 deck = mix(uDeckA, uDeckB, uXfade);
  color = mix(color, color * deck * 1.6, TINT);
  color += deck * uKick * FLASH * 0.5;
  fragColor = vec4(color, 1.0);
}
`;

export const GifTemplate = gifShader();

/** The fit a gif shader's code asks for (old ones had COVER 1 / 0) */
export const fitOfCode = (code: string): GifFit | undefined => {
  const fit = /const\s+int\s+FIT\s*=\s*(\d)/.exec(code);
  if (fit) return GifFits[Number(fit[1])];
  const cover = /const\s+float\s+COVER\s*=\s*([\d.]+)/.exec(code);
  if (cover) return Number(cover[1]) >= 0.5 ? "cover" : "contain";
  return undefined;
};

/** The code with its fit changed, or undefined when it has no FIT line */
export const withFit = (code: string, fit: GifFit) => {
  const index = GifFits.indexOf(fit);
  if (/const\s+int\s+FIT\s*=\s*\d/.test(code)) return code.replace(/(const\s+int\s+FIT\s*=\s*)\d/, `$1${index}`);
  // the gif shader from before FIT: swapped for the current one
  if (/^\/\/ gif —/.test(code) && /const\s+float\s+COVER/.test(code)) return gifShader(fit);
  return undefined;
};

export const ShaderTemplate = `// new shader — Shadertoy style: write mainImage, Ctrl+Enter runs it
// iChannel0 is the gif, iChannel1 the previous frame
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 color = 0.5 + 0.5 * cos(iTime + uv.xyx * 3.0 + vec3(0.0, 2.0, 4.0));
  color *= 0.6 + uKick * 0.6;
  fragColor = vec4(color, 1.0);
}
`;

export const HydraTemplate = `// new hydra effect — Ctrl+Enter runs it
// gif() is the gif, fft(0–3) kick() beat() bar() xfade() the music
osc(10, 0.05, () => 0.4 + fft(1))
  .modulate(noise(2), () => kick() * 0.3)
  .out()`;

export const ShaderPresets: ShaderPreset[] = [
  {
    id: "glsl-tunnel",
    name: "tunnel",
    description: "neon rings rushing in, one per beat, in the colours of the decks playing",
    code: `// tunnel — neon rings rushing in, one ring per beat, in the colours of
// the decks that play, each deck in its own colour. With both playing each
// ring takes its own shade between them, centred on the crossfader, so
// the colours mix through the tunnel and fade over to the next deck.
// the deck colours from the settings
#define DECK_A uDeckA
#define DECK_B uDeckB
const vec3 GLOW = vec3(0.6, 0.4, 1.0);

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  float r = max(length(p), 1e-3);
  float angle = atan(p.y, p.x);
  // depth into the tunnel, moving one ring per beat
  float z = 0.35 / r;
  float beats = uBar * 4.0 + iTime * 0.1;
  float depth = z - beats;
  float ring = pow(1.0 - abs(fract(depth) * 2.0 - 1.0), 14.0);
  float spokes = pow(abs(sin(angle * 6.0 + z * 0.4 + beats * 0.25)), 30.0);

  // which decks are heard: 0 all A, 1 all B, the crossfader when both are
  float a = smoothstep(0.004, 0.04, uLevelA);
  float b = smoothstep(0.004, 0.04, uLevelB);
  float heard = a + b;
  float toward = heard < 0.01 ? uXfade : mix(b / heard, uXfade, a * b);
  // each ring its own shade when both are heard, so the two colours mix;
  // most in the middle of the crossfader, none at its ends
  float spread = a * b * 0.7 * (1.0 - abs(toward * 2.0 - 1.0));
  float shade = clamp(toward + (hash(floor(depth)) - 0.5) * spread, 0.0, 1.0);
  vec3 tint = mix(DECK_A, DECK_B, shade);

  float fade = smoothstep(0.0, 0.5, r);
  // each ring in its own shade, the spokes in the mix of what plays
  vec3 color = (ring * (0.6 + uKick * 1.2) * tint + spokes * (0.15 + uFft.z * 1.5) * mix(DECK_A, DECK_B, toward)) * fade;
  color += GLOW * 0.12 * (0.3 + uFft.x) / (r + 0.25);
  fragColor = vec4(color, 1.0);
}
`
  },
  {
    id: "glsl-cyberwave",
    name: "cyberwave",
    description: "a neon wireframe landscape rolling in; the bass lifts the hills, the kick flashes the lines",
    code: `// cyberwave — a neon wireframe landscape rolling towards you, two grid
// cells a bar. The bass lifts the hills, the kick flashes the lines, and
// the colours run cyan → blue → violet → magenta → amber across it.
const float CELL = 3.2;     // grid cells per unit
const float SPEED = 2.0;    // cells it rolls in per bar
const float HILLS = 0.75;   // how tall the hills are
const float FOG = 0.06;     // how fast the far grid fades out

float height(vec2 p) {
  float t = uBar * 0.35;
  float h = sin(p.x * 0.42 + t) * cos(p.y * 0.31 - t * 0.6) * 0.65;
  h += sin(p.x * 1.05 - p.y * 0.73 + t * 1.4) * 0.28;
  h += sin(p.x * 0.8 + p.y * 0.55 + t * 0.8) * 0.35;
  h += cos(p.x * 2.2 + p.y * 1.6 - t) * 0.07;
  // a peak in the middle, far away, breathing with the bass
  vec2 peak = p - vec2(0.0, uBar * SPEED / CELL + 20.0);
  h += 2.2 * exp(-dot(peak, peak) * 0.045) * (0.8 + uFft.x * 0.8);
  // flat right under the camera, rising into the distance
  float near = smoothstep(1.0, 7.0, p.y - uBar * SPEED / CELL);
  return h * HILLS * (0.55 + uFft.x * 1.1) * near;
}

vec3 palette(float x) {
  vec3 cyan = vec3(0.1, 0.95, 1.0);
  vec3 blue = vec3(0.25, 0.4, 1.0);
  vec3 violet = vec3(0.55, 0.2, 1.0);
  vec3 magenta = vec3(1.0, 0.22, 0.85);
  vec3 amber = vec3(1.0, 0.62, 0.12);
  x = clamp(x, 0.0, 1.0) * 4.0;
  if (x < 1.0) return mix(cyan, blue, x);
  if (x < 2.0) return mix(blue, violet, x - 1.0);
  if (x < 3.0) return mix(violet, magenta, x - 2.0);
  return mix(magenta, amber, x - 3.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  float travel = uBar * SPEED / CELL;
  vec3 ro = vec3(0.0, 2.1, travel);
  vec3 rd = normalize(vec3(uv.x, uv.y - 0.3, 1.25));

  // march to the landscape, then refine the hit
  float t = 0.4;
  float hit = -1.0;
  for (int i = 0; i < 90; i++) {
    vec3 p = ro + rd * t;
    float d = p.y - height(p.xz);
    if (d < 0.0) {
      float lo = t - max(0.05, t * 0.035);
      float hi = t;
      for (int j = 0; j < 6; j++) {
        float mid = 0.5 * (lo + hi);
        vec3 q = ro + rd * mid;
        if (q.y - height(q.xz) < 0.0) hi = mid; else lo = mid;
      }
      hit = hi;
      break;
    }
    t += max(0.05, d * 0.45 + t * 0.012);
    if (t > 45.0) break;
  }

  vec3 color = vec3(0.0);
  // a faint glow along the horizon
  color += palette(fragCoord.x / iResolution.x) * 0.06 * exp(-abs(uv.y - 0.02) * 9.0);

  if (hit > 0.0) {
    vec3 p = ro + rd * hit;
    vec2 g = p.xz * CELL;
    // capped: across a ridge the jump would smear the lines into dashes
    vec2 w = min(fwidth(g), vec2(0.35));
    vec2 d = abs(fract(g - 0.5) - 0.5) / max(w, 1e-4);
    float line = 1.0 - min(min(d.x, d.y), 1.0);
    // far away the cells get smaller than a pixel: let the lines go there
    line *= smoothstep(0.35, 0.12, max(w.x, w.y));
    // a soft halo around every line
    vec2 f = abs(fract(g - 0.5) - 0.5);
    float halo = exp(-min(f.x, f.y) * 9.0) * 0.45;

    float fade = exp(-hit * FOG);
    float lift = clamp(p.y * 0.45 + 0.3, 0.0, 1.0);
    vec3 tint = palette(fragCoord.x / iResolution.x + p.y * 0.08);
    float flash = 0.75 + uKick * 0.9;
    color += tint * (line * 1.8 + halo) * fade * flash * (0.7 + lift * 0.8);
    // the surface itself, barely there, so the hills read as solid
    color += tint * 0.035 * fade * lift;
  }

  // glow: brighter lines bleed a little
  color = 1.0 - exp(-color * 2.0);
  fragColor = vec4(color, 1.0);
}
`
  },
  {
    id: "glsl-portal",
    name: "portal",
    description: "the lodecks frame as a neon tunnel, a frame per beat, equalizers on the walls",
    code: `// portal — the lodecks frame repeated into a neon tunnel, a new frame
// rushing in on every beat. Cyan on the left, violet on top, magenta on
// the right, amber below; the floor reflects it, the walls carry
// equalizers of the four bands, pixels float by, the kick flashes it.
const int FRAMES = 14;
const float SPACING = 0.55;  // depth between frames
const float GLOW = 1.0;

// the frame: the stepped outline of the lodecks mark
const int N = 13;
const vec2 SHAPE[13] = vec2[13](
  vec2(-0.55, 0.45), vec2(-0.38, 0.45), vec2(-0.25, 0.62), vec2(0.30, 0.62),
  vec2(0.30, 0.45), vec2(0.48, 0.45), vec2(0.48, 0.25), vec2(0.60, 0.25),
  vec2(0.60, -0.30), vec2(0.42, -0.30), vec2(0.42, -0.42), vec2(0.28, -0.55),
  vec2(-0.55, -0.55)
);

// distance to the outline (Inigo Quilez's polygon distance)
float outline(vec2 p) {
  float d = dot(p - SHAPE[0], p - SHAPE[0]);
  for (int i = 0, j = N - 1; i < N; j = i, i++) {
    vec2 e = SHAPE[j] - SHAPE[i];
    vec2 w = p - SHAPE[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
  }
  return sqrt(d);
}

vec3 palette(vec2 q) {
  vec3 cyan = vec3(0.1, 0.9, 1.0);
  vec3 violet = vec3(0.55, 0.25, 1.0);
  vec3 magenta = vec3(1.0, 0.25, 0.9);
  vec3 amber = vec3(1.0, 0.6, 0.12);
  vec3 c = mix(cyan, magenta, smoothstep(-0.5, 0.5, q.x));
  c = mix(c, violet, smoothstep(0.1, 0.6, q.y) * 0.7);
  c = mix(c, amber, smoothstep(0.0, 0.6, q.x - q.y - 0.4));
  return c;
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 frames(vec2 uv) {
  vec3 color = vec3(0.0);
  float travel = fract(uBar * 4.0) ;
  for (int k = 0; k < FRAMES; k++) {
    float z = (float(k) + 1.0 - travel) * SPACING;
    float scale = 0.4 / z;
    vec2 q = uv / scale;
    float d = outline(q) * scale;
    // frames come out of the dark and are gone just before they reach you
    float near = smoothstep(0.35, 1.1, z);
    float far = exp(-z * 0.3);
    float line = exp(-d * 220.0) * 1.6 + exp(-d * 35.0) * 0.4;
    color += palette(q) * line * near * far * GLOW * (0.8 + uKick * 1.2);
  }
  return color;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  vec3 color = vec3(0.0);

  // the corridor: light streaks running out from the middle
  float angle = atan(uv.y, uv.x);
  float r = length(uv);
  float streaks = pow(abs(sin(angle * 9.0 + 0.4)), 60.0) + pow(abs(sin(angle * 5.0 + 1.3)), 90.0);
  color += palette(uv * 1.2) * streaks * smoothstep(0.35, 0.9, r) * (0.18 + uFft.z * 0.6);

  // equalizers on the side walls, in perspective
  float side = abs(uv.x);
  if (side > 0.62) {
    float depth = 0.45 / side;
    float slot = floor(depth * 26.0 + uBar * 4.0);
    float band = mod(slot, 4.0);
    float level = band < 1.0 ? uFft.x : band < 2.0 ? uFft.y : band < 3.0 ? uFft.z : uFft.w;
    float height = (0.15 + level * 0.9 + hash(vec2(slot, 1.0)) * 0.15) * (1.0 / depth) * 0.22;
    float column = step(0.78, fract(depth * 26.0 + uBar * 4.0));
    float bar = column * step(-0.2 / depth * 0.3, uv.y) * step(uv.y, height - 0.05);
    vec3 tint = uv.x < 0.0 ? vec3(0.15, 0.75, 1.0) : vec3(1.0, 0.3, 0.85);
    color += tint * bar * 0.35 * smoothstep(0.62, 0.9, side);
  }

  // the frames, and their reflection on the floor
  color += frames(uv);
  if (uv.y < -0.32) {
    vec2 mirror = vec2(uv.x, -0.64 - uv.y);
    color += frames(mirror) * 0.22 * smoothstep(-0.32, -0.5, uv.y);
    // floor lines rushing towards you
    float floorZ = 0.3 / max(-uv.y - 0.3, 0.01);
    float lines = pow(abs(sin((floorZ - uBar * 4.0) * 3.14159)), 40.0);
    color += palette(vec2(uv.x * 2.0, -0.5)) * lines * 0.12 * smoothstep(-0.32, -0.6, uv.y);
  }

  // pixels floating by
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 at = vec2(hash(vec2(fi, 3.0)) - 0.5, hash(vec2(fi, 7.0)) - 0.5) * vec2(1.5, 0.9);
    at += 0.03 * vec2(sin(iTime * 0.7 + fi), cos(iTime * 0.5 + fi * 2.0));
    vec2 cell = abs(uv - at);
    float px = step(max(cell.x, cell.y), 0.012 + 0.006 * uKick);
    color += palette(at * 1.5) * px * 0.9;
  }

  color = 1.0 - exp(-color * 1.4);
  fragColor = vec4(color, 1.0);
}
`
  },
  {
    id: "glsl-plasma",
    name: "plasma",
    description: "sine plasma, each band of the music bends one layer",
    code: `// plasma — sine plasma, each band of the music bends one layer
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y * 3.0;
  float t = iTime * 0.3 + uBar * 0.5;
  float v = sin(p.x * (1.0 + uFft.x * 2.0) + t);
  v += sin((p.y + t) * (1.0 + uFft.y * 2.0));
  v += sin(length(p + vec2(sin(t), cos(t))) * (2.0 + uFft.z * 4.0));
  v += sin(length(p) * 3.0 - t * 2.0 + uFft.w * 6.0);

  vec3 color = 0.5 + 0.5 * cos(3.14159 * v + vec3(0.0, 2.1, 4.2) + uXfade * 2.0);
  color *= 0.55 + uKick * 0.6;
  // scanlines
  color *= 0.85 + 0.15 * sin(fragCoord.y * 3.14159);
  fragColor = vec4(color, 1.0);
}
`
  }
];
