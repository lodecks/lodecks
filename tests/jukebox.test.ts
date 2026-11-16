import { describe, expect, test } from "bun:test";

import { buildGraph, gridQuanta } from "@/engine/modules/jukebox/graph.module";
import type { TrackAnalysis } from "@/engine/modules/jukebox/vendor/index";
import { JukeboxWalker } from "@/engine/modules/jukebox/walker.module";

// a song of 32 bars: phrase X (bars 0–3) comes back at 8–11 and 24–27,
// everything else is different material
const song = (): TrackAnalysis => {
  const grid = gridQuanta({ bpm: 120, beatsPerBar: 4, bars: 32 });
  const tatum = grid.beat / 2;
  const segments = grid.tatums.map((tatum0, index) => {
    const bar = Math.floor(index / 8);
    const inPhrase = bar % 4;
    const repeated = bar < 4 || (bar >= 8 && bar < 12) || (bar >= 24 && bar < 28);
    // repeats share a fingerprint; other bars get their own
    const id = repeated ? 1000 + inPhrase * 8 + (index % 8) : index;
    const timbre = Array.from({ length: 12 }, (_, d) => Math.sin(id * 1.7 + d * 2.3) * 40);
    const pitches = Array.from({ length: 12 }, (_, d) => (Math.cos(id * 0.9 + d) + 1) / 2);
    return {
      start: tatum0.start,
      duration: tatum,
      confidence: 0.5,
      timbre,
      pitches,
      loudness_start: -20,
      loudness_max: -10
    };
  });
  return {
    sections: grid.sections,
    bars: grid.bars,
    beats: grid.beats,
    tatums: grid.tatums,
    segments
  };
};

describe("jukebox graph", () => {
  const graph = buildGraph(song(), "bar");

  test("has a quantum per bar and some branches", () => {
    expect(graph.count).toBe(32);
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  test("links the repeated phrase to its repeats", () => {
    const repeats = [0, 1, 2, 3, 8, 9, 10, 11, 24, 25, 26, 27];
    // every arc joins two repeats, except the long backward branch the
    // algorithm adds from the last branch point so the song never ends
    for (const [from, to] of graph.edges) {
      if (from === graph.lastBranchPoint) continue;
      expect(repeats).toContain(from);
      expect(repeats).toContain(to);
    }
    expect(graph.edges.some(([from, to]) => from === 0 && to === 8)).toBe(true);
    expect(graph.edges.some(([from]) => from === graph.lastBranchPoint)).toBe(true);
  });

  test("only links bars at the same position in the phrase", () => {
    for (const [from, to] of graph.edges) {
      expect(from % 4).toBe(to % 4);
    }
  });

  test("drawing data covers every bar", () => {
    expect(graph.loudness).toHaveLength(32);
    expect(graph.hue).toHaveLength(32);
  });

  test("beat graphs only link equal beats in the bar", () => {
    const beats = buildGraph(song(), "beat");
    expect(beats.count).toBe(128);
    for (const [from, to] of beats.edges) expect(from % 4).toBe(to % 4);
  });
});

describe("jukebox walker", () => {
  const graph = {
    count: 8,
    lastBranchPoint: 6,
    edges: [
      [2, 5, 10],
      [6, 1, 12],
      [6, 3, 20]
    ] as [number, number, number][],
    loudness: new Array(8).fill(0.5),
    hue: new Array(8).fill(200)
  };

  test("never branches where there is no edge", () => {
    const walker = new JukeboxWalker(graph, "beat", "high", () => 0);
    expect(walker.choose(0)).toBe(0);
    expect(walker.choose(4)).toBe(4);
  });

  test("always branches at the last branch point, rotating its arcs", () => {
    const walker = new JukeboxWalker(graph, "beat", "mid", () => 0.99);
    expect(walker.choose(6)).toBe(1);
    expect(walker.choose(6)).toBe(3);
    expect(walker.choose(6)).toBe(1);
  });

  test("branch chance ramps up and resets after a branch", () => {
    // random 0.25: below the start chance of mid (0.18)? no — so it waits
    const walker = new JukeboxWalker(graph, "beat", "mid", () => 0.25);
    const choices = Array.from({ length: 6 }, () => walker.choose(2));
    // ramps 0.198, 0.216, 0.234, 0.252 → branches on the 4th visit, then resets
    expect(choices).toEqual([2, 2, 2, 5, 2, 2]);
  });

  test("force branches when an edge exists", () => {
    const walker = new JukeboxWalker(graph, "bar", "low", () => 0.99);
    expect(walker.choose(2, true)).toBe(5);
    expect(walker.choose(0, true)).toBe(0);
  });
});

describe("jukebox smoothing", () => {
  const graph = {
    count: 10,
    lastBranchPoint: 9,
    edges: [
      [1, 5, 8],
      [1, 7, 12],
      [2, 6, 30],
      [3, 8, 60],
      [9, 2, 70]
    ] as [number, number, number][],
    loudness: new Array(10).fill(0.5),
    hue: new Array(10).fill(200)
  };

  test("drops the least similar arcs, but never the last way back", () => {
    const walker = new JukeboxWalker(graph, "bar", "mid", () => 0, 0.6);
    // cutoff is the distance at the 60th percentile: 60, so only 70 goes…
    expect(walker.candidates(3)).toEqual([8]);
    // …except from the last branch point, which keeps every arc
    expect(walker.candidates(9)).toEqual([2]);

    const strict = new JukeboxWalker(graph, "bar", "mid", () => 0, 0.2);
    expect(strict.candidates(1)).toEqual([5, 7]);
    expect(strict.candidates(2)).toEqual([]);
    expect(strict.candidates(3)).toEqual([]);
    expect(strict.candidates(9)).toEqual([2]);
  });

  test("candidates rotate between visits", () => {
    const walker = new JukeboxWalker(graph, "bar", "mid", () => 0, 1);
    expect(walker.candidates(1)).toEqual([5, 7]);
    expect(walker.candidates(1)).toEqual([7, 5]);
  });

  test("forced branches need an arc to take", () => {
    const walker = new JukeboxWalker(graph, "bar", "mid", () => 0.99, 1);
    expect(walker.wantsBranch(1, true)).toBe(true);
    expect(walker.wantsBranch(4, true)).toBe(false);
    expect(walker.wantsBranch(9)).toBe(true);
  });
});
