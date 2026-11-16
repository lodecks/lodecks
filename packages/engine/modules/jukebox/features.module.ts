import Meyda from "meyda";

import type { Segment, TrackAnalysis } from "./vendor/index";
import { Grid, gridQuanta } from "./graph.module";

const FrameSize = 1024;

const decibels = (rms: number) => 20 * Math.log10(rms + 1e-6);

/**
 * Builds an analysis in the shape of Spotify's from a mono mix starting on
 * bar 0: grid quanta, and per 8th-note segment a timbre (12 MFCC), pitches
 * (12 chroma, max 1), loudness in dB and an attack confidence.
 */
export const analyseMix = (mix: Float32Array, sampleRate: number, grid: Grid): TrackAnalysis => {
  const quanta = gridQuanta(grid);
  Meyda.bufferSize = FrameSize;
  Meyda.sampleRate = sampleRate;
  Meyda.numberOfMFCCCoefficients = 13;

  const frame = new Float32Array(FrameSize);
  const read = (start: number) => {
    frame.fill(0);
    if (start < mix.length) frame.set(mix.subarray(start, Math.min(mix.length, start + FrameSize)));
    return frame;
  };

  let previousRms = 0;
  const segments: Segment[] = quanta.tatums.map((tatum) => {
    const start = Math.round(tatum.start * sampleRate);
    const length = Math.round(tatum.duration * sampleRate);
    const offsets = [0, Math.floor(length / 3), Math.floor((length * 2) / 3)].filter(
      (offset) => offset + FrameSize <= length || offset === 0
    );

    const timbre = new Array(12).fill(0);
    const pitches = new Array(12).fill(0);
    let first = 0;
    let loudest = 0;

    for (const [index, offset] of offsets.entries()) {
      const features = Meyda.extract(["mfcc", "chroma", "rms"], read(start + offset)) as {
        mfcc: number[];
        chroma: number[];
        rms: number;
      } | null;
      if (!features) continue;
      for (let d = 0; d < 12; d++) {
        timbre[d] += (features.mfcc?.[d] || 0) / offsets.length;
        pitches[d] += (Number.isFinite(features.chroma?.[d]) ? features.chroma[d] : 0) / offsets.length;
      }
      if (index === 0) first = features.rms;
      loudest = Math.max(loudest, features.rms);
    }

    const peak = Math.max(...pitches);
    const attack = Math.max(0, Math.min(1, (first - previousRms) / (first + 1e-6)));
    previousRms = loudest;

    return {
      start: tatum.start,
      duration: tatum.duration,
      confidence: attack,
      timbre,
      pitches: peak > 0 ? pitches.map((value) => value / peak) : pitches,
      loudness_start: decibels(first),
      loudness_max: decibels(loudest)
    };
  });

  return {
    sections: quanta.sections,
    bars: quanta.bars,
    beats: quanta.beats,
    tatums: quanta.tatums,
    segments
  };
};
