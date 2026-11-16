/**
 * Hydra presets. Each one is plain hydra code with the music helpers in
 * scope: fft(0–3) bands, kick() 1 on a kick then decaying, beat() 0..1
 * across a beat, bar() the running bar count, xfade(), deck.a.level().
 * Loading a preset puts its code in the visuals tab, so it can be edited.
 */
export type VisualPreset = {
  id: string;
  name: string;
  description: string;
  code: string;
};

export const VisualPresets: VisualPreset[] = [
  {
    id: "cyberpunk",
    name: "cyberpunk",
    description: "neon city glitch: rgb split, scanlines, pixel bursts on the kick",
    code: `// cyberpunk — a wall of lit windows in the rain, glitching on the kick
// hydra chains change when you call them, so pieces are functions
const windows = () => shape(4, 0.62, 0)
  .repeat(40, 26)
  // which windows are lit follows the mids
  .mult(noise(26, 0.03).thresh(() => 0.48 - fft(1) * 0.3, 0.02))

// street glow rising from the bottom (hydra's y runs downwards)
const haze = () => gradient(0).g().color(0.55, 0.05, 0.6)

const rain = () => osc(260, 0, 0).thresh(0.97, 0)
  .mult(noise(3, 0.4).thresh(0.5, 0.2))
  .scrollY(() => -bar() * 1.5)

// magenta and cyan copies pulled apart on hits: the rgb split
windows().color(0.85, 0, 0.6)
  .add(windows().scrollX(() => 0.004 + kick() * 0.025).color(0, 0.65, 0.9), 0.75)
  .add(rain().color(0.3, 0.7, 1), 0.3)
  .add(haze(), () => 0.35 + fft(0) * 0.3)
  // scanlines
  .mult(osc(280, 0, 0).rotate(Math.PI / 2).thresh(0.25, 0.3).add(solid(0.55, 0.55, 0.55)))
  // slices jump sideways and the picture crunches on strong hits
  .scrollX(() => kick() > 0.75 ? Math.random() * 0.04 - 0.02 : 0)
  .pixelate(() => kick() > 0.75 ? 90 : 420, () => kick() > 0.75 ? 60 : 280)
  .blend(o0, 0.3)
  .add(solid(0.03, 0, 0.06, 1))
  .out()`
  },
  {
    id: "vhs",
    name: "vhs tape",
    description: "worn 80s tape: chroma bleed, tracking bar, tape noise",
    code: `// vhs tape — warm colours bleeding, a tracking bar rolling once a bar
const picture = () => osc(6, 0.05, 1.2)
  .kaleid(4)
  .rotate(() => bar() * 0.05)
  .color(1, 0.6, 0.5)
  .modulate(noise(2, 0.1), () => 0.1 + fft(0) * 0.2)

picture()
  // chroma bleed: the red runs to the right
  .add(picture().scrollX(0.015).color(0.7, 0, 0), 0.5)
  // tape noise
  .add(noise(400, 1).thresh(0.6).color(1, 1, 1), 0.08)
  // tracking bar rolls down once a bar
  .add(shape(4, 0.05, 0.6).scale(1, 30, 1).scrollY(() => bar() % 1).color(1, 1, 1), 0.3)
  .modulate(osc(200, 0.5).rotate(Math.PI / 2), () => 0.002 + kick() * 0.008)
  .saturate(0.75)
  .posterize(14, 0.8)
  .out()`
  },
  {
    id: "outrun",
    name: "outrun tunnel",
    description: "neon frames rushing at you, a new one every beat",
    code: `// outrun tunnel — neon frames rushing toward you, one more every beat
// each frame doubles-and-a-bit in size per beat, so they hand over seamlessly
const size = (i) => () => 0.05 * Math.pow(2.3, i + (bar() * 4) % 1)
// a frame keeps its colour on the way out: pink and cyan by birth beat
const pink = (i) => () => (Math.floor(bar() * 4) - i) % 2 === 0
const frame = (i) => shape(4, size(i), 0.006)
  .diff(shape(4, () => size(i)() * 0.93, 0.006))
  .scale(1, () => aspect(), 1)
  .color(() => (pink(i)() ? 1 : 0.05), () => (pink(i)() ? 0.1 : 0.9), 1)

frame(0)
  .add(frame(1), 1)
  .add(frame(2), 1)
  .add(frame(3), 1)
  .add(frame(4), 1)
  // a dark centre so the far frames read as distance
  .mult(shape(4, 0.5, 0.6).scale(1, () => aspect(), 1).invert().add(solid(0.35, 0.35, 0.35)))
  .rotate(() => Math.sin(bar() * 0.5) * 0.08)
  .brightness(() => kick() * 0.15)
  .add(solid(0.03, 0, 0.06, 1))
  .out()`
  },
  {
    id: "terminal",
    name: "terminal",
    description: "green phosphor rain to match the deck",
    code: `// terminal — green phosphor columns falling with the hats
noise(30, 0.1)
  .thresh(0.6, 0.1)
  .repeat(1, 40)
  .scrollY(() => bar() * 0.5, 0)
  .modulateScrollY(osc(40, 0, 0).thresh(0.5), () => 0.2 + fft(3) * 0.5)
  .pixelate(80, 60)
  .color(0.2, 1, 0.5)
  .add(src(o0).scrollY(0.005).color(0.6, 0.9, 0.7), 0.85)
  .brightness(() => kick() * 0.1)
  .out()`
  }
];

export const DefaultPreset = VisualPresets[0];

export const findPreset = (id: string) =>
  VisualPresets.find((preset) => preset.id === id);
