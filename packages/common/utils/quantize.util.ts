import { Quantize, QuantizeCycles } from "../constants/quantize.constant";

const Epsilon = 1e-6;

/**
 * Next quantize boundary at or after `cycle`, in cycles.
 * `lead` keeps a minimum distance so there is time to schedule audio.
 */
export const nextBoundary = (cycle: number, quantize: Quantize, lead = 0) => {
  const step = QuantizeCycles[quantize];
  if (!step) return cycle + lead;

  return Math.ceil((cycle + lead - Epsilon) / step) * step;
};

/** Position inside the current step, 0..1 */
export const phaseOf = (cycle: number, step: number) => {
  const phase = (cycle / step) % 1;
  return phase < 0 ? phase + 1 : phase;
};

export const bpmToCps = (bpm: number, beatsPerBar = 4) => bpm / 60 / beatsPerBar;
export const cpsToBpm = (cps: number, beatsPerBar = 4) => cps * 60 * beatsPerBar;

/** Seconds one bar lasts at `bpm` */
export const barSeconds = (bpm: number, beatsPerBar = 4) =>
  (60 / bpm) * beatsPerBar;

/**
 * Position (in bars, wrapped) a loop of `bars` length must be at
 * when the transport is at `cycle`, so every launch stays phase locked.
 */
export const loopPosition = (cycle: number, bars: number) => {
  const position = cycle % bars;
  return position < 0 ? position + bars : position;
};

/** Bpm from tap timestamps (ms), ignoring taps older than 2s gaps */
export const tapTempo = (taps: number[]) => {
  const recent: number[] = [];
  for (let i = taps.length - 1; i > 0; i--) {
    const gap = taps[i] - taps[i - 1];
    if (gap > 2000) break;
    recent.push(gap);
  }
  if (recent.length < 2) return undefined;

  const average = recent.reduce((sum, gap) => sum + gap, 0) / recent.length;
  return Math.round((60000 / average) * 10) / 10;
};
