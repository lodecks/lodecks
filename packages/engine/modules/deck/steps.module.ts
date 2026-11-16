/**
 * The song as a grid of 16th notes: how loud each layer (drums, bass,
 * other, vocals) is on every step. What the inline deck views draw: dots,
 * falling bars, barcodes, stairs… Computed once per pack, sparsely sampled.
 */
import { Pack } from "@/common/schemas/pack.schema";

import { layerOf } from "../automix/profile.module";
import type { Voice } from "../voice/voice.module";

export const StepsPerBar = 16;
const Order = ["drums", "bass", "other", "vocals"] as const;
export type StepLayer = (typeof Order)[number];

export type Steps = {
  bars: number;
  // one row per layer present, in a fixed order, 0…1 per step:
  // `values` how loud it is, `hits` how much it rises (its rhythm)
  rows: { layer: StepLayer; values: Float32Array; hits: Float32Array }[];
  // all layers together, 0…1 per step
  energy: Float32Array;
};

/** Scales so the loudest steps (95th percentile) reach 1 */
const normalise = (values: Float32Array) => {
  const sorted = Float32Array.from(values).sort();
  const top = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const out = new Float32Array(values.length);
  if (top > 1e-5) for (let i = 0; i < values.length; i++) out[i] = Math.min(1, values[i] / top);
  return out;
};

export const buildSteps = (pack: Pack, followers: Voice[], bars: number): Steps => {
  const bar = (60 / pack.bpm) * pack.timeSignature[0];
  const step = bar / StepsPerBar;
  const count = bars * StepsPerBar;
  const layers = new Map<StepLayer, Float32Array>();

  for (const voice of followers) {
    const layer = layerOf(voice);
    const values = layers.get(layer) ?? new Float32Array(count);
    layers.set(layer, values);
    const data = voice.loaded.buffer.getChannelData(0);
    const rate = voice.loaded.buffer.sampleRate;
    const zero = pack.gridOffset - voice.track.bar * bar;
    const stride = 11;
    for (let index = 0; index < count; index++) {
      const start = Math.max(0, Math.floor((zero + index * step) * rate));
      const end = Math.min(data.length, Math.floor((zero + (index + 1) * step) * rate));
      if (end <= start) continue;
      let sum = 0;
      let samples = 0;
      for (let i = start; i < end; i += stride) {
        sum += data[i] * data[i];
        samples++;
      }
      // two stems of one layer: the louder one counts
      values[index] = Math.max(values[index], Math.sqrt(sum / samples) * voice.track.gain);
    }
  }

  const rows = Order.filter((layer) => layers.has(layer)).map((layer) => {
    const values = normalise(layers.get(layer)!);
    // an attack is a step louder than the one before it: drums hit on
    // every beat, a held pad only where a new chord comes in
    const rise = new Float32Array(count);
    for (let i = 0; i < count; i++) rise[i] = Math.max(0, values[i] - values[(i - 1 + count) % count]);
    // scaled by the real attacks only: steps that do not rise do not count
    const attacks = rise.filter((value) => value > 1e-3).sort();
    const top = attacks[Math.floor(attacks.length * 0.9)] || 1;
    const hits = rise.map((value) => Math.min(1, value / top));
    return { layer, values, hits };
  });
  const energy = new Float32Array(count);
  for (const row of rows) for (let i = 0; i < count; i++) energy[i] += row.values[i] / rows.length;
  return { bars, rows, energy };
};
