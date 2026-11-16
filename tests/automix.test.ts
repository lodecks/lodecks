import { describe, expect, test } from "bun:test";

import {
  Profile,
  exitCandidates,
  planTransition,
  vocalClash
} from "@/engine/modules/automix/planner.module";

const profile = (bars: number, vocal: (bar: number) => number, extra: Partial<Profile> = {}): Profile => ({
  bars,
  vocals: Array.from({ length: bars }, (_, bar) => vocal(bar)),
  drums: new Array(bars).fill(0.8),
  bass: new Array(bars).fill(0.7),
  energy: new Array(bars).fill(0.6),
  sections: [],
  ...extra
});

describe("automix planner", () => {
  test("vocal clash is zero when only one song sings", () => {
    const singing = profile(32, () => 1);
    const silent = profile(32, () => 0);
    expect(vocalClash(singing, 0, silent, 0, 16)).toBe(0);
    expect(vocalClash(singing, 0, singing, 0, 16)).toBeGreaterThan(0.3);
  });

  test("exits sit on phrase starts ahead of the playhead", () => {
    const song = profile(64, () => 0);
    const exits = exitCandidates(song, { position: 5.3, length: 8, lookahead: 20 });
    expect(exits.map((exit) => exit.bar)).toEqual([8, 12, 16, 20, 24]);
    expect(exits.every((exit) => exit.bar % 4 === 0)).toBe(true);
  });

  test("no exit past the point where the blend would not fit", () => {
    const song = profile(40, () => 0);
    const exits = exitCandidates(song, { position: 20, length: 16, lookahead: 32 });
    expect(Math.max(...exits.map((exit) => exit.bar))).toBe(24);
  });

  test("leaves where the outgoing vocals stop and enters before the next ones start", () => {
    // outgoing sings bars 0–23, then an instrumental stretch
    const outgoing = profile(64, (bar) => (bar < 24 ? 1 : 0));
    // incoming has an instrumental intro of 16 bars, vocals after
    const incoming = profile(64, (bar) => (bar >= 16 ? 1 : 0));
    const plan = planTransition(outgoing, incoming, { position: 2, length: 16, lookahead: 32 })!;
    expect(plan.exit.bar).toBeGreaterThanOrEqual(24);
    expect(plan.entry).toBe(0);
    expect(plan.reasons).toContain("vocals don't overlap");
  });

  test("lands on a given entry bar (a cue) when asked, still picking the exit", () => {
    const outgoing = profile(64, (bar) => (bar < 24 ? 1 : 0));
    const incoming = profile(64, (bar) => (bar >= 16 ? 1 : 0));
    const plan = planTransition(outgoing, incoming, { position: 2, length: 8, lookahead: 32, entry: 33 })!;
    expect(plan.entry).toBe(33);
    expect(plan.exit.bar).toBeGreaterThanOrEqual(24);
    // past the end of the song it clamps to the last bar
    expect(planTransition(outgoing, incoming, { position: 2, length: 8, lookahead: 32, entry: 500 })!.entry).toBe(63);
  });

  test("takes a jukebox arc when the way ahead is all vocals", () => {
    // sings everywhere except bars 40–59
    const outgoing = profile(80, (bar) => (bar >= 40 && bar < 60 ? 0 : 1));
    const incoming = profile(64, (bar) => (bar >= 16 ? 1 : 0));
    const arcs: [number, number][] = [[6, 38]];
    const plan = planTransition(outgoing, incoming, { position: 1, length: 16, lookahead: 16, arcs })!;
    expect(plan.exit.via).toEqual({ from: 6, to: 38 });
    expect(plan.exit.bar).toBe(40);
  });

  test("prefers a section start and an intro when all else is equal", () => {
    const outgoing = profile(64, () => 0, {
      sections: [
        { name: "verse", bar: 0, bars: 20 },
        { name: "outro", bar: 20, bars: 44 }
      ]
    });
    const incoming = profile(64, () => 0, { sections: [{ name: "intro", bar: 0, bars: 16 }] });
    const plan = planTransition(outgoing, incoming, { position: 0, length: 8, lookahead: 32 })!;
    expect(plan.exit.bar).toBe(20);
    expect(plan.entry).toBe(0);
  });
});
