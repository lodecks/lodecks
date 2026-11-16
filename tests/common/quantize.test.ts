import { describe, expect, test } from "bun:test";

import {
  barSeconds,
  bpmToCps,
  loopPosition,
  nextBoundary,
  tapTempo
} from "@/common/utils/quantize.util";

describe("nextBoundary", () => {
  test("next bar", () => {
    expect(nextBoundary(3.2, "bar")).toBe(4);
  });

  test("a boundary we are exactly on is kept", () => {
    expect(nextBoundary(4, "bar")).toBe(4);
  });

  test("beats and 16ths", () => {
    expect(nextBoundary(3.3, "beat")).toBe(3.5);
    expect(nextBoundary(3.3, "16th")).toBeCloseTo(3.3125);
  });

  test("phrases are 4 bars", () => {
    expect(nextBoundary(5.1, "phrase")).toBe(8);
  });

  test("lead time pushes past a boundary that is too close", () => {
    expect(nextBoundary(3.99, "bar", 0.02)).toBe(5);
  });

  test("off launches now plus lead", () => {
    expect(nextBoundary(3.21, "off", 0.01)).toBeCloseTo(3.22);
  });
});

describe("tempo maths", () => {
  test("bpm to cycles per second, one cycle per bar", () => {
    expect(bpmToCps(120)).toBe(0.5);
    expect(barSeconds(120)).toBe(2);
  });

  test("loop position wraps, also for negative cycles", () => {
    expect(loopPosition(9.5, 4)).toBe(1.5);
    expect(loopPosition(-1, 4)).toBe(3);
  });

  test("tap tempo averages recent taps", () => {
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
    // a long pause starts a new measurement
    expect(tapTempo([0, 400, 5000, 5500, 6000])).toBe(120);
    expect(tapTempo([0, 500])).toBeUndefined();
  });
});
