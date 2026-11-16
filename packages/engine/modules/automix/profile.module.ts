import { Pack } from "@/common/schemas/pack.schema";

import type { Voice } from "../voice/voice.module";
import { Profile } from "./planner.module";

type Layer = "vocals" | "drums" | "bass" | "other";

/** Which layer a stem is, from its id and name */
export const layerOf = (voice: Voice): Layer => {
  const label = `${voice.track.id} ${voice.track.name}`.toLowerCase();
  if (/vocal|vox|voice|acapella|sing/.test(label)) return "vocals";
  if (/drum|perc|beat|kick/.test(label)) return "drums";
  if (/bass|sub/.test(label)) return "bass";
  return "other";
};

const normalise = (values: Float32Array) => {
  const sorted = [...values].sort((a, b) => a - b);
  const top = sorted[Math.floor(sorted.length * 0.95)] || 0;
  return Array.from(values, (value) => (top > 1e-5 ? Math.min(1, value / top) : 0));
};

/**
 * Per bar level of each layer of the song, from the tracks that follow
 * the song position. Sampled sparsely: this runs on the main thread.
 */
export const buildProfile = (pack: Pack, followers: Voice[], bars: number): Profile => {
  const bar = (60 / pack.bpm) * pack.timeSignature[0];
  const layers: Record<Layer, Float32Array> = {
    vocals: new Float32Array(bars),
    drums: new Float32Array(bars),
    bass: new Float32Array(bars),
    other: new Float32Array(bars)
  };
  const present = new Set<Layer>();

  for (const voice of followers) {
    const layer = layerOf(voice);
    present.add(layer);
    const data = voice.loaded.buffer.getChannelData(0);
    const rate = voice.loaded.buffer.sampleRate;
    const zero = pack.gridOffset - voice.track.bar * bar;
    const stride = 37;

    for (let index = 0; index < bars; index++) {
      const start = Math.max(0, Math.floor((zero + index * bar) * rate));
      const end = Math.min(data.length, Math.floor((zero + (index + 1) * bar) * rate));
      if (end <= start) continue;
      let sum = 0;
      let count = 0;
      for (let i = start; i < end; i += stride) {
        sum += data[i] * data[i];
        count++;
      }
      const level = Math.sqrt(sum / count) * voice.track.gain;
      // two stems of one layer: the louder one counts
      layers[layer][index] = Math.max(layers[layer][index], level);
    }
  }

  const vocals = normalise(layers.vocals);
  const drums = normalise(layers.drums);
  const bass = normalise(layers.bass);
  const other = normalise(layers.other);
  const used = [...present].length || 1;
  const energy = Array.from({ length: bars }, (_, index) =>
    (vocals[index] + drums[index] + bass[index] + other[index]) / used
  );

  return { bars, vocals, drums, bass, energy, sections: pack.sections };
};
