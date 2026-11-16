import { JukeUnit, JukeboxGraph } from "@/common/schemas/jukebox.schema";

import calculateNearestNeighbors from "./vendor/calculateNearestNeighbors.js";
import type { Segment, TrackAnalysis } from "./vendor/index";
import remixTrack from "./vendor/remixTrack.js";

/** Grid to build an analysis on: everything is on a constant tempo */
export type Grid = { bpm: number; beatsPerBar: number; bars: number };

/** Quanta in the shape of Spotify's audio analysis, on our grid */
export const gridQuanta = ({ bpm, beatsPerBar, bars }: Grid) => {
  const beat = 60 / bpm;
  const bar = beat * beatsPerBar;
  const make = (count: number, size: number) =>
    Array.from({ length: count }, (_, index) => ({
      start: index * size,
      duration: size,
      confidence: 1
    }));

  return {
    // 4-bar phrases as parents, so bars only link at the same phrase position
    sections: make(Math.ceil(bars / 4), bar * 4),
    bars: make(bars, bar),
    beats: make(bars * beatsPerBar, beat),
    tatums: make(bars * beatsPerBar * 2, beat / 2),
    beat,
    bar
  };
};

// same weights as the vendored distance
const segmentParts = (a: Segment, b: Segment) => {
  let timbre = 0;
  for (let i = 0; i < a.timbre.length; i++) timbre += (a.timbre[i] - b.timbre[i]) ** 2;
  let pitch = 0;
  for (let i = 0; i < a.pitches.length; i++) pitch += (a.pitches[i] - b.pitches[i]) ** 2;
  const rest =
    Math.sqrt(pitch) * 10 +
    Math.abs(a.loudness_start - b.loudness_start) +
    Math.abs(a.loudness_max - b.loudness_max) +
    Math.abs(a.duration - b.duration) * 100 +
    Math.abs(a.confidence - b.confidence);
  return { timbre: Math.sqrt(timbre), rest };
};

// a small deterministic random, so analysis is reproducible
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/**
 * Scales timbre so near neighbours land around `target`, the middle of the
 * 10–80 threshold sweep the algorithm was tuned for on Spotify's scale.
 */
export const calibrate = (analysis: TrackAnalysis, type: "bars" | "beats", target = 30) => {
  const quanta = analysis[type];
  const perQuantum = Math.max(1, Math.round(analysis.segments.length / Math.max(1, quanta.length)));
  const group = type === "bars" ? 4 : 4;
  const random = seeded(7);
  const samples: { timbre: number; rest: number }[][] = [];

  const segmentsOf = (index: number) =>
    analysis.segments.slice(index * perQuantum, (index + 1) * perQuantum);

  const count = quanta.length;
  for (let s = 0; s < Math.min(160, count); s++) {
    const a = Math.floor(random() * count);
    const candidates: { timbre: number; rest: number }[] = [];
    for (let c = 0; c < 48; c++) {
      let b = Math.floor(random() * count);
      // same position in the parent, like the algorithm requires
      b = b - (b % group) + (a % group);
      if (b === a || b >= count) continue;
      const sa = segmentsOf(a);
      const sb = segmentsOf(b);
      let timbre = 0;
      let rest = 0;
      for (let j = 0; j < Math.min(sa.length, sb.length); j++) {
        const part = segmentParts(sa[j], sb[j]);
        timbre += part.timbre;
        rest += part.rest;
      }
      const n = Math.max(1, Math.min(sa.length, sb.length));
      candidates.push({ timbre: timbre / n, rest: rest / n });
    }
    if (candidates.length) samples.push(candidates);
  }
  if (!samples.length) return 1;

  const medianNearest = (k: number) => {
    const mins = samples.map((candidates) =>
      Math.min(...candidates.map((item) => k * item.timbre + item.rest))
    );
    mins.sort((x, y) => x - y);
    return mins[Math.floor(mins.length / 2)];
  };

  // log-space search for the scale
  let low = 0.001;
  let high = 1000;
  for (let i = 0; i < 40; i++) {
    const mid = Math.sqrt(low * high);
    if (medianNearest(mid) > target) high = mid;
    else low = mid;
  }
  const k = Math.sqrt(low * high);

  for (const segment of analysis.segments) {
    segment.timbre = segment.timbre.map((value) => value * k);
  }
  return k;
};

/**
 * Runs the vendored infinite jukebox algorithm for one quantum size and
 * flattens the result into a small serialisable graph.
 */
export const buildGraph = (source: TrackAnalysis, unit: JukeUnit): JukeboxGraph => {
  const type = unit === "bar" ? "bars" : "beats";
  // the algorithm decorates objects with cycles; work on a copy
  const analysis: TrackAnalysis = structuredClone(source);
  calibrate(analysis, type);

  const track = { analysis };
  remixTrack(track);
  const { lastBranchPoint } = calculateNearestNeighbors(track, type);

  const quanta = analysis[type] as any[];
  const edges: [number, number, number][] = [];
  for (const quantum of quanta) {
    for (const neighbor of quantum.neighbors || []) {
      edges.push([quantum.which, neighbor.dest.which, Math.round(neighbor.distance * 10) / 10]);
    }
  }

  // loudness and a hue per quantum for drawing
  const loudness = quanta.map((quantum) => {
    const segments = (quantum.overlappingSegments || []) as Segment[];
    return segments.length ? Math.max(...segments.map((segment) => segment.loudness_max)) : -60;
  });
  // percentiles, so one silent intro bar does not flatten the rest
  const sorted = [...loudness].sort((a, b) => a - b);
  const minLoud = sorted[Math.floor(sorted.length * 0.05)] ?? -60;
  const maxLoud = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const hues = quanta.map((quantum) => {
    const segments = (quantum.overlappingSegments || []) as Segment[];
    if (!segments.length) return 0;
    const a = segments.reduce((sum, segment) => sum + (segment.timbre[1] || 0), 0) / segments.length;
    const b = segments.reduce((sum, segment) => sum + (segment.timbre[2] || 0), 0) / segments.length;
    return a + b * 0.5;
  });
  const minHue = Math.min(...hues);
  const maxHue = Math.max(...hues);

  return {
    count: quanta.length,
    lastBranchPoint,
    edges,
    loudness: loudness.map((value) => {
      const level = (value - minLoud) / Math.max(1e-6, maxLoud - minLoud);
      return Math.round((0.12 + 0.88 * Math.max(0, Math.min(1, level))) * 1000) / 1000;
    }),
    // spread across violet → blue → green, like the reference
    hue: hues.map((value) => Math.round(280 - ((value - minHue) / Math.max(1e-6, maxHue - minHue)) * 170))
  };
};
