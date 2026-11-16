import { Jukebox } from "@/common/schemas/jukebox.schema";
import { Pack } from "@/common/schemas/pack.schema";

import type { Voice } from "../voice/voice.module";

const Rate = 22050;

// work in slices this long, then let the browser breathe
const SliceMs = 6;
const Block = 32768;

/**
 * The song as one mono mix at 22.05 kHz starting on bar 0: every track
 * that follows the song position (stems and stem voices), summed. Built in
 * slices that yield, so a long song does not stall the deck.
 */
export const songMix = async (pack: Pack, voices: Voice[], bars: number) => {
  const bar = (60 / pack.bpm) * pack.timeSignature[0];
  const length = Math.round(bars * bar * Rate);
  const mix = new Float32Array(length);

  for (const voice of voices) {
    const data = voice.loaded.buffer.getChannelData(0);
    const sourceRate = voice.loaded.buffer.sampleRate;
    const ratio = sourceRate / Rate;
    const span = Math.max(1, Math.round(ratio));
    // file time of song time 0 for this track
    const zero = pack.gridOffset - voice.track.bar * bar;

    let slice = performance.now();
    for (let block = 0; block < length; block += Block) {
      const end = Math.min(length, block + Block);
      for (let n = block; n < end; n++) {
        const at = Math.floor((zero + n / Rate) * sourceRate);
        if (at < 0) continue;
        if (at + span > data.length) break;
        // average the samples this output sample covers
        let sum = 0;
        for (let k = 0; k < span; k++) sum += data[at + k];
        mix[n] += sum / span;
      }
      if (performance.now() - slice > SliceMs) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        slice = performance.now();
      }
    }
  }

  return { mix, sampleRate: Rate };
};

export type AnalysisResult = { jukebox: Jukebox; ms: { features: number; total: number } };

/** Analyses the song in a worker; the mix is moved, not copied */
export const analyseSong = async (
  pack: Pack,
  voices: Voice[],
  bars: number
): Promise<AnalysisResult> => {
  const { mix, sampleRate } = await songMix(pack, voices, bars);
  const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), {
    type: "module"
  });

  return new Promise((resolve, reject) => {
    worker.onmessage = (event) => {
      worker.terminate();
      if (event.data.ok) resolve({ jukebox: event.data.jukebox, ms: event.data.ms });
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "jukebox analysis failed"));
    };
    worker.postMessage(
      { mix, sampleRate, grid: { bpm: pack.bpm, beatsPerBar: pack.timeSignature[0], bars } },
      [mix.buffer]
    );
  });
};
